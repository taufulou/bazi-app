import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AIProvider, ReadingType, Prisma } from '@prisma/client';
import {
  READING_PROMPTS,
  BASE_SYSTEM_PROMPT,
  OUTPUT_FORMAT_INSTRUCTIONS,
  COMPARISON_TYPE_ZH,
  GENDER_ZH,
  STRENGTH_ZH,
} from './prompts';

// ============================================================
// Types
// ============================================================

export interface InterpretationSection {
  preview: string;
  full: string;
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
        model: this.configService.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-20250514',
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
  ): Promise<AIGenerationResult> {
    if (this.providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    // Build the prompt from calculation data
    const { systemPrompt, userPrompt } = await this.buildPrompt(
      calculationData,
      readingType,
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
  // Provider Calls
  // ============================================================

  private async callProvider(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    switch (config.provider) {
      case AIProvider.CLAUDE:
        return this.callClaude(config, systemPrompt, userPrompt);
      case AIProvider.GPT:
        return this.callGPT(config, systemPrompt, userPrompt);
      case AIProvider.GEMINI:
        return this.callGemini(config, systemPrompt, userPrompt);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  private async *streamProvider(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
  ): AsyncGenerator<string> {
    switch (config.provider) {
      case AIProvider.CLAUDE:
        yield* this.streamClaude(config, systemPrompt, userPrompt);
        break;
      case AIProvider.GPT:
        yield* this.streamGPT(config, systemPrompt, userPrompt);
        break;
      case AIProvider.GEMINI:
        yield* this.streamGemini(config, systemPrompt, userPrompt);
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
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (!this.claudeClient) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.claudeClient = new Anthropic({ apiKey: config.apiKey });
    }

    const response = await this.claudeClient.messages.create({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

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
  ): AsyncGenerator<string> {
    if (!this.claudeClient) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.claudeClient = new Anthropic({ apiKey: config.apiKey });
    }

    const stream = this.claudeClient.messages.stream({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

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
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (!this.openaiClient) {
      const { default: OpenAI } = await import('openai');
      this.openaiClient = new OpenAI({ apiKey: config.apiKey });
    }

    const response = await this.openaiClient.chat.completions.create({
      model: config.model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

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
  ): AsyncGenerator<string> {
    if (!this.openaiClient) {
      const { default: OpenAI } = await import('openai');
      this.openaiClient = new OpenAI({ apiKey: config.apiKey });
    }

    const stream = await this.openaiClient.chat.completions.create({
      model: config.model,
      max_tokens: 4096,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

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
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (!this.geminiAI) {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      this.geminiAI = new GoogleGenerativeAI(config.apiKey);
    }
    const model = this.geminiAI.getGenerativeModel({
      model: config.model,
      systemInstruction: systemPrompt,
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
  ): Promise<{ systemPrompt: string; userPrompt: string }> {
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

    // Fall back to hardcoded defaults
    const readingConfig = READING_PROMPTS[readingType];
    if (!readingConfig) {
      throw new Error(`No prompt template for reading type: ${readingType}`);
    }

    const systemPrompt = BASE_SYSTEM_PROMPT + '\n\n' + readingConfig.systemAddition;
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

    // Basic fields
    result = result.replace(/\{\{gender\}\}/g, GENDER_ZH[(data['gender'] as string) || 'male'] || '男');
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
      result = result.replace(/\{\{strength\}\}/g, STRENGTH_ZH[(dayMaster['strength'] as string) || ''] || '');
      result = result.replace(/\{\{strengthScore\}\}/g, String(dayMaster['strengthScore'] || 0));
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

    // Compatibility-specific fields
    if (readingType === ReadingType.COMPATIBILITY) {
      const compatibility = data['compatibility'] as Record<string, unknown> | undefined;
      const chartA = data['chartA'] as Record<string, unknown> | undefined;
      const chartB = data['chartB'] as Record<string, unknown> | undefined;

      if (compatibility) {
        const compType = (compatibility['comparisonType'] as string) || 'romance';
        result = result.replace(/\{\{comparisonType\}\}/g, compType);
        result = result.replace(/\{\{comparisonTypeZh\}\}/g, COMPARISON_TYPE_ZH[compType] || '配對');
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

      // Chart A & B fields
      if (chartA) {
        this.interpolateChartFields(result, chartA, 'A');
      }
      if (chartB) {
        this.interpolateChartFields(result, chartB, 'B');
      }

      // Re-assign after chart field interpolation
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
      result = result.replace(new RegExp(`\\{\\{strength${suffix}\\}\\}`, 'g'),
        STRENGTH_ZH[(dayMaster['strength'] as string) || ''] || '');
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
    // Try to extract JSON from the response
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fallback: treat entire response as a single section
      return this.fallbackParse(rawContent, readingType);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      // Validate structure
      if (parsed.sections && typeof parsed.sections === 'object') {
        const sections: Record<string, InterpretationSection> = {};

        for (const [key, value] of Object.entries(parsed.sections)) {
          const section = value as Record<string, string>;
          sections[key] = {
            preview: section.preview || '',
            full: section.full || section.preview || '',
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
   * Fallback parser when AI doesn't return proper JSON.
   * Splits the raw text into sections based on common headers.
   */
  private fallbackParse(
    rawContent: string,
    readingType: ReadingType,
  ): AIInterpretationResult {
    const readingConfig = READING_PROMPTS[readingType];
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
  ) {
    try {
      await this.prisma.aIUsageLog.create({
        data: {
          userId,
          readingId,
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
  ): string {
    const crypto = require('crypto');
    const data = `${birthDate}|${birthTime}|${birthCity}|${gender}|${readingType}|${targetYear || ''}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
