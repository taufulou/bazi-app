/**
 * ChatSampleQuestionService — fetches/caches per-(readingType, sectionKey)
 * sample question lists for the chat InlineAskCard + ChatFloatingButton
 * empty state. Replaces the Phase 1 hardcoded LIFETIME_SAMPLE_QUESTIONS.
 *
 * Caching strategy (round-1 LOW-#1 — batch-aware version stamp):
 * - In-memory cache keyed by `${readingType}:${sectionKey ?? '*'}:${locale}`.
 * - Single Redis-backed `chat-sample-questions:version` integer increments
 *   on EVERY write batch (not per-row). Public reads check the version
 *   stamp before returning cached data; if drift, re-query DB and cache.
 * - Bulk inserts of 50 rows = 1 invalidation, not 50.
 *
 * Auth model:
 * - Public read endpoint (rate-limited at controller layer @60req/min/IP).
 * - Admin-only mutations (delegated to admin guard at controller layer).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ChatSampleQuestion, Prisma, ReadingType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Whitelist of section keys per reading type. NestJS local mirror of
// `CHAT_SECTION_KEYS_BY_READING_TYPE` in `packages/shared/src/constants.ts`
// — kept in lockstep manually because NestJS has the known
// @repo/shared runtime-import issue (see CLAUDE.md).
const CHAT_SECTION_KEYS_BY_READING_TYPE_LOCAL: Record<string, readonly string[]> = {
  LIFETIME: [
    'chart_identity', 'finance_pattern', 'career_pattern', 'boss_strategy',
    'love_pattern', 'health', 'children_analysis', 'parents_analysis',
    'current_period', 'next_period', 'best_period',
  ],
  LOVE: [
    'love_personality', 'peach_blossom_analysis', 'natal_marriage',
    'partner_matching', 'spouse_appearance', 'romance_good_years',
    'romance_danger_years', 'marriage_change_years', 'love_summary',
  ],
  CAREER: [
    'career_personality', 'career_pattern', 'industry_match',
    'workplace_strategy', 'boss_subordinate', 'career_timing',
    'entrepreneurship', 'partnership', 'finance_at_work', 'career_summary',
  ],
  ANNUAL: [
    'annual_overview', 'annual_tai_sui', 'annual_dayun_context',
    'annual_career', 'annual_finance', 'annual_relationships',
    'annual_love', 'annual_family', 'annual_health', 'monthly_overview',
  ],
  // Phase 3 — COMPATIBILITY (ROMANCE only)
  COMPATIBILITY: [
    'compat_overview', 'wedding_timing', 'partner_appearance',
    'partner_personality', 'interaction_dynamics', 'conflict_warning',
    'dimension_breakdown', 'compatibility_advice',
  ],
};

const VERSION_KEY = 'chat-sample-questions:version';
/** TTL for cached items — short because we already invalidate via version
 *  stamp. 5 minutes is the upper bound for an admin-edited question to
 *  appear publicly even if Redis pub/sub fails. */
const CACHE_TTL_SECONDS = 5 * 60;

export interface SampleQuestionDto {
  id: string;
  questionText: string;
  displayOrder: number;
}

@Injectable()
export class ChatSampleQuestionService {
  private readonly logger = new Logger(ChatSampleQuestionService.name);

  /** In-process LRU-ish cache. Map<cacheKey, {questions, versionAtCacheTime}>.
   *  Bounded implicitly by readingType × sectionKey cardinality (~50 entries
   *  total at full LIFETIME+LOVE+CAREER+ANNUAL coverage). */
  private readonly cache = new Map<
    string,
    { questions: SampleQuestionDto[]; versionAtCacheTime: number; cachedAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Section keys allowed for a given reading type. Admin UI dropdown
   * sources from this; service-layer POST/PATCH validates against it.
   */
  getValidSectionKeys(readingType: ReadingType): readonly string[] {
    return CHAT_SECTION_KEYS_BY_READING_TYPE_LOCAL[readingType] ?? [];
  }

  /**
   * Public read — returns active sample questions for the (readingType, sectionKey)
   * tuple, ordered by displayOrder asc. Caches in memory; invalidates via
   * Redis version stamp.
   *
   * `sectionKey === null` returns "general" floating-button questions
   * (not section-specific).
   */
  async listActive(
    readingType: ReadingType,
    sectionKey: string | null,
    locale: string = 'zh-TW',
  ): Promise<SampleQuestionDto[]> {
    const cacheKey = `${readingType}:${sectionKey ?? '*'}:${locale}`;
    const currentVersion = await this.getCacheVersion();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.versionAtCacheTime === currentVersion) {
      return cached.questions;
    }

    const rows = await this.prisma.chatSampleQuestion.findMany({
      where: {
        readingType,
        sectionKey,
        locale,
        isActive: true,
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const dtos: SampleQuestionDto[] = rows.map((r) => ({
      id: r.id,
      questionText: r.questionText,
      displayOrder: r.displayOrder,
    }));

    this.cache.set(cacheKey, {
      questions: dtos,
      versionAtCacheTime: currentVersion,
      cachedAt: Date.now(),
    });

    return dtos;
  }

  /** Phase 4 — list ALL active sample questions for a reading type
   *  (across all sectionKeys including NULL «general» questions). Used
   *  by the in-drawer SampleQuestionsBrowser so user can scan the full
   *  menu of questions in one place.
   *
   *  Ordering: section-grouped (sectionKey ASC, NULLS LAST), then by
   *  displayOrder within each section. Section-specific contextual
   *  questions appear first; general «catch-all» questions appear at
   *  the bottom — most natural reading order for users browsing.
   *
   *  Cache key uses sentinel `__ALL__` for the sectionKey slot —
   *  disjoint from section-specific cache entries. Auto-invalidated
   *  via version stamp when any admin write fires.
   */
  async listAllActiveForType(
    readingType: ReadingType,
    locale: string = 'zh-TW',
  ): Promise<SampleQuestionDto[]> {
    const cacheKey = `${readingType}:__ALL__:${locale}`;
    const currentVersion = await this.getCacheVersion();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.versionAtCacheTime === currentVersion) {
      return cached.questions;
    }

    const rows = await this.prisma.chatSampleQuestion.findMany({
      where: { readingType, locale, isActive: true },
      orderBy: [
        // Phase 4 follow-up — flat popularity ordering across ALL sections.
        // Earlier ordering grouped by sectionKey (alphabetical) — that
        // made the panel show «best_period» first regardless of how
        // popular those questions were. The browser overlay is flat (no
        // section headers visible), so users read top-to-bottom expecting
        // most-engaging questions first. `displayOrder` is now assigned
        // globally per reading-type (e.g. LIFETIME 10-400 in popularity
        // order); section grouping is no longer enforced at query time.
        { displayOrder: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    const dtos: SampleQuestionDto[] = rows.map((r) => ({
      id: r.id,
      questionText: r.questionText,
      displayOrder: r.displayOrder,
    }));

    this.cache.set(cacheKey, {
      questions: dtos,
      versionAtCacheTime: currentVersion,
      cachedAt: Date.now(),
    });

    return dtos;
  }

  /** Admin — list ALL rows (active + inactive) for a reading type, for the
   *  /admin/chat-questions page. */
  async listAllForAdmin(readingType?: ReadingType): Promise<ChatSampleQuestion[]> {
    return this.prisma.chatSampleQuestion.findMany({
      where: readingType ? { readingType } : undefined,
      orderBy: [
        { readingType: 'asc' },
        { sectionKey: 'asc' },
        { displayOrder: 'asc' },
      ],
    });
  }

  /** Admin — create. Validates sectionKey is in the per-type whitelist
   *  (or null for general questions). Bumps cache version once. */
  async create(args: {
    readingType: ReadingType;
    sectionKey: string | null;
    questionText: string;
    displayOrder?: number;
    locale?: string;
  }): Promise<ChatSampleQuestion> {
    this.assertValidSectionKey(args.readingType, args.sectionKey);
    const created = await this.prisma.chatSampleQuestion.create({
      data: {
        readingType: args.readingType,
        sectionKey: args.sectionKey,
        questionText: args.questionText,
        displayOrder: args.displayOrder ?? 0,
        locale: args.locale ?? 'zh-TW',
      },
    });
    await this.bumpCacheVersion();
    return created;
  }

  /** Admin — bulk create (single transaction → single cache invalidation
   *  per round-1 LOW-#1). Used by TSV-paste / seed migration. */
  async createMany(args: {
    items: Array<{
      readingType: ReadingType;
      sectionKey: string | null;
      questionText: string;
      displayOrder?: number;
      locale?: string;
    }>;
  }): Promise<{ count: number }> {
    for (const item of args.items) {
      this.assertValidSectionKey(item.readingType, item.sectionKey);
    }
    const result = await this.prisma.chatSampleQuestion.createMany({
      data: args.items.map((i) => ({
        readingType: i.readingType,
        sectionKey: i.sectionKey,
        questionText: i.questionText,
        displayOrder: i.displayOrder ?? 0,
        locale: i.locale ?? 'zh-TW',
      })),
    });
    await this.bumpCacheVersion();
    return { count: result.count };
  }

  /** Admin — partial update. Returns the updated row so admin UI can
   *  optimistically refetch (round-1 LOW-#2). */
  async update(
    id: string,
    patch: Partial<{
      questionText: string;
      displayOrder: number;
      isActive: boolean;
      sectionKey: string | null;
    }>,
  ): Promise<ChatSampleQuestion> {
    if (patch.sectionKey !== undefined) {
      const existing = await this.prisma.chatSampleQuestion.findUniqueOrThrow({
        where: { id },
        select: { readingType: true },
      });
      this.assertValidSectionKey(existing.readingType, patch.sectionKey);
    }
    const updated = await this.prisma.chatSampleQuestion.update({
      where: { id },
      data: patch,
    });
    await this.bumpCacheVersion();
    return updated;
  }

  /** Admin — delete (hard delete; questions are non-PII). */
  async delete(id: string): Promise<void> {
    await this.prisma.chatSampleQuestion.delete({ where: { id } });
    await this.bumpCacheVersion();
  }

  // ============================================================
  // Internals
  // ============================================================

  private assertValidSectionKey(
    readingType: ReadingType,
    sectionKey: string | null,
  ): void {
    if (sectionKey === null) return; // "general" questions are always allowed
    const valid = CHAT_SECTION_KEYS_BY_READING_TYPE_LOCAL[readingType];
    if (!valid || !valid.includes(sectionKey)) {
      throw new Error(
        `Invalid sectionKey "${sectionKey}" for readingType ${readingType}. ` +
          `Valid keys: ${(valid ?? []).join(', ')} or null.`,
      );
    }
  }

  private async getCacheVersion(): Promise<number> {
    try {
      const v = await this.redis.get(VERSION_KEY);
      return v ? parseInt(v, 10) : 0;
    } catch {
      return 0; // Redis down → treat as "version 0", may serve stale data
    }
  }

  private async bumpCacheVersion(): Promise<void> {
    try {
      const next = (await this.getCacheVersion()) + 1;
      await this.redis.set(VERSION_KEY, String(next), CACHE_TTL_SECONDS * 2);
      // Also clear in-process cache so this Nest instance sees the bump
      // immediately (other instances pick it up via Redis on next read).
      this.cache.clear();
    } catch (err) {
      // Non-fatal: in-process cache cleared anyway, public reads will be
      // stale on OTHER instances for up to TTL.
      this.cache.clear();
      this.logger.warn(`Failed to bump sample-questions cache version: ${err}`);
    }
  }
}
