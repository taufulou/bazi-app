/**
 * Design tokens ported from apps/web/app/globals.css (the canonical warm-cream
 * light theme). RN has no CSS variables, so these are a typed JS object consumed
 * via StyleSheet. Keep in sync with globals.css when the web tokens change.
 *
 * Design direction: premium / elegant / traditional Chinese. Warm palette
 * (reds, golds, ambers) on cream. Serif (Noto Serif TC) for headings/CJK.
 */

import { Platform, StyleSheet } from 'react-native';
import type { TextStyle } from 'react-native';

export const colors = {
  // Primary red
  red: '#E23D28',
  redDark: '#C4311F',
  redLight: '#F5564A',

  // Gold & warm accents — DECORATIVE ONLY, never as text on light bg (fails WCAG)
  gold: '#D4A017',
  goldLight: '#F5C842',
  amber: '#E8B86D',
  orange: '#F5A623',

  // Backgrounds
  bgPrimary: '#FFF3E0', // warm cream page background
  bgSecondary: '#FFFBF5',
  bgCard: '#FFFFFF',
  bgBannerWarm: '#FFF8F0',
  heroStart: '#E23D28',
  heroEnd: '#F5A623',

  // Text (WCAG-AA compliant on light bg)
  textPrimary: '#3C2415', // dark brown
  textSecondary: '#6B5940',
  textOnRed: '#FFFFFF',
  textOnGold: '#3C2415',
  textAccent: '#C41E3A', // crimson — section titles/emphasis
  /**
   * Was #8B7355 — measured 4.49:1 on white and 4.09:1 on cream, i.e. short of
   * WCAG AA while carrying nearly every label in the Bazi chart (row labels,
   * zodiac names, palace captions, 大運 years). Darkened to clear AA on BOTH
   * grounds: 5.61:1 on white, 5.11:1 on cream.
   */
  textMuted: '#7A6449',

  /**
   * 金 as TEXT. `elementColors.金` (#B8860B) is only 3.25:1 — fine for the 28pt
   * 干支 (large-text AA needs 3:1) but it fails at the 12–13pt used by 藏干.
   *
   * ⚠️ Measure against the ground it ACTUALLY renders on, not white. 藏干 sits on
   * `zebra` rows and on the `columnTint` 日柱 band, so an earlier #9A6F08 (4.51:1
   * on white) was only 4.37:1 and 4.23:1 there — i.e. still short of AA on the
   * exact cells this token exists for. This cut clears it on all three:
   * 5.11 white · 4.94 zebra · 4.79 columnTint.
   */
  metalText: '#8F6707',

  /**
   * Amber for WARNING TEXT. `colors.warning` (#ffc107) is a signal fill, not a text
   * colour — it measures 1.58:1 on bgSecondary, which made the 「點數不足」 message on
   * the spend-confirmation sheet effectively invisible. This cut is 4.78:1.
   */
  warningText: '#A16207',

  // Borders & shadows (shadow tuples split out below)
  borderLight: 'rgba(212, 160, 23, 0.15)',
  borderMedium: 'rgba(212, 160, 23, 0.3)',

  /**
   * Table furniture. `borderLight` composites to #F9F1DC on white — 1.13:1,
   * effectively invisible, which is why the chart grid read as floating text.
   * These sit just high enough to register as rules without shouting.
   */
  ruleHair: 'rgba(140, 110, 45, 0.20)', // 1.29:1 — row separators
  ruleHeader: 'rgba(140, 110, 45, 0.42)', // header underline
  zebra: '#FDFBF6', // alternating row tint
  columnTint: 'rgba(226, 61, 40, 0.045)', // 日柱 emphasis band
  /**
   * Warm track behind a coloured arc or bar fill (was a cold 6% black).
   * 0.26 alpha → 1.40:1. It was briefly 0.12, which is 1.16:1 — barely above the
   * 1.13:1 borderLight it replaced, so the swap was very nearly a no-op. A track
   * is a solid area rather than a hairline, so it can and should carry more
   * weight than `ruleHair`.
   */
  ringTrack: 'rgba(140, 110, 45, 0.26)',

  // Feature accents
  love: '#E91E63',
  loveBg: 'rgba(233, 30, 99, 0.15)',
  zwds: '#8B5CF6',
  zwdsBg: 'rgba(139, 92, 246, 0.08)',
  peachBlossom: '#C2185B',

  // Functional FILLS — vivid, for bars/rings/badges. Do not use as text.
  success: '#4caf50',
  warning: '#ffc107',
  error: '#f44336',
  info: '#2196f3',
  scoreGood: '#8bc34a',
  scorePoor: '#ff9800',

  /**
   * Functional TEXT — the same semantics at readable contrast.
   *
   * The vivid cuts above are signal fills and fail as type. On white: success
   * 2.78:1, error 3.68:1, gold 2.38:1 — all below the 4.5:1 AA needs at the sizes
   * these render at (12–18pt), and success and gold are below even the 3:1
   * large-text floor. Wherever a verdict word, score or tier label is being READ
   * rather than filled, use these.
   */
  successText: '#2A6B33', // 6.46:1 on white
  cautionText: '#96591D', // 5.61:1 on white — the amber/mid tier
  errorText: '#A63A25', // 5.89:1 on white

  // Subscription tier badges
  tierFreeText: '#757575',
  tierFreeBg: 'rgba(117, 117, 117, 0.12)',
  tierBasicText: '#1976D2',
  tierBasicBg: 'rgba(25, 118, 210, 0.10)',
  tierProText: '#7B1FA2',
  tierProBg: 'rgba(123, 31, 162, 0.10)',
  tierMasterText: '#B8860B',
  tierMasterBg: 'rgba(184, 134, 11, 0.12)',
  tierMasterBorder: '#D4A017',
} as const;

/** Five-element colors for the Bazi chart (darker, tuned for light bg). */
export const elementColors = {
  木: '#2E7D32', // wood — dark green
  火: '#D32F2F', // fire — dark red
  土: '#8D6E63', // earth — brown
  金: '#B8860B', // metal — dark gold
  水: '#1565C0', // water — dark blue
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16, // default card radius
  xl: 20,
  pill: 999,
} as const;

/**
 * 4px-based spacing scale.
 *
 * The original rungs (4/8/12/16/24/32) jump straight from 16 to 24 to 32,
 * leaving nothing for comfortable card padding (20) or major section breaks
 * (40/48) — so those got hand-written at call sites. The `lg2`/`xxl2`/`xxl3`
 * additions fill those gaps. Existing rungs are UNCHANGED: they are load-bearing
 * across ~700 call sites and shifting one would silently reflow the whole app.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  lg2: 20,
  xl: 24,
  xxl: 32,
  xxl2: 40,
  xxl3: 48,
} as const;

/**
 * RN shadow presets (mirrors --shadow-warm etc.). iOS uses shadow*, Android uses
 * elevation — both provided so a single spread works cross-platform.
 */
export const shadows = {
  warm: {
    shadowColor: '#E23D28',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  warmLg: {
    shadowColor: '#E23D28',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 32,
    elevation: 6,
  },
  gold: {
    shadowColor: '#D4A017',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 4,
  },
} as const;

/**
 * Font families. Registered by expo-font in src/theme/fonts.ts (Noto Serif TC)
 * for headings + CJK; `sans` falls back to the system font.
 *
 * ⚠️ React Native does NOT synthesize weight for custom fonts — every loaded face
 * is its OWN family. So the REGULAR family + `fontWeight: '700'` silently renders
 * REGULAR — you must name the bold family (`serifBold`) instead. (This bug hid in
 * 106 of 109 serif usages and made the whole app read thinner than the web.)
 */
export const fonts = {
  /** Regular (400) serif — for body-weight serif only. */
  serif: 'NotoSerifTC',
  /** Bold (700) serif — a SEPARATE family, not a weight of `serif`. */
  serifBold: 'NotoSerifTC_Bold',
  /** System font (iOS PingFang / Android Noto Sans CJK). Real `fontWeight` DOES work here. */
  sans: undefined,
} as const;

/**
 * Type scale, aligned to Apple's iOS HIG (the reference users' eyes are calibrated
 * to; Material 3 is close enough that one scale serves Android too):
 *
 *   Caption 12 · Footnote 13 · Subhead 15 · Callout 16 · Body 17
 *   Title3 20 · Title2 22 · Title1 28 · LargeTitle 34
 *
 * ⚠️ CJK rule: Chinese glyphs are much denser than Latin at the same point size,
 * so CJK text sits at the TOP of these ranges, never the bottom (Apple's own
 * Chinese apps run PingFang at 17pt body). Do NOT copy the web's px values here —
 * web CSS px ≠ native pt; mirror the web's HIERARCHY, not its absolute numbers.
 *
 * `base` and `sm` were 16/14 — one step below Apple's Body/Subhead — while carrying
 * the bulk of the app's text (115 + 176 usages). Raised to 17/15.
 * `xs` stays 12: audited, and its ~100 usages are genuinely caption-class
 * (disclaimers, badges, tags, units, micro-notes). Keep it that way.
 */
export const fontSize = {
  xs: 12, // Caption — captions/badges/units ONLY, never prose
  sm: 15, // Subhead — secondary prose
  base: 17, // Body — primary prose
  lg: 18,
  xl: 20, // Title 3
  xxl: 24,
  title: 28, // Title 1
  hero: 34, // Large Title
} as const;

/**
 * Line-height multipliers. CJK needs looser leading than Latin (1.5–1.7 vs ~1.4)
 * because the glyphs are dense and full-width. Use these instead of hardcoding:
 *   lineHeight: fontSize.sm * lineHeightRatio.prose
 */
export const lineHeightRatio = {
  /** Running prose / paragraphs. Matches `text.body` (17 → 28). */
  prose: 1.65,
  /** Compact multi-line text (card descriptions, list subtitles). */
  tight: 1.45,
} as const;

/**
 * VERTICAL RHYTHM for long-form content (AI narration, deterministic prose cards).
 *
 * Space encodes grouping, so these values are deliberately UNEQUAL. The gap before
 * a heading must be much larger than the gap after it — otherwise the heading sits
 * equidistant between the group it ends and the group it begins, the reader gets no
 * grouping signal, and consecutive sections read as one undifferentiated mass.
 *
 * That was measured on device before this existed: 30px above a sub-heading versus
 * 22px below it (1.36 : 1, i.e. effectively uniform) — which is exactly what
 * "everything squeezed together" looked like. `section : afterHeading` is ~3 : 1.
 *
 * Use these instead of reaching for `spacing.*` when laying out prose.
 */
export const rhythm = {
  /** Before a heading — a real break between sections. */
  section: 32,
  /** After a heading — binds it to the content it introduces. */
  afterHeading: 10,
  /** Between sibling paragraphs or lists inside one section. */
  block: 16,
  /** Within a tightly-bound pair (a label and its value). */
  tight: 8,
} as const;

/**
 * Letter-spacing (tracking). ⚠️ RN takes POINTS, not em — so an em intent has to
 * be multiplied by the font size at the point of use. The `text` presets below
 * already bake that in; these raw values are for one-off cases.
 */
export const tracking = {
  tight: -0.02, // × fontSize — large display type
  normal: 0,
  wide: 0.04, // × fontSize — labels
  caps: 0.1, // × fontSize — uppercase / spaced ornaments
} as const;

/**
 * Card surface, platform-split.
 *
 * Android's `elevation` renders a NEUTRAL GREY shadow — it cannot take a colour
 * — so pairing a warm `shadowColor` with `elevation: 3` gave iOS the intended
 * warm lift and Android a muddy grey one on cream. Here Android drops to a
 * near-flat elevation and gets definition from a warm hairline instead, which
 * reads cleaner on a cream ground than any grey shadow.
 *
 * Spread this INSTEAD of `...shadows.warm` on cards. `shadows.warm` is left
 * untouched so existing consumers don't shift.
 */
export const surfaces = {
  card: Platform.select({
    ios: {
      backgroundColor: colors.bgCard,
      shadowColor: '#E23D28',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 20,
    },
    default: {
      backgroundColor: colors.bgCard,
      elevation: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(140, 110, 45, 0.22)',
    },
  }),
} as const;

/**
 * TEXT ROLES — the load-bearing token.
 *
 * Rationale: the app had 589 raw `fontSize` declarations and only 87 that also
 * set `lineHeight`. Everything else inherited RN's font-metric default, which is
 * derived from Latin metrics and far too tight for full-width CJK glyphs — the
 * single largest reason dense screens (the Bazi chart above all) read as cheap.
 *
 * A token that describes ONE property lets every call site re-decide leading, and
 * 85% of them decided wrong by omission. So these presets carry size + family +
 * weight + leading + tracking TOGETHER: pick a role, not five numbers, so that
 * WHERE ADOPTED it becomes impossible to ship unleaded CJK by forgetting.
 * (Adoption is partial — BaziChart is fully migrated; other surfaces still
 * declare raw sizes and were leaded by hand in the same pass.)
 *
 * Usage:  <Text style={[text.section, { color: colors.textAccent }]}>
 *
 * ⚠️ Serif roles name `fonts.serifBold` explicitly — RN does NOT synthesize
 * weight for custom fonts, so `fonts.serif` + fontWeight:'700' silently renders
 * Regular. The `fontWeight` on those roles is belt-and-braces for the fallback
 * face only; the FAMILY is what actually does the work.
 */
const asTextStyles = <T extends Record<string, TextStyle>>(o: T) => o;

export const text = asTextStyles({
  /** Hero numerals / page-level display. 34 · 1.25 · −0.02em */
  display: {
    fontFamily: fonts.serifBold,
    fontSize: 34,
    lineHeight: 43,
    letterSpacing: -0.7,
    fontWeight: '700',
  },
  /** Card titles. 24 · 1.3 · −0.01em */
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 24,
    lineHeight: 31,
    letterSpacing: -0.24,
    fontWeight: '700',
  },
  /** Section headings inside a card (五行能量, 日主分析). 19 · 1.4 · +0.01em */
  section: {
    fontFamily: fonts.serifBold,
    fontSize: 19,
    lineHeight: 27,
    letterSpacing: 0.19,
    fontWeight: '700',
  },
  /** Primary running prose. 17 · 1.65 — CJK needs the loose leading. */
  body: { fontSize: 17, lineHeight: 28 },
  /** Compact prose: card descriptions, list subtitles. 15 · 1.5 */
  bodyTight: { fontSize: 15, lineHeight: 23 },
  /** Field labels, table row labels. 13 · 1.4 · +0.04em */
  label: { fontSize: 13, lineHeight: 18, letterSpacing: 0.52, fontWeight: '600' },
  /**
   * Captions, units, micro-notes. 12 · 1.45 · +0.02em — the floor for PROSE.
   * Dense tabular cells (神煞 pills, 藏干 ten-god, 納音, 大運 years) run 11 with an
   * explicit lineHeight; 11 is the hard minimum for CJK, never below.
   */
  caption: { fontSize: 12, lineHeight: 17, letterSpacing: 0.24 },
  /** Any column of digits. Tabular so values stop shifting between renders. */
  data: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  /** Smaller tabular figures (percentages under rings, year ranges). */
  dataSmall: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  /**
   * 干支 characters — the emotional centre of the chart. Raised 24 → 28: they
   * previously sat at the same visual weight as a section heading despite being
   * the thing the whole page is about.
   */
  ganzhi: {
    fontFamily: fonts.serifBold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: 0.56,
    fontWeight: '700',
  },
});

export const theme = {
  colors,
  elementColors,
  radius,
  spacing,
  rhythm,
  shadows,
  surfaces,
  fonts,
  fontSize,
  text,
  tracking,
  /** Exported at last — was defined and documented but unreachable via `theme`. */
  leading: lineHeightRatio,
} as const;

export type Theme = typeof theme;
export default theme;
