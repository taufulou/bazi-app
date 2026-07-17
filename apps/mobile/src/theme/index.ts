/**
 * Design tokens ported from apps/web/app/globals.css (the canonical warm-cream
 * light theme). RN has no CSS variables, so these are a typed JS object consumed
 * via StyleSheet. Keep in sync with globals.css when the web tokens change.
 *
 * Design direction: premium / elegant / traditional Chinese. Warm palette
 * (reds, golds, ambers) on cream. Serif (Noto Serif TC) for headings/CJK.
 */

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
  textMuted: '#8B7355',

  // Borders & shadows (shadow tuples split out below)
  borderLight: 'rgba(212, 160, 23, 0.15)',
  borderMedium: 'rgba(212, 160, 23, 0.3)',

  // Feature accents
  love: '#E91E63',
  loveBg: 'rgba(233, 30, 99, 0.15)',
  zwds: '#8B5CF6',
  zwdsBg: 'rgba(139, 92, 246, 0.08)',
  peachBlossom: '#C2185B',

  // Functional (do not theme-swap)
  success: '#4caf50',
  warning: '#ffc107',
  error: '#f44336',
  info: '#2196f3',
  scoreGood: '#8bc34a',
  scorePoor: '#ff9800',

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
} as const;

/** 4px-based spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
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
  /** Running prose / paragraphs. */
  prose: 1.6,
  /** Compact multi-line text (card descriptions, list subtitles). */
  tight: 1.45,
} as const;

export const theme = {
  colors,
  elementColors,
  radius,
  spacing,
  shadows,
  fonts,
  fontSize,
} as const;

export type Theme = typeof theme;
export default theme;
