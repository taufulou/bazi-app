/**
 * labels.ts — Frontend UX copy mappings + tier helpers for the daily-fortune page.
 *
 * Per Revision Round 1 (plan §R1.9):
 *   - `dimensions.ts` = per-dim metadata (icons, narrative keys)
 *   - `labels.ts`     = label-to-copy maps, tier color helpers, date format
 *
 * If a constant fits BOTH, put it here (UX copy concern dominates).
 *
 * Coexistence note: the AI's daily_overview narrative is the RICH version;
 * the `friendlyExplanationFromLabel` map below is the always-visible STATIC
 * fallback shown in the energy ring. Both intentionally coexist — frontend
 * gives instant scan-line for the verdict, AI gives nuance once user scrolls.
 */

// ============================================================
// Friendly explanation per 9-label verdict — warm advisor tone
// ============================================================
//
// Used inside <EnergyScoreRing /> beneath the label band. ~10-15 字 each.
// Tone: warm advisor (per locked decision 2026-05-15).

const FRIENDLY_EXPLANATIONS: Record<string, string> = {
  大吉:     '整體能量充沛，是把握機會的好日子',
  吉:       '整體偏向順利，宜以平常心開展事務',
  吉中有凶: '整體傾向順遂，但留意潛在波動',
  平:       '整體平穩，無強烈動靜',
  凶中有吉: '整體有挑戰，但隱藏轉機',
  小凶:     '整體偏向謹慎，宜放慢腳步',
  凶:       '整體偏弱，宜保守應對',
  大凶:     '整體較為艱難，宜守不宜攻',
  凶上加凶: '整體挑戰深重，建議內省休養',
};

export function friendlyExplanationFromLabel(label: string): string {
  return FRIENDLY_EXPLANATIONS[label] ?? '今日宜以平常心面對';
}

// ============================================================
// Ring tier mapping — 2-tier (green for 大吉/吉, gold for else)
// ============================================================
//
// Per locked decision 2026-05-15: simplified from 3-tier (positive/neutral/
// negative) to 2-tier (positive/default). Reuses existing --color-success
// for green; --color-gold for default.

export type RingTier = 'positive' | 'default';

export function ringTierFromLabel(label: string): RingTier {
  if (label === '大吉' || label === '吉') return 'positive';
  return 'default';
}

// ============================================================
// Dim-score tier mapping — for the per-dim score chip's tier dot
// ============================================================
//
// Used by NarrativeCard's per-dim header chip. Tier dot is decorative;
// text label («順遂/平穩/需謹慎/不利») is load-bearing for a11y.

export type DimTier = 'good' | 'mid' | 'low';

export function dimTierFromScore(score: number): DimTier {
  // Aligned to the engine's 5-band dimension labels (derive_dimension_label:
  // 極佳80 / 順遂65 / 平穩50 / 需謹慎35 / 不利0) so the color tier matches the
  // text label. Pre-用神-baseline, scores clustered at 50 so the old 60/40
  // cutoffs never surfaced the mismatch; the baseline now pushes many scores
  // into 55–65, where a green "good" bar next to a "平穩" label read oddly.
  if (score >= 65) return 'good';   // 順遂 / 極佳
  if (score >= 50) return 'mid';    // 平穩
  return 'low';                      // 需謹慎 / 不利
}

// ============================================================
// Date formatting — locked Intl options for SSR consistency
// ============================================================
//
// Per Revision Round 1 §R1.8: lock format options + add a unit test that
// asserts exact output. Used inside <EnergyScoreRing /> date band.
//
// Expected output for '2026-05-17':
//   { dateLine: '2026年5月17日 週六', short: '5/17' }

export interface FormattedFortuneDate {
  /** Full verbose date line for the energy card date band (e.g. '2026年5月17日 週六') */
  dateLine: string;
  /** Short fallback used elsewhere (e.g. '5/17') */
  short: string;
}

const FORTUNE_DATE_FORMATTER = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

export function formatFortuneDate(iso: string): FormattedFortuneDate {
  // Parse YYYY-MM-DD safely — avoid timezone shift
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { dateLine: iso, short: iso };
  // Non-null assertions: the regex pattern guarantees 3 capture groups
  // when match succeeds; `if (!m) return` above proves match succeeded.
  // Needed because tsconfig sets `noUncheckedIndexedAccess: true`.
  const year = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const day = parseInt(m[3]!, 10);
  const date = new Date(year, month - 1, day, 12, 0, 0); // noon avoids TZ edge

  let dateLine: string;
  try {
    dateLine = FORTUNE_DATE_FORMATTER.format(date);
  } catch {
    // Fallback if Intl locale unavailable (rare in modern runtimes)
    dateLine = `${year}年${month}月${day}日`;
  }

  return {
    dateLine,
    short: `${month}/${day}`,
  };
}
