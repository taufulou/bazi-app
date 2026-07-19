/**
 * Shared reading-display primitives (RN). The kit that every reading type's
 * widgets + the AIReadingDisplay orchestrator build on. Ported from the web
 * AIReadingDisplay monolith (renderFormattedContent, SECTION_THEMES,
 * StarRating, verdict banner, info strip, chips, paywall, skeleton).
 */
import { useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle, type TextStyle } from 'react-native';
import {
  Baby,
  Brain,
  Briefcase,
  Building2,
  Calendar,
  CalendarDays,
  Coins,
  Compass,
  Flower2,
  Gauge,
  Gem,
  Handshake,
  Heart,
  HeartPulse,
  RefreshCw,
  Rocket,
  Route,
  ScrollText,
  Star,
  TriangleAlert,
  UserRound,
  Users,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, radius, rhythm, surfaces  } from '../../theme';

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

/**
 * Section icons — monochrome vectors, tinted from the section's theme colour.
 *
 * These were system emoji (🧠 💼 💕 …). Emoji are multicolour, drawn in a cartoon
 * idiom that fights the ink-wash traditional-Chinese art direction, and — because
 * each vendor ships its own artwork — they made the design literally different on
 * Android and iOS. Vectors take the palette, so a section header now reads as part
 * of the same system as the rest of the card.
 *
 * ⚠️ This covers the icons the APP controls. Emoji that arrive INSIDE the AI prose
 * (🔥 強項, ⚠️ 注意事項, 💡 實戰建議 — see EMOJI_SUBHEADER below) are emitted by the
 * backend prompts and can only be changed there; doing so also affects web and
 * costs a reading-cache invalidation, so it's deliberately out of scope here.
 */
const SECTION_THEMES: Record<string, { Icon: LucideIcon; theme: SectionThemeName }> = {
  personality: { Icon: Brain, theme: 'personality' },
  career: { Icon: Briefcase, theme: 'career' },
  favorable_industries: { Icon: Building2, theme: 'career' },
  love: { Icon: Heart, theme: 'love' },
  finance: { Icon: Coins, theme: 'finance' },
  health: { Icon: HeartPulse, theme: 'health' },
  // Lifetime V2
  chart_identity: { Icon: Gem, theme: 'personality' },
  finance_pattern: { Icon: Coins, theme: 'finance' },
  career_pattern: { Icon: Briefcase, theme: 'career' },
  boss_strategy: { Icon: Handshake, theme: 'career' },
  love_pattern: { Icon: Heart, theme: 'love' },
  children_analysis: { Icon: Baby, theme: 'family' },
  parents_analysis: { Icon: UsersRound, theme: 'family' },
  current_period: { Icon: Gauge, theme: 'timing' },
  next_period: { Icon: Route, theme: 'timing' },
  best_period: { Icon: Star, theme: 'timing' },
  annual_love: { Icon: Heart, theme: 'love' },
  annual_career: { Icon: Briefcase, theme: 'career' },
  annual_finance: { Icon: Coins, theme: 'finance' },
  annual_health: { Icon: HeartPulse, theme: 'health' },
  // Annual V2
  annual_overview: { Icon: Calendar, theme: 'overview' },
  annual_tai_sui: { Icon: Zap, theme: 'overview' },
  annual_dayun_context: { Icon: RefreshCw, theme: 'timing' },
  annual_relationships: { Icon: Handshake, theme: 'overview' },
  annual_family: { Icon: UsersRound, theme: 'family' },
  // Career V2
  suitable_positions: { Icon: Briefcase, theme: 'career' },
  career_directions_favorable: { Icon: Compass, theme: 'career' },
  career_directions_unfavorable: { Icon: TriangleAlert, theme: 'career' },
  company_type_fit: { Icon: Building2, theme: 'career' },
  entrepreneurship: { Icon: Rocket, theme: 'career' },
  partnership: { Icon: Handshake, theme: 'career' },
  career_allies: { Icon: Users, theme: 'overview' },
  // Love V2
  love_personality: { Icon: Heart, theme: 'love' },
  peach_blossom_analysis: { Icon: Flower2, theme: 'love' },
  natal_marriage: { Icon: Gem, theme: 'love' },
  partner_matching: { Icon: Users, theme: 'love' },
  spouse_appearance: { Icon: UserRound, theme: 'love' },
  romance_good_years: { Icon: Flower2, theme: 'timing' },
  romance_danger_years: { Icon: TriangleAlert, theme: 'timing' },
  marriage_change_years: { Icon: RefreshCw, theme: 'timing' },
  love_summary: { Icon: Heart, theme: 'love' },
};

/** Resolve section theme for a key (handles dynamic annual/monthly forecast keys). */
export function getSectionTheme(key: string): { Icon: LucideIcon; theme: SectionThemeName; color: string } {
  const base =
    SECTION_THEMES[key] ??
    (key.startsWith('annual_forecast_')
      ? { Icon: Calendar, theme: 'timing' as const }
      : key.startsWith('monthly_forecast_')
        ? { Icon: CalendarDays, theme: 'timing' as const }
        : key.startsWith('annual_love_')
          ? { Icon: Heart, theme: 'timing' as const }
          : key.startsWith('monthly_love_')
            ? { Icon: CalendarDays, theme: 'love' as const }
            : key.startsWith('monthly_')
              ? { Icon: CalendarDays, theme: 'timing' as const }
              : { Icon: ScrollText, theme: 'default' as const });
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
type BlockKind = 'heading' | 'bullets' | 'paragraph';

/**
 * Space between two adjacent narration blocks. See `rhythm` in the theme for why
 * these are deliberately unequal — a heading needs a big gap BEFORE it and a small
 * one AFTER, or it reads as belonging to neither section.
 */
function gapBefore(kind: BlockKind, prevKind: BlockKind): number {
  if (kind === 'heading') return rhythm.section;
  if (prevKind === 'heading') return rhythm.afterHeading;
  return rhythm.block;
}

export function MarkdownText({
  text,
  convert = (s) => s,
}: {
  text: string;
  convert?: (s: string) => string;
}) {
  const processed = postProcess(convert(text));
  const lines = processed.split('\n');
  const blocks: { kind: BlockKind; node: ReactNode }[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flush = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push({
      kind: 'bullets',
      node: (
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
        </View>
      ),
    });
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
      blocks.push({
        kind: 'heading',
        node: (
          <Text key={`h${key++}`} style={md.subHeader}>
            {t}
          </Text>
        ),
      });
      continue;
    }
    blocks.push({
      kind: 'paragraph',
      node: <BoldRuns key={`p${key++}`} text={t} style={md.paragraph} boldStyle={md.bold} />,
    });
  }
  flush();

  return (
    <View>
      {blocks.map((b, i) => (
        <View key={i} style={i === 0 ? undefined : { marginTop: gapBefore(b.kind, blocks[i - 1].kind) }}>
          {b.node}
        </View>
      ))}
    </View>
  );
}

/** Running-prose leading: 17 × 1.65, the CJK ratio the theme defines. Was 25–26 (≈1.5). */
const PROSE_LEADING = 28;

const md = StyleSheet.create({
  // Prose leading was below the project's own CJK standard — dense full-width
  // glyphs at ~1.5 read as a wall. 1.65 is the ratio `lineHeightRatio.prose` sets.
  paragraph: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: PROSE_LEADING },
  bold: { fontWeight: '700', color: colors.textPrimary },
  // One step above body, with tracking — a sub-heading set at exactly body size
  // has to carry the whole hierarchy on weight and colour alone.
  subHeader: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: colors.textAccent,
  },
  // 14, not 4. Each bullet here is a 4–5 line paragraph; separating two of those
  // by 4px merges them into one block of text.
  bulletList: { gap: rhythm.block - 2 },
  bulletRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  // lineHeight matches the text's so the ornament centres on the FIRST line.
  dot: { color: colors.gold, fontSize: 10, lineHeight: PROSE_LEADING },
  bulletText: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary, lineHeight: PROSE_LEADING },
  bulletCategoryWrap: { flex: 1, gap: 2 },
  bulletCategory: { fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent, lineHeight: PROSE_LEADING },
  bulletCategoryItems: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 24 },
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
  const { Icon, color } = getSectionTheme(sectionKey);
  return (
    <View style={[card.wrap, style]}>
      <View style={[card.headerRow, { borderLeftColor: color }]}>
        <Icon size={19} strokeWidth={2} color={color} />
        <Text style={[card.title, { color }]}>{title}</Text>
      </View>
      <View style={card.body}>{children}</View>
    </View>
  );
}

const card = StyleSheet.create({
  // Padding 16 → 20 and header/body gap 12 → 18: at 17pt with 28px leading the
  // old values left the prose crowding the card edge and sitting almost on the
  // section title. Generous margins are most of what makes a text surface feel
  // considered rather than packed.
  wrap: {
    borderRadius: radius.lg,
    padding: spacing.lg2,
    gap: spacing.lg2,
    ...surfaces.card,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderLeftWidth: 3, paddingLeft: spacing.md },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', flex: 1 },
  body: { gap: spacing.md },
});

// ============================================================
// StarRating
// ============================================================

/**
 * ⚠️ Do NOT go back to encoding the partial star as a text glyph.
 *
 * This previously built the row as
 *   '★'.repeat(full) + (half ? '⯨' : '') + '☆'.repeat(…)
 * where '⯨' is U+2BE8 — a codepoint present in NEITHER Noto Serif TC nor the
 * Android system font. Every half rating therefore rendered a literal tofu box
 * (★★★▯☆) on the primary score display of every reading.
 *
 * Instead: a muted track of five ★ with a filled copy clipped to `score/5` laid
 * over it. No font dependency, and it shows true fractions instead of snapping
 * to halves.
 */
export function StarRating({ score, indicatorLabel, color }: { score: number; indicatorLabel?: string; color?: string }) {
  const clamped = Math.max(0, Math.min(5, score));
  const row = '★★★★★';
  // Measured width of the track, so the filled copy can be laid out at its FULL
  // natural width and merely CLIPPED by the parent.
  //
  // ⚠️ The overlay Text must carry an explicit width. Clipping it with a
  // percentage-width parent alone makes RN re-lay-out the text to that narrower
  // box (letter-spacing and glyph advances shift), so the fill lands at the wrong
  // ratio — a 3.5 rendered as ≈2.3. Width comes from onLayout; until it arrives
  // the overlay stays hidden, which is one frame of the empty track at most.
  const [trackW, setTrackW] = useState(0);
  return (
    <View style={star.row}>
      {/*
        ⚠️ `accessible` is REQUIRED, not decoration. A View defaults to
        accessible=false, so without it the label is never announced and the
        screen reader falls through to the children — reading the literal
        「★★★★★」, and TWICE, since the track and the clipped fill are both
        present. Both Texts are therefore hidden; the wrapper speaks for them.
      */}
      <View accessible accessibilityRole="image" accessibilityLabel={`${clamped.toFixed(1)} / 5`}>
        <Text
          style={[star.stars, { color: colors.borderMedium }]}
          onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {row}
        </Text>
        {trackW > 0 ? (
          <View style={[star.clip, { width: (trackW * clamped) / 5 }]}>
            {/*
              ellipsizeMode="clip": onLayout can report a width a fraction under
              the Text's natural width (dp↔px rounding on Android), and the
              DEFAULT tail ellipsis would then render 「★★★…」 in gold rather than
              clipping the fill.
            */}
            <Text
              style={[star.stars, { color: color ?? colors.gold, width: trackW }]}
              numberOfLines={1}
              ellipsizeMode="clip"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {row}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={star.score}>{clamped.toFixed(1)}</Text>
      {indicatorLabel ? <Text style={star.indicator}>· {indicatorLabel}</Text> : null}
    </View>
  );
}

const star = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stars: { fontSize: fontSize.lg, lineHeight: fontSize.lg * 1.25, letterSpacing: 1 },
  clip: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  score: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  indicator: { fontSize: fontSize.sm, lineHeight: fontSize.sm * 1.45, color: colors.textSecondary },
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
  label: { fontSize: fontSize.sm, lineHeight: 21, color: colors.textSecondary, fontWeight: '600' },
  // tabular so a column of these (5 elements, 10 ten-gods) stops shifting per render
  value: { fontSize: fontSize.base, lineHeight: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  level: { fontSize: fontSize.xs, lineHeight: 17, color: colors.textMuted, fontWeight: '600' },
  // borderLight is ~1.14:1 — the UNFILLED remainder was invisible, so the bar read
  // as a floating stub with no 0–100 reference. ringTrack is the warm 1.40:1 token.
  track: { height: 8, backgroundColor: colors.ringTrack, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
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
  // Same split as Chip: the vivid cut carries the border and fill (decorative,
  // where it reads well) while the SCORE — the thing actually being read — gets an
  // AA-safe cut of the same hue. ALL THREE tones need it, not just neutral:
  // measured on their own 8% fills, success #4caf50 is 2.57:1 and error #f44336 is
  // 3.30:1, so both fail AA at the 20pt weight-800 this renders at.
  const toneColor = tone === 'positive' ? colors.success : tone === 'negative' ? colors.error : colors.gold;
  const toneText =
    tone === 'positive' ? colors.successText : tone === 'negative' ? colors.errorText : colors.metalText;
  const icon = tone === 'positive' ? '✓' : tone === 'negative' ? '✗' : '◆';
  return (
    <View style={[verdict.wrap, { borderColor: toneColor, backgroundColor: `${toneColor}14` }]}>
      <View style={verdict.top}>
        <View style={verdict.left}>
          <Text style={[verdict.icon, { color: toneColor }]}>{icon}</Text>
          <Text style={verdict.label}>{label}</Text>
        </View>
        {score != null ? (
          <Text style={[verdict.score, { color: toneText }]}>
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
  meta: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 24 },
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.md },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ruleHair },
  label: { fontSize: fontSize.sm, lineHeight: 24, color: colors.textMuted },
  value: {
    fontSize: fontSize.sm,
    lineHeight: 22,
    color: colors.textPrimary,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});

// ============================================================
// Chip / ChipGroup — pill tags
// ============================================================

export type ChipTone = 'neutral' | 'positive' | 'negative' | 'gold';

/**
 * Tone → { text, edge } . The text and border colours are deliberately DIFFERENT
 * for `gold`.
 *
 * `colors.gold` (#D4A017) measures ~2.4:1 as text on the 12%-alpha fill — it fails
 * even the 3:1 large-text floor, and the theme itself marks gold "DECORATIVE ONLY,
 * never as text on light bg". But this one `Chip` renders ~9 call sites across
 * career, annual/love and luck-period widgets, so the fix belongs here rather than
 * at each of them: keep gold for the border and fill (where it's decorative and
 * reads beautifully) and drop the LABEL to `metalText` (4.8:1+ on every ground it renders on).
 */
const CHIP_TONES: Record<ChipTone, { text: string; edge: string }> = {
  neutral: { text: colors.textSecondary, edge: colors.textSecondary },
  // Every tone splits, not just gold: on their own fills the vivid cuts measure
  // success 2.60:1 and error 3.34:1 at 15pt — the same failure diagnosed above.
  positive: { text: colors.successText, edge: colors.success },
  negative: { text: colors.errorText, edge: colors.error },
  gold: { text: colors.metalText, edge: colors.gold },
};

export function Chip({ label, tone = 'neutral' }: { label: string; tone?: ChipTone }) {
  const { text: fg, edge } = CHIP_TONES[tone];
  return (
    <View style={[chip.wrap, { borderColor: `${edge}55`, backgroundColor: `${edge}12` }]}>
      <Text style={[chip.text, { color: fg }]}>{label}</Text>
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
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  wrap: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: 4 },
  text: { fontSize: fontSize.sm, lineHeight: 21, fontWeight: '600' },
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
  line: { height: 14, borderRadius: 7, backgroundColor: colors.ruleHair, opacity: 0.7 },
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
    borderColor: colors.ruleHair,
    borderStyle: 'dashed',
  },
  lock: { fontSize: 24 },
  text: { fontSize: fontSize.sm, color: colors.textSecondary },
  cta: { fontSize: fontSize.base, fontWeight: '700', color: colors.red, marginTop: spacing.xs },
});
