/**
 * Career (事業詳批) deterministic widgets (RN). Ports the web's per-section
 * career visuals — ScoreBar scores, element/ten-god capability charts, go/no-go
 * verdict banners, position lists, industry + ally chip groups, and the
 * annual/monthly forecast badges — onto the shared reading primitives.
 *
 * These render the DETERMINISTIC engine data only (never AI prose). Every widget
 * returns BARE content; the caller wraps it in a ReadingSectionCard.
 *
 * Web sources: AIReadingDisplay.tsx (CareerVerdictBadge / CareerSummaryBadge),
 * ScoreBar.tsx, ElementCapabilityChart.tsx, TenGodCapabilityChart.tsx,
 * AnnualForecastTimeline.tsx, MonthlyFortuneGrid.tsx.
 */
import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, elementColors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import type { CareerV2DeterministicData } from '../../lib/readings-api';
import {
  ScoreBar,
  VerdictBanner,
  Chip,
  ChipGroup,
  InfoStrip,
  type VerdictTone,
  type ChipTone,
} from './primitives';

// ============================================================
// Constants (ported from web ElementCapabilityChart / TenGodCapabilityChart)
// ============================================================

const ELEMENT_ORDER = ['木', '火', '土', '金', '水'] as const;

const TEN_GOD_ORDER = [
  '比肩', '劫財',
  '食神', '傷官',
  '偏財', '正財',
  '偏官', '正官',
  '偏印', '正印',
];

const TEN_GOD_GROUPS: Record<string, string> = {
  比肩: '比劫', 劫財: '比劫',
  食神: '食傷', 傷官: '食傷',
  偏財: '財星', 正財: '財星',
  偏官: '官殺', 正官: '官殺',
  偏印: '印星', 正印: '印星',
};

const ENTREPRENEURSHIP_LABELS: Record<string, string> = {
  technical_founder: '適合技術型創業',
  business_founder: '適合商業型創業',
  freelancer: '適合自由業型',
  not_recommended: '不建議創業',
};

/** Auspiciousness → accent color (ported from AnnualForecastTimeline config). */
const AUSPICIOUSNESS_COLOR: Record<string, string> = {
  大吉: '#2E7D32',
  吉: '#388E3C',
  吉中有凶: '#F9A825',
  曇花一現: '#F9A825',
  平: '#546E7A',
  凶中有吉: '#E65100',
  凶中帶機: '#E65100',
  小凶: '#E65100',
  凶: '#E65100',
  大凶: '#E65100',
  凶上加凶: '#E65100',
};

function auspColor(label: string | undefined): string {
  return (label && AUSPICIOUSNESS_COLOR[label]) || '#546E7A';
}

const clampPct = (n: number): number => Math.min(Math.max(n || 0, 0), 100);

/** Coerce an unknown list → string[] (handles string items or {label|name|element|category|type}). */
function toStrList(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it): string => {
      if (typeof it === 'string') return it;
      if (it && typeof it === 'object') {
        const o = it as Record<string, unknown>;
        const v = o.label ?? o.name ?? o.element ?? o.category ?? o.type;
        return typeof v === 'string' ? v : '';
      }
      return '';
    })
    .filter((s) => s.length > 0);
}

// ============================================================
// Local sub-components
// ============================================================

function SubHeader({ text }: { text: string }) {
  return <Text style={s.subHeader}>{text}</Text>;
}

function LabeledGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.labeledGroup}>
      <Text style={s.groupLabel}>{label}</Text>
      {children}
    </View>
  );
}

/** 五行比重 capability rows: colored element badge + ScoreBar + talent chips. */
function ElementRows({
  data,
  zh,
}: {
  data: CareerV2DeterministicData['weightedElements'];
  zh: (v: string) => string;
}) {
  const els = ELEMENT_ORDER.filter((e) => data?.[e] != null);
  if (!els.length) return null;
  return (
    <View style={s.group}>
      <SubHeader text={zh('先天潛在能力（五行比重）')} />
      {els.map((e) => {
        const info = data[e]!;
        const color = elementColors[e as keyof typeof elementColors] ?? colors.textMuted;
        const pct = clampPct(info.percentage);
        return (
          <View key={e} style={s.elemRow}>
            <View style={s.elemHead}>
              <View style={[s.badge, { backgroundColor: color }]}>
                <Text style={s.badgeText}>{e}</Text>
              </View>
              <View style={s.flex}>
                <ScoreBar
                  label={zh(info.level || '')}
                  score={Number(pct.toFixed(1))}
                  levelLabel={`${pct.toFixed(1)}%`}
                  color={color}
                />
              </View>
            </View>
            <ChipGroup items={(info.talents || []).map(zh)} tone="gold" />
          </View>
        );
      })}
    </View>
  );
}

/** 十神比重 capability rows: ScoreBar (name + group) + capability chips. */
function TenGodRows({
  data,
  zh,
}: {
  data: CareerV2DeterministicData['weightedTenGods'];
  zh: (v: string) => string;
}) {
  const tgs = TEN_GOD_ORDER.filter((t) => data?.[t] != null);
  if (!tgs.length) return null;
  return (
    <View style={s.group}>
      <SubHeader text={zh('後天社會能力（十神比重）')} />
      {tgs.map((t) => {
        const info = data[t]!;
        const pct = clampPct(info.percentage);
        const group = TEN_GOD_GROUPS[t] || '';
        return (
          <View key={t} style={s.tgRow}>
            <ScoreBar
              label={zh(group ? `${t}（${group}）` : t)}
              score={Number(pct.toFixed(1))}
              levelLabel={info.level ? zh(info.level) : `${pct.toFixed(1)}%`}
              color={colors.red}
            />
            <ChipGroup items={(info.capabilities || []).map(zh)} tone="neutral" />
          </View>
        );
      })}
    </View>
  );
}

// ============================================================
// CareerWidgets — per-section deterministic widget dispatcher
// ============================================================

export function CareerWidgets({
  sectionKey,
  det,
}: {
  sectionKey: string;
  det: CareerV2DeterministicData;
}): React.ReactNode {
  const zh = useZh();
  if (!det) return null;

  switch (sectionKey) {
    case 'career_pattern': {
      const rep = det.reputationScore;
      const wealth = det.wealthScore;
      const hasScores = !!(rep || wealth);
      const hasCharts = !!(det.weightedElements || det.weightedTenGods);
      if (!det.pattern && !hasScores && !hasCharts) return null;
      return (
        <View style={s.stack}>
          {det.pattern ? (
            <View style={s.chipRow}>
              <Chip label={zh(`${det.pattern}格局`)} tone="gold" />
            </View>
          ) : null}
          {hasScores ? (
            <View style={s.scores}>
              {rep ? (
                <ScoreBar
                  label={zh('名聲地位')}
                  score={rep.score}
                  levelLabel={rep.level ? zh(rep.level) : undefined}
                  color={colors.red}
                />
              ) : null}
              {wealth ? (
                <ScoreBar
                  label={zh('財富格局')}
                  score={wealth.score}
                  levelLabel={wealth.tier ? zh(wealth.tier) : undefined}
                  color={elementColors.金}
                />
              ) : null}
            </View>
          ) : null}
          <ElementRows data={det.weightedElements} zh={zh} />
          <TenGodRows data={det.weightedTenGods} zh={zh} />
        </View>
      );
    }

    case 'company_type_fit': {
      const comp = det.companyTypeFit;
      if (!comp) return null;
      const score = (comp as { score?: number }).score ?? null;
      return (
        <VerdictBanner
          label={zh(comp.label || comp.type || '穩定型')}
          meta={comp.description ? zh(comp.description) : undefined}
          score={score}
          tone="neutral"
        />
      );
    }

    case 'entrepreneurship': {
      const ent = det.entrepreneurshipFit;
      if (!ent) return null;
      const label = ENTREPRENEURSHIP_LABELS[ent.type] || ent.type;
      const tone: VerdictTone = ent.type !== 'not_recommended' ? 'positive' : 'negative';
      const chipTone: ChipTone = tone === 'positive' ? 'positive' : 'negative';
      return (
        <View style={s.stack}>
          <VerdictBanner label={zh(label)} score={ent.score} tone={tone} />
          <ChipGroup items={(ent.reasons || []).map(zh)} tone={chipTone} />
        </View>
      );
    }

    case 'partnership': {
      const part = det.partnershipFit;
      if (!part) return null;
      const label = part.suitable ? '適合合夥經營' : '不建議合夥經營';
      const tone: VerdictTone = part.suitable ? 'positive' : 'negative';
      const chipTone: ChipTone = part.suitable ? 'positive' : 'negative';
      return (
        <View style={s.stack}>
          <VerdictBanner label={zh(label)} score={part.score} tone={tone} />
          <ChipGroup items={(part.reasons || []).map(zh)} tone={chipTone} />
        </View>
      );
    }

    case 'suitable_positions': {
      const positions = det.suitablePositions;
      if (!positions?.length) return null;
      return (
        <View style={s.stack}>
          {positions.map((p, i) => (
            <View key={`${p.label}-${i}`} style={s.posCard}>
              <Text style={s.posLabel}>{zh(p.label)}</Text>
              {p.description ? <Text style={s.posDesc}>{zh(p.description)}</Text> : null}
              <ChipGroup items={(p.anchors || []).map(zh)} tone="neutral" />
            </View>
          ))}
        </View>
      );
    }

    case 'career_directions_favorable': {
      const items = toStrList(det.favorableIndustries as unknown).map(zh);
      if (!items.length) return null;
      return <ChipGroup items={items} tone="positive" />;
    }

    case 'career_directions_unfavorable': {
      const items = toStrList(det.unfavorableIndustries as unknown).map(zh);
      if (!items.length) return null;
      return <ChipGroup items={items} tone="negative" />;
    }

    case 'career_allies': {
      const a = det.careerAllies;
      if (!a) return null;
      const nobles = (a.nobles || [])
        .map((n) => zh(`${n.type}${n.branch ? `·${n.branch}` : ''}`))
        .filter(Boolean);
      const shensha = (a.careerShensha || []).map((x) => zh(x.name)).filter(Boolean);
      const allies = toStrList(a.allies as unknown).map(zh);
      const enemies = toStrList(a.enemies as unknown).map(zh);
      const antagonists = (a.antagonists || [])
        .filter((x) => x?.type)
        .map((x) => ({ label: zh(x.type), value: x.description ? zh(x.description) : '—' }));

      if (!nobles.length && !shensha.length && !allies.length && !enemies.length && !antagonists.length) {
        return null;
      }
      return (
        <View style={s.stack}>
          {nobles.length ? (
            <LabeledGroup label={zh('貴人')}>
              <ChipGroup items={nobles} tone="gold" />
            </LabeledGroup>
          ) : null}
          {shensha.length ? (
            <LabeledGroup label={zh('事業神煞')}>
              <ChipGroup items={shensha} tone="gold" />
            </LabeledGroup>
          ) : null}
          {allies.length ? (
            <LabeledGroup label={zh('助力')}>
              <ChipGroup items={allies} tone="positive" />
            </LabeledGroup>
          ) : null}
          {enemies.length ? (
            <LabeledGroup label={zh('小人')}>
              <ChipGroup items={enemies} tone="negative" />
            </LabeledGroup>
          ) : null}
          {antagonists.length ? (
            <LabeledGroup label={zh('需提防')}>
              <InfoStrip rows={antagonists} />
            </LabeledGroup>
          ) : null}
        </View>
      );
    }

    default:
      return null;
  }
}

// ============================================================
// CareerForecastBadge — annual_forecast_YYYY / monthly_forecast_MM
// ============================================================

export function CareerForecastBadge({
  sectionKey,
  det,
}: {
  sectionKey: string;
  det: CareerV2DeterministicData;
}): React.ReactNode {
  const zh = useZh();
  if (!det) return null;

  const annualMatch = sectionKey.match(/^annual_forecast_(\d{4})$/);
  if (annualMatch?.[1]) {
    const year = parseInt(annualMatch[1], 10);
    const fc = det.annualForecasts?.find((f) => f.year === year);
    if (!fc) return null;
    const color = auspColor(fc.auspiciousness);
    const flags: Array<{ label: string; tone: ChipTone }> = [];
    if (fc.kongWangAnalysis?.hit) {
      flags.push({
        label: `空亡 ${fc.kongWangAnalysis.favorable ? '化解' : '受困'}`,
        tone: fc.kongWangAnalysis.favorable ? 'positive' : 'negative',
      });
    }
    if (fc.yimaAnalysis?.hit) {
      flags.push({
        label: `驛馬 ${fc.yimaAnalysis.favorable ? '利動' : '不宜動'}`,
        tone: fc.yimaAnalysis.favorable ? 'positive' : 'negative',
      });
    }
    const interactions = [
      ...toStrList(fc.branchInteractions as unknown),
      ...toStrList(fc.careerIndicators as unknown),
    ].map(zh);
    return (
      <View style={s.forecast}>
        <View style={s.forecastHead}>
          <Text style={s.ganZhi}>{zh(`${fc.stem}${fc.branch}年`)}</Text>
          {fc.tenGod ? <Text style={s.forecastTenGod}>{zh(`【${fc.tenGod}】`)}</Text> : null}
          <View style={s.flex} />
          {fc.auspiciousness ? (
            <Text style={[s.auspPill, auspPillStyle(color)]}>{zh(fc.auspiciousness)}</Text>
          ) : null}
        </View>
        {flags.length ? (
          <View style={s.chipRow}>
            {flags.map((f, i) => (
              <Chip key={`${f.label}-${i}`} label={zh(f.label)} tone={f.tone} />
            ))}
          </View>
        ) : null}
        <ChipGroup items={interactions} tone="neutral" />
      </View>
    );
  }

  const monthlyMatch = sectionKey.match(/^monthly_forecast_(\d{1,2})$/);
  if (monthlyMatch?.[1]) {
    const month = parseInt(monthlyMatch[1], 10);
    const fc = det.monthlyForecasts?.find((f) => f.month === month);
    if (!fc) return null;
    const color = auspColor(fc.auspiciousness);
    return (
      <View style={s.forecast}>
        <View style={s.forecastHead}>
          <Text style={s.ganZhi}>{zh(`${fc.stem}${fc.branch}`)}</Text>
          {fc.monthName ? <Text style={s.forecastMonth}>{zh(fc.monthName)}</Text> : null}
          {fc.tenGod ? <Text style={s.forecastTenGod}>{zh(`【${fc.tenGod}】`)}</Text> : null}
          <View style={s.flex} />
          {fc.auspiciousness ? (
            <Text style={[s.auspPill, auspPillStyle(color)]}>{zh(fc.auspiciousness)}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  return null;
}

function auspPillStyle(color: string) {
  return { color, borderColor: `${color}55`, backgroundColor: `${color}14` };
}

// ============================================================
// Styles
// ============================================================

const s = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: spacing.md },
  scores: { gap: spacing.sm },
  group: { gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },

  subHeader: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textAccent,
    marginTop: spacing.xs,
  },

  // Element capability rows
  elemRow: { gap: spacing.xs },
  elemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '800', color: colors.textOnRed },

  // Ten god capability rows
  tgRow: { gap: spacing.xs },

  // Labeled chip groups (career allies)
  labeledGroup: { gap: spacing.xs },
  groupLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },

  // Suitable positions
  posCard: {
    gap: spacing.xs,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  posLabel: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  posDesc: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },

  // Forecast badge
  forecast: {
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  forecastHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ganZhi: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
  forecastMonth: { fontSize: fontSize.sm, color: colors.textSecondary },
  forecastTenGod: { fontSize: fontSize.sm, color: colors.textAccent, fontWeight: '600' },
  auspPill: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
});
