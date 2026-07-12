/**
 * labels.ts — UX copy mappings + tier helpers for the daily-fortune tab.
 * Verbatim port of apps/web/app/components/fortune/labels.ts.
 *
 * The AI's daily_overview is the RICH verdict; `friendlyExplanationFromLabel`
 * is the always-visible STATIC fallback shown in the energy ring. Both coexist.
 */

// ---- Friendly explanation per 9-label verdict (warm advisor tone) ----

const FRIENDLY_EXPLANATIONS: Record<string, string> = {
  大吉: '整體能量充沛，是把握機會的好日子',
  吉: '整體偏向順利，宜以平常心開展事務',
  吉中有凶: '整體傾向順遂，但留意潛在波動',
  平: '整體平穩，無強烈動靜',
  凶中有吉: '整體有挑戰，但隱藏轉機',
  小凶: '整體偏向謹慎，宜放慢腳步',
  凶: '整體偏弱，宜保守應對',
  大凶: '整體較為艱難，宜守不宜攻',
  凶上加凶: '整體挑戰深重，建議內省休養',
};

export function friendlyExplanationFromLabel(label: string): string {
  return FRIENDLY_EXPLANATIONS[label] ?? '今日宜以平常心面對';
}

// ---- Ring tier mapping — 2-tier (positive for 大吉/吉, default else) ----

export type RingTier = 'positive' | 'default';

export function ringTierFromLabel(label: string): RingTier {
  if (label === '大吉' || label === '吉') return 'positive';
  return 'default';
}

// ---- Dim-score tier mapping — aligned to engine's 5-band labels ----

export type DimTier = 'good' | 'mid' | 'low';

export function dimTierFromScore(score: number): DimTier {
  // 極佳80 / 順遂65 / 平穩50 / 需謹慎35 / 不利0.
  if (score >= 65) return 'good'; // 順遂 / 極佳
  if (score >= 50) return 'mid'; // 平穩
  return 'low'; // 需謹慎 / 不利
}

// ---- Date formatting ----
// Expected for '2026-05-17': { dateLine: '2026年5月17日 週日', short: '5/17' }
//
// ⚠️ Built MANUALLY — NOT via Intl.DateTimeFormat('zh-TW', {weekday, month:'long'}).
// Android Hermes lacks full zh-TW locale data for that format and SILENTLY falls
// back to English («Sun, July 12, 2026») — no throw, so a try/catch never catches
// it. Manual formatting guarantees the same zh-TW output on iOS + Android.
// (Intl's timeZone support IS fine on both — used by resolveBaziToday etc. for the
// date MATH; only locale-based display strings are unreliable on Android Hermes.)

export interface FormattedFortuneDate {
  dateLine: string;
  short: string;
}

const WEEKDAYS_ZH = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export function formatFortuneDate(iso: string): FormattedFortuneDate {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { dateLine: iso, short: iso };
  const year = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const day = parseInt(m[3]!, 10);
  const weekday = WEEKDAYS_ZH[new Date(year, month - 1, day, 12, 0, 0).getDay()]; // noon avoids TZ edge
  return { dateLine: `${year}年${month}月${day}日 ${weekday}`, short: `${month}/${day}` };
}
