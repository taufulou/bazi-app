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
  // Phase Fortune — 5 daily dimensions (mirrors daily_enhanced.py dispatchers).
  // The «general» FORTUNE strip lives at sectionKey=NULL (no whitelist entry
  // needed — admin can post with sectionKey=null for the homepage pill row).
  // Tier B2 — 4 yearly dimensions (no yearly_travel; travel is DAY-only per
  // 三命通會 神煞篇). MONTH stays general-only (no per-dim monthly_* keys).
  // The fortune_scope column on each row disambiguates daily_* vs yearly_*.
  FORTUNE: [
    'daily_romance', 'daily_career', 'daily_finance',
    'daily_travel', 'daily_health',
    'yearly_career', 'yearly_finance', 'yearly_romance', 'yearly_health',
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
    /**
     * Phase 2 月運 audit fix (2026-05-28 CRITICAL #1): when readingType=FORTUNE,
     * filter by fortune_scope. Without this, MONTH-scope questions (seeded by
     * L6 migration) leak into DAY-scope chat — DAY users see 「這個月整體運勢」
     * mixed into 「今日宜避免什麼？」 list. Triggers refuse-cap charges + UX confusion.
     *
     * Back-compat semantics:
     * - fortuneScope=null + readingType=FORTUNE → returns rows with fortune_scope IS NULL
     *   (legacy DAY rows seeded BEFORE Phase 2 migration; treats NULL as DAY)
     * - fortuneScope='DAY' → returns rows with fortune_scope='DAY' (post-Phase-2 explicit DAY)
     *   OR fortune_scope IS NULL (legacy back-compat)
     * - fortuneScope='MONTH' → returns ONLY rows with fortune_scope='MONTH'
     * - fortuneScope='YEAR' → returns ONLY rows with fortune_scope='YEAR' (Phase 3)
     *
     * For non-FORTUNE reading types this arg is ignored (the column is NULL
     * for all LIFETIME/LOVE/CAREER/ANNUAL/COMPATIBILITY rows by design).
     */
    fortuneScope: 'DAY' | 'MONTH' | 'YEAR' | null = null,
  ): Promise<SampleQuestionDto[]> {
    const cacheKey = `${readingType}:${sectionKey ?? '*'}:${locale}:${fortuneScope ?? '_'}`;
    const currentVersion = await this.getCacheVersion();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.versionAtCacheTime === currentVersion) {
      return cached.questions;
    }

    // Compose fortune_scope filter ONLY for FORTUNE reading type.
    // Other reading types ignore the column (always NULL by design).
    let fortuneScopeFilter: Prisma.ChatSampleQuestionWhereInput = {};
    if (readingType === 'FORTUNE') {
      if (fortuneScope === null || fortuneScope === 'DAY') {
        // null OR DAY → match both NULL (legacy) AND explicit 'DAY' rows
        fortuneScopeFilter = {
          OR: [
            { fortuneScope: null },
            { fortuneScope: 'DAY' as const },
          ],
        };
      } else {
        // 'MONTH' or 'YEAR' → exact match (no NULL leakage)
        fortuneScopeFilter = { fortuneScope };
      }
    }

    const rows = await this.prisma.chatSampleQuestion.findMany({
      where: {
        readingType,
        sectionKey,
        locale,
        isActive: true,
        ...fortuneScopeFilter,
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
    /**
     * Phase 2 月運 audit fix (2026-05-28 CRITICAL #1 mirror): same fortune_scope
     * filter semantics as `listActive` above. Without this, the in-drawer
     * SampleQuestionsBrowser mixes MONTH + DAY questions for FORTUNE users.
     */
    fortuneScope: 'DAY' | 'MONTH' | 'YEAR' | null = null,
  ): Promise<SampleQuestionDto[]> {
    const cacheKey = `${readingType}:__ALL__:${locale}:${fortuneScope ?? '_'}`;
    const currentVersion = await this.getCacheVersion();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.versionAtCacheTime === currentVersion) {
      return cached.questions;
    }

    let fortuneScopeFilter: Prisma.ChatSampleQuestionWhereInput = {};
    if (readingType === 'FORTUNE') {
      if (fortuneScope === null || fortuneScope === 'DAY') {
        fortuneScopeFilter = {
          OR: [
            { fortuneScope: null },
            { fortuneScope: 'DAY' as const },
          ],
        };
      } else {
        fortuneScopeFilter = { fortuneScope };
      }
    }

    const rows = await this.prisma.chatSampleQuestion.findMany({
      where: { readingType, locale, isActive: true, ...fortuneScopeFilter },
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
   *  (or null for general questions). Bumps cache version once.
   *
   *  Phase 2.x L3.5b audit C#3 — accepts `fortuneScope` (REQUIRED for
   *  FORTUNE rows; REJECTED for non-FORTUNE rows). Without this admin
   *  could not create MONTH/YEAR sample questions via the API; only
   *  raw-SQL migrations.
   */
  async create(args: {
    readingType: ReadingType;
    sectionKey: string | null;
    questionText: string;
    displayOrder?: number;
    locale?: string;
    fortuneScope?: 'DAY' | 'MONTH' | 'YEAR' | null;
  }): Promise<ChatSampleQuestion> {
    this.assertValidSectionKey(args.readingType, args.sectionKey);
    this.assertValidFortuneScope(args.readingType, args.fortuneScope ?? null);
    const created = await this.prisma.chatSampleQuestion.create({
      data: {
        readingType: args.readingType,
        sectionKey: args.sectionKey,
        questionText: args.questionText,
        displayOrder: args.displayOrder ?? 0,
        locale: args.locale ?? 'zh-TW',
        fortuneScope: args.fortuneScope ?? null,
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
      fortuneScope?: 'DAY' | 'MONTH' | 'YEAR' | null;
    }>;
  }): Promise<{ count: number }> {
    for (const item of args.items) {
      this.assertValidSectionKey(item.readingType, item.sectionKey);
      this.assertValidFortuneScope(item.readingType, item.fortuneScope ?? null);
    }
    const result = await this.prisma.chatSampleQuestion.createMany({
      data: args.items.map((i) => ({
        readingType: i.readingType,
        sectionKey: i.sectionKey,
        questionText: i.questionText,
        displayOrder: i.displayOrder ?? 0,
        locale: i.locale ?? 'zh-TW',
        fortuneScope: i.fortuneScope ?? null,
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
      fortuneScope: 'DAY' | 'MONTH' | 'YEAR' | null;
    }>,
  ): Promise<ChatSampleQuestion> {
    // Audit C#3: validate fortuneScope is consistent with row's readingType.
    // Fetch existing row once when either sectionKey OR fortuneScope changes,
    // since both need readingType context.
    if (patch.sectionKey !== undefined || patch.fortuneScope !== undefined) {
      const existing = await this.prisma.chatSampleQuestion.findUniqueOrThrow({
        where: { id },
        select: { readingType: true },
      });
      if (patch.sectionKey !== undefined) {
        this.assertValidSectionKey(existing.readingType, patch.sectionKey);
      }
      if (patch.fortuneScope !== undefined) {
        this.assertValidFortuneScope(existing.readingType, patch.fortuneScope);
      }
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

  /** Phase 2.x L3.5b audit C#3 — fortuneScope must be null when readingType
   *  is not FORTUNE; for FORTUNE it must be one of DAY/MONTH/YEAR (or null
   *  to default to DAY at read-time per back-compat). Rejects mismatches
   *  so admin UI can't create cross-type rows that would never be read.
   */
  private assertValidFortuneScope(
    readingType: ReadingType,
    fortuneScope: 'DAY' | 'MONTH' | 'YEAR' | null,
  ): void {
    if (fortuneScope === null) return; // null is always permitted
    if (readingType !== 'FORTUNE') {
      throw new Error(
        `Invalid fortuneScope="${fortuneScope}" for readingType ${readingType}. ` +
          `fortuneScope is only allowed when readingType === 'FORTUNE'.`,
      );
    }
    // For FORTUNE: enum already constrained at TS layer; defensive runtime check.
    if (fortuneScope !== 'DAY' && fortuneScope !== 'MONTH' && fortuneScope !== 'YEAR') {
      throw new Error(
        `Invalid fortuneScope="${fortuneScope}". Must be one of: DAY, MONTH, YEAR, null.`,
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
