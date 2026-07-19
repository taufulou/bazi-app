/**
 * Deterministic per-section widgets for the 流年運勢 (Annual V2) and 愛情姻緣
 * (Love V2) readings. RN port of the web `AnnualSectionBadge` / `LoveSectionBadge`
 * dispatchers (apps/web/app/components/AIReadingDisplay.tsx) plus the
 * LoveForecastTimeline / LoveMonthlyGrid signal logic.
 *
 * Each exported dispatcher takes a `sectionKey` + the reading's deterministic
 * data and returns BARE content (StarRating / VerdictBanner / InfoStrip / chips)
 * that the AIReadingDisplay orchestrator renders inside a ReadingSectionCard
 * after the AI prose. Unknown keys → null. Everything is defensively
 * optional-chained: render nothing rather than crash.
 */
import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import type { AnnualV2DeterministicData, LoveV2DeterministicData } from '../../lib/readings-api';
import {
  StarRating,
  InfoStrip,
  VerdictBanner,
  Chip,
  ChipGroup,
  type ChipTone,
  type VerdictTone,
} from './primitives';

// ============================================================
// Shared score / label maps (ported from apps/web/app/lib/bazi-utils.ts)
// ============================================================

/** Chinese auspiciousness label → 0–5 star score. */
const AUSPICIOUSNESS_TO_STARS: Record<string, number> = {
  大吉: 5.0,
  吉: 4.0,
  小吉: 3.5,
  平: 3.0,
  凶: 2.0,
  大凶: 1.0,
  吉中有凶: 3.5,
  小凶: 2.5,
  凶中有吉: 2.5,
  凶中帶機: 1.5,
  曇花一現: 3.5,
  凶上加凶: 0.5,
};

function auspToStars(a?: string): number {
  if (!a) return 3.0;
  return AUSPICIOUSNESS_TO_STARS[a] ?? 3.0;
}

/** Romance level (engine English keys + Chinese fallbacks) → 0–5 star score. */
const ROMANCE_LEVEL_STARS: Record<string, number> = {
  very_strong: 5.0,
  strong: 4.0,
  moderate: 3.0,
  quiet: 2.0,
  極旺: 5.0,
  偏強: 4.0,
  中等: 3.0,
  平靜: 2.0,
  高: 4.5,
  中: 3.0,
  低: 2.0,
};

const ROMANCE_LEVEL_ZH: Record<string, string> = {
  very_strong: '極旺',
  strong: '偏強',
  moderate: '中等',
  quiet: '平靜',
};

function romanceToStars(level?: string): number {
  if (!level) return 3.0;
  return ROMANCE_LEVEL_STARS[level] ?? 3.0;
}

/** Health vitality → 0–5 star score + tone. */
const VITALITY_TO_STARS: Record<string, number> = {
  peak: 5.0,
  strong: 4.5,
  strengthening: 4.0,
  rising: 3.5,
  nurturing: 3.5,
  renewing: 3.0,
  unstable: 2.5,
  declining: 2.5,
  dormant: 2.0,
  weak: 1.5,
  very_weak: 1.0,
  critical: 0.5,
};

const VITALITY_TONE: Record<string, VerdictTone> = {
  peak: 'positive',
  strong: 'positive',
  strengthening: 'positive',
  rising: 'neutral',
  nurturing: 'neutral',
  renewing: 'neutral',
  unstable: 'neutral',
  declining: 'negative',
  dormant: 'negative',
  weak: 'negative',
  very_weak: 'negative',
  critical: 'negative',
};

/** Day-master strength class English→Chinese (love personality). */
const STRENGTH_ZH: Record<string, string> = {
  very_strong: '極強',
  strong: '偏強',
  balanced: '中和',
  neutral: '中和',
  weak: '偏弱',
  very_weak: '極弱',
};

const PILLAR_ZH: Record<string, string> = { year: '年柱', month: '月柱', day: '日柱', hour: '時柱' };
const PALACE_ZH: Record<string, string> = { year: '長輩宮', month: '事業宮', day: '夫妻宮', hour: '子女宮' };
const VISIBILITY_ZH: Record<string, string> = {
  透出: '姻緣星明顯',
  暗藏: '姻緣星暗藏',
  全無: '姻緣星不可見',
};
const WEALTH_CONDITION_ZH: Record<string, string> = {
  strong_dm: '身強扛財',
  weak_dm: '穩守為主',
  neutral: '量力而行',
};

/** Signal impact → chip tone. */
function impactTone(impact?: string): ChipTone {
  if (impact === 'positive' || impact === 'very_positive') return 'positive';
  if (impact === 'negative' || impact === 'very_negative') return 'negative';
  return 'neutral';
}

/** Interaction string → chip tone (六合 good / 六沖·六害 bad / 伏吟 neutral). */
function interactionTone(inter: string): ChipTone {
  if (inter.includes('六合')) return 'positive';
  if (inter.includes('六沖') || inter.includes('六害')) return 'negative';
  return 'neutral';
}

type Zh = (s: string) => string;

// ============================================================
// Small local building blocks (pure — receive `zh`, no hooks)
// ============================================================

/** Wrapper that spaces the widget's sub-elements regardless of parent gap. */
function Wrap({ children }: { children: React.ReactNode }) {
  return <View style={ws.wrap}>{children}</View>;
}

/** A labelled chip group (label above the pills). Renders nothing if empty. */
function ChipSection({
  label,
  items,
  tone,
  zh,
}: {
  label: string;
  items?: string[];
  tone: ChipTone;
  zh: Zh;
}) {
  if (!items?.length) return null;
  return (
    <View style={ws.chipSection}>
      <Text style={ws.chipSectionLabel}>{zh(label)}</Text>
      <ChipGroup items={items.map(zh)} tone={tone} />
    </View>
  );
}

/** Monthly 4-aspect 2×2 grid (事業/財運/感情/健康). */
function MonthlyAspects({
  aspects,
  zh,
}: {
  aspects?: AnnualV2DeterministicData['monthlyForecasts'][number]['aspects'];
  zh: Zh;
}) {
  if (!aspects) return null;
  const items = [
    { icon: '💼', label: '事業', value: aspects.career?.signals?.[0] || aspects.career?.tenGod || '—' },
    { icon: '💰', label: '財運', value: aspects.finance?.signals?.[0] || '平' },
    { icon: '💕', label: '感情', value: aspects.romance?.signals?.[0] || '平' },
    { icon: '🏥', label: '健康', value: aspects.health?.signals?.[0] || '平' },
  ];
  return (
    <View style={ws.aspectGrid}>
      {items.map((it) => (
        <View key={it.label} style={ws.aspectCell}>
          <Text style={ws.aspectLabel}>
            {it.icon} {zh(it.label)}
          </Text>
          <Text style={ws.aspectValue}>{zh(it.value)}</Text>
        </View>
      ))}
    </View>
  );
}

// ============================================================
// Annual V2 dispatcher
// ============================================================

export function AnnualWidgets({
  sectionKey,
  det,
}: {
  sectionKey: string;
  det: AnnualV2DeterministicData;
}): React.ReactNode {
  const zh = useZh();
  if (!det) return null;

  // === annual_overview ===
  if (sectionKey === 'annual_overview') {
    const fy = det.flowYear;
    if (!fy) return null;
    const rows = [
      { label: '流年', value: `${fy.stem || ''}${fy.branch || ''}年 (${fy.year || ''})` },
      { label: '十神', value: fy.tenGod || '' },
      { label: '吉凶', value: fy.auspiciousness || '' },
    ];
    if (det.flowYearHarmony?.pattern) rows.push({ label: '流年格局', value: det.flowYearHarmony.pattern });
    return (
      <Wrap>
        <StarRating score={auspToStars(fy.auspiciousness)} indicatorLabel={zh(fy.auspiciousness || '')} />
        <InfoStrip rows={rows.filter((r) => r.value).map((r) => ({ label: zh(r.label), value: zh(r.value) }))} />
      </Wrap>
    );
  }

  // === annual_tai_sui ===
  if (sectionKey === 'annual_tai_sui') {
    const ts = det.taiSui;
    if (!ts) return null;
    if (!ts.hasTaiSui) {
      return (
        <Wrap>
          <VerdictBanner label={zh('今年未犯太歲')} meta={zh('四柱與太歲無刑沖破害')} tone="positive" />
        </Wrap>
      );
    }
    const results = ts.pillarResults || [];
    const allFav = results.length > 0 && results.every((r) => r.isActuallyFavorable);
    const allUnfav = results.length > 0 && results.every((r) => !r.isActuallyFavorable);
    const tone: VerdictTone = allFav ? 'positive' : allUnfav ? 'negative' : 'neutral';
    return (
      <Wrap>
        <VerdictBanner label={zh(ts.summary || `犯太歲${results.length}處`)} tone={tone} />
        {results.length > 0 ? (
          <View style={ws.chipRow}>
            {results.map((r, i) => {
              const label = `${PILLAR_ZH[r.pillar] || r.pillar}${(r.types || []).join('')}太歲${
                r.isActuallyFavorable ? '(去忌有利)' : '(需防)'
              }`;
              return <Chip key={i} label={zh(label)} tone={r.isActuallyFavorable ? 'positive' : 'negative'} />;
            })}
          </View>
        ) : null}
      </Wrap>
    );
  }

  // === annual_dayun_context ===
  if (sectionKey === 'annual_dayun_context') {
    const dc = det.dayunContext;
    if (!dc?.available) {
      return (
        <Wrap>
          <InfoStrip rows={[{ label: zh('大運'), value: zh('尚無大運背景') }]} />
        </Wrap>
      );
    }
    const rows = [
      { label: '大運', value: `${dc.stem || ''}${dc.branch || ''}` },
      { label: '十神', value: dc.tenGod ? `${dc.tenGod}（${dc.role || '閒神'}）` : '' },
      { label: '有利度', value: dc.favorability || '' },
      { label: '期間', value: dc.startYear && dc.endYear ? `${dc.startYear}–${dc.endYear}` : '' },
    ];
    return (
      <Wrap>
        <InfoStrip rows={rows.filter((r) => r.value).map((r) => ({ label: zh(r.label), value: zh(r.value) }))} />
      </Wrap>
    );
  }

  // === annual_career ===
  if (sectionKey === 'annual_career') {
    const c = det.career;
    if (!c) return null;
    const ROLE_ZH: Record<string, string> = {
      喜神: '喜神助力',
      用神: '用神強力',
      忌神: '忌神壓力',
      仇神: '仇神阻礙',
      閒神: '閒神中性',
    };
    const roleVal = ROLE_ZH[c.tenGodRole] || c.tenGodRole || '';
    const hasChips = (c.signals?.length || 0) > 0 || (c.shenShaSignals?.length || 0) > 0;
    return (
      <Wrap>
        <StarRating score={auspToStars(c.auspiciousness)} indicatorLabel={zh(c.auspiciousness || '')} />
        <InfoStrip
          rows={[
            { label: zh('流年十神'), value: zh(c.flowYearTenGod || '—') },
            { label: zh('角色'), value: zh(roleVal || '—') },
          ]}
        />
        {hasChips ? (
          <View style={ws.chipRow}>
            {(c.signals || []).map((s, i) => (
              <Chip key={`s${i}`} label={zh(s.type)} tone={impactTone(s.impact)} />
            ))}
            {(c.shenShaSignals || []).map((s, i) => (
              <Chip key={`ss${i}`} label={zh(s)} tone="gold" />
            ))}
          </View>
        ) : null}
      </Wrap>
    );
  }

  // === annual_finance ===
  if (sectionKey === 'annual_finance') {
    const f = det.finance;
    if (!f) return null;
    return (
      <Wrap>
        <StarRating score={financeStarScore(f)} indicatorLabel={zh(financeLabel(financeStarScore(f)))} />
        <InfoStrip
          rows={[
            { label: zh('財星'), value: zh(f.wealthPresent ? '到位' : '無直接財星') },
            { label: zh('狀態'), value: zh(WEALTH_CONDITION_ZH[f.wealthCondition] || f.wealthCondition || '—') },
          ]}
        />
        {(f.signals?.length || 0) > 0 ? (
          <View style={ws.chipRow}>
            {(f.signals || []).map((s, i) => (
              <Chip key={i} label={zh(s.type)} tone={impactTone(s.impact)} />
            ))}
          </View>
        ) : null}
      </Wrap>
    );
  }

  // === annual_love ===
  if (sectionKey === 'annual_love') {
    const ms = det.marriageStar;
    if (!ms) return null;
    const activeTracks = (ms.tracks || [])
      .filter((t) => t.active)
      .map((t) => (t.trackType === 'celebration' ? `${t.track}(喜慶星)` : t.track));
    const rows = [{ label: '姻緣信號', value: `${ms.trackCount || 0}個` }];
    if (typeof ms.romanceScore === 'number') rows.push({ label: '姻緣指數', value: `${ms.romanceScore}` });
    return (
      <Wrap>
        <StarRating
          score={romanceToStars(ms.romanceLevel)}
          indicatorLabel={zh(ROMANCE_LEVEL_ZH[ms.romanceLevel] || ms.romanceLevel || '')}
        />
        <InfoStrip rows={rows.map((r) => ({ label: zh(r.label), value: zh(r.value) }))} />
        <ChipSection label="姻緣信號" items={activeTracks} tone="positive" zh={zh} />
      </Wrap>
    );
  }

  // === annual_relationships ===
  if (sectionKey === 'annual_relationships') {
    const palaces = det.relationships?.palaceRelationships;
    if (!palaces || Object.keys(palaces).length === 0) return null;
    const rows = Object.entries(palaces).map(([pillar, p]) => ({
      label: PALACE_ZH[pillar] || pillar,
      value: p?.status || '—',
    }));
    return (
      <Wrap>
        <InfoStrip rows={rows.map((r) => ({ label: zh(r.label), value: zh(r.value) }))} />
      </Wrap>
    );
  }

  // === annual_health ===
  if (sectionKey === 'annual_health') {
    const h = det.health;
    if (!h) return null;
    const vitality = h.healthVitality?.vitality || '';
    const vitalityLabel = h.healthVitality?.label || '';
    const tone = VITALITY_TONE[vitality] || 'neutral';
    const starColor = tone === 'positive' ? colors.success : tone === 'negative' ? colors.error : colors.gold;
    const riskChips = [
      ...(h.riskOrgans || []).map((r) => `${r.source || ''}${r.organs ? `(${r.organs})` : ''}`),
      ...(h.elementWarnings || []).map((w) => `${w.element || ''}${w.condition || ''}`),
    ].filter(Boolean);
    if (h.yangrenDanger) riskChips.push('⚠ 羊刃高危');
    return (
      <Wrap>
        <StarRating
          score={VITALITY_TO_STARS[vitality] ?? 3.0}
          indicatorLabel={zh(vitalityLabel || vitality || '')}
          color={starColor}
        />
        {h.lifeStage ? <InfoStrip rows={[{ label: zh('十二長生'), value: zh(h.lifeStage) }]} /> : null}
        {riskChips.length > 0 ? <ChipGroup items={riskChips.map(zh)} tone="negative" /> : null}
      </Wrap>
    );
  }

  // === monthly_01 … monthly_12 ===
  const monthMatch = sectionKey.match(/^monthly_(\d{1,2})$/);
  if (monthMatch?.[1]) {
    const monthNum = parseInt(monthMatch[1], 10);
    const fc = det.monthlyForecasts?.find((m) => m.monthIndex === monthNum);
    if (!fc) return null;
    const tag = `${fc.monthStem || ''}${fc.monthBranch || ''}·${fc.monthTenGod || ''}${fc.isKongWang ? '(空亡)' : ''}`;
    return (
      <Wrap>
        <StarRating score={auspToStars(fc.auspiciousness)} indicatorLabel={zh(fc.auspiciousness || '')} />
        <InfoStrip rows={[{ label: zh('月柱'), value: zh(tag) }]} />
        <MonthlyAspects aspects={fc.aspects} zh={zh} />
      </Wrap>
    );
  }

  return null;
}

// --- annual finance star helpers (ported from web getFinanceStarScore) ---

function financeStarScore(f: AnnualV2DeterministicData['finance']): number {
  if (!f?.signals) return 3.0;
  const pos = f.signals.filter((s) => s.impact === 'positive' || s.impact === 'very_positive').length;
  const neg = f.signals.filter((s) => s.impact === 'negative' || s.impact === 'very_negative').length;
  let score: number;
  if (pos >= 3 && neg === 0) score = 5.0;
  else if (pos >= 2 && neg === 0) score = 4.0;
  else if (pos >= 1 && neg === 0) score = 3.5;
  else if (pos === 0 && neg === 0) score = 3.0;
  else if (pos === 0 && neg >= 1) score = 2.0;
  else score = 3.0;
  if (f.wealthPresent && f.wealthCondition === 'strong_dm') score = Math.min(5.0, score + 0.5);
  return score;
}

function financeLabel(score: number): string {
  if (score >= 4.5) return '大吉';
  if (score >= 3.5) return '吉';
  if (score >= 2.5) return '平';
  if (score >= 1.5) return '凶';
  return '大凶';
}

// ============================================================
// Love V2 dispatcher
// ============================================================

export function LoveWidgets({
  sectionKey,
  det,
}: {
  sectionKey: string;
  det: LoveV2DeterministicData;
}): React.ReactNode {
  const zh = useZh();
  if (!det) return null;

  // === love_personality ===
  if (sectionKey === 'love_personality') {
    const lp = det.lovePersonality;
    if (!lp) return null;
    const rows = [
      { label: '戀愛原型', value: lp.archetypeLabel || '' },
      { label: '特質', value: lp.archetypeTrait || '' },
      { label: '五行風格', value: lp.elementStyle || '' },
      { label: '日主', value: STRENGTH_ZH[lp.strengthClass] || lp.strengthClass || '中和' },
    ];
    if (lp.dominantCount >= 4 && lp.dominantTenGod) {
      rows.push({ label: '主導十神', value: `${lp.dominantTenGod}偏多` });
    }
    return (
      <Wrap>
        <InfoStrip rows={rows.filter((r) => r.value).map((r) => ({ label: zh(r.label), value: zh(r.value) }))} />
      </Wrap>
    );
  }

  // === peach_blossom_analysis ===
  if (sectionKey === 'peach_blossom_analysis') {
    const pb = det.peachBlossoms;
    if (!pb) return null;
    const pos = pb.positiveCount || 0;
    const neg = pb.negativeCount || 0;
    const tone: VerdictTone = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
    const label = pos > neg ? '正桃花為主' : neg > pos ? '爛桃花風險高' : '桃花平穩';
    const meta = pb.summary || `正桃花 ${pos} · 爛桃花 ${neg}`;
    return (
      <Wrap>
        <VerdictBanner label={zh(label)} meta={zh(meta)} tone={tone} />
        <ChipSection label="正桃花" items={pb.positiveTypes} tone="positive" zh={zh} />
        <ChipSection label="爛桃花" items={pb.negativeTypes} tone="negative" zh={zh} />
      </Wrap>
    );
  }

  // === natal_marriage ===
  if (sectionKey === 'natal_marriage') {
    const ss = det.spouseStar;
    const mp = det.marriagePalace;
    if (!ss && !mp) return null;
    const mpRows = mp
      ? [
          { label: '配偶宮', value: mp.dayBranch || '' },
          { label: '五行', value: mp.element || '' },
          { label: '十神', value: mp.tenGod || '' },
          { label: '十二長生', value: mp.twelveStage || '' },
          { label: '相貌', value: mp.appearanceGrade || '' },
          { label: '空亡', value: mp.isKongWang ? '是' : '' },
        ].filter((r) => r.value)
      : [];
    return (
      <Wrap>
        {ss ? (
          <VerdictBanner
            label={zh(ss.star ? `姻緣星：${ss.star}` : '本命姻緣')}
            meta={
              [VISIBILITY_ZH[ss.visibility] || ss.visibility, ss.role, ss.balanceDesc]
                .filter(Boolean)
                .map((s) => zh(s as string))
                .join(' · ') || undefined
            }
            tone="neutral"
          />
        ) : null}
        {ss?.challenges?.length ? <ChipGroup items={ss.challenges.map(zh)} tone="negative" /> : null}
        {mpRows.length > 0 ? (
          <InfoStrip rows={mpRows.map((r) => ({ label: zh(r.label), value: zh(r.value) }))} />
        ) : null}
      </Wrap>
    );
  }

  // === partner_matching ===
  if (sectionKey === 'partner_matching') {
    const pr = det.partnerRecommendations;
    if (!pr) return null;
    const favorable = [...(pr.favorable || []), ...(pr.favorableSecondary || [])];
    const seasonRows = (pr.favorableSeasons || []).map((s) => ({
      label: `${s.element || ''}${s.role ? `(${s.role})` : ''}`,
      value: [s.season, s.months].filter(Boolean).join(' · '),
    }));
    if (!favorable.length && !pr.avoidance?.length && !seasonRows.length) return null;
    return (
      <Wrap>
        <ChipSection label="宜配生肖" items={favorable} tone="positive" zh={zh} />
        <ChipSection label="避開生肖" items={pr.avoidance} tone="negative" zh={zh} />
        {seasonRows.length > 0 ? (
          <InfoStrip rows={seasonRows.map((r) => ({ label: zh(r.label), value: zh(r.value) }))} />
        ) : null}
      </Wrap>
    );
  }

  // === romance_good_years ===
  if (sectionKey === 'romance_good_years') {
    const years = det.romanceTimeline?.goodYears;
    if (!years?.length) return null;
    return (
      <Wrap>
        <View style={ws.chipRow}>
          {years.map((y, i) => (
            <Chip
              key={i}
              label={zh(`${y.year}${y.type ? ` ${y.type}` : ''}${y.conflicted ? ' ⚠' : ''}`)}
              tone={y.conflicted ? 'gold' : 'positive'}
            />
          ))}
        </View>
      </Wrap>
    );
  }

  // === romance_danger_years ===
  if (sectionKey === 'romance_danger_years') {
    const years = det.romanceTimeline?.dangerYears;
    if (!years?.length) return null;
    return (
      <Wrap>
        <ChipGroup items={years.map((y) => zh(`${y.year}${y.trigger ? `(${y.trigger})` : ''}`))} tone="negative" />
      </Wrap>
    );
  }

  // === marriage_change_years ===
  if (sectionKey === 'marriage_change_years') {
    const years = det.romanceTimeline?.changeYears;
    if (!years?.length) return null;
    return (
      <Wrap>
        <View style={ws.chipRow}>
          {years.map((y, i) => (
            <Chip key={i} label={zh(`${y.year}${y.type ? `(${y.type})` : ''}`)} tone="gold" />
          ))}
        </View>
      </Wrap>
    );
  }

  // === annual_love_YYYY ===
  const annualMatch = sectionKey.match(/^annual_love_(\d{4})$/);
  if (annualMatch?.[1]) {
    const year = parseInt(annualMatch[1], 10);
    const af = det.annualForecasts?.find((f) => f.year === year);
    if (!af) return null;
    const chips: Array<{ label: string; tone: ChipTone }> = [];
    if (af.isGoodYear && af.goodYearType) chips.push({ label: af.goodYearType, tone: 'positive' });
    if (af.isDangerYear && af.dangerYearTrigger)
      chips.push({ label: `桃花劫·${af.dangerYearTrigger}`, tone: 'negative' });
    if (af.isChangeYear && af.changeYearType) chips.push({ label: `變動·${af.changeYearType}`, tone: 'gold' });
    if (af.isVoid) chips.push({ label: '空亡年', tone: 'negative' });
    return (
      <Wrap>
        <StarRating score={auspToStars(af.auspiciousness)} indicatorLabel={zh(af.auspiciousness || '')} />
        <InfoStrip
          rows={[
            { label: zh('干支'), value: zh(`${af.stem || ''}${af.branch || ''}年`) },
            { label: zh('十神'), value: zh(`${af.stemTenGod || ''}${af.stemRole ? `（${af.stemRole}）` : ''}`) },
          ]}
        />
        {chips.length > 0 ? (
          <View style={ws.chipRow}>
            {chips.map((c, i) => (
              <Chip key={i} label={zh(c.label)} tone={c.tone} />
            ))}
          </View>
        ) : null}
      </Wrap>
    );
  }

  // === monthly_love_MM ===
  const monthlyMatch = sectionKey.match(/^monthly_love_(\d{1,2})$/);
  if (monthlyMatch?.[1]) {
    const month = parseInt(monthlyMatch[1], 10);
    const mf = det.monthlyForecasts?.find((f) => f.month === month);
    if (!mf) return null;
    const chips: Array<{ label: string; tone: ChipTone }> = [];
    if (mf.hasRomanceStar) chips.push({ label: '桃花月', tone: 'positive' });
    if (mf.isVoid) chips.push({ label: '空亡月', tone: 'negative' });
    for (const inter of mf.interactions || []) {
      if (inter.includes('六合') || inter.includes('六沖') || inter.includes('六害') || inter.includes('伏吟')) {
        chips.push({ label: inter, tone: interactionTone(inter) });
      }
    }
    return (
      <Wrap>
        <StarRating score={auspToStars(mf.auspiciousness)} indicatorLabel={zh(mf.auspiciousness || '')} />
        <InfoStrip
          rows={[
            { label: zh('干支'), value: zh(`${mf.stem || ''}${mf.branch || ''}`) },
            { label: zh('十神'), value: zh(`${mf.stemTenGod || ''}${mf.stemRole ? `（${mf.stemRole}）` : ''}`) },
          ]}
        />
        {chips.length > 0 ? (
          <View style={ws.chipRow}>
            {chips.map((c, i) => (
              <Chip key={i} label={zh(c.label)} tone={c.tone} />
            ))}
          </View>
        ) : null}
      </Wrap>
    );
  }

  return null;
}

// ============================================================
// Styles
// ============================================================

const ws = StyleSheet.create({
  wrap: { gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chipSection: { gap: spacing.xs },
  chipSectionLabel: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
  aspectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  aspectCell: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
  },
  aspectLabel: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
  aspectValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
});
