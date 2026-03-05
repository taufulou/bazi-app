import {
  Injectable,
  Logger,
  OnModuleInit,
  type MessageEvent,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subscriber } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AIProvider, ReadingType, Prisma } from '@prisma/client';
import {
  READING_PROMPTS,
  ZWDS_READING_PROMPTS,
  BASE_SYSTEM_PROMPT,
  ZWDS_BASE_SYSTEM_PROMPT,
  OUTPUT_FORMAT_INSTRUCTIONS,
  COMPARISON_TYPE_ZH,
  GENDER_ZH,
  STRENGTH_V2_ZH,
  LIFETIME_V2_PROMPTS,
  buildBaseSystemPrompt,
  STYLE_RULES,
  type ReadingStyle,
} from './prompts';

// ============================================================
// Types
// ============================================================

export interface InterpretationSection {
  preview: string;
  full: string;
  score?: number;
}

export interface AIInterpretationResult {
  sections: Record<string, InterpretationSection>;
  summary: InterpretationSection;
}

export interface AIGenerationResult {
  interpretation: AIInterpretationResult;
  provider: AIProvider;
  model: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  latencyMs: number;
  isCacheHit: boolean;
}

/** V2 multi-call result with schema version and deterministic data */
export interface AIGenerationResultV2 extends AIGenerationResult {
  schemaVersion: 'v2';
  interpretation: AIInterpretationResult & {
    deterministic: Record<string, unknown>;
  };
}

interface ProviderConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  timeoutMs: number;
  costPerInputToken: number;  // USD per token
  costPerOutputToken: number; // USD per token
}

// ============================================================
// AI Service
// ============================================================

@Injectable()
export class AIService implements OnModuleInit {
  private readonly logger = new Logger(AIService.name);
  private providers: ProviderConfig[] = [];
  // Cached SDK clients — instantiated once at init, not per-request
  private claudeClient: any;
  private openaiClient: any;
  private geminiAI: any;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async onModuleInit() {
    this.initializeProviders();
    await this.initializeClients();
  }

  /**
   * Initialize the provider failover chain: Claude → GPT → Gemini
   */
  private initializeProviders() {
    const claudeKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');

    if (claudeKey) {
      this.providers.push({
        provider: AIProvider.CLAUDE,
        model: this.configService.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-5-20250929',
        apiKey: claudeKey,
        timeoutMs: 30000,
        costPerInputToken: 3 / 1_000_000,   // $3 per 1M input tokens
        costPerOutputToken: 15 / 1_000_000,  // $15 per 1M output tokens
      });
      this.logger.log('Claude provider initialized');
    }

    if (openaiKey) {
      this.providers.push({
        provider: AIProvider.GPT,
        model: this.configService.get<string>('GPT_MODEL') || 'gpt-4o',
        apiKey: openaiKey,
        timeoutMs: 30000,
        costPerInputToken: 2.5 / 1_000_000,
        costPerOutputToken: 10 / 1_000_000,
      });
      this.logger.log('GPT provider initialized');
    }

    if (geminiKey) {
      this.providers.push({
        provider: AIProvider.GEMINI,
        model: this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.0-flash',
        apiKey: geminiKey,
        timeoutMs: 30000,
        costPerInputToken: 2 / 1_000_000,
        costPerOutputToken: 12 / 1_000_000,
      });
      this.logger.log('Gemini provider initialized');
    }

    if (this.providers.length === 0) {
      this.logger.warn('No AI providers configured! Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.');
    }
  }

  /**
   * Initialize SDK clients once at startup — avoids re-importing and re-instantiating per request.
   */
  private async initializeClients() {
    for (const provider of this.providers) {
      try {
        switch (provider.provider) {
          case AIProvider.CLAUDE: {
            const { default: Anthropic } = await import('@anthropic-ai/sdk');
            this.claudeClient = new Anthropic({ apiKey: provider.apiKey });
            this.logger.log('Claude SDK client cached');
            break;
          }
          case AIProvider.GPT: {
            const { default: OpenAI } = await import('openai');
            this.openaiClient = new OpenAI({ apiKey: provider.apiKey });
            this.logger.log('OpenAI SDK client cached');
            break;
          }
          case AIProvider.GEMINI: {
            const { GoogleGenerativeAI } = await import('@google/generative-ai');
            this.geminiAI = new GoogleGenerativeAI(provider.apiKey);
            this.logger.log('Gemini SDK client cached');
            break;
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to initialize ${provider.provider} client: ${err}`);
      }
    }
  }

  // ============================================================
  // Main API: Generate Interpretation
  // ============================================================

  /**
   * Generate an AI interpretation for a Bazi reading.
   * Tries providers in order (Claude → GPT → Gemini) with failover.
   */
  async generateInterpretation(
    calculationData: Record<string, unknown>,
    readingType: ReadingType,
    userId?: string,
    readingId?: string,
    promptVariant?: string,
  ): Promise<AIGenerationResult> {
    if (this.providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    // Build the prompt from calculation data
    const { systemPrompt, userPrompt } = await this.buildPrompt(
      calculationData,
      readingType,
      promptVariant,
    );

    // Try each provider in order
    let lastError: Error | undefined;
    for (const providerConfig of this.providers) {
      try {
        const startTime = Date.now();

        const result = await this.callProvider(
          providerConfig,
          systemPrompt,
          userPrompt,
        );

        const latencyMs = Date.now() - startTime;

        // Calculate cost
        const estimatedCostUsd =
          result.inputTokens * providerConfig.costPerInputToken +
          result.outputTokens * providerConfig.costPerOutputToken;

        // Parse the AI response into structured sections
        const interpretation = this.parseAIResponse(result.content, readingType);

        const generationResult: AIGenerationResult = {
          interpretation,
          provider: providerConfig.provider,
          model: providerConfig.model,
          tokenUsage: {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.inputTokens + result.outputTokens,
            estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
          },
          latencyMs,
          isCacheHit: false,
        };

        // Log usage asynchronously (don't block response)
        this.logUsage(
          userId,
          readingId,
          providerConfig,
          generationResult,
          readingType,
        ).catch((err) => this.logger.error(`Failed to log AI usage: ${err}`));

        this.logger.log(
          `AI interpretation generated via ${providerConfig.provider} (${providerConfig.model}) ` +
          `in ${latencyMs}ms, ${result.inputTokens}+${result.outputTokens} tokens, $${estimatedCostUsd.toFixed(4)}`,
        );

        return generationResult;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `Provider ${providerConfig.provider} failed: ${lastError.message}. Trying next...`,
        );
      }
    }

    throw new Error(`All AI providers failed. Last error: ${lastError?.message}`);
  }

  /**
   * Generate interpretation with streaming support.
   * Returns an async generator that yields text chunks.
   */
  async *generateInterpretationStream(
    calculationData: Record<string, unknown>,
    readingType: ReadingType,
  ): AsyncGenerator<string> {
    if (this.providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    const { systemPrompt, userPrompt } = await this.buildPrompt(
      calculationData,
      readingType,
    );

    // For streaming, only try the primary provider
    const providerConfig = this.providers[0];

    yield* this.streamProvider(providerConfig, systemPrompt, userPrompt);
  }

  // ============================================================
  // Lifetime V2 Multi-Call Generation
  // ============================================================

  /**
   * Generate a V2 Lifetime interpretation using parallel AI calls.
   * Call 1: Core Life Domains (chart_identity through parents_analysis + summary)
   * Call 2: Timing & Fortune (current_period through annual_health)
   *
   * Both calls receive deterministic data — no data dependency between them.
   * Uses Promise.allSettled for partial failure resilience.
   *
   * On total V2 failure, falls back to V1 single-call via generateInterpretation().
   */
  async generateLifetimeV2Interpretation(
    calculationData: Record<string, unknown>,
    userId?: string,
    readingId?: string,
    style: ReadingStyle = 'expert',
  ): Promise<AIGenerationResult> {
    if (this.providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    const timeoutMs = parseInt(
      this.configService.get<string>('AI_CALL_TIMEOUT_MS') || '60000',
      10,
    );

    // Build both prompts from calculation data
    const { systemPrompt, userPromptCall1, userPromptCall2 } =
      this.buildLifetimeV2Prompts(calculationData, style);

    // Try each provider in order (fallback chain: Claude → GPT-4o → Gemini)
    let lastError: Error | undefined;

    for (const providerConfig of this.providers) {
      try {
        // Fire both calls in parallel via Promise.allSettled
        const call1Promise = this.callProviderWithTimeout(
          providerConfig, systemPrompt, userPromptCall1, timeoutMs,
        );
        const call2Promise = this.callProviderWithTimeout(
          providerConfig, systemPrompt, userPromptCall2, timeoutMs,
        );

        const startTime = Date.now();
        const [result1, result2] = await Promise.allSettled([call1Promise, call2Promise]);
        const latencyMs = Date.now() - startTime;

        const call1Success = result1.status === 'fulfilled';
        const call2Success = result2.status === 'fulfilled';

        if (!call1Success) {
          this.logger.warn(`Lifetime V2 Call 1 failed (${providerConfig.provider}): ${(result1 as PromiseRejectedResult).reason}`);
        }
        if (!call2Success) {
          this.logger.warn(`Lifetime V2 Call 2 failed (${providerConfig.provider}): ${(result2 as PromiseRejectedResult).reason}`);
        }

        // Both failed for this provider — try next provider
        if (!call1Success && !call2Success) {
          lastError = new Error(`Provider ${providerConfig.provider}: both V2 calls failed`);
          this.logger.warn(`V2 provider ${providerConfig.provider} both calls failed. Trying next...`);
          continue;
        }

        // At least one call succeeded — parse and merge results
        let sections: Record<string, InterpretationSection> = {};
        let summary: InterpretationSection = { preview: '', full: '' };
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        if (call1Success) {
          const r1 = (result1 as PromiseFulfilledResult<{ content: string; inputTokens: number; outputTokens: number }>).value;
          totalInputTokens += r1.inputTokens;
          totalOutputTokens += r1.outputTokens;

          const parsed1 = this.parseLifetimeV2CallResponse(r1.content, 'call1');
          // Apply auto-fix before merging
          const { result: fixed1 } = this.autoFixAllSections(parsed1, calculationData);
          sections = { ...sections, ...fixed1.sections };
          if (fixed1.summary && (fixed1.summary.preview || fixed1.summary.full)) {
            summary = fixed1.summary;
          }

          // Log Call 1 usage
          this.logUsage(userId, readingId, providerConfig, {
            interpretation: { sections: fixed1.sections, summary: fixed1.summary },
            provider: providerConfig.provider,
            model: providerConfig.model,
            tokenUsage: {
              inputTokens: r1.inputTokens,
              outputTokens: r1.outputTokens,
              totalTokens: r1.inputTokens + r1.outputTokens,
              estimatedCostUsd: 0,
            },
            latencyMs,
            isCacheHit: false,
          }, 'LIFETIME' as ReadingType).catch(() => {});
        }

        if (call2Success) {
          const r2 = (result2 as PromiseFulfilledResult<{ content: string; inputTokens: number; outputTokens: number }>).value;
          totalInputTokens += r2.inputTokens;
          totalOutputTokens += r2.outputTokens;

          const parsed2 = this.parseLifetimeV2CallResponse(r2.content, 'call2');
          // Apply auto-fix before merging
          const { result: fixed2 } = this.autoFixAllSections(parsed2, calculationData);
          sections = { ...sections, ...fixed2.sections };

          // Log Call 2 usage
          this.logUsage(userId, readingId, providerConfig, {
            interpretation: { sections: parsed2.sections, summary: { preview: '', full: '' } },
            provider: providerConfig.provider,
            model: providerConfig.model,
            tokenUsage: {
              inputTokens: r2.inputTokens,
              outputTokens: r2.outputTokens,
              totalTokens: r2.inputTokens + r2.outputTokens,
              estimatedCostUsd: 0,
            },
            latencyMs,
            isCacheHit: false,
          }, 'LIFETIME' as ReadingType).catch(() => {});
        } else if (call1Success) {
          // Call 1 succeeded, Call 2 failed — return Call 1 sections only (still valuable)
          this.logger.warn('Lifetime V2 Call 2 failed — returning Call 1 sections only');
        }

        // Merge with deterministic data from lifetimeEnhancedInsights
        // Python engine returns snake_case keys; convert to camelCase for frontend
        const enhancedInsights = calculationData['lifetimeEnhancedInsights'] as Record<string, unknown> | undefined;
        const rawDeterministic = (enhancedInsights?.['deterministic'] || {}) as Record<string, unknown>;
        const deterministic: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rawDeterministic)) {
          const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
          deterministic[camelKey] = value;
        }

        const totalCost =
          totalInputTokens * providerConfig.costPerInputToken +
          totalOutputTokens * providerConfig.costPerOutputToken;

        const interpretation: AIInterpretationResult & { deterministic: Record<string, unknown>; schemaVersion: string } = {
          sections,
          summary,
          deterministic,
          schemaVersion: 'v2',
        };

        this.logger.log(
          `Lifetime V2 generated via ${providerConfig.provider} in ${latencyMs}ms, ` +
          `${totalInputTokens}+${totalOutputTokens} tokens (total), $${totalCost.toFixed(4)}, ` +
          `call1=${call1Success ? 'ok' : 'FAIL'}, call2=${call2Success ? 'ok' : 'FAIL'}`,
        );

        return {
          interpretation,
          provider: providerConfig.provider,
          model: providerConfig.model,
          tokenUsage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
            estimatedCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
          },
          latencyMs,
          isCacheHit: false,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `V2 provider ${providerConfig.provider} failed: ${lastError.message}. Trying next...`,
        );
      }
    }

    // All providers exhausted for V2 → fall back to V1 single-call
    this.logger.warn(`Lifetime V2 all providers failed (last: ${lastError?.message}) — falling back to V1`);
    return this.generateInterpretation(
      calculationData,
      ReadingType.LIFETIME,
      userId,
      readingId,
    );
  }

  /**
   * Call a provider with a timeout. Passes AbortController signal to SDK.
   */
  private async callProviderWithTimeout(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    timeoutMs: number,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.callProvider(config, systemPrompt, userPrompt, controller.signal);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============================================================
  // Lifetime V2 SSE Streaming
  // ============================================================

  /**
   * Stream Lifetime V2 AI interpretation via SSE Observable.
   * Call 1 streams with progressive brace-depth section extraction.
   * Call 2 runs non-streaming in parallel; sections flushed after Call 1.
   */
  streamLifetimeV2(
    calculationData: Record<string, unknown>,
    readingId: string,
    style: ReadingStyle = 'expert',
  ): Observable<MessageEvent> {
    return new Observable((subscriber: Subscriber<MessageEvent>) => {
      this._executeStreamLifetimeV2(calculationData, readingId, subscriber, style)
        .catch((err) => {
          const message = err instanceof Error ? err.message : 'Stream failed';
          subscriber.next({
            data: JSON.stringify({ message }),
            type: 'error',
          } as MessageEvent);
          subscriber.complete();
        });
    });
  }

  private async _executeStreamLifetimeV2(
    calculationData: Record<string, unknown>,
    readingId: string,
    subscriber: Subscriber<MessageEvent>,
    style: ReadingStyle = 'expert',
  ) {
    const startTime = Date.now();
    // Streaming V2 timeout: default 180s (sections are capped at ~200-450 chars each)
    const timeoutMs = parseInt(
      this.configService.get<string>('AI_STREAM_TIMEOUT_MS') ||
      this.configService.get<string>('AI_CALL_TIMEOUT_MS') || '180000',
      10,
    );

    if (this.providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    const { systemPrompt, userPromptCall1, userPromptCall2 } =
      this.buildLifetimeV2Prompts(calculationData, style);

    // Heartbeat every 15s to prevent proxy timeouts
    const heartbeatInterval = setInterval(() => {
      try {
        subscriber.next({ data: '', type: 'heartbeat' } as MessageEvent);
      } catch {
        // subscriber already closed
      }
    }, 15000);

    // Declare timeout handles outside loop so finally can reference the latest pair
    let call1Timeout: ReturnType<typeof setTimeout> | undefined;
    let call2Timeout: ReturnType<typeof setTimeout> | undefined;
    let totalSections = 0;

    try {
      // Try each provider in order (fallback chain: Claude → GPT-4o → Gemini)
      let v2Succeeded = false;
      let activeProviderConfig = this.providers[0]; // track for DB/logging

      for (const providerConfig of this.providers) {
        // Fresh AbortControllers per provider attempt
        const call1Controller = new AbortController();
        const call2Controller = new AbortController();
        call1Timeout = setTimeout(() => call1Controller.abort(), timeoutMs);
        call2Timeout = setTimeout(() => call2Controller.abort(), timeoutMs);
        activeProviderConfig = providerConfig;

        try {
          // Fire Call 2 (non-streaming) in parallel
          const call2Promise = this.callProvider(
            providerConfig, systemPrompt, userPromptCall2, call2Controller.signal,
          ).catch((err) => {
            this.logger.warn(`Stream Call 2 failed (${providerConfig.provider}): ${err instanceof Error ? err.message : err}`);
            return null;
          });

          // Call 1: streaming with progressive section extraction
          const call1Sections: Record<string, InterpretationSection> = {};
          let call1Summary: InterpretationSection = { preview: '', full: '' };
          let call1Buffer = '';
          let call1OutputTokens = 0;

          try {
            const streamGen = this.streamProvider(
              providerConfig, systemPrompt, userPromptCall1, call1Controller.signal,
            );

            const extractedKeys = new Set<string>();

            for await (const chunk of streamGen) {
              call1Buffer += chunk;

              // Progressive extraction: try to extract completed sections
              const newSections = this.extractCompletedSections(
                call1Buffer,
                LIFETIME_V2_PROMPTS.call1Sections,
                extractedKeys,
              );

              for (const [key, rawSection] of Object.entries(newSections)) {
                // Apply auto-fix before emitting
                const { section } = this.autoFixSection(key, rawSection, calculationData);
                call1Sections[key] = section;
                totalSections++;
                subscriber.next({
                  data: JSON.stringify({ key, preview: section.preview, full: section.full, ...(section.score != null && { score: section.score }) }),
                  type: 'section_complete',
                } as MessageEvent);
              }
            }

            // Parse any remaining sections from the complete buffer
            const finalParsed = this.parseLifetimeV2CallResponse(call1Buffer, 'call1');
            for (const [key, rawSection] of Object.entries(finalParsed.sections)) {
              if (!call1Sections[key]) {
                // Apply auto-fix before emitting
                const { section } = this.autoFixSection(key, rawSection, calculationData);
                call1Sections[key] = section;
                totalSections++;
                subscriber.next({
                  data: JSON.stringify({ key, preview: section.preview, full: section.full, ...(section.score != null && { score: section.score }) }),
                  type: 'section_complete',
                } as MessageEvent);
              }
            }
            if (finalParsed.summary && (finalParsed.summary.preview || finalParsed.summary.full)) {
              call1Summary = finalParsed.summary;
            }

            // Estimate tokens from buffer length (approximation for streaming)
            call1OutputTokens = Math.ceil(call1Buffer.length / 3);

            subscriber.next({
              data: JSON.stringify({ call: 1 }),
              type: 'call_complete',
            } as MessageEvent);

          } catch (err) {
            const message = err instanceof Error ? err.message : 'Call 1 stream failed';
            this.logger.warn(`Stream Call 1 failed (${providerConfig.provider}): ${message}`);
            subscriber.next({
              data: JSON.stringify({ message, partial: true }),
              type: 'error',
            } as MessageEvent);
          }

          // Await Call 2 result and flush sections
          // Parse once, cache result for both emit + DB (avoid redundant double-parse)
          const call2Result = await call2Promise;
          const call2Parsed = call2Result
            ? this.parseLifetimeV2CallResponse(call2Result.content, 'call2')
            : null;

          // Build auto-fixed Call 2 sections for both emit and DB consistency
          const call2FixedSections: Record<string, InterpretationSection> = {};
          if (call2Parsed) {
            for (const [key, rawSection] of Object.entries(call2Parsed.sections)) {
              const { section } = this.autoFixSection(key, rawSection, calculationData);
              call2FixedSections[key] = section;
              totalSections++;
              subscriber.next({
                data: JSON.stringify({ key, preview: section.preview, full: section.full, ...(section.score != null && { score: section.score }) }),
                type: 'section_complete',
              } as MessageEvent);
            }

            subscriber.next({
              data: JSON.stringify({ call: 2 }),
              type: 'call_complete',
            } as MessageEvent);
          }

          // Emit summary
          if (call1Summary.preview || call1Summary.full) {
            subscriber.next({
              data: JSON.stringify({ preview: call1Summary.preview, full: call1Summary.full }),
              type: 'summary',
            } as MessageEvent);
          }

          // Merge all sections for DB update (use auto-fixed Call 2 sections for consistency)
          const allSections: Record<string, InterpretationSection> = {
            ...call1Sections,
            ...call2FixedSections,
          };

          // Build deterministic data
          const enhancedInsights = calculationData['lifetimeEnhancedInsights'] as Record<string, unknown> | undefined;
          const rawDeterministic = (enhancedInsights?.['deterministic'] || {}) as Record<string, unknown>;
          const deterministic: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(rawDeterministic)) {
            const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
            deterministic[camelKey] = value;
          }

          const aiInterpretation = {
            schemaVersion: 'v2',
            sections: allSections,
            summary: call1Summary,
            deterministic,
          };

          // Update DB record with complete AI interpretation
          try {
            await this.prisma.baziReading.update({
              where: { id: readingId },
              data: {
                aiInterpretation: aiInterpretation as unknown as Prisma.InputJsonValue,
                aiProvider: providerConfig.provider as any,
                aiModel: providerConfig.model,
              },
            });
          } catch (dbErr) {
            this.logger.error(`Failed to update reading ${readingId} with AI: ${dbErr}`);
          }

          // Cache the result for future requests
          const birthDataHash = this.generateBirthDataHash(
            calculationData['birthDate'] as string || '',
            calculationData['birthTime'] as string || '',
            '', // birthCity not available here
            calculationData['gender'] as string || '',
            ReadingType.LIFETIME,
            undefined, undefined, undefined, undefined,
            style, // use the direct `style` parameter from _executeStreamLifetimeV2
          );
          this.cacheInterpretation(
            birthDataHash,
            ReadingType.LIFETIME,
            calculationData,
            aiInterpretation as unknown as AIInterpretationResult,
          ).catch((err) => this.logger.error(`Stream cache write failed: ${err}`));

          v2Succeeded = true;
          break; // success, exit provider loop

        } catch (err) {
          this.logger.warn(
            `Stream V2 provider ${providerConfig.provider} failed: ${err instanceof Error ? err.message : err}. Trying next...`,
          );
          // Clean up this iteration's timeouts before retrying
          clearTimeout(call1Timeout);
          clearTimeout(call2Timeout);
          // If some sections were already streamed, accept partial results — don't retry
          if (totalSections > 0) {
            v2Succeeded = true;
            break;
          }
        }
      }

      if (!v2Succeeded) {
        subscriber.next({
          data: JSON.stringify({ message: 'All V2 providers failed' }),
          type: 'error',
        } as MessageEvent);
      }

      const latencyMs = Date.now() - startTime;
      this.logger.log(
        `Stream Lifetime V2 completed via ${activeProviderConfig.provider} in ${latencyMs}ms, ${totalSections} sections delivered`,
      );

      // Done event
      subscriber.next({
        data: JSON.stringify({ totalSections, latencyMs }),
        type: 'done',
      } as MessageEvent);

    } finally {
      // CRITICAL: This MUST stay at outermost scope — cleans up regardless of loop outcome
      clearInterval(heartbeatInterval);
      clearTimeout(call1Timeout!);
      clearTimeout(call2Timeout!);
      subscriber.complete(); // ALWAYS closes the SSE stream
    }
  }

  /**
   * Extract completed JSON sections from a streaming buffer using brace-depth tracking.
   * Handles escaped characters and string contexts properly.
   *
   * For each known section key, scans the buffer for `"KEY":` followed by `{`,
   * then tracks brace depth. When depth returns to 0, the section object is complete.
   */
  private extractCompletedSections(
    buffer: string,
    expectedKeys: readonly string[],
    alreadyExtracted: Set<string>,
  ): Record<string, InterpretationSection> {
    const result: Record<string, InterpretationSection> = {};

    for (const key of expectedKeys) {
      if (alreadyExtracted.has(key)) continue;

      // Find the key's object start: "key": {
      const keyPattern = `"${key}"`;
      const keyIdx = buffer.indexOf(keyPattern);
      if (keyIdx === -1) continue;

      // Find the opening brace after the key
      let i = keyIdx + keyPattern.length;
      // Skip whitespace and colon
      while (i < buffer.length && (buffer[i] === ' ' || buffer[i] === ':' || buffer[i] === '\n' || buffer[i] === '\r' || buffer[i] === '\t')) {
        i++;
      }
      if (i >= buffer.length || buffer[i] !== '{') continue;

      // Track brace depth with string awareness
      const startBrace = i;
      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let j = startBrace; j < buffer.length; j++) {
        const ch = buffer[j];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === '\\') {
          escaped = true;
          continue;
        }

        if (ch === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              // Complete section object found
              const sectionJson = buffer.substring(startBrace, j + 1);
              try {
                const parsed = JSON.parse(sectionJson);
                if (parsed.preview !== undefined && parsed.full !== undefined) {
                  result[key] = {
                    preview: parsed.preview,
                    full: parsed.full,
                    score: typeof parsed.score === 'number' ? parsed.score : undefined,
                  };
                  alreadyExtracted.add(key);
                }
              } catch {
                // JSON not valid yet — possibly truncated string content
                // Skip this key for now, will retry next chunk
              }
              break;
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Build system + user prompts for both V2 calls.
   * Context bridge for Call 2 is assembled from deterministic pre-analysis data.
   */
  private buildLifetimeV2Prompts(
    calculationData: Record<string, unknown>,
    style: ReadingStyle = 'expert',
  ): { systemPrompt: string; userPromptCall1: string; userPromptCall2: string } {
    const basePrompt = buildBaseSystemPrompt(style);
    const styleRules = STYLE_RULES[style];
    const systemPrompt = basePrompt + '\n\n' + LIFETIME_V2_PROMPTS.systemAddition + (styleRules ? '\n' + styleRules : '');

    // Interpolate shared placeholders for both calls
    let call1Template = LIFETIME_V2_PROMPTS.userTemplateCall1;
    let call2Template = LIFETIME_V2_PROMPTS.userTemplateCall2;

    // Apply standard interpolation (reuses existing logic)
    call1Template = this.interpolateTemplate(call1Template, calculationData, ReadingType.LIFETIME);
    call2Template = this.interpolateTemplate(call2Template, calculationData, ReadingType.LIFETIME);

    // Interpolate V2-specific placeholders
    call1Template = this.interpolateLifetimeV2Fields(call1Template, calculationData);
    call2Template = this.interpolateLifetimeV2Fields(call2Template, calculationData);

    // Build deterministic context bridge for Call 2
    call2Template = this.interpolateContextBridge(call2Template, calculationData);

    // Interpolate enriched luck periods for Call 2
    call2Template = this.interpolateEnrichedLuckPeriods(call2Template, calculationData);

    // Append output format instructions (guide style gets score field)
    let outputFormatCall1 = LIFETIME_V2_PROMPTS.outputFormatCall1;
    let outputFormatCall2 = LIFETIME_V2_PROMPTS.outputFormatCall2;
    if (style === 'guide') {
      // Inject "score" field into JSON format examples for guide style
      outputFormatCall1 = outputFormatCall1.replace(
        /{ "preview"/g,
        '{ "score": <1-5的數字，支持0.5如3.5>, "preview"',
      );
      outputFormatCall2 = outputFormatCall2.replace(
        /{ "preview"/g,
        '{ "score": <1-5的數字，支持0.5如3.5>, "preview"',
      );
    }
    const userPromptCall1 = call1Template + '\n\n' + outputFormatCall1;
    const userPromptCall2 = call2Template + '\n\n' + outputFormatCall2;

    return { systemPrompt, userPromptCall1, userPromptCall2 };
  }

  /**
   * Interpolate V2-specific placeholders (patternNarrative, childrenInsights, etc.)
   */
  private interpolateLifetimeV2Fields(
    template: string,
    data: Record<string, unknown>,
  ): string {
    let result = template;
    const enhanced = data['lifetimeEnhancedInsights'] as Record<string, unknown> | undefined;

    // Pattern Narrative
    const patternNarrative = enhanced?.['patternNarrative'] as Record<string, unknown> | undefined;
    if (patternNarrative) {
      const pnText = [
        `格局名稱：${patternNarrative['patternName']}`,
        `推導邏輯：${patternNarrative['patternLogic']}`,
        `日主與格局關係：${patternNarrative['patternStrengthRelation']}`,
        `主導十神：${(patternNarrative['dominantTenGods'] as string[] || []).join('、')}`,
      ].join('\n');
      result = result.replace(/\{\{patternNarrative\}\}/g, pnText);
    } else {
      result = result.replace(/\{\{patternNarrative\}\}/g, '（資料未提供）');
    }

    // Children Insights — now uses narrative anchors (self-narrating sentences)
    const narrativeAnchors = enhanced?.['narrativeAnchors'] as Record<string, string[]> | undefined;
    const childrenAnchors = narrativeAnchors?.['children_analysis'] as string[] | undefined;
    if (childrenAnchors && childrenAnchors.length > 0) {
      const ciText = childrenAnchors.map((a, i) => `${i + 1}. ${a}`).join('\n');
      result = result.replace(/\{\{childrenInsights\}\}/g, ciText);
    } else {
      // Fallback to old format if narrative anchors not available
      const childrenInsights = enhanced?.['childrenInsights'] as Record<string, unknown> | undefined;
      if (childrenInsights) {
        const ciText = [
          `食傷顯現數（天干中）：${childrenInsights['shishanManifestCount']}`,
          `食傷潛藏數（地支本氣）：${childrenInsights['shishanLatentCount']}`,
          `食傷透干：${(childrenInsights['shishanTransparent'] as string[] || []).join('、') || '無'}`,
          `時支本氣十神（非時干）：${childrenInsights['hourPillarTenGod']}`,
          `食傷被印制：${childrenInsights['isShishanSuppressed'] ? '是' : '否'}`,
          `時支十二長生：${childrenInsights['hourBranchLifeStage']}`,
        ].join('\n');
        result = result.replace(/\{\{childrenInsights\}\}/g, ciText);
      } else {
        result = result.replace(/\{\{childrenInsights\}\}/g, '（資料未提供）');
      }
    }

    // Parents Insights — now uses narrative anchors (self-narrating sentences)
    const parentsAnchors = narrativeAnchors?.['parents_analysis'] as string[] | undefined;
    if (parentsAnchors && parentsAnchors.length > 0) {
      const piText = parentsAnchors.map((a, i) => `${i + 1}. ${a}`).join('\n');
      result = result.replace(/\{\{parentsInsights\}\}/g, piText);
    } else {
      // Fallback to old format if narrative anchors not available
      const parentsInsights = enhanced?.['parentsInsights'] as Record<string, unknown> | undefined;
      if (parentsInsights) {
        const piText = [
          `年干${parentsInsights['yearStemTenGod'] || ''}；父星（古典）：${parentsInsights['fatherStar']}`,
          `年支本氣${parentsInsights['yearBranchMainTenGod'] || ''}；母星（古典）：${parentsInsights['motherStar']}`,
          `父親五行（財星）：${parentsInsights['fatherElement']}`,
          `母親五行（印星）：${parentsInsights['motherElement']}`,
          `年柱生剋關係：${parentsInsights['yearPillarRelation']}`,
          `年柱喜忌：${parentsInsights['yearPillarFavorability']}`,
        ].join('\n');
        result = result.replace(/\{\{parentsInsights\}\}/g, piText);
      } else {
        result = result.replace(/\{\{parentsInsights\}\}/g, '（資料未提供）');
      }
    }

    // Boss Compatibility
    const bossCompat = enhanced?.['bossCompatibility'] as Record<string, unknown> | undefined;
    if (bossCompat) {
      const bcText = [
        `主導風格：${bossCompat['dominantStyle']}`,
        `理想上司類型：${bossCompat['idealBossType']}`,
        `職場優勢：${(bossCompat['workplaceStrengths'] as string[] || []).join('、')}`,
        `職場警示：${(bossCompat['workplaceWarnings'] as string[] || []).join('、')}`,
      ].join('\n');
      result = result.replace(/\{\{bossCompatibility\}\}/g, bcText);
    } else {
      result = result.replace(/\{\{bossCompatibility\}\}/g, '（資料未提供）');
    }

    // Per-section narrative anchors — Call 1 (chart_identity, finance_pattern, career_pattern, love_pattern, health, boss_strategy, summary)
    const anchorSections = ['chart_identity', 'finance_pattern', 'career_pattern', 'love_pattern', 'health', 'boss_strategy', 'summary'];
    for (const section of anchorSections) {
      const sectionAnchors = narrativeAnchors?.[section] as string[] | undefined;
      const placeholder = `{{anchors_${section}}}`;
      if (sectionAnchors && sectionAnchors.length > 0) {
        const anchorText = sectionAnchors.map((a, i) => `${i + 1}. ${a}`).join('\n');
        result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), anchorText);
      } else {
        result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), '（錨點資料未提供）');
      }
    }

    // Per-section narrative anchors — Call 2 (current_period, next_period, best_period, annual_love, annual_career, annual_finance, annual_health)
    const call2Anchors = enhanced?.['call2NarrativeAnchors'] as Record<string, string[]> | undefined;
    const call2Sections = ['current_period', 'next_period', 'best_period', 'annual_love', 'annual_career', 'annual_finance', 'annual_health'];
    for (const section of call2Sections) {
      const sectionAnchors = call2Anchors?.[section] as string[] | undefined;
      const placeholder = `{{anchors_${section}}}`;
      if (sectionAnchors && sectionAnchors.length > 0) {
        const anchorText = sectionAnchors.map((a, i) => `${i + 1}. ${a}`).join('\n');
        result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), anchorText);
      } else {
        result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), '（錨點資料未提供）');
      }
    }

    // Annual Ten God
    const deterministic = enhanced?.['deterministic'] as Record<string, unknown> | undefined;
    const annualTenGod = deterministic?.['annualTenGod'] as string || '（資料未提供）';
    result = result.replace(/\{\{annualTenGod\}\}/g, annualTenGod);

    return result;
  }

  /**
   * Build deterministic context bridge for Call 2.
   * Assembled from pre-analysis data (NOT from Call 1 AI output) — enables true parallel execution.
   */
  private interpolateContextBridge(
    template: string,
    data: Record<string, unknown>,
  ): string {
    const preAnalysis = data['preAnalysis'] as Record<string, unknown> | undefined;
    const dayMaster = data['dayMaster'] as Record<string, unknown> | undefined;
    const enhanced = data['lifetimeEnhancedInsights'] as Record<string, unknown> | undefined;
    const patternNarrative = enhanced?.['patternNarrative'] as Record<string, unknown> | undefined;

    const bridgeParts: string[] = [];

    // DM element + strength
    const dmStem = data['dayMasterStem'] as string || '';
    const dmElement = dayMaster?.['element'] as string || '';
    const strengthV2 = preAnalysis?.['strengthV2'] as Record<string, unknown> | undefined;
    const classification = STRENGTH_V2_ZH[(strengthV2?.['classification'] as string) || ''] || '';
    bridgeParts.push(`日主${dmStem}（${dmElement}），${classification}`);

    // 用神/忌神
    const effectiveGods = preAnalysis?.['effectiveFavorableGods'] as Record<string, string> | undefined;
    if (effectiveGods) {
      bridgeParts.push(`用神=${effectiveGods['usefulGod']}，喜神=${effectiveGods['favorableGod']}，忌神=${effectiveGods['tabooGod']}，仇神=${effectiveGods['enemyGod']}`);
    }

    // 格局
    const patternName = patternNarrative?.['patternName'] as string || dayMaster?.['pattern'] as string || '';
    bridgeParts.push(`格局：${patternName}`);

    // Pattern strength relation
    const strengthRelation = patternNarrative?.['patternStrengthRelation'] as string || '';
    if (strengthRelation) {
      bridgeParts.push(`格局與日主：${strengthRelation}`);
    }

    const bridge = bridgeParts.join('。');
    return template.replace(/\{\{contextBridge\}\}/g, bridge);
  }

  /**
   * Interpolate enriched luck periods and annual star details for Call 2.
   */
  private interpolateEnrichedLuckPeriods(
    template: string,
    data: Record<string, unknown>,
  ): string {
    let result = template;
    const enhanced = data['lifetimeEnhancedInsights'] as Record<string, unknown> | undefined;
    const deterministic = enhanced?.['deterministic'] as Record<string, unknown> | undefined;
    // Python engine returns snake_case keys; handle both conventions
    const enrichedPeriods = (deterministic?.['luck_periods_enriched'] || deterministic?.['luckPeriodsEnriched']) as Array<Record<string, unknown>> | undefined;
    const bestPeriod = (deterministic?.['best_period'] || deterministic?.['bestPeriod']) as Record<string, unknown> | null | undefined;

    // Enriched luck periods overview
    if (enrichedPeriods?.length) {
      const lpText = enrichedPeriods.map((lp, idx) => {
        const current = lp['isCurrent'] ? ' ← 目前' : '';
        const interactions = (lp['interactions'] as string[] || []).join('、') || '無特殊互動';
        const tenGodLabel = lp['tenGod'] ? `（${lp['tenGod']}）` : '';
        return `[${idx + 1}/${enrichedPeriods.length}] ${lp['startAge']}-${lp['endAge']}歲（${lp['startYear']}-${lp['endYear']}）：` +
          `${lp['stem']}${lp['branch']}${tenGodLabel}，評分${lp['score']}/100${current}\n` +
          `  天干階段：${lp['stemPhase']}\n` +
          `  地支階段：${lp['branchPhase']}\n` +
          `  互動：${interactions}`;
      }).join('\n\n');
      result = result.replace(/\{\{enrichedLuckPeriods\}\}/g, lpText);

      // Current period detail
      const current = enrichedPeriods.find((lp) => lp['isCurrent']);
      const currentIdx = enrichedPeriods.findIndex((lp) => lp['isCurrent']);
      if (current) {
        result = result.replace(/\{\{currentPeriodDetail\}\}/g, this.formatPeriodDetail(current, currentIdx, enrichedPeriods.length));

        // Previous period
        if (currentIdx > 0) {
          result = result.replace(/\{\{previousPeriodDetail\}\}/g,
            this.formatPeriodDetail(enrichedPeriods[currentIdx - 1], currentIdx - 1, enrichedPeriods.length));
        } else {
          result = result.replace(/\{\{previousPeriodDetail\}\}/g, '（無前一大運）');
        }

        // Next period
        if (currentIdx < enrichedPeriods.length - 1) {
          result = result.replace(/\{\{nextPeriodDetail\}\}/g,
            this.formatPeriodDetail(enrichedPeriods[currentIdx + 1], currentIdx + 1, enrichedPeriods.length));
        } else {
          result = result.replace(/\{\{nextPeriodDetail\}\}/g, '（無下一大運）');
        }
      } else {
        result = result.replace(/\{\{currentPeriodDetail\}\}/g, '（未找到當前大運）');
        result = result.replace(/\{\{previousPeriodDetail\}\}/g, '（無資料）');
        result = result.replace(/\{\{nextPeriodDetail\}\}/g, '（無資料）');
      }
    } else {
      result = result.replace(/\{\{enrichedLuckPeriods\}\}/g, '（無大運資料）');
      result = result.replace(/\{\{currentPeriodDetail\}\}/g, '（無資料）');
      result = result.replace(/\{\{previousPeriodDetail\}\}/g, '（無資料）');
      result = result.replace(/\{\{nextPeriodDetail\}\}/g, '（無資料）');
    }

    // Best period
    if (bestPeriod) {
      const bestTenGodLabel = bestPeriod['tenGod'] ? `（${bestPeriod['tenGod']}）` : '';
      result = result.replace(/\{\{bestPeriodDetail\}\}/g,
        `${bestPeriod['stem']}${bestPeriod['branch']}${bestTenGodLabel}大運（${bestPeriod['startAge']}-${bestPeriod['endAge']}歲），` +
        `評分${bestPeriod['score']}/100，天干階段：${bestPeriod['stemPhase']}，地支階段：${bestPeriod['branchPhase']}`);
    } else {
      result = result.replace(/\{\{bestPeriodDetail\}\}/g, '（大運數據不足，無法判定最有利大運）');
    }

    // Annual star detail
    const annualStars = data['annualStars'] as Array<Record<string, unknown>> | undefined;
    const targetYear = data['targetYear'] as number || new Date().getFullYear();
    const annualStar = annualStars?.find((s) => s['year'] === targetYear);
    if (annualStar) {
      const natalInteractions = annualStar['natalInteractions'] as Array<Record<string, unknown>> | undefined;
      const intText = natalInteractions?.length
        ? natalInteractions.map((i) => i['description'] as string).filter(Boolean).join('、')
        : '無特殊互動';
      result = result.replace(/\{\{annualStarDetail\}\}/g,
        `${targetYear}年：${annualStar['stem']}${annualStar['branch']}（${annualStar['tenGod']}）\n互動：${intText}`);
    } else {
      result = result.replace(/\{\{annualStarDetail\}\}/g, `${targetYear}年：（資料未提供）`);
    }

    return result;
  }

  /**
   * Format a single luck period into detail text.
   */
  private formatPeriodDetail(
    period: Record<string, unknown>,
    index: number,
    total: number,
  ): string {
    const interactions = (period['interactions'] as string[] || []).join('、') || '無特殊互動';
    const tenGodLabel = period['tenGod'] ? `（${period['tenGod']}）` : '';
    return `[${index + 1}/${total}] ${period['stem']}${period['branch']}${tenGodLabel}大運（${period['startAge']}-${period['endAge']}歲，${period['startYear']}-${period['endYear']}），` +
      `評分${period['score']}/100\n` +
      `天干階段（前5年）：${period['stemPhase']}\n` +
      `地支階段（後5年）：${period['branchPhase']}\n` +
      `互動：${interactions}`;
  }

  /**
   * Parse a single V2 call response into sections.
   *
   * parseAIResponse() never throws (it always falls back to fallbackParse),
   * so we check for empty sections and fall through to regex extraction.
   */
  private parseLifetimeV2CallResponse(
    rawContent: string,
    callLabel: 'call1' | 'call2',
  ): AIInterpretationResult {
    const expectedKeys = callLabel === 'call1'
      ? LIFETIME_V2_PROMPTS.call1Sections
      : LIFETIME_V2_PROMPTS.call2Sections;

    // Stage 1: Standard JSON parse (never throws — always returns via fallbackParse)
    const parsed = this.parseAIResponse(rawContent, ReadingType.LIFETIME);
    if (Object.keys(parsed.sections).length > 0) {
      return parsed;
    }

    // Stage 2: Regex fallback — extract each expected section key individually.
    // NOTE: This regex is a best-effort last resort. It may fail for section values
    // containing literal { or } characters. For more robust extraction, consider
    // using extractCompletedSections() which uses brace-depth tracking.
    const sections: Record<string, InterpretationSection> = {};
    for (const key of expectedKeys) {
      const regex = new RegExp(`"${key}"\\s*:\\s*\\{[^}]*"preview"\\s*:\\s*"([^"]*)"[^}]*"full"\\s*:\\s*"([^"]*)"`, 's');
      const match = rawContent.match(regex);
      if (match) {
        sections[key] = { preview: match[1] || '', full: match[2] || '' };
      }
    }

    return {
      sections,
      summary: parsed.summary || { preview: '', full: '' },
    };
  }

  // ============================================================
  // Post-Processing Auto-Fix Validation Layer
  // ============================================================

  /**
   * Auto-fix common AI errors in a single section based on ground truth data.
   *
   * Rule-based detection + string replacement. No AI call needed.
   * Returns { text, fixes } where fixes is an array of applied corrections.
   */
  private autoFixSection(
    sectionKey: string,
    section: InterpretationSection,
    calculationData: Record<string, unknown>,
  ): { section: InterpretationSection; fixes: string[] } {
    const fixes: string[] = [];
    let previewText = section.preview;
    let fullText = section.full;

    const enhanced = calculationData['lifetimeEnhancedInsights'] as Record<string, unknown> | undefined;
    const dayMaster = calculationData['dayMaster'] as Record<string, unknown> | undefined;
    const tabooGod = (dayMaster?.['tabooGod'] as string) || '';
    const enemyGod = (dayMaster?.['enemyGod'] as string) || '';

    if (!tabooGod || !enemyGod || tabooGod === enemyGod) {
      return { section, fixes };
    }

    // ---- Fix 1: 忌神/仇神 mislabeling ----
    // If AI calls the enemyGod element "忌神" instead of "仇神", fix it.
    // Pattern: "忌神{enemyGod}" should be "仇神{enemyGod}" when enemyGod ≠ tabooGod
    const wrongLabel = `忌神${enemyGod}`;
    const correctLabel = `仇神${enemyGod}`;
    if (fullText.includes(wrongLabel)) {
      fullText = fullText.split(wrongLabel).join(correctLabel);
      fixes.push(`Fixed: "${wrongLabel}" → "${correctLabel}" in ${sectionKey}.full`);
    }
    if (previewText.includes(wrongLabel)) {
      previewText = previewText.split(wrongLabel).join(correctLabel);
      fixes.push(`Fixed: "${wrongLabel}" → "${correctLabel}" in ${sectionKey}.preview`);
    }

    // Also check for variant patterns like "忌神（土）" when 土 is enemyGod
    const wrongLabelParen = `忌神（${enemyGod}）`;
    const correctLabelParen = `仇神（${enemyGod}）`;
    if (fullText.includes(wrongLabelParen)) {
      fullText = fullText.split(wrongLabelParen).join(correctLabelParen);
      fixes.push(`Fixed: "${wrongLabelParen}" → "${correctLabelParen}" in ${sectionKey}.full`);
    }
    if (previewText.includes(wrongLabelParen)) {
      previewText = previewText.split(wrongLabelParen).join(correctLabelParen);
      fixes.push(`Fixed: "${wrongLabelParen}" → "${correctLabelParen}" in ${sectionKey}.preview`);
    }

    // Variant: "忌神 土" with space
    const wrongLabelSpace = `忌神 ${enemyGod}`;
    const correctLabelSpace = `仇神 ${enemyGod}`;
    if (fullText.includes(wrongLabelSpace)) {
      fullText = fullText.split(wrongLabelSpace).join(correctLabelSpace);
      fixes.push(`Fixed: "${wrongLabelSpace}" → "${correctLabelSpace}" in ${sectionKey}.full`);
    }

    // ---- Fix 2: Children section — wrong hourPillarTenGod reference ----
    if (sectionKey === 'children_analysis') {
      const childrenInsights = enhanced?.['childrenInsights'] as Record<string, unknown> | undefined;
      if (childrenInsights) {
        const correctHourTenGod = childrenInsights['hourPillarTenGod'] as string;

        // Detect if AI references the STEM's ten god instead of the BRANCH main qi's ten god
        // We can identify this by checking if the AI mentions a different ten god for 時支/時柱
        // when describing children's personality/traits
        const pillars = calculationData['pillars'] as Record<string, Record<string, string>> | undefined;
        if (pillars && correctHourTenGod) {
          const hourStem = pillars['hour']?.['stem'] || '';
          const dayMasterStem = calculationData['dayMasterStem'] as string || '';

          if (hourStem && dayMasterStem) {
            // Calculate what the WRONG ten god would be (from hour stem)
            // We can't call derive_ten_god here (Python), so we check common patterns
            // The key pattern: if AI says "時支本氣為{wrongTG}" or "時柱為{wrongTG}"
            // when it should be correctHourTenGod
            const wrongTenGods = ['比肩', '劫財', '食神', '傷官', '偏財', '正財', '偏官', '正官', '偏印', '正印']
              .filter(tg => tg !== correctHourTenGod);

            for (const wrongTG of wrongTenGods) {
              // Pattern: "時支本氣為{wrong}" or "時支{branch}本氣為{wrong}"
              const wrongPatterns = [
                `時支本氣為${wrongTG}`,
                `時柱十神為${wrongTG}`,
                `時柱為${wrongTG}`,
              ];
              for (const wp of wrongPatterns) {
                const cp = wp.replace(wrongTG, correctHourTenGod);
                if (fullText.includes(wp)) {
                  fullText = fullText.split(wp).join(cp);
                  fixes.push(`Fixed: "${wp}" → "${cp}" in children_analysis.full`);
                }
              }
            }
          }
        }

        // Fix transparent/latent contradiction
        // Pattern: "X透於Y干但藏而不透" — self-contradictory
        const transparentPattern = /([甲乙丙丁戊己庚辛壬癸][火木金水土]?(?:食神|傷官))透[於出]([年月時])干[，、但而].*?藏而不透/g;
        const transparentMatch = fullText.match(transparentPattern);
        if (transparentMatch) {
          for (const match of transparentMatch) {
            // The stem is transparent (透), so it should NOT say "藏而不透"
            // Remove the contradictory part
            const fixed = match.replace(/[，、但而].*?藏而不透/, '，屬顯現食傷');
            fullText = fullText.replace(match, fixed);
            fixes.push(`Fixed self-contradiction: "${match.substring(0, 30)}..." → removed "藏而不透" (it IS transparent)`);
          }
        }
      }
    }

    // Strip 📊 綜合評分 text line from full (guide style outputs score as JSON field instead)
    fullText = fullText.replace(/📊\s*綜合評分[：:]\s*[★☆]+\n?/g, '');

    if (fixes.length > 0 || fullText !== section.full) {
      return {
        section: { preview: previewText, full: fullText, score: section.score },
        fixes,
      };
    }

    return { section, fixes };
  }

  /**
   * Apply auto-fix to all sections in a parsed result.
   * Returns the fixed result and a log of all applied fixes.
   */
  private autoFixAllSections(
    parsed: AIInterpretationResult,
    calculationData: Record<string, unknown>,
  ): { result: AIInterpretationResult; allFixes: string[] } {
    const allFixes: string[] = [];
    const fixedSections: Record<string, InterpretationSection> = {};

    for (const [key, section] of Object.entries(parsed.sections)) {
      const { section: fixedSection, fixes } = this.autoFixSection(key, section, calculationData);
      fixedSections[key] = fixedSection;
      allFixes.push(...fixes);
    }

    if (allFixes.length > 0) {
      this.logger.log(`Auto-fix applied ${allFixes.length} corrections: ${allFixes.join('; ')}`);
    }

    return {
      result: {
        sections: fixedSections,
        summary: parsed.summary,
      },
      allFixes,
    };
  }

  // ============================================================
  // Provider Calls
  // ============================================================

  private async callProvider(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    switch (config.provider) {
      case AIProvider.CLAUDE:
        return this.callClaude(config, systemPrompt, userPrompt, signal);
      case AIProvider.GPT:
        return this.callGPT(config, systemPrompt, userPrompt, signal);
      case AIProvider.GEMINI:
        return this.callGemini(config, systemPrompt, userPrompt, signal);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  private async *streamProvider(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    switch (config.provider) {
      case AIProvider.CLAUDE:
        yield* this.streamClaude(config, systemPrompt, userPrompt, signal);
        break;
      case AIProvider.GPT:
        yield* this.streamGPT(config, systemPrompt, userPrompt, signal);
        break;
      case AIProvider.GEMINI:
        yield* this.streamGemini(config, systemPrompt, userPrompt, signal);
        break;
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  // ---- Claude ----

  private async callClaude(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (!this.claudeClient) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.claudeClient = new Anthropic({ apiKey: config.apiKey });
    }

    const response = await this.claudeClient.messages.create(
      {
        model: config.model,
        max_tokens: 16384,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      signal ? { signal } : undefined,
    );

    const content = response.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { type: string; text?: string }) => block.text || '')
      .join('');

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  private async *streamClaude(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (!this.claudeClient) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.claudeClient = new Anthropic({ apiKey: config.apiKey });
    }

    const stream = this.claudeClient.messages.stream(
      {
        model: config.model,
        max_tokens: 16384,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      signal ? { signal } : undefined,
    );

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        'delta' in event &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }

  // ---- GPT ----

  private async callGPT(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (!this.openaiClient) {
      const { default: OpenAI } = await import('openai');
      this.openaiClient = new OpenAI({ apiKey: config.apiKey });
    }

    const response = await this.openaiClient.chat.completions.create({
      model: config.model,
      max_tokens: 16384,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, signal ? { signal } : undefined);

    return {
      content: response.choices[0]?.message?.content || '',
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    };
  }

  private async *streamGPT(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (!this.openaiClient) {
      const { default: OpenAI } = await import('openai');
      this.openaiClient = new OpenAI({ apiKey: config.apiKey });
    }

    const stream = await this.openaiClient.chat.completions.create({
      model: config.model,
      max_tokens: 16384,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, signal ? { signal } : undefined);

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        yield text;
      }
    }
  }

  // ---- Gemini ----

  private async callGemini(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    _signal?: AbortSignal,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (!this.geminiAI) {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      this.geminiAI = new GoogleGenerativeAI(config.apiKey);
    }
    const model = this.geminiAI.getGenerativeModel({
      model: config.model,
      systemInstruction: systemPrompt,
      generationConfig: { maxOutputTokens: 8192 },
    });

    const result = await model.generateContent(userPrompt);
    const response = result.response;

    return {
      content: response.text(),
      inputTokens: response.usageMetadata?.promptTokenCount || 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
    };
  }

  private async *streamGemini(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    _signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (!this.geminiAI) {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      this.geminiAI = new GoogleGenerativeAI(config.apiKey);
    }
    const model = this.geminiAI.getGenerativeModel({
      model: config.model,
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContentStream(userPrompt);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  }

  // ============================================================
  // Prompt Building
  // ============================================================

  /**
   * Build the system and user prompts from calculation data.
   * First checks DB for admin-customized prompt, falls back to defaults.
   */
  async buildPrompt(
    calculationData: Record<string, unknown>,
    readingType: ReadingType,
    promptVariant?: string,
  ): Promise<{ systemPrompt: string; userPrompt: string }> {
    // Handle special prompt variants (cross-system, deep-stars)
    if (promptVariant === 'cross-system') {
      const { CROSS_SYSTEM_PROMPT } = await import('./prompts');
      const baseSystemPrompt = ZWDS_BASE_SYSTEM_PROMPT + '\n\n' + BASE_SYSTEM_PROMPT;
      const systemPrompt = baseSystemPrompt + '\n\n' + CROSS_SYSTEM_PROMPT.systemAddition;
      const userPrompt = this.interpolateTemplate(
        CROSS_SYSTEM_PROMPT.userTemplate,
        calculationData,
        readingType,
      ) + '\n\n' + OUTPUT_FORMAT_INSTRUCTIONS;
      return { systemPrompt, userPrompt };
    }

    if (promptVariant === 'deep-stars') {
      const { DEEP_STAR_PROMPT } = await import('./prompts');
      const systemPrompt = ZWDS_BASE_SYSTEM_PROMPT + '\n\n' + DEEP_STAR_PROMPT.systemAddition;
      const userPrompt = this.interpolateTemplate(
        DEEP_STAR_PROMPT.userTemplate,
        calculationData,
        readingType,
      ) + '\n\n' + OUTPUT_FORMAT_INSTRUCTIONS;
      return { systemPrompt, userPrompt };
    }

    // Try to load admin-customized prompt from DB
    const dbPrompt = await this.loadPromptFromDB(readingType);

    if (dbPrompt) {
      const userPrompt = this.interpolateTemplate(
        dbPrompt.userPromptTemplate,
        calculationData,
        readingType,
      );
      return {
        systemPrompt: dbPrompt.systemPrompt,
        userPrompt: userPrompt + '\n\n' + (dbPrompt.outputFormatInstructions || OUTPUT_FORMAT_INSTRUCTIONS),
      };
    }

    // Fall back to hardcoded defaults — check both Bazi and ZWDS prompt maps
    const isZwds = readingType.startsWith('ZWDS_');
    const readingConfig = isZwds
      ? ZWDS_READING_PROMPTS[readingType]
      : READING_PROMPTS[readingType];

    if (!readingConfig) {
      throw new Error(`No prompt template for reading type: ${readingType}`);
    }

    const baseSystemPrompt = isZwds ? ZWDS_BASE_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT;
    const systemPrompt = baseSystemPrompt + '\n\n' + readingConfig.systemAddition;
    const userPrompt = this.interpolateTemplate(
      readingConfig.userTemplate,
      calculationData,
      readingType,
    ) + '\n\n' + OUTPUT_FORMAT_INSTRUCTIONS;

    return { systemPrompt, userPrompt };
  }

  private async loadPromptFromDB(readingType: ReadingType) {
    try {
      const prompt = await this.prisma.promptTemplate.findFirst({
        where: {
          readingType,
          isActive: true,
        },
        orderBy: { version: 'desc' },
      });
      return prompt;
    } catch {
      return null;
    }
  }

  /**
   * Replace {{placeholders}} in prompt template with actual calculation data.
   */
  private interpolateTemplate(
    template: string,
    data: Record<string, unknown>,
    readingType: ReadingType,
  ): string {
    let result = template;

    // Extract data structures
    const fourPillars = data['fourPillars'] as Record<string, Record<string, unknown>> | undefined;
    const dayMaster = data['dayMaster'] as Record<string, unknown> | undefined;
    const balance = data['fiveElementsBalance'] as Record<string, number> | undefined;
    const balanceZh = data['fiveElementsBalanceZh'] as Record<string, number> | undefined;
    const trueSolarTime = data['trueSolarTime'] as Record<string, unknown> | undefined;
    const lunarDate = data['lunarDate'] as Record<string, unknown> | undefined;
    const luckPeriods = data['luckPeriods'] as Record<string, unknown>[] | undefined;
    const annualStars = data['annualStars'] as Record<string, unknown>[] | undefined;
    const monthlyStars = data['monthlyStars'] as Record<string, unknown>[] | undefined;
    const allShenSha = data['allShenSha'] as Record<string, unknown>[] | undefined;
    const tenGodDist = data['tenGodDistribution'] as Record<string, number> | undefined;
    const elementCounts = data['elementCounts'] as Record<string, Record<string, number>> | undefined;

    // Current year — anchors all time-related analysis to the correct year
    result = result.replace(/\{\{currentYear\}\}/g, String(new Date().getFullYear()));

    // Basic fields
    const genderRaw = data['gender'] as string;
    if (!genderRaw) {
      this.logger.warn('Gender missing in calculation data, defaulting to male');
    }
    result = result.replace(/\{\{gender\}\}/g, GENDER_ZH[genderRaw || 'male'] || '男');
    result = result.replace(/\{\{birthDate\}\}/g, (data['birthDate'] as string) || '');
    result = result.replace(/\{\{birthTime\}\}/g, (data['birthTime'] as string) || '');

    // Lunar date
    if (lunarDate) {
      result = result.replace(/\{\{lunarDate\}\}/g,
        `農曆${lunarDate['year']}年${lunarDate['isLeapMonth'] ? '閏' : ''}${lunarDate['month']}月${lunarDate['day']}日`);
    }

    // True Solar Time
    if (trueSolarTime) {
      result = result.replace(/\{\{trueSolarTime\}\}/g, (trueSolarTime['true_solar_time'] as string) || '');
    }

    // Four Pillars
    if (fourPillars) {
      for (const [pillar, pillarData] of Object.entries(fourPillars)) {
        const stem = pillarData['stem'] as string || '';
        const branch = pillarData['branch'] as string || '';
        const tenGod = pillarData['tenGod'] as string || '';
        const hidden = (pillarData['hiddenStems'] as string[]) || [];
        const naYin = pillarData['naYin'] as string || '';

        result = result.replace(new RegExp(`\\{\\{${pillar}Pillar\\}\\}`, 'g'), `${stem}${branch}`);
        result = result.replace(new RegExp(`\\{\\{${pillar}TenGod\\}\\}`, 'g'), tenGod);
        result = result.replace(new RegExp(`\\{\\{${pillar}Hidden\\}\\}`, 'g'), hidden.join('、'));
        result = result.replace(new RegExp(`\\{\\{${pillar}NaYin\\}\\}`, 'g'), naYin);
      }
    }

    // Day Master
    if (dayMaster) {
      result = result.replace(/\{\{dayMaster\}\}/g, (data['dayMasterStem'] as string) || '');
      result = result.replace(/\{\{dayMasterElement\}\}/g, (dayMaster['element'] as string) || '');
      result = result.replace(/\{\{dayMasterYinYang\}\}/g, (dayMaster['yinYang'] as string) || '');
      result = result.replace(/\{\{pattern\}\}/g, (dayMaster['pattern'] as string) || '');
      result = result.replace(/\{\{sameParty\}\}/g, String(dayMaster['sameParty'] || 0));
      result = result.replace(/\{\{oppositeParty\}\}/g, String(dayMaster['oppositeParty'] || 0));
      result = result.replace(/\{\{favorableGod\}\}/g, (dayMaster['favorableGod'] as string) || '');
      result = result.replace(/\{\{usefulGod\}\}/g, (dayMaster['usefulGod'] as string) || '');
      result = result.replace(/\{\{idleGod\}\}/g, (dayMaster['idleGod'] as string) || '');
      result = result.replace(/\{\{tabooGod\}\}/g, (dayMaster['tabooGod'] as string) || '');
      result = result.replace(/\{\{enemyGod\}\}/g, (dayMaster['enemyGod'] as string) || '');
    }

    // Five Elements balance
    const elemData = balanceZh || balance;
    if (elemData) {
      result = result.replace(/\{\{wood\}\}/g, String(elemData['木'] ?? elemData['wood'] ?? 0));
      result = result.replace(/\{\{fire\}\}/g, String(elemData['火'] ?? elemData['fire'] ?? 0));
      result = result.replace(/\{\{earth\}\}/g, String(elemData['土'] ?? elemData['earth'] ?? 0));
      result = result.replace(/\{\{metal\}\}/g, String(elemData['金'] ?? elemData['metal'] ?? 0));
      result = result.replace(/\{\{water\}\}/g, String(elemData['水'] ?? elemData['water'] ?? 0));
    }

    // Seasonal state labels (旺相休囚死)
    const seasonalStates = data['seasonalStates'] as Record<string, string> | undefined;
    if (seasonalStates) {
      const stateText = Object.entries(seasonalStates)
        .map(([elem, state]) => `${elem}${state}`)
        .join('、');
      result = result.replace(/\{\{seasonalStates\}\}/g, `五行旺衰：${stateText}`);
    } else {
      result = result.replace(/\{\{seasonalStates\}\}/g, '');
    }

    // Luck Periods
    if (luckPeriods) {
      const lpText = luckPeriods.map((lp) => {
        const isCurrent = lp['isCurrent'] ? ' ← 目前' : '';
        return `${lp['startAge']}-${lp['endAge']}歲（${lp['startYear']}-${lp['endYear']}）：${lp['stem']}${lp['branch']}（${lp['tenGod']}）${isCurrent}`;
      }).join('\n');
      result = result.replace(/\{\{luckPeriods\}\}/g, lpText);

      // Current luck period
      const current = luckPeriods.find((lp) => lp['isCurrent']);
      if (current) {
        result = result.replace(/\{\{currentLuckPeriod\}\}/g,
          `${current['stem']}${current['branch']}（${current['tenGod']}），${current['startAge']}-${current['endAge']}歲`);
      }
    }

    // Annual Stars
    if (annualStars) {
      const targetYear = data['targetYear'] as number;
      if (targetYear) {
        const annualStar = annualStars.find((s) => s['year'] === targetYear);
        if (annualStar) {
          result = result.replace(/\{\{annualStar\}\}/g,
            `${annualStar['stem']}${annualStar['branch']}年（${annualStar['tenGod']}）`);
        }
        result = result.replace(/\{\{targetYear\}\}/g, String(targetYear));
      }
    }

    // Monthly Stars
    if (monthlyStars) {
      const msText = monthlyStars.map((ms) => {
        return `${ms['month']}月（${ms['solarTermDate']}）：${ms['stem']}${ms['branch']}（${ms['tenGod']}）`;
      }).join('\n');
      result = result.replace(/\{\{monthlyStars\}\}/g, msText);
    }

    // Shen Sha
    if (allShenSha) {
      const shaText = allShenSha.map((sha) => {
        return `${sha['name']}（${sha['pillar']}柱·${sha['branch']}）`;
      }).join('、');
      result = result.replace(/\{\{shenSha\}\}/g, shaText || '無特殊神煞');
    }

    // Ten God Distribution
    if (tenGodDist) {
      const tgText = Object.entries(tenGodDist)
        .map(([god, count]) => `${god}: ${count}`)
        .join(' / ');
      result = result.replace(/\{\{tenGodDistribution\}\}/g, tgText);
    }

    // Element Counts
    if (elementCounts) {
      const ecText = ['木', '火', '土', '金', '水'].map((elem) => {
        const stems = elementCounts['stems']?.[elem] || 0;
        const branches = elementCounts['branches']?.[elem] || 0;
        const hidden = elementCounts['hidden']?.[elem] || 0;
        const total = elementCounts['total']?.[elem] || 0;
        return `${elem}: ${stems}/${branches}/${hidden}/${total}`;
      }).join(' | ');
      result = result.replace(/\{\{elementCounts\}\}/g, ecText);
    }

    // Phase 11A: Life Stages summary
    const lifeStagesSummary = data['lifeStagesSummary'] as Record<string, string> | undefined;
    if (lifeStagesSummary) {
      const lsText = ['year', 'month', 'day', 'hour']
        .map((p) => {
          const zh = { year: '年柱', month: '月柱', day: '日柱', hour: '時柱' }[p];
          return `${zh}：${lifeStagesSummary[p] || '—'}`;
        })
        .join('、');
      result = result.replace(/\{\{lifeStages\}\}/g, lsText);
    } else {
      result = result.replace(/\{\{lifeStages\}\}/g, '（資料未提供）');
    }

    // Phase 11A: Kong Wang summary
    const kongWangSummary = data['kongWangSummary'] as string[] | string | undefined;
    if (kongWangSummary) {
      const kwText = Array.isArray(kongWangSummary)
        ? kongWangSummary.join('、')
        : String(kongWangSummary);
      result = result.replace(/\{\{kongWang\}\}/g, kwText || '無空亡');
    } else {
      result = result.replace(/\{\{kongWang\}\}/g, '（資料未提供）');
    }

    // Phase 11A: Pillar Elements
    const pillarElements = data['pillarElements'] as Record<string, Record<string, string>> | undefined;
    if (pillarElements) {
      const peText = ['year', 'month', 'day', 'hour']
        .map((p) => {
          const zh = { year: '年', month: '月', day: '日', hour: '時' }[p];
          const pe = pillarElements[p];
          if (!pe) return `${zh}：—`;
          return `${zh}：${pe['stem']}(${pe['stemElement']}) ${pe['branch']}(${pe['branchElement']})`;
        })
        .join(' / ');
      result = result.replace(/\{\{pillarElements\}\}/g, peText);
    } else {
      result = result.replace(/\{\{pillarElements\}\}/g, '（資料未提供）');
    }

    // Phase 11B: Strength V2
    const preAnalysis = data['preAnalysis'] as Record<string, unknown> | undefined;
    const strengthV2 = preAnalysis?.['strengthV2'] as Record<string, unknown> | undefined;
    if (strengthV2) {
      const classification = STRENGTH_V2_ZH[(strengthV2['classification'] as string) || ''] || '';
      const score = strengthV2['score'] || 0;
      const factors = strengthV2['factors'] as Record<string, number> | undefined;
      const factorText = factors
        ? `得令=${factors['deling']}、得地=${factors['dedi']}、得勢=${factors['deshi']}`
        : '';
      result = result.replace(/\{\{strengthV2\}\}/g,
        `${classification}（${score}/100）[${factorText}]`);
    } else {
      result = result.replace(/\{\{strengthV2\}\}/g, '（資料未提供）');
    }

    // Phase 11C: Pre-Analysis (compressed format for AI consumption)
    if (preAnalysis) {
      const preAnalysisText = this.formatPreAnalysis(preAnalysis, readingType);
      result = result.replace(/\{\{preAnalysis\}\}/g, preAnalysisText);
    } else {
      result = result.replace(/\{\{preAnalysis\}\}/g, '（本次分析未包含預分析數據）');
    }

    // Pre-analysis for compatibility charts (A/B)
    const chartA = data['chartA'] as Record<string, unknown> | undefined;
    const chartB = data['chartB'] as Record<string, unknown> | undefined;
    if (chartA?.['preAnalysis']) {
      result = result.replace(/\{\{preAnalysisA\}\}/g,
        this.formatPreAnalysis(chartA['preAnalysis'] as Record<string, unknown>, readingType));
    } else {
      result = result.replace(/\{\{preAnalysisA\}\}/g, '（資料未提供）');
    }
    if (chartB?.['preAnalysis']) {
      result = result.replace(/\{\{preAnalysisB\}\}/g,
        this.formatPreAnalysis(chartB['preAnalysis'] as Record<string, unknown>, readingType));
    } else {
      result = result.replace(/\{\{preAnalysisB\}\}/g, '（資料未提供）');
    }

    // ZWDS-specific fields
    if (readingType.startsWith('ZWDS_')) {
      result = this.interpolateZwdsFields(result, data, readingType);
    }

    // Compatibility-specific fields (Bazi)
    if (readingType === ReadingType.COMPATIBILITY) {
      const compatibility = data['compatibility'] as Record<string, unknown> | undefined;
      const compatEnhanced = data['compatibilityEnhanced'] as Record<string, unknown> | undefined;
      const compatPreAnalysis = data['compatibilityPreAnalysis'] as Record<string, unknown> | undefined;
      const chartA = data['chartA'] as Record<string, unknown> | undefined;
      const chartB = data['chartB'] as Record<string, unknown> | undefined;

      // Comparison type (from enrichedData set by bazi.service.ts)
      const compType = (data['comparisonType'] as string) ||
        (compatibility?.['comparisonType'] as string) || 'romance';
      result = result.replace(/\{\{comparisonType\}\}/g, compType);
      result = result.replace(/\{\{comparisonTypeZh\}\}/g, COMPARISON_TYPE_ZH[compType] || '配對');

      // Legacy compatibility fields (backward compat)
      if (compatibility) {
        result = result.replace(/\{\{overallScore\}\}/g, String(compatibility['overallScore'] || 0));
        result = result.replace(/\{\{level\}\}/g, (compatibility['levelZh'] as string) || '');
        result = result.replace(/\{\{dayMasterInteraction\}\}/g,
          JSON.stringify(compatibility['dayMasterInteraction'] || {}));
        result = result.replace(/\{\{stemCombination\}\}/g,
          JSON.stringify(compatibility['stemCombination'] || {}));
        result = result.replace(/\{\{branchRelationships\}\}/g,
          JSON.stringify(compatibility['branchRelationships'] || []));
        result = result.replace(/\{\{elementComplementarity\}\}/g,
          JSON.stringify(compatibility['elementComplementarity'] || {}));
      }

      // Enhanced compatibility fields (8-dimension scoring)
      if (compatEnhanced) {
        result = result.replace(/\{\{enhancedScore\}\}/g,
          String(compatEnhanced['adjustedScore'] || 0));
        result = result.replace(/\{\{enhancedLabel\}\}/g,
          (compatEnhanced['label'] as string) || '');
        const specialLabel = compatEnhanced['specialLabel'] as string | null;
        result = result.replace(/\{\{enhancedSpecialLabel\}\}/g,
          specialLabel ? `【特殊標籤】${specialLabel}` : '');
      } else {
        result = result.replace(/\{\{enhancedScore\}\}/g, String(compatibility?.['overallScore'] || 0));
        result = result.replace(/\{\{enhancedLabel\}\}/g, (compatibility?.['levelZh'] as string) || '');
        result = result.replace(/\{\{enhancedSpecialLabel\}\}/g, '');
      }

      // Compatibility pre-analysis fields (Layer 2 structured data for AI)
      if (compatPreAnalysis) {
        result = this.interpolateCompatPreAnalysis(result, compatPreAnalysis);
      } else {
        // Fallback: clear all enhanced placeholders
        result = result.replace(/\{\{dimensionSummary\}\}/g, '（資料未提供）');
        result = result.replace(/\{\{pillarFindings\}\}/g, '（資料未提供）');
        result = result.replace(/\{\{knockoutConditions\}\}/g, '（無加減分條件）');
        result = result.replace(/\{\{crossTenGods\}\}/g, '（資料未提供）');
        result = result.replace(/\{\{yongshenAnalysis\}\}/g, '（資料未提供）');
        result = result.replace(/\{\{landmines\}\}/g, '（無地雷禁忌）');
        result = result.replace(/\{\{timingSync\}\}/g, '（資料未提供）');
        result = result.replace(/\{\{attractionSection\}\}/g, '');
        result = result.replace(/\{\{suggestedTone\}\}/g, 'balanced');
        result = result.replace(/\{\{highlightDimensions\}\}/g, '');
      }

      // Strength V2 for chart A and B
      if (chartA?.['preAnalysis']) {
        const preA = chartA['preAnalysis'] as Record<string, unknown>;
        const sv2A = preA['strengthV2'] as Record<string, unknown> | undefined;
        if (sv2A) {
          const classA = STRENGTH_V2_ZH[(sv2A['classification'] as string) || ''] || '';
          const scoreA = sv2A['score'] || 0;
          result = result.replace(/\{\{strengthV2A\}\}/g, `${classA}（${scoreA}/100）`);
        } else {
          result = result.replace(/\{\{strengthV2A\}\}/g, '（資料未提供）');
        }
      } else {
        result = result.replace(/\{\{strengthV2A\}\}/g, '（資料未提供）');
      }
      if (chartB?.['preAnalysis']) {
        const preB = chartB['preAnalysis'] as Record<string, unknown>;
        const sv2B = preB['strengthV2'] as Record<string, unknown> | undefined;
        if (sv2B) {
          const classB = STRENGTH_V2_ZH[(sv2B['classification'] as string) || ''] || '';
          const scoreB = sv2B['score'] || 0;
          result = result.replace(/\{\{strengthV2B\}\}/g, `${classB}（${scoreB}/100）`);
        } else {
          result = result.replace(/\{\{strengthV2B\}\}/g, '（資料未提供）');
        }
      } else {
        result = result.replace(/\{\{strengthV2B\}\}/g, '（資料未提供）');
      }

      // Chart A & B pillar fields
      if (chartA) result = this.interpolateChartFields(result, chartA, 'A');
      if (chartB) result = this.interpolateChartFields(result, chartB, 'B');
    }

    return result;
  }

  /**
   * Interpolate chart-specific fields for compatibility (chartA, chartB).
   */
  private interpolateChartFields(
    template: string,
    chart: Record<string, unknown>,
    suffix: string,
  ): string {
    let result = template;
    const fourPillars = chart['fourPillars'] as Record<string, Record<string, unknown>> | undefined;
    const dayMaster = chart['dayMaster'] as Record<string, unknown> | undefined;
    const balance = chart['fiveElementsBalanceZh'] as Record<string, number> | undefined;

    result = result.replace(new RegExp(`\\{\\{gender${suffix}\\}\\}`, 'g'),
      GENDER_ZH[(chart['gender'] as string) || 'male'] || '男');

    if (fourPillars) {
      for (const [pillar, pillarData] of Object.entries(fourPillars)) {
        result = result.replace(
          new RegExp(`\\{\\{${pillar}Pillar${suffix}\\}\\}`, 'g'),
          `${pillarData['stem']}${pillarData['branch']}`,
        );
      }
    }

    if (dayMaster) {
      result = result.replace(new RegExp(`\\{\\{dayMaster${suffix}\\}\\}`, 'g'),
        (chart['dayMasterStem'] as string) || '');
      result = result.replace(new RegExp(`\\{\\{dayMasterElement${suffix}\\}\\}`, 'g'),
        (dayMaster['element'] as string) || '');
      result = result.replace(new RegExp(`\\{\\{pattern${suffix}\\}\\}`, 'g'),
        (dayMaster['pattern'] as string) || '');
      result = result.replace(new RegExp(`\\{\\{favorableGod${suffix}\\}\\}`, 'g'),
        (dayMaster['favorableGod'] as string) || '');
      result = result.replace(new RegExp(`\\{\\{usefulGod${suffix}\\}\\}`, 'g'),
        (dayMaster['usefulGod'] as string) || '');
    }

    if (balance) {
      result = result.replace(new RegExp(`\\{\\{wood${suffix}\\}\\}`, 'g'), String(balance['木'] ?? 0));
      result = result.replace(new RegExp(`\\{\\{fire${suffix}\\}\\}`, 'g'), String(balance['火'] ?? 0));
      result = result.replace(new RegExp(`\\{\\{earth${suffix}\\}\\}`, 'g'), String(balance['土'] ?? 0));
      result = result.replace(new RegExp(`\\{\\{metal${suffix}\\}\\}`, 'g'), String(balance['金'] ?? 0));
      result = result.replace(new RegExp(`\\{\\{water${suffix}\\}\\}`, 'g'), String(balance['水'] ?? 0));
    }

    return result;
  }

  // ============================================================
  // Compatibility Pre-Analysis Interpolation (Phase C — Enhanced 合盤)
  // ============================================================

  /**
   * Interpolate compatibility pre-analysis fields into the prompt template.
   * Converts structured JSON into compressed Chinese text for AI consumption.
   */
  private interpolateCompatPreAnalysis(
    template: string,
    preAnalysis: Record<string, unknown>,
  ): string {
    let result = template;

    // ---- Dimension Summary ----
    const dimSummary = preAnalysis['dimensionSummary'] as Array<Record<string, unknown>> | undefined;
    if (dimSummary && dimSummary.length > 0) {
      const dimText = dimSummary.map((d) =>
        `${d['dimension']}：${d['score']}分（${d['assessment']}，權重${d['weight']}%）`
      ).join('\n');
      result = result.replace(/\{\{dimensionSummary\}\}/g, dimText);
    } else {
      result = result.replace(/\{\{dimensionSummary\}\}/g, '（資料未提供）');
    }

    // ---- Pillar Findings ----
    const findings = preAnalysis['pillarFindings'] as Array<Record<string, unknown>> | undefined;
    if (findings && findings.length > 0) {
      const findText = findings.map((f, i) => {
        const sig = f['significance'] === 'critical' ? '🔴' :
          f['significance'] === 'high' ? '🟠' : '🟡';
        let line = `${sig} ${f['type']}：${f['description']}`;
        if (f['narrativeHint']) line += `\n   提示：${f['narrativeHint']}`;
        return line;
      }).join('\n');
      result = result.replace(/\{\{pillarFindings\}\}/g, findText);
    } else {
      result = result.replace(/\{\{pillarFindings\}\}/g, '（無特殊發現）');
    }

    // ---- Knockout Conditions ----
    const knockouts = preAnalysis['knockoutConditions'] as Array<Record<string, unknown>> | undefined;
    if (knockouts && knockouts.length > 0) {
      const koText = knockouts.map((k) => {
        const impact = k['impact'] as number;
        const sign = impact > 0 ? '+' : '';
        const mitigated = k['mitigated'] ? '（已被天德/月德化解部分）' : '';
        return `${sign}${impact}分：${k['description']}${mitigated}`;
      }).join('\n');
      result = result.replace(/\{\{knockoutConditions\}\}/g, koText);
    } else {
      result = result.replace(/\{\{knockoutConditions\}\}/g, '（無加減分條件）');
    }

    // ---- Cross Ten Gods ----
    const crossTenGods = preAnalysis['crossTenGods'] as Record<string, unknown> | undefined;
    if (crossTenGods) {
      const aInB = crossTenGods['aDaymasterInB'] as Record<string, unknown>;
      const bInA = crossTenGods['bDaymasterInA'] as Record<string, unknown>;
      const spouseA = crossTenGods['aSpouseStar'] as Record<string, unknown>;
      const spouseB = crossTenGods['bSpouseStar'] as Record<string, unknown>;

      let ctgText = '';
      if (aInB) {
        ctgText += `你在對方命盤中的角色：${aInB['tenGod']}（${aInB['forComparison']}）\n`;
      }
      if (bInA) {
        ctgText += `對方在你命盤中的角色：${bInA['tenGod']}（${bInA['forComparison']}）\n`;
      }
      if (spouseA) {
        ctgText += `你的配偶星：${spouseA['star']}，位置：${spouseA['positionsZh']}（${spouseA['implication']}）\n`;
      }
      if (spouseB) {
        ctgText += `對方配偶星：${spouseB['star']}，位置：${spouseB['positionsZh']}（${spouseB['implication']}）`;
      }
      result = result.replace(/\{\{crossTenGods\}\}/g, ctgText);
    } else {
      result = result.replace(/\{\{crossTenGods\}\}/g, '（資料未提供）');
    }

    // ---- Yongshen Analysis ----
    const yongshen = preAnalysis['yongshenAnalysis'] as Record<string, unknown> | undefined;
    if (yongshen) {
      const ysText = [
        `你的用神：${yongshen['aUsefulElement']}，對方用神：${yongshen['bUsefulElement']}`,
        `互補程度：${yongshen['complementary'] ? '互補' : '不互補'}（${yongshen['score']}分）`,
        `分析：${yongshen['explanation']}`,
        yongshen['sharedJishenRisk'] ? `⚠️ 共同忌神風險：${yongshen['aTabooElement']}` : '',
        yongshen['congGeAffectsYongshen'] ? '⚠️ 從格影響用神判定' : '',
        yongshen['elementComplementaryHint'] ? `五行互補提示：${yongshen['elementComplementaryHint']}` : '',
      ].filter(Boolean).join('\n');
      result = result.replace(/\{\{yongshenAnalysis\}\}/g, ysText);
    } else {
      result = result.replace(/\{\{yongshenAnalysis\}\}/g, '（資料未提供）');
    }

    // ---- Landmines ----
    const landmines = preAnalysis['landmines'] as Array<Record<string, unknown>> | undefined;
    if (landmines && landmines.length > 0) {
      const lmText = landmines.map((lm, i) => {
        const sev = lm['severity'] === 'high' ? '⚠️ 重要提醒' :
          lm['severity'] === 'medium' ? '💡 注意事項' : '📝 小提醒';
        return [
          `${i + 1}. ${sev}【${lm['trigger']}】`,
          `   警示：${lm['warning']}`,
          `   避免：${lm['avoidBehavior']}`,
          `   建議：${lm['suggestion']}`,
          `   依據：${lm['dataSource']}`,
        ].join('\n');
      }).join('\n\n');
      result = result.replace(/\{\{landmines\}\}/g, lmText);
    } else {
      result = result.replace(/\{\{landmines\}\}/g, '（無地雷禁忌）');
    }

    // ---- Timing Sync ----
    const timing = preAnalysis['timingSync'] as Record<string, unknown> | undefined;
    if (timing) {
      const golden = timing['goldenYears'] as Array<Record<string, unknown>> | undefined;
      const challenge = timing['challengeYears'] as Array<Record<string, unknown>> | undefined;
      const syncScore = timing['luckCycleSyncScore'] as number | undefined;

      let timingText = `大運同步度：${syncScore ?? 50}分\n`;

      if (golden && golden.length > 0) {
        timingText += '🌟 黃金年份：\n' +
          golden.map((y) => {
            let line = `  ${y['year']}年：${y['reason']}`;
            if (y['narrativeHint']) line += `（${y['narrativeHint']}）`;
            return line;
          }).join('\n') + '\n';
      }
      if (challenge && challenge.length > 0) {
        timingText += '⚡ 挑戰年份：\n' +
          challenge.map((y) => {
            let line = `  ${y['year']}年：${y['reason']}`;
            if (y['narrativeHint']) line += `（${y['narrativeHint']}）`;
            return line;
          }).join('\n');
      }
      result = result.replace(/\{\{timingSync\}\}/g, timingText);
    } else {
      result = result.replace(/\{\{timingSync\}\}/g, '（資料未提供）');
    }

    // ---- Attraction Analysis (romance only) ----
    const attraction = preAnalysis['attractionAnalysis'] as Record<string, unknown> | undefined;
    if (attraction) {
      const signals = attraction['signals'] as string[] | undefined;
      const conclusion = attraction['conclusion'] as string;
      const conclusionZh: Record<string, string> = {
        strong: '強烈', medium: '中等', weak: '微弱', unclear: '不明確',
      };
      let attrText = `【對方是否喜歡你？】\n`;
      attrText += `吸引力指數：${attraction['score']}分（${conclusionZh[conclusion] || '待觀察'}）\n`;
      if (signals && signals.length > 0) {
        attrText += `信號：\n${signals.map((s) => `  ✦ ${s}`).join('\n')}`;
      }
      result = result.replace(/\{\{attractionSection\}\}/g, attrText);
    } else {
      result = result.replace(/\{\{attractionSection\}\}/g, '');
    }

    // ---- Narration Guidance ----
    const guidance = preAnalysis['narrationGuidance'] as Record<string, unknown> | undefined;
    if (guidance) {
      const toneZh: Record<string, string> = {
        enthusiastic: '熱情鼓勵', positive: '正面積極',
        balanced: '客觀平衡', cautious: '謹慎提醒', constructive: '建設性鼓勵',
      };
      result = result.replace(/\{\{suggestedTone\}\}/g,
        toneZh[(guidance['suggestedTone'] as string) || ''] || '客觀平衡');
      const highlights = guidance['highlightDimensions'] as string[] | undefined;
      if (highlights && highlights.length > 0) {
        const dimNameMap: Record<string, string> = {
          yongshenComplementarity: '用神互補', dayStemRelationship: '日柱天干',
          spousePalace: '配偶宮', tenGodCross: '十神交叉',
          elementComplementarity: '五行互補', fullPillarInteraction: '全盤互動',
          shenShaInteraction: '神煞互動', luckPeriodSync: '大運同步',
        };
        result = result.replace(/\{\{highlightDimensions\}\}/g,
          highlights.map((h) => dimNameMap[h] || h).join('、'));
      } else {
        result = result.replace(/\{\{highlightDimensions\}\}/g, '');
      }
    } else {
      result = result.replace(/\{\{suggestedTone\}\}/g, '客觀平衡');
      result = result.replace(/\{\{highlightDimensions\}\}/g, '');
    }

    return result;
  }

  // ============================================================
  // Pre-Analysis Formatting (Phase 11C)
  // ============================================================

  /**
   * Format the pre-analysis JSON into compressed Chinese text for AI consumption.
   * Uses abbreviated format to minimize token usage (~200-300 tokens).
   */
  private formatPreAnalysis(
    preAnalysis: Record<string, unknown>,
    readingType: ReadingType,
  ): string {
    const lines: string[] = [];

    // Summary line
    const summary = preAnalysis['summary'] as string;
    if (summary) {
      lines.push(`命格概要：${summary}`);
    }

    // Key findings (high significance only to save tokens)
    const keyFindings = preAnalysis['keyFindings'] as Array<Record<string, unknown>>;
    if (keyFindings?.length) {
      const highFindings = keyFindings
        .filter((f) => f['significance'] === 'high' || f['significance'] === 'critical')
        .map((f) => f['finding'] as string)
        .filter(Boolean);
      if (highFindings.length > 0) {
        lines.push(`重要發現：${highFindings.join('；')}`);
      }
    }

    // Stem combinations
    const pillarRel = preAnalysis['pillarRelationships'] as Record<string, unknown>;
    if (pillarRel) {
      const stemCombos = pillarRel['stemCombinations'] as Array<Record<string, unknown>>;
      if (stemCombos?.length) {
        const comboText = stemCombos.map((c) => c['description'] as string).filter(Boolean).join('；');
        lines.push(`天干合化：${comboText}`);
      }

      const stemClashes = pillarRel['stemClashes'] as Array<Record<string, unknown>>;
      if (stemClashes?.length) {
        const clashText = stemClashes.map((c) => c['description'] as string).filter(Boolean).join('；');
        lines.push(`天干沖：${clashText}`);
      }

      // Branch relationships
      const branchRel = pillarRel['branchRelationships'] as Record<string, unknown>;
      if (branchRel) {
        const branchParts: string[] = [];

        const harmonies = branchRel['harmonies'] as Array<Record<string, unknown>>;
        if (harmonies?.length) {
          branchParts.push(harmonies.map((h) => h['description'] as string).filter(Boolean).join('、'));
        }

        const clashes = branchRel['clashes'] as Array<Record<string, unknown>>;
        if (clashes?.length) {
          branchParts.push(clashes.map((c) =>
            `${c['description']}${c['pillarEffect'] ? `（${c['pillarEffect']}）` : ''}`
          ).filter(Boolean).join('、'));
        }

        const tripleHarmonies = branchRel['tripleHarmonies'] as Array<Record<string, unknown>>;
        if (tripleHarmonies?.length) {
          branchParts.push(tripleHarmonies.map((t) => t['description'] as string).filter(Boolean).join('、'));
        }

        const threeMeetings = branchRel['threeMeetings'] as Array<Record<string, unknown>>;
        if (threeMeetings?.length) {
          branchParts.push(threeMeetings.map((m) => m['description'] as string).filter(Boolean).join('、'));
        }

        const punishments = branchRel['punishments'] as Array<Record<string, unknown>>;
        if (punishments?.length) {
          branchParts.push(punishments.map((p) => p['description'] as string).filter(Boolean).join('、'));
        }

        const harms = branchRel['harms'] as Array<Record<string, unknown>>;
        if (harms?.length) {
          branchParts.push(harms.map((h) => h['description'] as string).filter(Boolean).join('、'));
        }

        if (branchParts.length > 0) {
          lines.push(`地支關係：${branchParts.join('；')}`);
        }
      }
    }

    // Ten God position analysis (top findings only)
    const tenGodFindings = preAnalysis['tenGodPositionAnalysis'] as Array<Record<string, unknown>>;
    if (tenGodFindings?.length) {
      const topFindings = tenGodFindings
        .slice(0, 6)  // limit to 6 most important
        .map((f) => `${f['tenGod']}在${f['pillar']}柱（${f['meaning'] || ''}）`)
        .filter(Boolean);
      lines.push(`十神位置：${topFindings.join('；')}`);
    }

    // 透干 analysis
    const tougan = preAnalysis['touganAnalysis'] as Array<Record<string, unknown>>;
    if (tougan?.length) {
      const touganText = tougan
        .map((t) => `${t['stem']}${t['isTransparent'] ? '透干' : '藏而不透'}（${t['tenGod']}）`)
        .filter(Boolean)
        .join('、');
      lines.push(`透干分析：${touganText}`);
    }

    // 從格
    const congGe = preAnalysis['congGe'] as Record<string, unknown>;
    if (congGe) {
      lines.push(`特殊格局：${congGe['name']}（${congGe['description']}）`);
    }

    // 官殺混雜
    const guanSha = preAnalysis['guanShaHunza'] as Record<string, unknown>;
    if (guanSha) {
      lines.push(`官殺混雜：${guanSha['description']}`);
    }

    // 用神合絆
    const yongShenLocked = preAnalysis['yongShenLocked'] as Array<Record<string, unknown>>;
    if (yongShenLocked?.length) {
      lines.push(`用神合絆：${yongShenLocked.map((l) => l['description']).join('、')}`);
    }

    // 墓庫
    const tombStorage = preAnalysis['tombStorage'] as Array<Record<string, unknown>>;
    if (tombStorage?.length) {
      lines.push(`墓庫：${tombStorage.map((t) => t['description'] as string).filter(Boolean).join('、')}`);
    }

    // Conflict resolution
    const conflicts = preAnalysis['conflictResolution'] as Array<Record<string, unknown>>;
    if (conflicts?.length) {
      lines.push(`衝突調解：${conflicts.map((c) => c['resolution'] as string).filter(Boolean).join('；')}`);
    }

    // Domain-specific insights
    const careerInsights = preAnalysis['careerInsights'] as Record<string, unknown>;
    if (careerInsights) {
      const industries = (careerInsights['suitableIndustries'] as string[])?.join('、') || '';
      const workStyle = careerInsights['workStyle'] as string || '';
      const useful = careerInsights['usefulElement'] as string || '';
      lines.push(`事業方向：用神${useful}→${industries}（${workStyle}）`);
    }

    const loveInsights = preAnalysis['loveInsights'] as Record<string, unknown>;
    if (loveInsights) {
      const spouseStar = loveInsights['spouseStar'] as string || '';
      const spousePalaceGod = loveInsights['spousePalaceGod'] as string || '';
      const challenges = (loveInsights['challenges'] as string[])?.join('、') || '';
      const loveLines: string[] = [];
      if (spouseStar) loveLines.push(`配偶星=${spouseStar}`);
      if (spousePalaceGod) loveLines.push(`配偶宮=${spousePalaceGod}`);
      if (challenges) loveLines.push(`注意：${challenges}`);
      if (loveLines.length > 0) {
        lines.push(`感情提示：${loveLines.join('、')}`);
      }
    }

    const healthInsights = preAnalysis['healthInsights'] as Record<string, unknown>;
    if (healthInsights) {
      const weakOrgans = (healthInsights['weakOrgans'] as string[])?.join('、') || '';
      const warnings = (healthInsights['warnings'] as string[])?.join('、') || '';
      const healthLines: string[] = [];
      if (weakOrgans) healthLines.push(`弱臟腑：${weakOrgans}`);
      if (warnings) healthLines.push(warnings);
      if (healthLines.length > 0) {
        lines.push(`健康提示：${healthLines.join('；')}`);
      }
    }

    // Effective favorable gods (may differ from original if 從格)
    const effectiveGods = preAnalysis['effectiveFavorableGods'] as Record<string, string>;
    if (effectiveGods && congGe) {
      lines.push(`從格用神：${effectiveGods['usefulGod']}（忌=${effectiveGods['tabooGod']}）`);
    }

    // Special day pillars (Phase 11D)
    const specialDayPillars = preAnalysis['specialDayPillars'] as Array<Record<string, unknown>>;
    if (specialDayPillars?.length) {
      const sdpText = specialDayPillars
        .map((s) => `${s['name']}：${s['effect'] || s['meaning']}`)
        .filter(Boolean)
        .join('；');
      lines.push(`特殊日柱：${sdpText}`);
    }

    // Timing insights (Phase 11D)
    const timingInsights = preAnalysis['timingInsights'] as Record<string, unknown>;
    if (timingInsights) {
      const timingLines: string[] = [];

      const currentPeriod = timingInsights['currentPeriod'] as Record<string, unknown>;
      if (currentPeriod) {
        const periodInteractions = currentPeriod['interactions'] as Array<Record<string, unknown>>;
        const intText = periodInteractions?.length
          ? periodInteractions.slice(0, 3).map((i) => i['description'] as string).filter(Boolean).join('、')
          : '無特殊互動';
        timingLines.push(
          `當前大運：${currentPeriod['stem']}${currentPeriod['branch']}`
          + `（${currentPeriod['tenGod']}，${currentPeriod['startYear']}-${currentPeriod['endYear']}）`
          + `→${intText}`
        );
      }

      const currentYear = timingInsights['currentYear'] as Record<string, unknown>;
      if (currentYear) {
        const yearInteractions = currentYear['interactions'] as Array<Record<string, unknown>>;
        const yIntText = yearInteractions?.length
          ? yearInteractions.slice(0, 3).map((i) => i['description'] as string).filter(Boolean).join('、')
          : '無特殊互動';
        timingLines.push(
          `目標流年：${currentYear['stem']}${currentYear['branch']}`
          + `（${currentYear['tenGod']}）→${yIntText}`
        );

        const lpInt = currentYear['lpInteraction'] as Array<Record<string, unknown>>;
        if (lpInt?.length) {
          timingLines.push(`大運流年交互：${lpInt.map((i) => i['description'] as string).filter(Boolean).join('、')}`);
        }
      }

      const sigFindings = timingInsights['significantFindings'] as Array<Record<string, unknown>>;
      if (sigFindings?.length) {
        timingLines.push(`時運重要事件：${sigFindings.map((f) => f['description'] as string).filter(Boolean).join('；')}`);
      }

      if (timingLines.length > 0) {
        lines.push(`時運分析：${timingLines.join('；')}`);
      }
    }

    return lines.join('\n') || '（預分析數據為空）';
  }

  // ============================================================
  // ZWDS-specific Interpolation
  // ============================================================

  /**
   * Interpolate ZWDS-specific placeholders in prompt templates.
   * Handles palace data, star data, horoscope overlays, etc.
   */
  private interpolateZwdsFields(
    template: string,
    data: Record<string, unknown>,
    readingType: ReadingType,
  ): string {
    let result = template;

    // Basic ZWDS fields
    result = result.replace(/\{\{solarDate\}\}/g, (data['solarDate'] as string) || '');
    result = result.replace(/\{\{lunarDate\}\}/g, (data['lunarDate'] as string) || '');
    result = result.replace(/\{\{birthTime\}\}/g, (data['birthTime'] as string) || '');
    result = result.replace(/\{\{timeRange\}\}/g, (data['timeRange'] as string) || '');
    result = result.replace(/\{\{zodiac\}\}/g, (data['zodiac'] as string) || '');
    result = result.replace(/\{\{fiveElementsClass\}\}/g, (data['fiveElementsClass'] as string) || '');
    result = result.replace(/\{\{soulStar\}\}/g, (data['soulStar'] as string) || '');
    result = result.replace(/\{\{bodyStar\}\}/g, (data['bodyStar'] as string) || '');
    result = result.replace(/\{\{soulPalaceBranch\}\}/g, (data['soulPalaceBranch'] as string) || '');
    result = result.replace(/\{\{bodyPalaceBranch\}\}/g, (data['bodyPalaceBranch'] as string) || '');
    result = result.replace(/\{\{gender\}\}/g, (data['gender'] as string) || '');

    const palaces = data['palaces'] as Array<Record<string, unknown>> | undefined;

    if (palaces) {
      // Format palace data for specific palaces
      const palaceByName = new Map<string, Record<string, unknown>>();
      for (const palace of palaces) {
        palaceByName.set(palace['name'] as string, palace);
      }

      // Individual palace data placeholders
      const palaceFieldMap: Record<string, string> = {
        '命宮': 'lifePalaceData',
        '官祿宮': 'careerPalaceData',
        '財帛宮': 'wealthPalaceData',
        '遷移宮': 'travelPalaceData',
        '夫妻宮': 'spousePalaceData',
        '子女宮': 'childrenPalaceData',
        '交友宮': 'friendsPalaceData',
        '福德宮': 'fortunePalaceData',
        '疾厄宮': 'healthPalaceData',
        '父母宮': 'parentsPalaceData',
      };

      for (const [palaceName, placeholder] of Object.entries(palaceFieldMap)) {
        const palace = palaceByName.get(palaceName);
        if (palace) {
          result = result.replace(
            new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g'),
            this.formatPalaceText(palace),
          );
        }
      }

      // Body palace location
      const bodyPalace = palaces.find((p) => p['isBodyPalace']);
      result = result.replace(/\{\{bodyPalaceLocation\}\}/g,
        bodyPalace ? `${bodyPalace['name']}（${bodyPalace['earthlyBranch']}）` : '');

      // All palaces overview
      const allPalacesText = palaces.map((p) => this.formatPalaceText(p)).join('\n\n');
      result = result.replace(/\{\{allPalacesData\}\}/g, allPalacesText);

      // Decadal periods
      const decadalText = palaces.map((p) => {
        const decadal = p['decadal'] as Record<string, unknown>;
        if (!decadal) return '';
        return `${decadal['startAge']}-${decadal['endAge']}歲：${decadal['stem']}${decadal['branch']}（${p['name']}）`;
      }).filter(Boolean).join('\n');
      result = result.replace(/\{\{decadalPeriods\}\}/g, decadalText);

      // All mutagens across palaces
      const mutagenList: string[] = [];
      for (const palace of palaces) {
        const allStars = [
          ...((palace['majorStars'] as Array<Record<string, unknown>>) || []),
          ...((palace['minorStars'] as Array<Record<string, unknown>>) || []),
        ];
        for (const star of allStars) {
          if (star['mutagen']) {
            mutagenList.push(`${star['name']}${star['mutagen']}（${palace['name']}）`);
          }
        }
      }
      result = result.replace(/\{\{allMutagens\}\}/g, mutagenList.join('、') || '無四化');

      // Peach blossom stars (桃花星)
      const peachStars = ['貪狼', '廉貞', '天姚', '紅鸞', '天喜', '咸池'];
      const peachList: string[] = [];
      for (const palace of palaces) {
        const allStars = [
          ...((palace['majorStars'] as Array<Record<string, unknown>>) || []),
          ...((palace['minorStars'] as Array<Record<string, unknown>>) || []),
          ...((palace['adjectiveStars'] as Array<Record<string, unknown>>) || []),
        ];
        for (const star of allStars) {
          if (peachStars.includes(star['name'] as string)) {
            peachList.push(`${star['name']}在${palace['name']}`);
          }
        }
      }
      result = result.replace(/\{\{peachBlossomStars\}\}/g, peachList.join('、') || '無明顯桃花星');
    }

    // Horoscope data
    const horoscope = data['horoscope'] as Record<string, unknown> | undefined;
    if (horoscope) {
      const decadal = horoscope['decadal'] as Record<string, unknown>;
      const yearly = horoscope['yearly'] as Record<string, unknown>;

      if (decadal) {
        result = result.replace(/\{\{currentDecadal\}\}/g,
          `${decadal['name']}大限（${decadal['stem']}${decadal['branch']}）四化：${(decadal['mutagen'] as string[] || []).join('、')}`);
      }

      if (yearly) {
        result = result.replace(/\{\{yearlyInfo\}\}/g,
          `${yearly['name']}（${yearly['stem']}${yearly['branch']}）`);
        result = result.replace(/\{\{yearlyMutagen\}\}/g,
          (yearly['mutagen'] as string[] || []).join('、'));
      }

      result = result.replace(/\{\{yearlyOverlay\}\}/g,
        `大限：${decadal?.['name'] || ''}，流年：${yearly?.['name'] || ''}`);

      // Monthly horoscope data
      const monthly = horoscope['monthly'] as Record<string, unknown> | undefined;
      if (monthly) {
        result = result.replace(/\{\{monthlyInfo\}\}/g,
          `${monthly['name']}（${monthly['stem']}${monthly['branch']}）`);
        result = result.replace(/\{\{monthlyMutagen\}\}/g,
          (monthly['mutagen'] as string[] || []).join('、'));
      }

      // Daily horoscope data
      const daily = horoscope['daily'] as Record<string, unknown> | undefined;
      if (daily) {
        result = result.replace(/\{\{dailyInfo\}\}/g,
          `${daily['name']}（${daily['stem']}${daily['branch']}）`);
        result = result.replace(/\{\{dailyMutagen\}\}/g,
          (daily['mutagen'] as string[] || []).join('、'));
      }
    }

    // Q&A question text
    const questionText = data['questionText'] as string | undefined;
    if (questionText) {
      result = result.replace(/\{\{questionText\}\}/g, questionText);
    }

    // ZWDS Compatibility fields
    if (readingType === ReadingType.ZWDS_COMPATIBILITY) {
      const compType = (data['comparisonType'] as string) || 'ROMANCE';
      result = result.replace(/\{\{comparisonType\}\}/g, compType);
      result = result.replace(/\{\{comparisonTypeZh\}\}/g,
        COMPARISON_TYPE_ZH[compType.toLowerCase()] || '配對');

      // Chart A and B
      const chartA = data['chartA'] as Record<string, unknown> | undefined;
      const chartB = data['chartB'] as Record<string, unknown> | undefined;

      if (chartA) {
        result = this.interpolateZwdsChartFields(result, chartA, 'A');
      }
      if (chartB) {
        result = this.interpolateZwdsChartFields(result, chartB, 'B');
      }
    }

    return result;
  }

  /**
   * Format a single palace into readable text for AI prompts.
   */
  private formatPalaceText(palace: Record<string, unknown>): string {
    const majorStars = (palace['majorStars'] as Array<Record<string, unknown>>) || [];
    const minorStars = (palace['minorStars'] as Array<Record<string, unknown>>) || [];

    const majorText = majorStars.map((s) => {
      let text = s['name'] as string;
      if (s['brightness']) text += `（${s['brightness']}）`;
      if (s['mutagen']) text += `${s['mutagen']}`;
      return text;
    }).join('、');

    const minorText = minorStars.map((s) => {
      let text = s['name'] as string;
      if (s['mutagen']) text += `${s['mutagen']}`;
      return text;
    }).join('、');

    const lines = [
      `【${palace['name']}】（${palace['heavenlyStem']}${palace['earthlyBranch']}）`,
    ];
    if (majorText) lines.push(`主星：${majorText}`);
    if (minorText) lines.push(`輔星：${minorText}`);
    if (palace['changsheng12']) lines.push(`十二長生：${palace['changsheng12']}`);
    if (palace['isBodyPalace']) lines.push(`※ 身宮所在`);

    return lines.join('\n');
  }

  /**
   * Interpolate ZWDS chart fields for compatibility (chartA/chartB).
   */
  private interpolateZwdsChartFields(
    template: string,
    chart: Record<string, unknown>,
    suffix: string,
  ): string {
    let result = template;

    result = result.replace(new RegExp(`\\{\\{gender${suffix}\\}\\}`, 'g'),
      (chart['gender'] as string) || '');
    result = result.replace(new RegExp(`\\{\\{fiveElementsClass${suffix}\\}\\}`, 'g'),
      (chart['fiveElementsClass'] as string) || '');

    const palaces = chart['palaces'] as Array<Record<string, unknown>> | undefined;
    if (palaces) {
      const palaceByName = new Map<string, Record<string, unknown>>();
      for (const palace of palaces) {
        palaceByName.set(palace['name'] as string, palace);
      }

      const fieldMap: Record<string, string> = {
        '命宮': `lifePalaceData${suffix}`,
        '夫妻宮': `spousePalaceData${suffix}`,
        '官祿宮': `careerPalaceData${suffix}`,
        '交友宮': `friendsPalaceData${suffix}`,
        '福德宮': `fortunePalaceData${suffix}`,
      };

      for (const [palaceName, placeholder] of Object.entries(fieldMap)) {
        const palace = palaceByName.get(palaceName);
        if (palace) {
          result = result.replace(
            new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g'),
            this.formatPalaceText(palace),
          );
        }
      }
    }

    return result;
  }

  // ============================================================
  // Response Parsing
  // ============================================================

  /**
   * Parse the AI's raw text response into structured InterpretationResult.
   * Handles JSON responses and gracefully degrades for non-JSON responses.
   */
  parseAIResponse(
    rawContent: string,
    readingType: ReadingType,
  ): AIInterpretationResult {
    // Strip markdown code fences if present (```json ... ```)
    let cleaned = rawContent
      .replace(/^```(?:json)?\s*\n?/gm, '')
      .replace(/\n?```\s*$/gm, '')
      .trim();

    // Try to extract JSON from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fallback: treat entire response as a single section
      return this.fallbackParse(rawContent, readingType);
    }

    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        // JSON might be truncated (AI ran out of tokens) — try to repair
        const repaired = this.repairTruncatedJSON(jsonMatch[0]);
        parsed = JSON.parse(repaired);
      }

      // Validate structure — try { sections: { ... } } wrapper first
      if (parsed.sections && typeof parsed.sections === 'object') {
        const sections: Record<string, InterpretationSection> = {};

        for (const [key, value] of Object.entries(parsed.sections)) {
          const section = value as Record<string, unknown>;
          sections[key] = {
            preview: (section.preview as string) || '',
            full: (section.full as string) || (section.preview as string) || '',
            ...(typeof section.score === 'number' && { score: section.score }),
          };
        }

        const summary: InterpretationSection = parsed.summary
          ? {
              preview: (parsed.summary as Record<string, string>).preview || '',
              full: (parsed.summary as Record<string, string>).full || '',
            }
          : { preview: '', full: '' };

        return { sections, summary };
      }

      // Handle flat structure — AI returned sections at top level without "sections" wrapper
      // e.g., { personality: { preview, full }, career: { preview, full }, summary: { preview, full } }
      const topLevelKeys = Object.keys(parsed);
      const sectionLikeKeys = topLevelKeys.filter((key) => {
        const val = parsed[key];
        return (
          key !== 'summary' &&
          val &&
          typeof val === 'object' &&
          ('preview' in val || 'full' in val)
        );
      });

      if (sectionLikeKeys.length > 0) {
        const sections: Record<string, InterpretationSection> = {};

        for (const key of sectionLikeKeys) {
          const section = parsed[key] as Record<string, unknown>;
          sections[key] = {
            preview: (section.preview as string) || '',
            full: (section.full as string) || (section.preview as string) || '',
            ...(typeof section.score === 'number' && { score: section.score }),
          };
        }

        const summary: InterpretationSection = parsed.summary
          ? {
              preview: (parsed.summary as Record<string, string>).preview || '',
              full: (parsed.summary as Record<string, string>).full || '',
            }
          : { preview: '', full: '' };

        return { sections, summary };
      }

      // If parsed but wrong structure, try fallback
      return this.fallbackParse(rawContent, readingType);
    } catch {
      return this.fallbackParse(rawContent, readingType);
    }
  }

  /**
   * Attempt to repair truncated JSON from AI that ran out of tokens.
   * Closes any open strings, arrays, and objects to make it parseable.
   */
  private repairTruncatedJSON(json: string): string {
    let repaired = json.trim();

    // If it ends mid-string, close the string
    // Count unescaped quotes to see if we're inside a string
    let inString = false;
    let lastCharBeforeEnd = '';
    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      if (ch === '\\' && inString) {
        i++; // skip escaped char
        continue;
      }
      if (ch === '"') {
        inString = !inString;
      }
      if (i === repaired.length - 1) {
        lastCharBeforeEnd = ch;
      }
    }

    if (inString) {
      // We're inside an unclosed string — close it
      // Remove trailing incomplete escape sequence if any
      if (repaired.endsWith('\\')) {
        repaired = repaired.slice(0, -1);
      }
      repaired += '"';
    }

    // Now close any open braces/brackets
    const stack: string[] = [];
    inString = false;
    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      if (ch === '\\' && inString) {
        i++;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === ch) {
          stack.pop();
        }
      }
    }

    // Remove trailing comma before closing (invalid JSON)
    repaired = repaired.replace(/,\s*$/, '');

    // Close all open braces/brackets in reverse order
    while (stack.length > 0) {
      repaired += stack.pop();
    }

    return repaired;
  }

  /**
   * Fallback parser when AI doesn't return proper JSON.
   * Splits the raw text into sections based on common headers.
   */
  private fallbackParse(
    rawContent: string,
    readingType: ReadingType,
  ): AIInterpretationResult {
    const isZwds = readingType.startsWith('ZWDS_');
    const readingConfig = isZwds
      ? ZWDS_READING_PROMPTS[readingType]
      : READING_PROMPTS[readingType];
    const sectionKeys = readingConfig?.sections || ['analysis'];

    // Split text into roughly equal parts for each expected section
    const paragraphs = rawContent.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const perSection = Math.max(1, Math.ceil(paragraphs.length / sectionKeys.length));

    const sections: Record<string, InterpretationSection> = {};

    for (let i = 0; i < sectionKeys.length; i++) {
      const sectionParagraphs = paragraphs.slice(i * perSection, (i + 1) * perSection);
      const fullText = sectionParagraphs.join('\n\n');
      const previewText = sectionParagraphs[0] || '';

      sections[sectionKeys[i]] = {
        preview: previewText.slice(0, 200),
        full: fullText,
      };
    }

    return {
      sections,
      summary: {
        preview: paragraphs[0]?.slice(0, 100) || '',
        full: paragraphs[0] || '',
      },
    };
  }

  // ============================================================
  // Usage Logging
  // ============================================================

  private async logUsage(
    userId: string | undefined,
    readingId: string | undefined,
    config: ProviderConfig,
    result: AIGenerationResult,
    readingType?: ReadingType,
  ) {
    try {
      await this.prisma.aIUsageLog.create({
        data: {
          userId,
          readingId,
          readingType: readingType ?? null,
          aiProvider: config.provider,
          aiModel: config.model,
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          costUsd: result.tokenUsage.estimatedCostUsd,
          latencyMs: result.latencyMs,
          isCacheHit: result.isCacheHit,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to log AI usage: ${err}`);
    }
  }

  // ============================================================
  // Reading Cache
  // ============================================================

  /**
   * Get a cached interpretation for identical birth data + reading type.
   */
  async getCachedInterpretation(
    birthDataHash: string,
    readingType: ReadingType,
  ): Promise<AIInterpretationResult | null> {
    try {
      // Try Redis first (fast)
      const cacheKey = `reading_cache:${birthDataHash}:${readingType}`;
      const cached = await this.redis.getJson<AIInterpretationResult>(cacheKey);
      if (cached) {
        return cached;
      }

      // Try DB cache (slower but persistent)
      const dbCache = await this.prisma.readingCache.findFirst({
        where: {
          birthDataHash,
          readingType,
          expiresAt: { gt: new Date() },
        },
      });

      if (dbCache?.interpretationJson) {
        // Populate Redis cache for next time
        const interpretation = dbCache.interpretationJson as unknown as AIInterpretationResult;
        await this.redis.setJson(cacheKey, interpretation, 86400); // 24h in Redis
        return interpretation;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Cache an interpretation result.
   */
  async cacheInterpretation(
    birthDataHash: string,
    readingType: ReadingType,
    calculationJson: Record<string, unknown>,
    interpretation: AIInterpretationResult,
  ): Promise<void> {
    try {
      // Redis cache (24h)
      const cacheKey = `reading_cache:${birthDataHash}:${readingType}`;
      await this.redis.setJson(cacheKey, interpretation, 86400);

      // DB cache (30 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await this.prisma.readingCache.upsert({
        where: {
          birthDataHash_readingType: {
            birthDataHash,
            readingType,
          },
        },
        update: {
          interpretationJson: interpretation as unknown as Prisma.InputJsonValue,
          calculationJson: calculationJson as unknown as Prisma.InputJsonValue,
          expiresAt,
        },
        create: {
          birthDataHash,
          readingType,
          calculationJson: calculationJson as unknown as Prisma.InputJsonValue,
          interpretationJson: interpretation as unknown as Prisma.InputJsonValue,
          expiresAt,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to cache interpretation: ${err}`);
    }
  }

  /**
   * Generate a hash for birth data to use as cache key.
   */
  generateBirthDataHash(
    birthDate: string,
    birthTime: string,
    birthCity: string,
    gender: string,
    readingType: ReadingType,
    targetYear?: number,
    targetMonth?: number,
    targetDay?: string,
    questionText?: string,
    readingStyle?: string,
  ): string {
    const crypto = require('crypto');
    // Include preAnalysis version in hash so cache invalidates when rules change
    // LIFETIME uses v2.2.0 (summary anchors + per-section narrative anchors + reading styles), all others use v1.1.0 (seasonal balance 旺相休囚死)
    const preAnalysisVersion = readingType === ReadingType.LIFETIME ? 'v2.2.0' : 'v1.1.0';
    const data = `${birthDate}|${birthTime}|${birthCity}|${gender}|${readingType}|${targetYear || ''}|${targetMonth || ''}|${targetDay || ''}|${questionText || ''}|${preAnalysisVersion}|${readingStyle || ''}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate a hash for compatibility comparison cache key.
   * Profiles are sorted by birth date to ensure A+B == B+A for the same pair.
   */
  generateComparisonHash(
    profileA: { birthDate: string; birthTime: string; birthCity: string; gender: string },
    profileB: { birthDate: string; birthTime: string; birthCity: string; gender: string },
    comparisonType: string,
  ): string {
    const crypto = require('crypto');
    const preAnalysisVersion = 'v1.1.0'; // bumped: seasonal balance change (旺相休囚死)
    // Sort profiles to ensure order-independent cache hits (A+B == B+A)
    const pA = `${profileA.birthDate}|${profileA.birthTime}|${profileA.birthCity}|${profileA.gender}`;
    const pB = `${profileB.birthDate}|${profileB.birthTime}|${profileB.birthCity}|${profileB.gender}`;
    const [first, second] = [pA, pB].sort();
    const year = new Date().getFullYear();
    const data = `comparison|${first}|${second}|${comparisonType}|${year}|${preAnalysisVersion}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
