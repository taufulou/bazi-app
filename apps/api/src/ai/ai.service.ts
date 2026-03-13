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
  buildLifetimeSystemPrompt,
  GUIDE_STYLE_RULES,
  CAREER_V2_PROMPTS,
  buildCareerSystemPrompt,
  CAREER_V2_STYLE_RULES,
  TEN_GOD_CAREER_TRANSLATION,
  ANNUAL_V2_PROMPTS,
} from './prompts';
import { deepCamelCase } from '../common/deep-camel-case';

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
      this.buildLifetimeV2Prompts(calculationData);

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

  // ============================================================
  // Career V2 Multi-Call (Non-Streaming)
  // ============================================================

  /**
   * Generate Career V2 AI interpretation using 2 parallel calls.
   * Call 1: Core career analysis (8 sections + summary)
   * Call 2: Timing forecasts (5 annual + 12 monthly)
   */
  async generateCareerV2Interpretation(
    calculationData: Record<string, unknown>,
    userId?: string,
    readingId?: string,
  ): Promise<AIGenerationResult> {
    if (this.providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    const timeoutMs = parseInt(
      this.configService.get<string>('AI_CALL_TIMEOUT_MS') || '60000',
      10,
    );

    const { systemPrompt, userPromptCall1, userPromptCall2 } =
      this.buildCareerV2Prompts(calculationData);

    let lastError: Error | undefined;

    for (const providerConfig of this.providers) {
      try {
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
          this.logger.warn(`Career V2 Call 1 failed (${providerConfig.provider}): ${(result1 as PromiseRejectedResult).reason}`);
        }
        if (!call2Success) {
          this.logger.warn(`Career V2 Call 2 failed (${providerConfig.provider}): ${(result2 as PromiseRejectedResult).reason}`);
        }

        if (!call1Success && !call2Success) {
          lastError = new Error(`Provider ${providerConfig.provider}: both career V2 calls failed`);
          continue;
        }

        let sections: Record<string, InterpretationSection> = {};
        let summary: InterpretationSection = { preview: '', full: '' };
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        if (call1Success) {
          const r1 = (result1 as PromiseFulfilledResult<{ content: string; inputTokens: number; outputTokens: number }>).value;
          totalInputTokens += r1.inputTokens;
          totalOutputTokens += r1.outputTokens;

          const parsed1 = this.parseLifetimeV2CallResponse(r1.content, 'call1');
          const { result: fixed1 } = this.autoFixAllSections(parsed1, calculationData);
          // Apply career-specific fixes to Call 1 sections
          for (const [key, section] of Object.entries(fixed1.sections)) {
            const { section: careerFixed } = this.autoFixCareerSection(key, section, calculationData);
            fixed1.sections[key] = careerFixed;
          }
          sections = { ...sections, ...fixed1.sections };
          if (fixed1.summary && (fixed1.summary.preview || fixed1.summary.full)) {
            summary = fixed1.summary;
          }

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
          }, 'CAREER' as ReadingType).catch(() => {});
        }

        if (call2Success) {
          const r2 = (result2 as PromiseFulfilledResult<{ content: string; inputTokens: number; outputTokens: number }>).value;
          totalInputTokens += r2.inputTokens;
          totalOutputTokens += r2.outputTokens;

          const parsed2 = this.parseLifetimeV2CallResponse(r2.content, 'call2');
          const { result: fixed2 } = this.autoFixAllSections(parsed2, calculationData);
          // Apply career-specific fixes to Call 2 sections
          for (const [key, section] of Object.entries(fixed2.sections)) {
            const { section: careerFixed } = this.autoFixCareerSection(key, section, calculationData);
            fixed2.sections[key] = careerFixed;
          }
          sections = { ...sections, ...fixed2.sections };

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
          }, 'CAREER' as ReadingType).catch(() => {});
        }

        // Merge with deterministic data from careerEnhancedInsights
        const enhancedInsights = calculationData['careerEnhancedInsights'] as Record<string, unknown> | undefined;
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
          `Career V2 generated via ${providerConfig.provider} in ${latencyMs}ms, ` +
          `${totalInputTokens}+${totalOutputTokens} tokens, $${totalCost.toFixed(4)}, ` +
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
          `Career V2 provider ${providerConfig.provider} failed: ${lastError.message}. Trying next...`,
        );
      }
    }

    // All providers exhausted for Career V2 → fall back to V1
    this.logger.warn(`Career V2 all providers failed (last: ${lastError?.message}) — falling back to V1`);
    return this.generateInterpretation(
      calculationData,
      ReadingType.CAREER,
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
  ): Observable<MessageEvent> {
    return new Observable((subscriber: Subscriber<MessageEvent>) => {
      this._executeStreamLifetimeV2(calculationData, readingId, subscriber)
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
      this.buildLifetimeV2Prompts(calculationData);

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
            calculationData['birthCity'] as string || '',
            calculationData['gender'] as string || '',
            ReadingType.LIFETIME,
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

  // ============================================================
  // Career V2 SSE Streaming
  // ============================================================

  /**
   * Stream Career V2 AI interpretation via SSE Observable.
   * Reuses the same streaming infrastructure as Lifetime V2.
   * Call 1 streams core career sections; Call 2 runs annual+monthly in parallel.
   */
  streamCareerV2(
    calculationData: Record<string, unknown>,
    readingId: string,
  ): Observable<MessageEvent> {
    return new Observable((subscriber: Subscriber<MessageEvent>) => {
      this._executeStreamCareerV2(calculationData, readingId, subscriber)
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

  private async _executeStreamCareerV2(
    calculationData: Record<string, unknown>,
    readingId: string,
    subscriber: Subscriber<MessageEvent>,
  ) {
    const startTime = Date.now();
    const timeoutMs = parseInt(
      this.configService.get<string>('AI_STREAM_TIMEOUT_MS') ||
      this.configService.get<string>('AI_CALL_TIMEOUT_MS') || '180000',
      10,
    );

    if (this.providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    const { systemPrompt, userPromptCall1, userPromptCall2 } =
      this.buildCareerV2Prompts(calculationData);

    // Build dynamic section keys for Call 2 extraction
    const call2ExpectedKeys: string[] = [];
    const enhancedInsights = calculationData['careerEnhancedInsights'] as Record<string, unknown> | undefined;
    const rawDeterministic = (enhancedInsights?.['deterministic'] || {}) as Record<string, unknown>;
    const annualForecasts = (rawDeterministic['annual_forecasts'] || rawDeterministic['annualForecasts'] || []) as Array<{ year: number }>;
    for (const af of annualForecasts) {
      call2ExpectedKeys.push(`annual_forecast_${af.year}`);
    }
    for (let m = 1; m <= 12; m++) {
      call2ExpectedKeys.push(`monthly_forecast_${String(m).padStart(2, '0')}`);
    }

    // Heartbeat to keep SSE alive
    const heartbeatInterval = setInterval(() => {
      subscriber.next({ data: '', type: 'heartbeat' } as MessageEvent);
    }, 15000);

    let call1Timeout!: ReturnType<typeof setTimeout>;

    try {
      let v2Succeeded = false;
      let totalSections = 0;
      let activeProviderConfig = this.providers[0]!;

      for (const providerConfig of this.providers) {
        activeProviderConfig = providerConfig;

        try {
          // === Call 1: Stream core career sections ===
          const call1Sections: Record<string, InterpretationSection> = {};
          let call1Summary: InterpretationSection = { preview: '', full: '' };
          let call1Buffer = '';

          // Set up abort controllers for timeouts
          const call1Controller = new AbortController();
          call1Timeout = setTimeout(() => call1Controller.abort(), timeoutMs);

          // === Call 2: Non-streaming parallel (annual + monthly forecasts) ===
          const call2Promise = this.callProviderWithTimeout(
            providerConfig, systemPrompt, userPromptCall2, timeoutMs,
          ).catch((err) => {
            this.logger.warn(`Career V2 Call 2 failed (${providerConfig.provider}): ${err instanceof Error ? err.message : err}`);
            return null;
          });

          const call1ExtractedKeys = new Set<string>();
          const call1Keys = CAREER_V2_PROMPTS.call1Sections;

          try {
            const streamGen = this.streamProvider(
              providerConfig, systemPrompt, userPromptCall1, call1Controller.signal,
            );

            for await (const chunk of streamGen) {
              call1Buffer += chunk;

              // Try to extract completed sections
              const newSections = this.extractCompletedSections(
                call1Buffer, call1Keys, call1ExtractedKeys,
              );

              for (const [key, rawSection] of Object.entries(newSections)) {
                const { section: autoFixed } = this.autoFixSection(key, rawSection, calculationData);
                const { section } = this.autoFixCareerSection(key, autoFixed, calculationData);
                call1Sections[key] = section;
                totalSections++;
                subscriber.next({
                  data: JSON.stringify({ key, preview: section.preview, full: section.full, ...(section.score != null && { score: section.score }) }),
                  type: 'section_complete',
                } as MessageEvent);
              }
            }

            // Parse any remaining from complete buffer
            const finalParsed = this.parseLifetimeV2CallResponse(call1Buffer, 'call1');
            for (const [key, rawSection] of Object.entries(finalParsed.sections)) {
              if (!call1Sections[key]) {
                const { section: autoFixed } = this.autoFixSection(key, rawSection, calculationData);
                const { section } = this.autoFixCareerSection(key, autoFixed, calculationData);
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
          } catch (streamErr) {
            if ((streamErr as Error).name !== 'AbortError') {
              this.logger.warn(`Career V2 Call 1 stream error: ${streamErr instanceof Error ? streamErr.message : streamErr}`);
            }
          }
          clearTimeout(call1Timeout);

          // Emit Call 1 complete
          subscriber.next({
            data: JSON.stringify({ call: 1 }),
            type: 'call_complete',
          } as MessageEvent);

          // Wait for Call 2 to finish
          let call2FixedSections: Record<string, InterpretationSection> = {};
          const call2Result = await call2Promise;
          if (call2Result) {
            const parsed2 = this.parseLifetimeV2CallResponse(call2Result.content, 'call2');
            const { result: fixed2 } = this.autoFixAllSections(parsed2, calculationData);
            // Apply career-specific fixes to Call 2 sections
            for (const [key, section] of Object.entries(fixed2.sections)) {
              const { section: careerFixed } = this.autoFixCareerSection(key, section, calculationData);
              fixed2.sections[key] = careerFixed;
            }
            call2FixedSections = fixed2.sections;

            for (const [key, section] of Object.entries(call2FixedSections)) {
              totalSections++;
              subscriber.next({
                data: JSON.stringify({ key, preview: section.preview, full: section.full, ...(section.score != null && { score: section.score }) }),
                type: 'section_complete',
              } as MessageEvent);
            }
          }

          // Emit Call 2 complete
          subscriber.next({
            data: JSON.stringify({ call: 2 }),
            type: 'call_complete',
          } as MessageEvent);

          // Emit summary
          if (call1Summary.preview || call1Summary.full) {
            subscriber.next({
              data: JSON.stringify({ preview: call1Summary.preview, full: call1Summary.full }),
              type: 'summary',
            } as MessageEvent);
          }

          // Merge all sections for DB update
          const allSections: Record<string, InterpretationSection> = {
            ...call1Sections,
            ...call2FixedSections,
          };

          // Build deterministic data (uses careerEnhancedInsights, NOT lifetimeEnhancedInsights)
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

          // Update DB record
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
            this.logger.error(`Failed to update career reading ${readingId} with AI: ${dbErr}`);
          }

          // Cache the result
          const birthDataHash = this.generateBirthDataHash(
            calculationData['birthDate'] as string || '',
            calculationData['birthTime'] as string || '',
            calculationData['birthCity'] as string || '',
            calculationData['gender'] as string || '',
            ReadingType.CAREER,
          );
          this.cacheInterpretation(
            birthDataHash,
            ReadingType.CAREER,
            calculationData,
            aiInterpretation as unknown as AIInterpretationResult,
          ).catch((err) => this.logger.error(`Career stream cache write failed: ${err}`));

          v2Succeeded = true;
          break;

        } catch (err) {
          this.logger.warn(
            `Career Stream V2 provider ${providerConfig.provider} failed: ${err instanceof Error ? err.message : err}. Trying next...`,
          );
          clearTimeout(call1Timeout);
          if (totalSections > 0) {
            v2Succeeded = true;
            break;
          }
        }
      }

      if (!v2Succeeded) {
        subscriber.next({
          data: JSON.stringify({ message: 'All Career V2 providers failed' }),
          type: 'error',
        } as MessageEvent);
      }

      const latencyMs = Date.now() - startTime;
      this.logger.log(
        `Stream Career V2 completed via ${activeProviderConfig.provider} in ${latencyMs}ms, ${totalSections} sections delivered`,
      );

      subscriber.next({
        data: JSON.stringify({ totalSections, latencyMs }),
        type: 'done',
      } as MessageEvent);

    } finally {
      clearInterval(heartbeatInterval);
      clearTimeout(call1Timeout!);
      subscriber.complete();
    }
  }

  // ============================================================
  // Annual V2 — Two-call architecture (mirrors Career V2)
  // ============================================================

  async generateAnnualV2Interpretation(
    calculationData: Record<string, unknown>,
    userId?: string,
    readingId?: string,
  ): Promise<AIGenerationResult> {
    if (this.providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    const timeoutMs = parseInt(
      this.configService.get<string>('AI_CALL_TIMEOUT_MS') || '60000',
      10,
    );

    const { systemPrompt, userPromptCall1, userPromptCall2 } =
      this.buildAnnualV2Prompts(calculationData);

    let lastError: Error | undefined;

    for (const providerConfig of this.providers) {
      try {
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
          this.logger.warn(`Annual V2 Call 1 failed (${providerConfig.provider}): ${(result1 as PromiseRejectedResult).reason}`);
        }
        if (!call2Success) {
          this.logger.warn(`Annual V2 Call 2 failed (${providerConfig.provider}): ${(result2 as PromiseRejectedResult).reason}`);
        }

        if (!call1Success && !call2Success) {
          lastError = new Error(`Provider ${providerConfig.provider}: both annual V2 calls failed`);
          continue;
        }

        let sections: Record<string, InterpretationSection> = {};
        let summary: InterpretationSection = { preview: '', full: '' };
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        if (call1Success) {
          const r1 = (result1 as PromiseFulfilledResult<{ content: string; inputTokens: number; outputTokens: number }>).value;
          totalInputTokens += r1.inputTokens;
          totalOutputTokens += r1.outputTokens;

          // Use parseAIResponse directly (generic JSON parser) — avoid parseLifetimeV2CallResponse
          // which falls back to LIFETIME_V2_PROMPTS keys (wrong for Annual V2)
          const parsed1 = this.parseAIResponse(r1.content, ReadingType.ANNUAL);
          // If Stage 1 failed, use brace-depth extraction with correct annual keys
          if (Object.keys(parsed1.sections).length === 0) {
            const extracted = this.extractCompletedSections(r1.content, ANNUAL_V2_PROMPTS.call1Sections, new Set<string>());
            Object.assign(parsed1.sections, extracted);
          }
          const { result: fixed1 } = this.autoFixAllSections(parsed1, calculationData);
          sections = { ...sections, ...fixed1.sections };
          if (fixed1.summary && (fixed1.summary.preview || fixed1.summary.full)) {
            summary = fixed1.summary;
          }

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
          }, 'ANNUAL' as ReadingType).catch(() => {});
        }

        if (call2Success) {
          const r2 = (result2 as PromiseFulfilledResult<{ content: string; inputTokens: number; outputTokens: number }>).value;
          totalInputTokens += r2.inputTokens;
          totalOutputTokens += r2.outputTokens;

          const parsed2 = this.parseAnnualV2Call2Response(r2.content);
          const { result: fixed2 } = this.autoFixAllSections(parsed2, calculationData);
          sections = { ...sections, ...fixed2.sections };

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
          }, 'ANNUAL' as ReadingType).catch(() => {});
        }

        // Merge with full annualEnhancedInsights as deterministic data
        // (not just the compact 'deterministic' sub-key — frontend needs full data for sub-header badges)
        const enhancedInsights = calculationData['annualEnhancedInsights'] as Record<string, unknown> | undefined;
        const deterministic = (enhancedInsights ? deepCamelCase(enhancedInsights) : {}) as Record<string, unknown>;

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
          `Annual V2 generated via ${providerConfig.provider} in ${latencyMs}ms, ` +
          `${totalInputTokens}+${totalOutputTokens} tokens, $${totalCost.toFixed(4)}, ` +
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
          `Annual V2 provider ${providerConfig.provider} failed: ${lastError.message}. Trying next...`,
        );
      }
    }

    // All providers exhausted — fall back to V1
    this.logger.warn(`Annual V2 all providers failed (last: ${lastError?.message}) — falling back to V1`);
    return this.generateInterpretation(
      calculationData,
      ReadingType.ANNUAL,
      userId,
      readingId,
    );
  }

  streamAnnualV2(
    calculationData: Record<string, unknown>,
    readingId: string,
  ): Observable<MessageEvent> {
    return new Observable((subscriber: Subscriber<MessageEvent>) => {
      this._executeStreamAnnualV2(calculationData, readingId, subscriber)
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

  private async _executeStreamAnnualV2(
    calculationData: Record<string, unknown>,
    readingId: string,
    subscriber: Subscriber<MessageEvent>,
  ) {
    const startTime = Date.now();
    const timeoutMs = parseInt(
      this.configService.get<string>('AI_STREAM_TIMEOUT_MS') ||
      this.configService.get<string>('AI_CALL_TIMEOUT_MS') || '180000',
      10,
    );

    if (this.providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    const { systemPrompt, userPromptCall1, userPromptCall2 } =
      this.buildAnnualV2Prompts(calculationData);

    // Build dynamic section keys for Call 2
    const call2ExpectedKeys: string[] = [];
    for (let m = 1; m <= 12; m++) {
      call2ExpectedKeys.push(`monthly_${String(m).padStart(2, '0')}`);
    }

    // Extract full enhanced insights as deterministic data (not just compact sub-key)
    const enhancedInsights = calculationData['annualEnhancedInsights'] as Record<string, unknown> | undefined;

    // Heartbeat to keep SSE alive
    const heartbeatInterval = setInterval(() => {
      subscriber.next({ data: '', type: 'heartbeat' } as MessageEvent);
    }, 15000);

    let call1Timeout!: ReturnType<typeof setTimeout>;

    try {
      let v2Succeeded = false;
      let totalSections = 0;
      let activeProviderConfig = this.providers[0]!;

      for (const providerConfig of this.providers) {
        activeProviderConfig = providerConfig;

        try {
          // === Call 1: Stream core annual sections ===
          const call1Sections: Record<string, InterpretationSection> = {};
          let call1Summary: InterpretationSection = { preview: '', full: '' };
          let call1Buffer = '';

          const call1Controller = new AbortController();
          call1Timeout = setTimeout(() => call1Controller.abort(), timeoutMs);

          // === Call 2: Non-streaming parallel (12 monthly forecasts) ===
          const call2Promise = this.callProviderWithTimeout(
            providerConfig, systemPrompt, userPromptCall2, timeoutMs,
          ).catch((err) => {
            this.logger.warn(`Annual V2 Call 2 failed (${providerConfig.provider}): ${err instanceof Error ? err.message : err}`);
            return null;
          });

          const call1ExtractedKeys = new Set<string>();
          const call1Keys = ANNUAL_V2_PROMPTS.call1Sections;

          try {
            const streamGen = this.streamProvider(
              providerConfig, systemPrompt, userPromptCall1, call1Controller.signal,
            );

            for await (const chunk of streamGen) {
              call1Buffer += chunk;

              const newSections = this.extractCompletedSections(
                call1Buffer, call1Keys, call1ExtractedKeys,
              );

              for (const [key, rawSection] of Object.entries(newSections)) {
                const { section: autoFixed } = this.autoFixSection(key, rawSection, calculationData);
                call1Sections[key] = autoFixed;
                totalSections++;
                subscriber.next({
                  data: JSON.stringify({ key, preview: autoFixed.preview, full: autoFixed.full }),
                  type: 'section_complete',
                } as MessageEvent);
              }
            }

            // Parse remaining from complete buffer using correct annual keys
            const finalExtracted = this.extractCompletedSections(call1Buffer, call1Keys, call1ExtractedKeys);
            for (const [key, rawSection] of Object.entries(finalExtracted)) {
              if (!call1Sections[key]) {
                const { section: autoFixed } = this.autoFixSection(key, rawSection, calculationData);
                call1Sections[key] = autoFixed;
                totalSections++;
                subscriber.next({
                  data: JSON.stringify({ key, preview: autoFixed.preview, full: autoFixed.full }),
                  type: 'section_complete',
                } as MessageEvent);
              }
            }
            // Extract summary using same brace-depth method
            const summaryExtracted = this.extractCompletedSections(call1Buffer, ['summary'], new Set<string>());
            if (summaryExtracted['summary'] && (summaryExtracted['summary'].preview || summaryExtracted['summary'].full)) {
              call1Summary = summaryExtracted['summary'];
            }
          } catch (streamErr) {
            if ((streamErr as Error).name !== 'AbortError') {
              this.logger.warn(`Annual V2 Call 1 stream error: ${streamErr instanceof Error ? streamErr.message : streamErr}`);
            }
          }
          clearTimeout(call1Timeout);

          subscriber.next({
            data: JSON.stringify({ call: 1 }),
            type: 'call_complete',
          } as MessageEvent);

          // Wait for Call 2
          let call2FixedSections: Record<string, InterpretationSection> = {};
          const call2Result = await call2Promise;
          if (!call2Result) {
            this.logger.warn(`Annual V2 Call 2 returned null — monthly sections will be missing`);
          }
          if (call2Result) {
            this.logger.log(`Annual V2 Call 2 completed: ${call2Result.content.length} chars`);
            const parsed2 = this.parseAnnualV2Call2Response(call2Result.content);
            const { result: fixed2 } = this.autoFixAllSections(parsed2, calculationData);
            call2FixedSections = fixed2.sections;

            for (const [key, section] of Object.entries(call2FixedSections)) {
              totalSections++;
              subscriber.next({
                data: JSON.stringify({ key, preview: section.preview, full: section.full }),
                type: 'section_complete',
              } as MessageEvent);
            }
          }

          subscriber.next({
            data: JSON.stringify({ call: 2 }),
            type: 'call_complete',
          } as MessageEvent);

          // Emit summary
          if (call1Summary.preview || call1Summary.full) {
            subscriber.next({
              data: JSON.stringify({ preview: call1Summary.preview, full: call1Summary.full }),
              type: 'summary',
            } as MessageEvent);
          }

          // Merge all sections for DB update
          const allSections: Record<string, InterpretationSection> = {
            ...call1Sections,
            ...call2FixedSections,
          };

          // Store full enhanced insights with deep camelCase as deterministic
          const deterministic = (enhancedInsights ? deepCamelCase(enhancedInsights) : {}) as Record<string, unknown>;

          const aiInterpretation = {
            schemaVersion: 'v2',
            sections: allSections,
            summary: call1Summary,
            deterministic,
          };

          // Update DB record
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
            this.logger.error(`Failed to update annual reading ${readingId} with AI: ${dbErr}`);
          }

          // Cache the result
          const birthDataHash = this.generateBirthDataHash(
            calculationData['birthDate'] as string || '',
            calculationData['birthTime'] as string || '',
            calculationData['birthCity'] as string || '',
            calculationData['gender'] as string || '',
            ReadingType.ANNUAL,
          );
          this.cacheInterpretation(
            birthDataHash,
            ReadingType.ANNUAL,
            calculationData,
            aiInterpretation as unknown as AIInterpretationResult,
          ).catch((err) => this.logger.error(`Annual stream cache write failed: ${err}`));

          v2Succeeded = true;
          break;

        } catch (err) {
          this.logger.warn(
            `Annual Stream V2 provider ${providerConfig.provider} failed: ${err instanceof Error ? err.message : err}. Trying next...`,
          );
          clearTimeout(call1Timeout);
          if (totalSections > 0) {
            v2Succeeded = true;
            break;
          }
        }
      }

      if (!v2Succeeded) {
        subscriber.next({
          data: JSON.stringify({ message: 'All Annual V2 providers failed' }),
          type: 'error',
        } as MessageEvent);
      }

      const latencyMs = Date.now() - startTime;
      this.logger.log(
        `Stream Annual V2 completed via ${activeProviderConfig.provider} in ${latencyMs}ms, ${totalSections} sections delivered`,
      );

      subscriber.next({
        data: JSON.stringify({ totalSections, latencyMs }),
        type: 'done',
      } as MessageEvent);

    } finally {
      clearInterval(heartbeatInterval);
      clearTimeout(call1Timeout!);
      subscriber.complete();
    }
  }

  private buildAnnualV2Prompts(
    calculationData: Record<string, unknown>,
  ): { systemPrompt: string; userPromptCall1: string; userPromptCall2: string } {
    const systemPrompt = BASE_SYSTEM_PROMPT + '\n\n' + ANNUAL_V2_PROMPTS.systemAddition;

    let call1Template = ANNUAL_V2_PROMPTS.userTemplateCall1;
    let call2Template = ANNUAL_V2_PROMPTS.userTemplateCall2;

    // Apply standard interpolation
    call1Template = this.interpolateTemplate(call1Template, calculationData, ReadingType.ANNUAL);
    call2Template = this.interpolateTemplate(call2Template, calculationData, ReadingType.ANNUAL);

    // Interpolate annual-specific placeholders
    call1Template = this.interpolateAnnualV2Fields(call1Template, calculationData);
    call2Template = this.interpolateAnnualV2Fields(call2Template, calculationData);

    const userPromptCall1 = call1Template + '\n\n' + ANNUAL_V2_PROMPTS.outputFormatCall1;
    const userPromptCall2 = call2Template + '\n\n' + ANNUAL_V2_PROMPTS.outputFormatCall2;

    return { systemPrompt, userPromptCall1, userPromptCall2 };
  }

  /**
   * Interpolate Annual V2-specific placeholders into templates.
   * Formats annualEnhancedInsights data as anchor text for AI consumption.
   */
  private interpolateAnnualV2Fields(
    template: string,
    data: Record<string, unknown>,
  ): string {
    let result = template;
    const insights = data['annualEnhancedInsights'] as Record<string, unknown> | undefined;
    if (!insights) {
      // Clear all annual placeholders
      result = result.replace(/\{\{flowYearHarmony\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualTaiSui\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{dayunContext\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualPillarImpacts\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualLuYangRen\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualCareerAnchors\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualFinanceAnchors\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualRelationshipAnchors\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualSpousePalace\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualMarriageStar\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualSealStar\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualHealthAnchors\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualContextBridge\}\}/g, '（預分析數據未提供）');
      result = result.replace(/\{\{annualMonthlyForecasts\}\}/g, '（預分析數據未提供）');
      return result;
    }

    // Read from full enhanced insights, NOT just the deterministic subset.
    // The deterministic sub-object is for frontend rendering only; AI needs all annual data.
    const det = insights as Record<string, unknown>;

    // {{flowYearHarmony}}
    const fyh = det['flowYearHarmony'] || det['flow_year_harmony'];
    if (fyh && typeof fyh === 'object') {
      const h = fyh as Record<string, unknown>;
      result = result.replace(/\{\{flowYearHarmony\}\}/g,
        `${h['flowYearLabel'] || ''}干支關係：${h['pattern'] || ''}（${h['description'] || ''}）`);
    } else {
      result = result.replace(/\{\{flowYearHarmony\}\}/g, '（無數據）');
    }

    // {{annualTaiSui}}
    const taiSui = det['taiSui'] || det['tai_sui'];
    if (taiSui && typeof taiSui === 'object') {
      const ts = taiSui as Record<string, unknown>;
      const pillarResults = (ts['pillarResults'] || []) as Array<Record<string, unknown>>;
      const lines: string[] = [];
      lines.push(`太歲總結：${ts['summary'] || '（無）'}`);
      for (const pr of pillarResults) {
        const types = (pr['types'] as string[]) || [];
        if (types.length > 0) {
          const roleLabel = pr['isActuallyFavorable'] ? '⚠️ 沖去忌神反而有利' : '不利影響';
          lines.push(`${pr['pillar']}柱(${pr['affectedPalace']}) ${pr['branch']}：${types.join('、')}，此支為${pr['branchRole']}，${roleLabel}`);
        }
      }
      result = result.replace(/\{\{annualTaiSui\}\}/g, lines.join('\n'));
    } else {
      result = result.replace(/\{\{annualTaiSui\}\}/g, '今年未犯太歲');
    }

    // {{dayunContext}}
    const dayun = det['dayunContext'] || det['dayun_context'];
    if (dayun && typeof dayun === 'object') {
      const d = dayun as Record<string, unknown>;
      const lines: string[] = [];
      if (d['available']) {
        lines.push(`目前大運：${d['stem']}${d['branch']}（${d['tenGod']}），${d['startYear']}-${d['endYear']}年`);
        lines.push(`大運角色：${d['role']}，對命主${d['favorability']}`);
        lines.push(`「流年為君，大運為臣 — 流年運勢以當年干支為主，大運提供背景影響。如需深入了解您的大運走勢，請參考八字終身運分析。」`);
      } else {
        lines.push('目前尚無大運（年紀尚輕），流年分析以命盤本身為主。');
      }
      result = result.replace(/\{\{dayunContext\}\}/g, lines.join('\n'));
    } else {
      result = result.replace(/\{\{dayunContext\}\}/g, '（大運數據未提供）');
    }

    // {{annualPillarImpacts}}
    const pillarImpacts = det['pillarImpacts'] || det['pillar_impacts'];
    if (Array.isArray(pillarImpacts)) {
      const lines: string[] = [];
      for (const pi of pillarImpacts) {
        const p = pi as Record<string, unknown>;
        const interactions = (p['interactions'] as Array<Record<string, unknown>>) || [];
        if (interactions.length > 0) {
          const interStr = interactions.map(i => `${i['type']}（${i['detail']}）`).join('、');
          lines.push(`${p['pillar']}柱(${p['palace']})${p['natalStem']}${p['natalBranch']}：${interStr}`);
        } else {
          lines.push(`${p['pillar']}柱(${p['palace']})${p['natalStem']}${p['natalBranch']}：無特殊交互`);
        }
      }
      result = result.replace(/\{\{annualPillarImpacts\}\}/g, lines.join('\n'));
    } else {
      result = result.replace(/\{\{annualPillarImpacts\}\}/g, '（無數據）');
    }

    // {{annualLuYangRen}}
    const luYangRen = det['luYangRen'] || det['lu_yangren'];
    if (luYangRen && typeof luYangRen === 'object') {
      const ly = luYangRen as Record<string, unknown>;
      const luShen = ly['luShen'] as Record<string, unknown> | undefined;
      const yangRen = ly['yangRen'] as Record<string, unknown> | undefined;
      const lines: string[] = [];
      if (luShen?.['active']) {
        lines.push(`祿神：流年見祿，${luShen['favorable'] ? '有利（增加收入/支持）' : '不利（身強忌祿）'}`);
        const warnings = (luShen['warnings'] as string[]) || [];
        if (warnings.length > 0) lines.push(`  注意：${warnings.join('、')}`);
      } else {
        lines.push('祿神：今年未見祿');
      }
      if (yangRen?.['active']) {
        lines.push(`羊刃：流年見羊刃，${yangRen['favorable'] ? '有利（身弱得助）' : `不利（危險等級：${yangRen['dangerLevel']}）`}`);
        const warnings = (yangRen['warnings'] as string[]) || [];
        if (warnings.length > 0) lines.push(`  ⚠️ ${warnings.join('、')}`);
      } else {
        lines.push('羊刃：今年未見羊刃');
      }
      result = result.replace(/\{\{annualLuYangRen\}\}/g, lines.join('\n'));
    } else {
      result = result.replace(/\{\{annualLuYangRen\}\}/g, '（無數據）');
    }

    // {{annualCareerAnchors}}
    const career = det['career'] || det['annual_career'];
    if (career && typeof career === 'object') {
      const c = career as Record<string, unknown>;
      const lines: string[] = [];
      lines.push(`流年十神：${c['flowYearTenGod']}（角色：${c['tenGodRole']}）`);
      const monthInter = (c['monthBranchInteractions'] as string[]) || [];
      if (monthInter.length > 0) lines.push(`事業宮互動：${monthInter.join('、')}`);
      const signals = (c['signals'] as Array<Record<string, unknown>>) || [];
      for (const s of signals) {
        lines.push(`${s['type']}（${s['impact']}）：${s['detail']}`);
      }
      result = result.replace(/\{\{annualCareerAnchors\}\}/g, lines.join('\n'));
    } else {
      result = result.replace(/\{\{annualCareerAnchors\}\}/g, '（無數據）');
    }

    // {{annualFinanceAnchors}}
    const finance = det['finance'] || det['annual_finance'];
    if (finance && typeof finance === 'object') {
      const f = finance as Record<string, unknown>;
      const lines: string[] = [];
      lines.push(`財星出現：${f['wealthPresent'] ? '是' : '否'}（${f['wealthType'] || '無'}）`);
      if (f['caikuFengChong']) {
        const ck = f['caikuFengChong'] as Record<string, unknown>;
        lines.push(`財庫逢沖：${ck['active'] ? `${ck['treasury']}被沖 — ${ck['interpretation']}` : '未觸發'}`);
      }
      const signals = (f['signals'] as Array<Record<string, unknown>>) || [];
      for (const s of signals) {
        lines.push(`${s['type']}（${s['impact']}）：${s['detail']}`);
      }
      result = result.replace(/\{\{annualFinanceAnchors\}\}/g, lines.join('\n'));
    } else {
      result = result.replace(/\{\{annualFinanceAnchors\}\}/g, '（無數據）');
    }

    // {{annualRelationshipAnchors}}
    const relationships = det['relationships'] || det['annual_relationships'];
    if (relationships && typeof relationships === 'object') {
      const r = relationships as Record<string, unknown>;
      const palaces = (r['palaceAnalysis'] as Array<Record<string, unknown>>) || [];
      const lines: string[] = [];
      for (const p of palaces) {
        const interactions = (p['interactions'] as Array<Record<string, unknown>>) || [];
        if (interactions.length > 0) {
          const interStr = interactions.map(i => `${i['type']}`).join('、');
          lines.push(`${p['palace']}：${interStr}`);
        }
      }
      result = result.replace(/\{\{annualRelationshipAnchors\}\}/g,
        lines.length > 0 ? lines.join('\n') : '各宮位無特殊人際互動');
    } else {
      result = result.replace(/\{\{annualRelationshipAnchors\}\}/g, '（無數據）');
    }

    // {{annualSpousePalace}}
    const spouse = det['spousePalace'] || det['spouse_palace'];
    if (spouse && typeof spouse === 'object') {
      const sp = spouse as Record<string, unknown>;
      const signals = (sp['signals'] as Array<Record<string, unknown>>) || [];
      const lines: string[] = [];
      if (sp['tianDiYuanYang']) {
        lines.push('⚠️ 天地鴛鴦合（流年干合日干 + 流年支合日支）— 極強婚姻信號');
      }
      for (const s of signals) {
        lines.push(`${s['type']}：${s['detail']}`);
      }
      result = result.replace(/\{\{annualSpousePalace\}\}/g,
        lines.length > 0 ? lines.join('\n') : '夫妻宮今年無特殊變化');
    } else {
      result = result.replace(/\{\{annualSpousePalace\}\}/g, '（無數據）');
    }

    // {{annualMarriageStar}}
    const marriage = det['marriageStar'] || det['marriage_star'];
    if (marriage && typeof marriage === 'object') {
      const m = marriage as Record<string, unknown>;
      const tracks = (m['tracks'] as Array<Record<string, unknown>>) || [];
      const lines: string[] = [];
      const ROMANCE_LEVEL_ZH: Record<string, string> = {
        very_strong: '極旺', strong: '偏強', moderate: '中等', quiet: '平靜',
      };
      const romanceLevelRaw = (m['romanceLevel'] as string) || 'quiet';
      lines.push(`姻緣活躍度：${ROMANCE_LEVEL_ZH[romanceLevelRaw] || '中等'}`);
      for (const t of tracks) {
        if (t['active']) {
          const trackLabel = t['trackType'] === 'celebration' ? `${t['track']}（喜慶星）` : t['track'];
          lines.push(`${trackLabel}：${t['detail']}`);
        }
      }
      result = result.replace(/\{\{annualMarriageStar\}\}/g,
        lines.length > 0 ? lines.join('\n') : '今年姻緣平靜');
    } else {
      result = result.replace(/\{\{annualMarriageStar\}\}/g, '（無數據）');
    }

    // {{annualSealStar}}
    const seal = det['sealStar'] || det['seal_star'];
    if (seal && typeof seal === 'object') {
      const s = seal as Record<string, unknown>;
      const lines: string[] = [];
      if (s['isSealYear']) {
        lines.push(`印星出現：${s['flowYearTenGod']}（角色：${s['sealRole']}）`);
        const sealSignals = (s['signals'] as Array<Record<string, unknown>>) || [];
        for (const sig of sealSignals) {
          lines.push(`${sig['type']}：${sig['detail']}`);
        }
      } else {
        lines.push('今年流年未見印星');
      }
      result = result.replace(/\{\{annualSealStar\}\}/g, lines.join('\n'));
    } else {
      result = result.replace(/\{\{annualSealStar\}\}/g, '（無數據）');
    }

    // {{annualHealthAnchors}}
    const healthData = det['health'] || det['annual_health'];
    if (healthData && typeof healthData === 'object') {
      const h = healthData as Record<string, unknown>;
      const lines: string[] = [];
      // Vitality (十二長生)
      const healthVitality = h['healthVitality'] as Record<string, unknown> | undefined;
      const lifeStage = h['lifeStage'] as string | undefined;
      if (lifeStage && healthVitality) {
        lines.push(`十二長生位：${lifeStage}（${healthVitality['label']}）`);
      }
      // Organ risk warnings (riskOrgans — flow year)
      const riskOrgans = (h['riskOrgans'] as Array<Record<string, unknown>>) || [];
      for (const w of riskOrgans) {
        lines.push(`【流年健康風險】${w['reason']}：${w['element']}行（${w['organs']}）— ${w['symptoms']}`);
      }
      // Element excess/deficiency warnings (natal constitution)
      const elementWarnings = (h['elementWarnings'] as Array<Record<string, unknown>>) || [];
      for (const ew of elementWarnings) {
        const sourceLabel = ew['source'] === 'natal' ? '【先天體質】' : '【流年風險】';
        lines.push(`${sourceLabel} ${ew['element']}${ew['condition']}：${ew['detail']}`);
      }
      // Yang Ren danger
      if (h['yangrenDanger']) {
        lines.push('⚠️ 流年見羊刃 — 注意血光之災/手術/意外');
      }
      // Stem body parts
      const stemBodyParts = h['stemBodyParts'] as string | undefined;
      if (stemBodyParts) {
        lines.push(`流年天干對應身體部位：${stemBodyParts}`);
      }
      result = result.replace(/\{\{annualHealthAnchors\}\}/g,
        lines.length > 0 ? lines.join('\n') : '健康方面無特殊警示');
    } else {
      result = result.replace(/\{\{annualHealthAnchors\}\}/g, '（無數據）');
    }

    // {{annualIndirectEffects}} — cross-section indirect effect chains
    const indirect = det['indirectEffects'] || det['indirect_effects'];
    if (indirect && typeof indirect === 'object') {
      const ie = indirect as Record<string, Array<Record<string, unknown>>>;
      const indirectLines: string[] = [];
      const sectionCN: Record<string, string> = {
        health: '健康', career: '事業', finance: '財運', relationships: '人際',
      };
      for (const [section, effects] of Object.entries(ie)) {
        for (const e of (effects || [])) {
          indirectLines.push(`[間接效應→${sectionCN[section] || section}] ${e['type']}（${e['impact']}）：${e['detail']}`);
        }
      }
      result = result.replace(/\{\{annualIndirectEffects\}\}/g,
        indirectLines.length > 0 ? indirectLines.join('\n') : '無間接效應');
    } else {
      result = result.replace(/\{\{annualIndirectEffects\}\}/g, '無間接效應');
    }

    // {{annualContextBridge}} — Call 2 summary of Call 1 findings
    const contextLines: string[] = [];
    if (taiSui && typeof taiSui === 'object') {
      const ts = taiSui as Record<string, unknown>;
      contextLines.push(`太歲：${ts['summary']}`);
    }
    if (fyh && typeof fyh === 'object') {
      const h = fyh as Record<string, unknown>;
      contextLines.push(`流年干支：${h['pattern']}（${h['description']}）`);
    }
    if (career && typeof career === 'object') {
      const c = career as Record<string, unknown>;
      contextLines.push(`流年十神：${c['flowYearTenGod']}（${c['tenGodRole']}）`);
    }
    if (dayun && typeof dayun === 'object') {
      const dCtx = dayun as Record<string, unknown>;
      if (dCtx['available']) {
        const hiddenStems = (dCtx['hiddenStems'] as Array<Record<string, unknown>>) || [];
        const hiddenStr = hiddenStems.map(
          (h: Record<string, unknown>) => `${h['stem']}=${h['tenGod']}(${h['role']})`
        ).join('、');
        contextLines.push(
          `大運背景：${dCtx['stem']}${dCtx['branch']}（${dCtx['tenGod']}），${dCtx['favorability']}` +
          (hiddenStr ? `；藏干：${hiddenStr}` : '')
        );
      }
    }
    result = result.replace(/\{\{annualContextBridge\}\}/g,
      contextLines.length > 0 ? contextLines.join('\n') : '（核心摘要未提供）');

    // {{annualMonthlyForecasts}} — all 12 months' deterministic data
    const pillarCN: Record<string, string> = { year: '年', month: '月', day: '日', hour: '時' };
    const monthly = det['monthlyForecasts'] || det['monthly_forecasts'];
    if (Array.isArray(monthly)) {
      const lines: string[] = [];
      for (const m of monthly) {
        const mo = m as Record<string, unknown>;
        const monthNum = String(mo['monthIndex'] || mo['monthLabel'] || '').padStart(2, '0');
        const aspects = mo['aspects'] as Record<string, unknown> | undefined;
        const branchInter = (mo['branchInteractions'] as Array<Record<string, unknown>>) || [];
        const interStr = branchInter.length > 0
          ? branchInter.map(bi => `${bi['type']}(${pillarCN[bi['pillar'] as string] || bi['pillar']}柱)`).join('、')
          : '無特殊';
        const kongWang = mo['isKongWang'] ? '⚠️空亡' : '';
        const stemBase = mo['stemBase'] || '';
        const branchBase = mo['branchBase'] || '';
        const baseDetail = (stemBase || branchBase) ? `，基礎判定：地支=${branchBase}，天干=${stemBase}` : '';
        lines.push(`${monthNum}月（${mo['monthStem']}${mo['monthBranch']}）：十神=${mo['monthTenGod']}，吉凶=${mo['auspiciousness']}${baseDetail}，地支=${interStr} ${kongWang}`);
        if (aspects) {
          // Career aspect has tenGod + signals + monthPillarInteractions
          const careerAspect = (aspects['career'] as Record<string, unknown>) || {};
          const careerSignals = (careerAspect['signals'] as string[]) || [];
          const careerInteractions = (careerAspect['monthPillarInteractions'] as string[]) || [];
          const careerParts = [`${careerAspect['tenGod'] || ''}`];
          if (careerSignals.length > 0) careerParts.push(careerSignals.join('、'));
          if (careerInteractions.length > 0) careerParts.push(`月柱交互=${careerInteractions.join('、')}`);
          lines.push(`  事業：${careerParts.filter(Boolean).join('，') || '無特殊'}`);
          // Finance/romance/health only have signals array
          const financeAspect = (aspects['finance'] as Record<string, unknown>) || {};
          const financeSignals = (financeAspect['signals'] as string[]) || [];
          lines.push(`  財運：${financeSignals.join('、') || '無特殊'}`);
          const romanceAspect = (aspects['romance'] as Record<string, unknown>) || {};
          const romanceSignals = (romanceAspect['signals'] as string[]) || [];
          lines.push(`  感情：${romanceSignals.join('、') || '無特殊'}`);
          const healthAspect = (aspects['health'] as Record<string, unknown>) || {};
          const healthSignals = (healthAspect['signals'] as string[]) || [];
          lines.push(`  健康：${healthSignals.join('、') || '無特殊'}`);
        }
      }
      result = result.replace(/\{\{annualMonthlyForecasts\}\}/g, lines.join('\n'));
    } else {
      result = result.replace(/\{\{annualMonthlyForecasts\}\}/g, '（月度預分析數據未提供）');
    }

    return result;
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
                if (parsed.full !== undefined) {
                  result[key] = {
                    preview: parsed.preview ?? '',
                    full: parsed.full ?? parsed.preview ?? '',
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
  ): { systemPrompt: string; userPromptCall1: string; userPromptCall2: string } {
    const basePrompt = buildLifetimeSystemPrompt();
    const systemPrompt = basePrompt + '\n\n' + LIFETIME_V2_PROMPTS.systemAddition + '\n' + GUIDE_STYLE_RULES;

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

    // Append output format instructions with score field (guide style always active)
    const outputFormatCall1 = LIFETIME_V2_PROMPTS.outputFormatCall1.replace(
      /{ "preview"/g,
      '{ "score": <1-5的數字，支持0.5如3.5>, "preview"',
    );
    const outputFormatCall2 = LIFETIME_V2_PROMPTS.outputFormatCall2.replace(
      /{ "preview"/g,
      '{ "score": <1-5的數字，支持0.5如3.5>, "preview"',
    );
    const userPromptCall1 = call1Template + '\n\n' + outputFormatCall1;
    const userPromptCall2 = call2Template + '\n\n' + outputFormatCall2;

    return { systemPrompt, userPromptCall1, userPromptCall2 };
  }

  /**
   * Build system + user prompts for both Career V2 calls.
   * Interpolates career-specific pre-analysis data into templates.
   */
  private buildCareerV2Prompts(
    calculationData: Record<string, unknown>,
  ): { systemPrompt: string; userPromptCall1: string; userPromptCall2: string } {
    const basePrompt = buildCareerSystemPrompt();
    const systemPrompt = basePrompt + '\n\n' + CAREER_V2_PROMPTS.systemAddition + '\n' + CAREER_V2_STYLE_RULES;

    // Interpolate shared placeholders for both calls
    let call1Template = CAREER_V2_PROMPTS.userTemplateCall1;
    let call2Template = CAREER_V2_PROMPTS.userTemplateCall2;

    // Apply standard interpolation (reuses existing logic)
    call1Template = this.interpolateTemplate(call1Template, calculationData, ReadingType.CAREER);
    call2Template = this.interpolateTemplate(call2Template, calculationData, ReadingType.CAREER);

    // Interpolate career-specific placeholders
    call1Template = this.interpolateCareerV2Fields(call1Template, calculationData);
    call2Template = this.interpolateCareerV2Fields(call2Template, calculationData);

    // Append output format instructions with score field
    const outputFormatCall1 = CAREER_V2_PROMPTS.outputFormatCall1.replace(
      /{ "preview"/g,
      '{ "score": <1-5的數字，支持0.5如3.5>, "preview"',
    );

    // Call 2 output format needs dynamic year substitution
    let outputFormatCall2 = CAREER_V2_PROMPTS.outputFormatCall2;
    const enhancedInsights = calculationData['careerEnhancedInsights'] as Record<string, unknown> | undefined;
    const rawDet = (enhancedInsights?.['deterministic'] || {}) as Record<string, unknown>;
    const annualForecasts = (rawDet['annual_forecasts'] || rawDet['annualForecasts'] || []) as Array<{ year: number }>;
    if (annualForecasts.length > 0) {
      const years = annualForecasts.map(af => af.year);
      for (let i = 0; i < Math.min(5, years.length); i++) {
        outputFormatCall2 = outputFormatCall2.replace(
          new RegExp(`YYYY${i + 1}`, 'g'),
          String(years[i]),
        );
      }
    }
    outputFormatCall2 = outputFormatCall2.replace(
      /{ "preview"/g,
      '{ "score": <1-5的數字，支持0.5如3.5>, "preview"',
    );

    const userPromptCall1 = call1Template + '\n\n' + outputFormatCall1;
    const userPromptCall2 = call2Template + '\n\n' + outputFormatCall2;

    return { systemPrompt, userPromptCall1, userPromptCall2 };
  }

  /**
   * Interpolate Career V2-specific placeholders into templates.
   */
  private interpolateCareerV2Fields(
    template: string,
    data: Record<string, unknown>,
  ): string {
    let result = template;
    const enhanced = data['careerEnhancedInsights'] as Record<string, unknown> | undefined;
    // Read from full enhanced insights (camelCase keys), NOT just the deterministic subset.
    // The deterministic sub-object is for frontend rendering only; AI needs all career data.
    const det = (enhanced || {}) as Record<string, unknown>;

    // Career pre-analysis (Call 1)
    if (result.includes('{{careerPreAnalysis}}')) {
      const lines: string[] = [];

      // DM Strength — prominent anchor (prevents AI self-diagnosis)
      const preAnalysis = data['preAnalysis'] as Record<string, unknown> | undefined;
      const strengthV2Data = preAnalysis?.['strengthV2'] as Record<string, unknown> | undefined;
      if (strengthV2Data) {
        const cls = STRENGTH_V2_ZH[(strengthV2Data['classification'] as string) || ''] || '';
        const sc = strengthV2Data['score'] || 0;
        lines.push(`⚠️ 日主強弱分類（以此為準，不可自行判斷）：${cls}（${sc}/100）`);
      }

      // Pattern & scores
      lines.push(`⚠️ 格局（以此為準）：${det['pattern'] || '（未提供）'}`);
      lines.push(`格局類型：${det['pattern_type'] || det['patternType'] || '標準格'}`);

      const rep = det['reputation_score'] || det['reputationScore'];
      if (rep && typeof rep === 'object') {
        const r = rep as Record<string, unknown>;
        lines.push(`名聲地位評分：${r['score']}分（等級：${r['level']}）`);
      }

      const wea = det['wealth_score'] || det['wealthScore'];
      if (wea && typeof wea === 'object') {
        const w = wea as Record<string, unknown>;
        lines.push(`財富格局評分：${w['score']}分（等級：${w['tier']}）`);
      }

      // Suitable positions
      const positions = (det['suitable_positions'] || det['suitablePositions'] || []) as Array<Record<string, unknown>>;
      if (positions.length > 0) {
        lines.push('\n適合職位：');
        for (const p of positions) {
          lines.push(`- ${p['pattern']}（${p['source']}）：${(p['positions'] as string[] || []).join('、')}`);
        }
      }

      // Company type
      const company = (det['company_type_fit'] || det['companyTypeFit']) as Record<string, unknown> | undefined;
      if (company) {
        lines.push(`\n公司類型適配：${company['label']}（${company['description']}）`);
      }

      // Entrepreneurship
      const entre = (det['entrepreneurship_fit'] || det['entrepreneurshipFit']) as Record<string, unknown> | undefined;
      if (entre) {
        lines.push(`\n創業適合度：${entre['score']}分（類型：${entre['type']}）`);
        lines.push(`原因：${(entre['reasons'] as string[] || []).join('；')}`);
      }

      // Partnership
      const partner = (det['partnership_fit'] || det['partnershipFit']) as Record<string, unknown> | undefined;
      if (partner) {
        lines.push(`\n合夥適合度：${partner['score']}分（${partner['suitable'] ? '適合' : '不適合'}）`);
        lines.push(`原因：${(partner['reasons'] as string[] || []).join('；')}`);
      }

      // Career allies
      const allies = (det['career_allies'] || det['careerAllies']) as Record<string, unknown> | undefined;
      if (allies) {
        const nobles = (allies['nobles'] || []) as Array<Record<string, unknown>>;
        if (nobles.length > 0) {
          lines.push('\n貴人：');
          for (const n of nobles) {
            lines.push(`- ${n['name']}（${n['branch']}${n['zodiac'] ? ' ' + n['zodiac'] : ''}）`);
          }
        }
        const antags = (allies['antagonists'] || []) as Array<Record<string, unknown>>;
        if (antags.length > 0) {
          lines.push('小人：');
          for (const a of antags) {
            lines.push(`- ${a['label']}：${a['description']}`);
          }
        }
        const allyList = (allies['allies'] || []) as Array<Record<string, unknown>>;
        if (allyList.length > 0) {
          lines.push(`三合/六合貴人生肖：${allyList.map(al => al['zodiac'] || al['branch']).join('、')}`);
        }
        const enemyList = (allies['enemies'] || []) as Array<Record<string, unknown>>;
        if (enemyList.length > 0) {
          lines.push(`六沖/刑/害 不合生肖：${enemyList.map(e => e['zodiac'] || e['branch']).join('、')}`);
        }
        // Career-specific shensha (將星, 太極貴人, etc.)
        const careerShensha = (allies['career_shensha'] || allies['careerShensha'] || []) as Array<Record<string, unknown>>;
        if (careerShensha.length > 0) {
          lines.push('事業貴星：');
          for (const cs of careerShensha) {
            lines.push(`- ${cs['name']}（${cs['branch']}${cs['zodiac'] ? ' ' + cs['zodiac'] : ''}）`);
          }
        }
        // Mobility bringers (驛馬 sources)
        const mobilityBringers = (allies['mobility_bringers'] || allies['mobilityBringers'] || []) as Array<Record<string, unknown>>;
        if (mobilityBringers.length > 0) {
          const uniqueZodiacs = [...new Set(mobilityBringers.map(mb => (mb['zodiac'] || mb['branch']) as string))];
          lines.push(`驛馬來源生肖：${uniqueZodiacs.join('、')}`);
        }
      }

      // Industries (Python returns Array<{element, anchor, category, industries: string[]}>)
      const favInd = (det['favorable_industries'] || det['favorableIndustries'] || []) as Array<Record<string, unknown>>;
      if (favInd.length > 0) {
        lines.push('\n有利行業：');
        for (const cat of favInd) {
          const indList = (cat['industries'] as string[] || []).join('、');
          lines.push(`- ${cat['element']}（${cat['category']}）：${indList}`);
        }
      }
      const unfavInd = (det['unfavorable_industries'] || det['unfavorableIndustries'] || []) as Array<Record<string, unknown>>;
      if (unfavInd.length > 0) {
        lines.push('不利行業：');
        for (const cat of unfavInd) {
          const indList = (cat['industries'] as string[] || []).join('、');
          lines.push(`- ${cat['element']}（${cat['category']}）：${indList}`);
        }
      }

      // Five Qi States
      const fiveQi = (det['five_qi_states'] || det['fiveQiStates']) as Record<string, string> | undefined;
      if (fiveQi) {
        lines.push(`\n旺相休囚死：${Object.entries(fiveQi).map(([e, s]) => `${e}=${s}`).join('、')}`);
      }

      // Weighted Five Elements (career-specific, with seasonal multipliers)
      const weightedElem = det['weightedElements'] as Record<string, Record<string, unknown>> | undefined;
      if (weightedElem) {
        const elemLines = Object.entries(weightedElem)
          .map(([elem, info]) => `${elem}=${(info as Record<string, unknown>)['percentage']}%（${(info as Record<string, unknown>)['level']}）`)
          .join('、');
        lines.push(`\n加權五行比重（含季節調整）：${elemLines}`);
      }

      result = result.replace(/\{\{careerPreAnalysis\}\}/g, lines.join('\n'));
    }

    // Call 1 Anchors: suitable_positions (numbered fact lines AI must weave into narrative)
    if (result.includes('{{anchors_suitable_positions}}')) {
      const positions = (det['suitablePositions'] || []) as Array<Record<string, unknown>>;
      const anchorLines: string[] = [];
      let idx = 1;
      for (const p of positions) {
        const positionList = (p['positions'] as string[] || []).join('、');
        anchorLines.push(`${idx}. ${p['pattern']}（${p['source']}）適合職位：${positionList}`);
        idx++;
      }
      if (anchorLines.length === 0) anchorLines.push('1. （無適合職位數據）');
      result = result.replace(/\{\{anchors_suitable_positions\}\}/g, anchorLines.join('\n'));
    }

    // Call 1 Anchors: career_directions_favorable
    if (result.includes('{{anchors_career_directions_favorable}}')) {
      const favInd = (det['favorableIndustries'] || []) as Array<Record<string, unknown>>;
      const anchorLines: string[] = [];
      let idx = 1;
      for (const cat of favInd) {
        const industries = (cat['industries'] as string[] || []);
        anchorLines.push(`${idx}. 有利行業（${cat['element']}/${cat['category']}）：${industries.join('、')}`);
        idx++;
      }
      if (anchorLines.length === 0) anchorLines.push('1. （無有利行業數據）');
      result = result.replace(/\{\{anchors_career_directions_favorable\}\}/g, anchorLines.join('\n'));
    }

    // Call 1 Anchors: career_directions_unfavorable
    if (result.includes('{{anchors_career_directions_unfavorable}}')) {
      const unfavInd = (det['unfavorableIndustries'] || []) as Array<Record<string, unknown>>;
      const anchorLines: string[] = [];
      let idx = 1;
      for (const cat of unfavInd) {
        const industries = (cat['industries'] as string[] || []);
        anchorLines.push(`${idx}. 不利行業（${cat['element']}/${cat['category']}）：${industries.join('、')}`);
        idx++;
      }
      if (anchorLines.length === 0) anchorLines.push('1. （無不利行業數據）');
      result = result.replace(/\{\{anchors_career_directions_unfavorable\}\}/g, anchorLines.join('\n'));
    }

    // Career context bridge (Call 2)
    if (result.includes('{{careerContextBridge}}')) {
      const bridgeLines: string[] = [];
      // DM Strength for Call 2 context bridge (self-contained, no shared vars with careerPreAnalysis block)
      const preAnalysis2 = data['preAnalysis'] as Record<string, unknown> | undefined;
      const sv2 = preAnalysis2?.['strengthV2'] as Record<string, unknown> | undefined;
      if (sv2) {
        const cls2 = STRENGTH_V2_ZH[(sv2['classification'] as string) || ''] || '';
        const sc2 = sv2['score'] || 0;
        bridgeLines.push(`⚠️ 日主強弱（以此為準）：${cls2}（${sc2}/100）`);
      }
      bridgeLines.push(`格局：${det['pattern'] || '（未提供）'}`);
      const rep = det['reputation_score'] || det['reputationScore'];
      if (rep && typeof rep === 'object') {
        bridgeLines.push(`名聲地位：${(rep as Record<string, unknown>)['score']}分`);
      }
      const wea = det['wealth_score'] || det['wealthScore'];
      if (wea && typeof wea === 'object') {
        bridgeLines.push(`財富格局：${(wea as Record<string, unknown>)['score']}分`);
      }
      result = result.replace(/\{\{careerContextBridge\}\}/g, bridgeLines.join('\n'));
    }

    // Call 2 Anchors: annual forecasts (numbered fact lines — AI must state auspiciousness labels exactly)
    if (result.includes('{{anchors_annual_forecasts}}')) {
      const annuals = (det['annualForecasts'] || []) as Array<Record<string, unknown>>;
      const anchorLines: string[] = [];
      let idx = 1;
      for (const af of annuals) {
        const yearTG = (af['tenGod'] as string) || '';
        const yearTGTrans = TEN_GOD_CAREER_TRANSLATION[yearTG] || yearTG;
        const lpTG = (af['luckPeriodTenGod'] as string) || '';
        const lpTGTrans = TEN_GOD_CAREER_TRANSLATION[lpTG] || lpTG;
        anchorLines.push(
          `${idx}. ⚠️ ${af['year']}年：流年十神為「${yearTG}」（翻譯：${yearTGTrans}），` +
          `大運十神為「${lpTG}」（翻譯：${lpTGTrans}），` +
          `吉凶判定為「${af['auspiciousness']}」——此吉凶等級不可更改`,
        );
        idx++;
      }
      if (anchorLines.length === 0) anchorLines.push('1. （無年度預測數據）');
      result = result.replace(/\{\{anchors_annual_forecasts\}\}/g, anchorLines.join('\n'));
    }

    // Call 2 Anchors: monthly forecasts (ten god translation + auspiciousness labels)
    if (result.includes('{{anchors_monthly_forecasts}}')) {
      const monthlies = (det['monthlyForecasts'] || []) as Array<Record<string, unknown>>;
      const anchorLines: string[] = [];
      let idx = 1;
      for (const mf of monthlies) {
        const mfTG = (mf['tenGod'] as string) || '';
        const mfTGTrans = TEN_GOD_CAREER_TRANSLATION[mfTG] || mfTG;

        let anchorLine = `${idx}. ${mf['month']}月（${mf['monthName'] || ''}）：` +
          `十神為「${mfTG}」（翻譯：${mfTGTrans}），吉凶為「${mf['auspiciousness']}」`;

        // Branch interactions in anchor
        const monthBranchInt = (mf['branchInteractions'] || mf['branch_interactions'] || []) as Array<Record<string, unknown>>;
        if (monthBranchInt.length > 0) {
          const intText = monthBranchInt.map(bi => `${bi['type']}（${bi['effect']}）`).join('、');
          anchorLine += `，地支互動：${intText}`;
        }

        anchorLines.push(anchorLine);
        idx++;
      }
      if (anchorLines.length === 0) anchorLines.push('1. （無月度預測數據）');
      result = result.replace(/\{\{anchors_monthly_forecasts\}\}/g, anchorLines.join('\n'));
    }

    // Active luck period (Call 2)
    if (result.includes('{{careerActiveLuckPeriod}}')) {
      const lp = (det['active_luck_period'] || det['activeLuckPeriod']) as Record<string, unknown> | undefined;
      if (lp) {
        const lpActiveTG = lp['tenGod'] as string;
        const lpActiveTGTrans = TEN_GOD_CAREER_TRANSLATION[lpActiveTG] || lpActiveTG;
        result = result.replace(/\{\{careerActiveLuckPeriod\}\}/g,
          `${lp['stem']}${lp['branch']}大運（${lp['startYear']}-${lp['endYear']}），十神：${lpActiveTG}（→${lpActiveTGTrans}）`);
      } else {
        result = result.replace(/\{\{careerActiveLuckPeriod\}\}/g, '（未提供）');
      }
    }

    // Annual forecasts (Call 2)
    if (result.includes('{{careerAnnualForecasts}}')) {
      const annuals = (det['annual_forecasts'] || det['annualForecasts'] || []) as Array<Record<string, unknown>>;
      const afLines: string[] = [];
      for (const af of annuals) {
        const yearTenGod = (af['ten_god'] || af['tenGod']) as string;
        const yearTGTrans = TEN_GOD_CAREER_TRANSLATION[yearTenGod] || yearTenGod;
        const lpTenGod = (af['luck_period_ten_god'] || af['luckPeriodTenGod']) as string;
        const lpTGTrans = TEN_GOD_CAREER_TRANSLATION[lpTenGod] || lpTenGod;
        const line = [
          `${af['year']}年（${af['stem']}${af['branch']}年）`,
          `流年十神：${yearTenGod}（→${yearTGTrans}）`,
          `大運：${af['luck_period_stem'] || af['luckPeriodStem']}${af['luck_period_branch'] || af['luckPeriodBranch']}`,
          `大運十神：${lpTenGod}（→${lpTGTrans}）`,
          `吉凶：${af['auspiciousness']}`,
        ];
        const interactions = (af['branch_interactions'] || af['branchInteractions'] || []) as string[];
        if (interactions.length > 0) line.push(`地支互動：${interactions.join('、')}`);
        const kong = af['kong_wang_analysis'] || af['kongWangAnalysis'];
        if (kong && typeof kong === 'object') {
          const k = kong as Record<string, unknown>;
          if (k['hit']) {
            const kongLabel = k['favorable'] === true ? '吉' : k['favorable'] === false ? '凶' : '平';
            line.push(`空亡：${k['effect']}（${kongLabel}）`);
          }
        }
        const yima = af['yima_analysis'] || af['yimaAnalysis'];
        if (yima && typeof yima === 'object') {
          const y = yima as Record<string, unknown>;
          if (y['hit']) {
            const yimaLabel = y['favorable'] === true ? '有利變動' : y['favorable'] === false ? '被迫變動' : '中性變動';
            line.push(`驛馬：${y['type']}（${yimaLabel}）`);
          }
        }
        const indicators = (af['career_indicators'] || af['careerIndicators'] || []) as Array<Record<string, unknown>>;
        if (indicators.length > 0) {
          const indicatorText = indicators.map(ind => `${ind['label']}（${ind['description']}）`).join('、');
          line.push(`事業指標：${indicatorText}`);
        }
        afLines.push(line.join(' / '));
      }
      result = result.replace(/\{\{careerAnnualForecasts\}\}/g, afLines.join('\n'));
    }

    // Monthly forecasts (Call 2)
    if (result.includes('{{careerMonthlyForecasts}}')) {
      const monthlies = (det['monthly_forecasts'] || det['monthlyForecasts'] || []) as Array<Record<string, unknown>>;
      const mfLines: string[] = [];
      for (const mf of monthlies) {
        const mfTenGod = (mf['ten_god'] || mf['tenGod']) as string;
        const mfTGTrans = TEN_GOD_CAREER_TRANSLATION[mfTenGod] || mfTenGod;

        let line = `${mf['month']}月（${mf['month_name'] || mf['monthName']}，${mf['stem']}${mf['branch']}）` +
          ` / 十神：${mfTenGod}（→${mfTGTrans}）` +
          ` / 吉凶：${mf['auspiciousness']}` +
          ` / 季節能量：${mf['season_element'] || mf['seasonElement'] || ''}` +
          ` / 公曆：${mf['solar_term_date'] || mf['solarTermDate'] || ''} 起`;

        // Branch interactions
        const monthBranchInt = (mf['branchInteractions'] || mf['branch_interactions'] || []) as Array<Record<string, unknown>>;
        if (monthBranchInt.length > 0) {
          const intText = monthBranchInt.map(bi => `${bi['type']}（${bi['effect']}）`).join('、');
          line += ` / 地支互動：${intText}`;
        }

        // Annual context
        const annCtx = (mf['annualContext'] || mf['annual_context'] || '') as string;
        if (annCtx) {
          line += ` / 年度背景：${annCtx}`;
        }

        mfLines.push(line);
      }
      result = result.replace(/\{\{careerMonthlyForecasts\}\}/g, mfLines.join('\n'));
    }

    return result;
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

  /**
   * Parse Annual V2 Call 2 response (12 monthly sections).
   * Stage 1: Standard JSON parse. Stage 2: brace-depth tracking fallback.
   */
  private parseAnnualV2Call2Response(rawContent: string): AIInterpretationResult {
    // Stage 1: Standard JSON parse
    const parsed = this.parseAIResponse(rawContent, ReadingType.ANNUAL);
    if (Object.keys(parsed.sections).length > 0) {
      return parsed;
    }

    // Stage 2: Use brace-depth tracking (extractCompletedSections) — handles } inside strings
    const monthlyKeys = Array.from({ length: 12 }, (_, i) =>
      `monthly_${String(i + 1).padStart(2, '0')}`,
    );
    const alreadyExtracted = new Set<string>();
    const sections = this.extractCompletedSections(rawContent, monthlyKeys, alreadyExtracted);

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

  /**
   * Career-specific auto-fix: corrects ten god translation swaps, DM strength mislabeling,
   * and raw Bazi term leaks. Applied AFTER generic autoFixSection().
   */
  private autoFixCareerSection(
    sectionKey: string,
    section: InterpretationSection,
    calculationData: Record<string, unknown>,
  ): { section: InterpretationSection; fixes: string[] } {
    const fixes: string[] = [];
    let fullText = section.full;
    let previewText = section.preview;

    const enhanced = calculationData['careerEnhancedInsights'] as Record<string, unknown> | undefined;
    if (!enhanced) return { section, fixes };

    // ---- Fix 1: 偏印↔正印 translation swap (section-aware) ----
    // Only apply when the section's ten god is known from pre-analysis data
    const annuals = (enhanced['annualForecasts'] || []) as Array<Record<string, unknown>>;
    const monthlies = (enhanced['monthlyForecasts'] || []) as Array<Record<string, unknown>>;

    let sectionTenGod: string | null = null;

    // Match annual_forecast_YYYY → look up that year's ten god
    const yearMatch = sectionKey.match(/^annual_forecast_(\d{4})$/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      const af = annuals.find(a => a['year'] === year);
      if (af) {
        sectionTenGod = (af['tenGod'] as string) || null;
      }
    }

    // Match monthly_forecast_MM → look up that month's ten god
    const monthMatch = sectionKey.match(/^monthly_forecast_(\d{2})$/);
    if (monthMatch) {
      const monthNum = parseInt(monthMatch[1], 10);
      const mf = monthlies.find(m => m['month'] === monthNum);
      if (mf) {
        sectionTenGod = (mf['tenGod'] as string) || null;
      }
    }

    if (sectionTenGod) {
      // If section's ten god is 偏印 but AI wrote 學習力 (正印's translation), fix it
      if (sectionTenGod === '偏印' && fullText.includes('學習力') && !fullText.includes('獨特才華')) {
        fullText = fullText.split('學習力').join('獨特才華');
        fixes.push(`Fixed 偏印 translation: "學習力" → "獨特才華" in ${sectionKey}.full`);
      }
      if (sectionTenGod === '偏印' && previewText.includes('學習力') && !previewText.includes('獨特才華')) {
        previewText = previewText.split('學習力').join('獨特才華');
        fixes.push(`Fixed 偏印 translation: "學習力" → "獨特才華" in ${sectionKey}.preview`);
      }
      // If section's ten god is 正印 but AI wrote 獨特才華 (偏印's translation), fix it
      if (sectionTenGod === '正印' && fullText.includes('獨特才華') && !fullText.includes('學習力')) {
        fullText = fullText.split('獨特才華').join('學習力');
        fixes.push(`Fixed 正印 translation: "獨特才華" → "學習力" in ${sectionKey}.full`);
      }
      if (sectionTenGod === '正印' && previewText.includes('獨特才華') && !previewText.includes('學習力')) {
        previewText = previewText.split('獨特才華').join('學習力');
        fixes.push(`Fixed 正印 translation: "獨特才華" → "學習力" in ${sectionKey}.preview`);
      }
    }

    // ---- Fix 2: DM strength mislabeling (anchored regex, scoped to DM context) ----
    const preAnalysis = calculationData['preAnalysis'] as Record<string, unknown> | undefined;
    const sv2 = preAnalysis?.['strengthV2'] as Record<string, unknown> | undefined;
    if (sv2) {
      const correctClass = STRENGTH_V2_ZH[(sv2['classification'] as string) || ''] || '';
      if (correctClass) {
        const wrongLabels = ['極弱', '偏弱', '中和', '偏強', '極旺'].filter(l => l !== correctClass);
        for (const wrong of wrongLabels) {
          // Only match in DM-strength context: "核心屬性" within 6 chars of the wrong label
          // Use .replace() directly — no .test() guard to avoid g-flag lastIndex drift
          fullText = fullText.replace(
            new RegExp(`(核心屬性.{0,6})${wrong}`, 'g'),
            `$1${correctClass}`,
          );
        }
      }
    }

    // ---- Fix 3: Raw Bazi term leak stripping ----
    // Remove leaked stem parenthetical references like （甲）（丙）（戊土）
    // But preserve legitimate parenthetical content (longer phrases, scores, etc.)
    fullText = fullText.replace(/（[甲乙丙丁戊己庚辛壬癸][木火土金水]?）/g, '');
    previewText = previewText.replace(/（[甲乙丙丁戊己庚辛壬癸][木火土金水]?）/g, '');

    if (fixes.length > 0 || fullText !== section.full || previewText !== section.preview) {
      if (fixes.length > 0) {
        this.logger.log(`Career auto-fix applied: ${fixes.join('; ')}`);
      }
      return {
        section: { preview: previewText, full: fullText, score: section.score },
        fixes,
      };
    }

    return { section, fixes };
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
  /**
   * Build a versioned cache key. V2 reading types use ':v2' suffix
   * to avoid collision with old V1 format entries.
   */
  private buildCacheKey(hash: string, readingType: ReadingType): string {
    const isV2 = readingType === ReadingType.LIFETIME || readingType === ReadingType.CAREER;
    return `reading_cache:${hash}:${readingType}${isV2 ? ':v2' : ''}`;
  }

  async getCachedInterpretation(
    birthDataHash: string,
    readingType: ReadingType,
  ): Promise<AIInterpretationResult | null> {
    try {
      // Try Redis first (fast) — uses versioned cache key
      const cacheKey = this.buildCacheKey(birthDataHash, readingType);
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
        const interpretation = dbCache.interpretationJson as unknown as AIInterpretationResult;
        // Reject stale V1 entries for V2 reading types
        const isV2Type = readingType === ReadingType.LIFETIME || readingType === ReadingType.CAREER;
        if (isV2Type && (interpretation as unknown as Record<string, unknown>).schemaVersion !== 'v2') {
          // Stale V1 entry — let it expire naturally (30-day TTL)
          return null;
        }
        // Populate Redis cache for next time
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
      // Redis cache (24h) — uses versioned cache key
      const cacheKey = this.buildCacheKey(birthDataHash, readingType);
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
  ): string {
    const crypto = require('crypto');
    // Include preAnalysis version in hash so cache invalidates when rules change
    // LIFETIME uses v2.3.0, CAREER uses v2.1.0, all others use v1.1.0
    const preAnalysisVersion = readingType === ReadingType.LIFETIME
      ? 'v2.3.0'
      : readingType === ReadingType.CAREER
        ? 'v2.1.0'
        : 'v1.1.0';
    const data = `${birthDate}|${birthTime}|${birthCity}|${gender}|${readingType}|${targetYear || ''}|${targetMonth || ''}|${targetDay || ''}|${questionText || ''}|${preAnalysisVersion}`;
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
