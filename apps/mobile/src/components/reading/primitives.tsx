/**
 * Shared reading-display primitives (RN). The kit that every reading type's
 * widgets + the AIReadingDisplay orchestrator build on. Ported from the web
 * AIReadingDisplay monolith (renderFormattedContent, SECTION_THEMES,
 * StarRating, verdict banner, info strip, chips, paywall, skeleton).
 */
import { type ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle, type TextStyle } from 'react-native';
import { colors, fonts, fontSize, spacing, radius, shadows } from '../../theme';

// ============================================================
// Section theme → accent color + icon
// ============================================================

export type SectionThemeName =
  | 'personality'
  | 'career'
  | 'love'
  | 'finance'
  | 'health'
  | 'family'
  | 'timing'
  | 'overview'
  | 'compatibility'
  | 'default';

const THEME_COLOR: Record<SectionThemeName, string> = {
  personality: '#C41E3A',
  career: '#1565C0',
  love: '#E91E63',
  finance: '#B8860B',
  health: '#2E7D32',
  family: '#F5A623',
  timing: '#8B5CF6',
  overview: '#C41E3A',
  compatibility: '#8B5CF6',
  default: '#C41E3A',
};

const SECTION_THEMES: Record<string, { icon: string; theme: SectionThemeName }> = {
  personality: { icon: '🧠', theme: 'personality' },
  career: { icon: '💼', theme: 'career' },
  favorable_industries: { icon: '🏢', theme: 'career' },
  love: { icon: '💕', theme: 'love' },
  finance: { icon: '💰', theme: 'finance' },
  health: { icon: '🏥', theme: 'health' },
  // Lifetime V2
  chart_identity: { icon: '🎴', theme: 'personality' },
  finance_pattern: { icon: '💰', theme: 'finance' },
  career_pattern: { icon: '💼', theme: 'career' },
  boss_strategy: { icon: '🤝', theme: 'career' },
  love_pattern: { icon: '💕', theme: 'love' },
  children_analysis: { icon: '👶', theme: 'family' },
  parents_analysis: { icon: '👨‍👩‍👧', theme: 'family' },
  current_period: { icon: '📊', theme: 'timing' },
  next_period: { icon: '🔮', theme: 'timing' },
  best_period: { icon: '🌟', theme: 'timing' },
  annual_love: { icon: '💕', theme: 'love' },
  annual_career: { icon: '💼', theme: 'career' },
  annual_finance: { icon: '💰', theme: 'finance' },
  annual_health: { icon: '🏥', theme: 'health' },
  // Annual V2
  annual_overview: { icon: '📅', theme: 'overview' },
  annual_tai_sui: { icon: '⚡', theme: 'overview' },
  annual_dayun_context: { icon: '🔄', theme: 'timing' },
  annual_relationships: { icon: '🤝', theme: 'overview' },
  annual_family: { icon: '👨‍👩‍👧', theme: 'family' },
  // Career V2
  suitable_positions: { icon: '💼', theme: 'career' },
  career_directions_favorable: { icon: '🧭', theme: 'career' },
  career_directions_unfavorable: { icon: '⚠️', theme: 'career' },
  company_type_fit: { icon: '🏢', theme: 'career' },
  entrepreneurship: { icon: '🚀', theme: 'career' },
  partnership: { icon: '🤝', theme: 'career' },
  career_allies: { icon: '👥', theme: 'overview' },
  // Love V2
  love_personality: { icon: '💕', theme: 'love' },
  peach_blossom_analysis: { icon: '🌸', theme: 'love' },
  natal_marriage: { icon: '💍', theme: 'love' },
  partner_matching: { icon: '💑', theme: 'love' },
  spouse_appearance: { icon: '👤', theme: 'love' },
  romance_good_years: { icon: '🌹', theme: 'timing' },
  romance_danger_years: { icon: '⚠️', theme: 'timing' },
  marriage_change_years: { icon: '🔄', theme: 'timing' },
  love_summary: { icon: '❤️', theme: 'love' },
};

/** Resolve section theme for a key (handles dynamic annual/monthly forecast keys). */
export function getSectionTheme(key: string): { icon: string; theme: SectionThemeName; color: string } {
  const base =
    SECTION_THEMES[key] ??
    (key.startsWith('annual_forecast_')
      ? { icon: '📅', theme: 'timing' as const }
      : key.startsWith('monthly_forecast_')
        ? { icon: '📆', theme: 'timing' as const }
        : key.startsWith('annual_love_')
          ? { icon: '💕', theme: 'timing' as const }
          : key.startsWith('monthly_love_')
            ? { icon: '📆', theme: 'love' as const }
            : key.startsWith('monthly_')
              ? { icon: '📆', theme: 'timing' as const }
              : { icon: '📜', theme: 'default' as const });
  return { ...base, color: THEME_COLOR[base.theme] };
}

// ============================================================
// MarkdownText — port of renderFormattedContent
// ============================================================

const EMOJI_SUBHEADER =
  /^(?:🔥|⚠️|⚠|💡|📍|◆|🔹|⭐|🌟|💎|🎯|💰|💼|💕|🏥|📊|🔮|🌸|💫|🌙|✨|🌺|🔒|🎉|🪷|💘|🎊|🍀|📌|🧲)/;

function postProcess(text: string): string {
  let r = text.replace(/💡\s*攻略秘技/g, '💡 實戰建議');
  r = r.replace(/((?:🔥|⚠️|⚠|💡)\s*(?:強項|注意事項|實戰建議))\n{2,}/g, '$1\n');
  r = r.replace(/((?:📍|◆|🔹|💡)\s*(?:總述|第一階段|第二階段|階段總結與建議).*)\n{2,}/g, '$1\n');
  return r;
}

/** Split a line on **bold** markers → styled runs (superset of web; web has none). */
function BoldRuns({ text, style, boldStyle }: { text: string; style: TextStyle; boldStyle: TextStyle }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  if (parts.length === 1) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <Text key={i} style={boldStyle}>
            {p.slice(2, -2)}
          </Text>
        ) : (
          <Text key={i}>{p}</Text>
        ),
      )}
    </Text>
  );
}

/**
 * Render AI section text: gold-dot bullets («- »/«· »/«YYYY年：»), emoji
 * sub-headers, «category：a、b、c» rows, and paragraphs. `convert` is the
 * 繁→簡 converter (identity in zh-TW).
 */
export function MarkdownText({
  text,
  convert = (s) => s,
}: {
  text: string;
  convert?: (s: string) => string;
}) {
  const processed = postProcess(convert(text));
  const lines = processed.split('\n');
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flush = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <View key={`b${key++}`} style={md.bulletList}>
        {items.map((item, i) => {
          const colonIdx = item.indexOf('：');
          if (colonIdx > 0 && colonIdx < item.length - 1) {
            const after = item.slice(colonIdx + 1).trim();
            const segs = after.split('、');
            if (segs.length >= 3 && segs.every((s) => s.trim().length <= 8)) {
              return (
                <View key={i} style={md.bulletRow}>
                  <Text style={md.dot}>◆</Text>
                  <View style={md.bulletCategoryWrap}>
                    <Text style={md.bulletCategory}>{item.slice(0, colonIdx)}</Text>
                    <Text style={md.bulletCategoryItems}>{after}</Text>
                  </View>
                </View>
              );
            }
          }
          return (
            <View key={i} style={md.bulletRow}>
              <Text style={md.dot}>◆</Text>
              <BoldRuns text={item} style={md.bulletText} boldStyle={md.bold} />
            </View>
          );
        })}
      </View>,
    );
  };

  for (const line of lines) {
    const t = line.trim();
    if (/^[-–·‧・]\s*/.test(t)) {
      bullets.push(t.replace(/^[-–·‧・]\s*/, ''));
      continue;
    }
    if (/^\d{4}年[：:]/.test(t)) {
      bullets.push(t);
      continue;
    }
    flush();
    if (t === '') continue;
    if (EMOJI_SUBHEADER.test(t)) {
      blocks.push(
        <Text key={`h${key++}`} style={md.subHeader}>
          {t}
        </Text>,
      );
      continue;
    }
    blocks.push(<BoldRuns key={`p${key++}`} text={t} style={md.paragraph} boldStyle={md.bold} />);
  }
  flush();

  return <View style={md.wrap}>{blocks}</View>;
}

const md = StyleSheet.create({
  wrap: { gap: spacing.sm },
  paragraph: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 25 },
  bold: { fontWeight: '700', color: colors.textPrimary },
  subHeader: { fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent, marginTop: spacing.xs },
  bulletList: { gap: spacing.xs },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dot: { color: colors.gold, fontSize: 10, lineHeight: 24 },
  bulletText: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 26 },
  bulletCategoryWrap: { flex: 1 },
  bulletCategory: { fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent, lineHeight: 26 },
  bulletCategoryItems: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
});

// ============================================================
// ReadingSectionCard — themed card shell
// ============================================================

export function ReadingSectionCard({
  sectionKey,
  title,
  children,
  style,
}: {
  sectionKey: string;
  title: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const { icon, color } = getSectionTheme(sectionKey);
  return (
    <View style={[card.wrap, style]}>
      <View style={[card.headerRow, { borderLeftColor: color }]}>
        <Text style={card.icon}>{icon}</Text>
        <Text style={[card.title, { color }]}>{title}</Text>
      </View>
      <View style={card.body}>{children}</View>
    </View>
  );
}

const card = StyleSheet.create({
  wrap: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, ...shadows.warm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderLeftWidth: 3, paddingLeft: spacing.sm },
  icon: { fontSize: 20 },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', flex: 1 },
  body: { gap: spacing.sm },
});

// ============================================================
// StarRating
// ============================================================

export function StarRating({ score, indicatorLabel, color }: { score: number; indicatorLabel?: string; color?: string }) {
  const clamped = Math.max(0, Math.min(5, score));
  const full = Math.floor(clamped);
  const half = clamped % 1 !== 0;
  const stars = '★'.repeat(full) + (half ? '⯨' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
  return (
    <View style={star.row}>
      <Text style={[star.stars, { color: color ?? colors.gold }]}>{stars}</Text>
      <Text style={star.score}>{clamped.toFixed(1)}</Text>
      {indicatorLabel ? <Text style={star.indicator}>· {indicatorLabel}</Text> : null}
    </View>
  );
}

const star = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stars: { fontSize: fontSize.lg, letterSpacing: 1 },
  score: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  indicator: { fontSize: fontSize.sm, color: colors.textSecondary },
});

// ============================================================
// ScoreBar — horizontal % bar with label
// ============================================================

export function ScoreBar({
  label,
  score,
  max = 100,
  levelLabel,
  color = colors.red,
}: {
  label: string;
  score: number;
  max?: number;
  levelLabel?: string;
  color?: string;
}) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  return (
    <View style={bar.wrap}>
      <View style={bar.labelRow}>
        <Text style={bar.label}>{label}</Text>
        <Text style={[bar.value, { color }]}>
          {score}
          {levelLabel ? <Text style={bar.level}> · {levelLabel}</Text> : null}
        </Text>
      </View>
      <View style={bar.track}>
        <View style={[bar.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const bar = StyleSheet.create({
  wrap: { gap: spacing.xs },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  value: { fontSize: fontSize.base, fontWeight: '800' },
  level: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
  track: { height: 8, backgroundColor: colors.borderLight, borderRadius: 999, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 999 },
});

// ============================================================
// VerdictBanner — go/no-go banner (✓/✗/◆ + label + /100)
// ============================================================

export type VerdictTone = 'positive' | 'negative' | 'neutral';

export function VerdictBanner({
  label,
  meta,
  score,
  tone = 'neutral',
}: {
  label: string;
  meta?: string;
  score?: number | null;
  tone?: VerdictTone;
}) {
  const toneColor = tone === 'positive' ? colors.success : tone === 'negative' ? colors.error : colors.gold;
  const icon = tone === 'positive' ? '✓' : tone === 'negative' ? '✗' : '◆';
  return (
    <View style={[verdict.wrap, { borderColor: toneColor, backgroundColor: `${toneColor}14` }]}>
      <View style={verdict.top}>
        <View style={verdict.left}>
          <Text style={[verdict.icon, { color: toneColor }]}>{icon}</Text>
          <Text style={verdict.label}>{label}</Text>
        </View>
        {score != null ? (
          <Text style={[verdict.score, { color: toneColor }]}>
            {score}
            <Text style={verdict.scoreMax}>/100</Text>
          </Text>
        ) : null}
      </View>
      {meta ? <Text style={verdict.meta}>{meta}</Text> : null}
    </View>
  );
}

const verdict = StyleSheet.create({
  wrap: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md, gap: spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  icon: { fontSize: fontSize.lg, fontWeight: '800' },
  label: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  score: { fontFamily: fonts.serifBold, fontSize: fontSize.xl, fontWeight: '800' },
  scoreMax: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
  meta: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
});

// ============================================================
// InfoStrip — compact label/value rows
// ============================================================

export function InfoStrip({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <View style={strip.wrap}>
      {rows.map((r, i) => (
        <View key={i} style={[strip.row, i > 0 && strip.rowBorder]}>
          <Text style={strip.label}>{r.label}</Text>
          <Text style={strip.value}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

const strip = StyleSheet.create({
  wrap: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  label: { fontSize: fontSize.sm, color: colors.textMuted },
  value: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});

// ============================================================
// Chip / ChipGroup — pill tags
// ============================================================

export type ChipTone = 'neutral' | 'positive' | 'negative' | 'gold';

export function Chip({ label, tone = 'neutral' }: { label: string; tone?: ChipTone }) {
  const c =
    tone === 'positive' ? colors.success : tone === 'negative' ? colors.error : tone === 'gold' ? colors.gold : colors.textSecondary;
  return (
    <View style={[chip.wrap, { borderColor: `${c}55`, backgroundColor: `${c}12` }]}>
      <Text style={[chip.text, { color: c }]}>{label}</Text>
    </View>
  );
}

export function ChipGroup({ items, tone = 'neutral' }: { items: string[]; tone?: ChipTone }) {
  if (!items?.length) return null;
  return (
    <View style={chip.group}>
      {items.map((it, i) => (
        <Chip key={`${it}-${i}`} label={it} tone={tone} />
      ))}
    </View>
  );
}

const chip = StyleSheet.create({
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  wrap: { borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  text: { fontSize: fontSize.sm, fontWeight: '600' },
});

// ============================================================
// SectionSkeleton — streaming placeholder
// ============================================================

export function SectionSkeleton({ label }: { label?: string }) {
  return (
    <View style={skel.wrap}>
      {label ? <Text style={skel.label}>{label}</Text> : null}
      <View style={[skel.line, { width: '90%' }]} />
      <View style={[skel.line, { width: '96%' }]} />
      <View style={[skel.line, { width: '70%' }]} />
    </View>
  );
}

const skel = StyleSheet.create({
  wrap: { gap: spacing.sm, paddingVertical: spacing.xs },
  label: { fontSize: fontSize.sm, color: colors.textMuted },
  line: { height: 14, borderRadius: 7, backgroundColor: colors.borderLight, opacity: 0.7 },
});

// ============================================================
// PaywallOverlay — preview + locked CTA (non-subscribers)
// ============================================================

export function PaywallOverlay({ onUnlock }: { onUnlock?: () => void }) {
  return (
    <View style={pay.wrap}>
      <Text style={pay.lock}>🔒</Text>
      <Text style={pay.text}>{'訂閱或解鎖完整報告以查看全部內容'}</Text>
      {onUnlock ? (
        <Text style={pay.cta} onPress={onUnlock}>
          {'立即解鎖'}
        </Text>
      ) : null}
    </View>
  );
}

const pay = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderStyle: 'dashed',
  },
  lock: { fontSize: 24 },
  text: { fontSize: fontSize.sm, color: colors.textSecondary },
  cta: { fontSize: fontSize.base, fontWeight: '700', color: colors.red, marginTop: spacing.xs },
});
