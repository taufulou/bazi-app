import { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, radius, spacing, fonts, surfaces, text as T } from '../theme';
import { useZh } from '../lib/language';
import { ElementExplanation, type ElementClickInfo } from './ElementExplanation';
import { extractGodRoles, extractFourPillars } from '../lib/element-explanation-api';
import type { BaziChartData, PillarData } from '../lib/bazi-types';

// ── Constants (ported verbatim from web BaziChart) ──
const CHART_ELEMENT_COLORS: Record<string, string> = {
  木: '#2E7D32',
  火: '#D32F2F',
  土: '#8D6E63',
  金: '#B8860B',
  水: '#1565C0',
};
const getChartElementColor = (el: string) => CHART_ELEMENT_COLORS[el] || '#8D6E63';

/**
 * Element colour for SMALL text (≤14pt). 金 #B8860B is only 3.25:1 on white —
 * fine for the 28pt 干支 (large-text AA needs 3:1) but failing everywhere it's
 * used at 12–13pt, i.e. 藏干. Swap in the darker cut there only, so the display
 * characters keep their brightness.
 */
const getChartElementTextColor = (el: string) =>
  el === '金' ? colors.metalText : getChartElementColor(el);

/**
 * 神煞 tone, for the in-table pills.
 *
 * ⚠️ DOCTRINAL — worth a Bazi-master pass before shipping to users. The lists are
 * deliberately conservative: only unambiguous cases are tinted, and anything not
 * matched falls through to neutral rather than being guessed at. 桃花 and 驛馬 are
 * left NEUTRAL on purpose — both are read as favourable or unfavourable depending
 * on context, so colouring them either way would assert more than the chart knows.
 */
const SHENSHA_AUSPICIOUS = [
  '天德', '月德', '天德合', '月德合', '文昌', '將星', '天喜', '紅鸞',
  '金輿', '太極貴人', '福星貴人', '德秀貴人', '天廚貴人', '天乙貴人', '國印',
];
const SHENSHA_INAUSPICIOUS = [
  '劫煞', '羊刃', '勾絞煞', '亡神', '孤辰', '寡宿', '元辰', '血刃',
  '白虎', '喪門', '弔客', '披麻', '災煞', '大耗',
];
type ShenShaTone = 'auspicious' | 'inauspicious' | 'neutral';
const shenShaTone = (name: string): ShenShaTone => {
  if (SHENSHA_AUSPICIOUS.some((s) => name.includes(s))) return 'auspicious';
  if (SHENSHA_INAUSPICIOUS.some((s) => name.includes(s))) return 'inauspicious';
  // Generic 貴人 catch-all, after the specific names above.
  if (name.includes('貴人')) return 'auspicious';
  return 'neutral';
};

/** How many 神煞 to show per cell before collapsing behind a “＋N” control. */
const SHENSHA_COLLAPSE_AT = 3;

/** 大運 card stride — fixed so the current-period autoscroll can be computed. */
const LUCK_CARD_W = 104;
const LUCK_GAP = spacing.sm;

const BRANCH_ZODIAC: Record<string, string> = {
  子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龍', 巳: '蛇',
  午: '馬', 未: '羊', 申: '猴', 酉: '雞', 戌: '狗', 亥: '豬',
};
const STRENGTH_LABELS: Record<string, string> = {
  very_weak: '極弱', weak: '偏弱', neutral: '中和', strong: '偏強', very_strong: '極強',
};
const STEM_ELEMENT: Record<string, string> = {
  甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水',
};
const getStemElement = (s: string) => STEM_ELEMENT[s] || '土';
const PILLAR_LABELS: Record<string, string> = { year: '年柱', month: '月柱', day: '日柱', hour: '時柱' };
const HINT_KEY = 'bazi_element_hint_shown';

/**
 * Ring geometry — DERIVED FROM WINDOW WIDTH, not a fixed constant.
 *
 * ⚠️ WIDTH BUDGET. Five rings plus four gaps must fit the width available INSIDE
 * this card, which is:
 *     screenWidth − 48 (page padding, spacing.xl × 2) − 40 (card padding, lg2 × 2)
 *
 * An earlier pass hardcoded 68 against a mis-remembered budget: 5 × 68 = 340 blew
 * past the 323dp available on a 411dp screen, flexbox shrank the wrappers, and
 * because the `<Svg>` and its label do NOT shrink with them the arcs clipped and
 * the percentages burst out through the stroke — which is what read as
 * "unbalanced". Hardcoding 56 fixed the 411dp case but still overflowed by 8dp on
 * a 360dp phone (a very common Android width), and `flexShrink: 0` below means it
 * would overflow VISIBLY rather than squeeze.
 *
 * So compute it: cap at RING_BOX_MAX where there's room, shrink to fit where
 * there isn't. `useRingGeometry` returns everything the SVG needs.
 */
const RING_BOX_MAX = 56;
const RING_GAP_MIN = 8;
/** Page padding (spacing.xl × 2) + card padding (spacing.lg2 × 2). */
const RING_ROW_CHROME = 48 + 40;

function useRingGeometry(windowWidth: number) {
  return useMemo(() => {
    const usable = windowWidth - RING_ROW_CHROME;
    const box = Math.max(
      40, // hard floor — below this the element glyph stops being legible
      Math.min(RING_BOX_MAX, Math.floor((usable - RING_GAP_MIN * 4) / 5)),
    );
    const stroke = box >= 52 ? 6 : 5;
    const radius = box / 2 - stroke / 2 - 1;
    return { box, stroke, radius, circumference: 2 * Math.PI * radius };
  }, [windowWidth]);
}
const ELEMENT_ORDER = ['木', '火', '土', '金', '水'] as const;

// Contextual message shown between staged-reveal stages (mirrors web BaziChart
// REVEAL_MESSAGES). Keyed by the number of already-revealed sections.
const REVEAL_MESSAGES: Record<number, string> = {
  1: '正在排列四柱…',
  2: '正在分析五行能量…',
  3: '正在解讀日主強弱…',
  4: '正在推算大運走勢…',
  5: '正在排列神煞…',
};

type PillarKey = 'year' | 'month' | 'day' | 'hour';

interface BaziChartProps {
  data: BaziChartData;
  name?: string;
  birthDate?: string;
  isSubscriber?: boolean;
  gender?: string;
  /**
   * Staged-reveal gate (0-6). When set, only the first `visibleSections` chart
   * sub-sections render (0=header, 1=pillars, 2=五行, 3=日主, 4=大運, 5=神煞).
   * Undefined = show everything immediately (no reveal). Mirrors web
   * BaziChart `visibleSections`.
   */
  visibleSections?: number;
}

export default function BaziChart({
  data,
  name,
  birthDate,
  isSubscriber = false,
  gender = 'male',
  visibleSections,
}: BaziChartProps) {
  const zh = useZh();
  const revealing = visibleSections !== undefined;
  const isVisible = (n: number) => visibleSections === undefined || visibleSections > n;
  const [selected, setSelected] = useState<ElementClickInfo | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  /** Per-pillar 神煞 expansion — cells collapse past SHENSHA_COLLAPSE_AT. */
  const [shenShaOpen, setShenShaOpen] = useState<Record<string, boolean>>({});
  const luckScrollRef = useRef<ScrollView>(null);
  /** 大運 autoscroll must run once, not on every layout pass. */
  const didAutoScrollRef = useRef(false);
  const { width: windowWidth } = useWindowDimensions();
  const ring = useRingGeometry(windowWidth);

  useEffect(() => {
    AsyncStorage.getItem(HINT_KEY).then((v) => {
      if (!v) setShowHint(true);
    });
  }, []);

  const godRoles = useMemo(() => extractGodRoles(data), [data]);
  const fourPillars = useMemo(() => extractFourPillars(data), [data]);

  const fp = data.fourPillars;
  const hourUnknown = !fp.hour?.stem;
  // Rendered left→right: 時 / 日 / 月 / 年 (reverse of the data object order).
  const pillars: { label: string; key: PillarKey; p: PillarData }[] = [
    { label: '時柱', key: 'hour', p: fp.hour },
    { label: '日柱', key: 'day', p: fp.day },
    { label: '月柱', key: 'month', p: fp.month },
    { label: '年柱', key: 'year', p: fp.year },
  ];

  const openSheet = (info: ElementClickInfo) => {
    if (showHint) {
      setShowHint(false);
      AsyncStorage.setItem(HINT_KEY, '1').catch(() => {});
    }
    setSelected(info);
    setSheetOpen(true);
  };

  // 空亡 branches are usually absent from the chart, but when one coincides with a
  // natal pillar branch, Layer B (paid) is pillar-specific — match it (default 日柱).
  const pillarForBranch = (branch: string): { key: PillarKey; label: string } => {
    for (const col of pillars) {
      if (col.p.branch === branch) return { key: col.key, label: col.label };
    }
    return { key: 'day', label: '日柱' };
  };

  const dm = data.dayMaster;

  /**
   * Identity line for the masthead: 「1987-09-06 · 男 · 兔年生」.
   * Composed rather than concatenated at the call site so the separators stay
   * consistent when any part is missing (a chart with no birthDate still reads
   * cleanly), and so 時辰未知 lands as its own segment instead of a parenthetical
   * bolted onto the date.
   */
  const metaLine = [
    birthDate,
    // Drop out of the line entirely rather than assert a sex we weren't given.
    gender === 'female' ? zh('女') : gender === 'male' ? zh('男') : null,
    fp.year?.branch && BRANCH_ZODIAC[fp.year.branch]
      ? `${zh(BRANCH_ZODIAC[fp.year.branch])}${zh('年生')}`
      : null,
    hourUnknown ? zh('時辰未知') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.wrapper}>
      {/* 時辰未知: beginner-friendly basis line (load-bearing UX — CLAUDE.md). */}
      {hourUnknown ? (
        <Text style={styles.basisLine}>
          {zh(
            '由於未提供出生時辰，本命盤只用「年、月、日」推算，約可掌握七成。與時辰有關的內容（出生那個時辰、子女運、晚年運等）暫不顯示。',
          )}
        </Text>
      ) : null}
      {showHint ? <Text style={styles.hint}>💡 {zh('點擊任意欄位查看解讀')}</Text> : null}

      {/*
        Chart card — the masthead and the pillars table are ONE object.

        They used to be three disconnected pieces describing one chart: a floating
        gradient banner, a line of muted grey text on the page background, then a
        separate white card. The identity line read as an afterthought precisely
        because it belonged to nothing — so it now sits ON the gradient in white,
        which is both the premium treatment and the honest structural relationship.

        ⚠️ The gradient has to be clipped to the card radius, but `overflow:hidden`
        sets clipsToBounds/masksToBounds on iOS, which ALSO clips the view's own
        shadow. So the shadow and the clip cannot live on the same node: the outer
        View carries the elevation, the inner one does the clipping.
      */}
      {isVisible(1) ? (
      <View style={styles.chartCard}>
      <View style={styles.chartClip}>
        <LinearGradient
          colors={[colors.heroStart, colors.heroEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.chartHeader}
        >
          <Text style={styles.headerEyebrow}>◆ {zh('八字命格')} ◆</Text>
          {name ? <Text style={styles.headerName}>{zh(name)}</Text> : null}
          {metaLine ? <Text style={styles.headerMeta}>{metaLine}</Text> : null}
        </LinearGradient>
        {/* header row */}
        <View style={styles.headRow}>
          <View style={styles.labelCell} />
          {pillars.map((col) => (
            <View
              key={col.key}
              style={[styles.pillarHead, col.key === 'day' && styles.pillarHeadDay]}
            >
              <Text style={styles.pillarHeadText}>{zh(col.label)}</Text>
            </View>
          ))}
        </View>

        {/* 十神 */}
        <GridRow label="十神">
          {pillars.map((col) =>
            col.key === 'day' ? (
              <Cell key={col.key} highlight>
                <Text style={styles.dayYuan}>{zh('日元')}</Text>
              </Cell>
            ) : (
              <ClickCell
                key={col.key}
                onPress={() =>
                  openSheet({ elementType: 'ten_god', value: col.p.tenGod || '', pillar: col.key, pillarLabel: col.label })
                }
              >
                <Text style={styles.cellText}>{col.p.tenGod ? zh(col.p.tenGod) : '—'}</Text>
              </ClickCell>
            ),
          )}
        </GridRow>

        {/* 天干地支 */}
        <GridRow label="天干地支" zebra>
          {pillars.map((col) => {
            if (col.key === 'hour' && hourUnknown) {
              return (
                <Cell key={col.key}>
                  <Text style={styles.unknownStem}>{zh('時辰')}</Text>
                  <Text style={styles.unknownStem}>{zh('未知')}</Text>
                </Cell>
              );
            }
            return (
              <Cell key={col.key} highlight={col.key === 'day'}>
                <Pressable
                  onPress={() =>
                    openSheet({ elementType: 'stem', value: col.p.stem, pillar: col.key, pillarLabel: col.label })
                  }
                  accessibilityRole="button"
                >
                  <Text style={[styles.ganZhi, { color: getChartElementColor(col.p.stemElement) }]}>{col.p.stem}</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    openSheet({ elementType: 'branch', value: col.p.branch, pillar: col.key, pillarLabel: col.label })
                  }
                  accessibilityRole="button"
                >
                  <Text style={[styles.ganZhi, { color: getChartElementColor(col.p.branchElement) }]}>{col.p.branch}</Text>
                </Pressable>
                {BRANCH_ZODIAC[col.p.branch] ? (
                  <Text style={styles.zodiac}>{zh(BRANCH_ZODIAC[col.p.branch])}</Text>
                ) : null}
              </Cell>
            );
          })}
        </GridRow>

        {/*
          藏干 — deliberate two-line form. Previously rendered as
          `庚金（食神）` on one line at 12pt, which wrapped INSIDE the parenthesis
          (`庚金（食` / `神）`) in a cell ~90dp wide. Splitting stem+element from
          the ten-god removes the break, halves the visual noise, and makes the
          row height predictable.
        */}
        <GridRow label="藏干">
          {pillars.map((col) => {
            const hsg = col.p.hiddenStemGods;
            return (
              <Cell key={col.key} highlight={col.key === 'day'}>
                {hsg && hsg.length ? (
                  hsg.map((h, i) => (
                    <Pressable
                      key={i}
                      onPress={() =>
                        openSheet({ elementType: 'hidden_stem', value: h.stem, pillar: col.key, pillarLabel: col.label })
                      }
                      accessibilityRole="button"
                      style={[styles.hiddenStemGroup, i > 0 && styles.hiddenStemGroupGap]}
                    >
                      <Text
                        style={[
                          styles.hiddenStem,
                          { color: getChartElementTextColor(h.element) },
                          // 本氣 (first) carries full weight; 中氣/餘氣 recede via
                          // size+colour rather than the old opacity dimming, which
                          // pushed them below readable contrast.
                          i > 0 && styles.hiddenStemMinor,
                        ]}
                      >
                        {h.stem}
                        {h.element}
                      </Text>
                      <Text style={styles.hiddenStemGod}>{zh(h.tenGod)}</Text>
                    </Pressable>
                  ))
                ) : (col.p.hiddenStems || []).length ? (
                  col.p.hiddenStems.map((s, i) => (
                    <Text
                      key={i}
                      style={[styles.hiddenStem, { color: getChartElementTextColor(STEM_ELEMENT[s] || '') }]}
                    >
                      {s}
                      {STEM_ELEMENT[s] || ''}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.cellText}>—</Text>
                )}
              </Cell>
            );
          })}
        </GridRow>

        {/* 十二運 (only if present) */}
        {fp.year.lifeStage ? (
          <GridRow label="十二運" zebra>
            {pillars.map((col) => (
              <ClickCell
                key={col.key}
                highlight={col.key === 'day'}
                onPress={() =>
                  openSheet({ elementType: 'life_stage', value: col.p.lifeStage || '', pillar: col.key, pillarLabel: col.label })
                }
              >
                <Text style={styles.cellText}>{col.p.lifeStage ? zh(col.p.lifeStage) : '—'}</Text>
              </ClickCell>
            ))}
          </GridRow>
        ) : null}

        {/* 納音 */}
        <GridRow label="納音">
          {pillars.map((col) => (
            <ClickCell
              key={col.key}
              highlight={col.key === 'day'}
              onPress={() => openSheet({ elementType: 'nayin', value: col.p.naYin, pillar: col.key, pillarLabel: col.label })}
            >
              <Text style={styles.cellSmall}>{zh(col.p.naYin)}</Text>
            </ClickCell>
          ))}
        </GridRow>

        {/*
          神煞 — pills, matching the treatment the SAME data already gets in the
          「神煞 & 空亡」 card lower down. Previously this was six-plus items of bare
          crimson text per column, which read as a wall rather than a set, and gave
          auspicious and inauspicious markers identical emphasis. Cells collapse
          past SHENSHA_COLLAPSE_AT so one busy pillar can't dominate the table.
        */}
        <GridRow label="神煞" zebra>
          {pillars.map((col) => {
            const list = col.p.shenSha || [];
            const open = shenShaOpen[col.key];
            const shown = open ? list : list.slice(0, SHENSHA_COLLAPSE_AT);
            const hidden = list.length - shown.length;
            return (
              <Cell key={col.key} highlight={col.key === 'day'}>
                {list.length ? (
                  <>
                    {shown.map((s, i) => {
                      const tone = shenShaTone(s);
                      return (
                        <Pressable
                          key={i}
                          onPress={() => openSheet({ elementType: 'shensha', value: s, pillar: col.key, pillarLabel: col.label })}
                          accessibilityRole="button"
                          hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                          style={[styles.shenShaPill, styles[`pill_${tone}`]]}
                        >
                          <Text style={[styles.shenShaPillText, styles[`pillText_${tone}`]]}>{zh(s)}</Text>
                        </Pressable>
                      );
                    })}
                    {hidden > 0 ? (
                      <Pressable
                        onPress={() => setShenShaOpen((p) => ({ ...p, [col.key]: true }))}
                        accessibilityRole="button"
                        accessibilityLabel={`${zh('顯示其餘')} ${hidden} ${zh('個神煞')}`}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                        style={styles.shenShaMore}
                      >
                        <Text style={styles.shenShaMoreText}>＋{hidden}</Text>
                      </Pressable>
                    ) : null}
                    {open && list.length > SHENSHA_COLLAPSE_AT ? (
                      <Pressable
                        onPress={() => setShenShaOpen((p) => ({ ...p, [col.key]: false }))}
                        accessibilityRole="button"
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                        style={styles.shenShaMore}
                      >
                        <Text style={styles.shenShaMoreText}>{zh('收合')}</Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.cellText}>—</Text>
                )}
              </Cell>
            );
          })}
        </GridRow>
      </View>
      </View>
      ) : null}

      {/* Extra palaces */}
      {isVisible(1) && (data.mingGong || data.shenGong || data.taiYuan || data.taiXi) ? (
        <View style={styles.palaceRow}>
          {([
            ['命宮', data.mingGong],
            ['身宮', data.shenGong],
            ['胎元', data.taiYuan],
            ['胎息', data.taiXi],
          ] as const)
            .filter(([, p]) => !!p)
            .map(([label, p]) => (
              <View key={label} style={styles.palaceCard}>
                <Text style={styles.palaceLabel}>{zh(label)}</Text>
                <Text style={styles.palaceGz}>
                  {p!.stem}
                  {p!.branch}
                </Text>
                <Text style={styles.palaceNayin}>{zh(p!.naYin)}</Text>
              </View>
            ))}
        </View>
      ) : null}

      {/* 旺相休囚死 */}
      {isVisible(1) && data.seasonalStates ? (
        <View style={styles.seasonalRow}>
          {Object.entries(data.seasonalStates).map(([element, state]) => (
            <Pressable
              key={element}
              testID={`seasonal-${element}`}
              style={styles.seasonalTag}
              onPress={() => openSheet({ elementType: 'seasonal_state', value: state, pillar: 'month', pillarLabel: '月柱' })}
              accessibilityRole="button"
            >
              <Text style={[styles.seasonalElement, { color: getChartElementColor(element) }]}>{element}</Text>
              <Text style={styles.seasonalState}>{zh(state)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Five-elements rings */}
      {isVisible(2) && data.fiveElementsBalanceZh ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{zh('五行能量')}</Text>
          <View style={styles.ringRow}>
            {ELEMENT_ORDER.map((el) => {
              const pct = data.fiveElementsBalanceZh?.[el] ?? 0;
              const c = ring.box / 2;
              return (
                // The element glyph sits inside the ring; the percentage sits
                // BELOW it. Both were briefly inside — but a 5-character string
                // like «38.6%» needs ~31dp and the inner circle is only 44dp
                // across, so at this ring size the number crowded the stroke and
                // then overflowed it outright once the boxes were squeezed.
                // One glyph inside, the number as a caption beneath: nothing can
                // overflow, and tight spacing keeps them reading as one unit.
                <View key={el} style={styles.ringItem}>
                  <View style={[styles.ringWrap, { width: ring.box, height: ring.box }]}>
                    <Svg
                      width={ring.box}
                      height={ring.box}
                      viewBox={`0 0 ${ring.box} ${ring.box}`}
                      style={StyleSheet.absoluteFill}
                    >
                      <Circle
                        cx={c}
                        cy={c}
                        r={ring.radius}
                        stroke={colors.ringTrack}
                        strokeWidth={ring.stroke}
                        fill="none"
                      />
                      <Circle
                        cx={c}
                        cy={c}
                        r={ring.radius}
                        stroke={getChartElementColor(el)}
                        strokeWidth={ring.stroke}
                        fill="none"
                        strokeDasharray={ring.circumference}
                        strokeDashoffset={ring.circumference * (1 - pct / 100)}
                        strokeLinecap="round"
                        transform={`rotate(-90 ${c} ${c})`}
                      />
                    </Svg>
                    <Text style={[styles.ringChar, { color: getChartElementColor(el) }]}>{el}</Text>
                  </View>
                  <Text style={styles.ringPct}>{pct.toFixed(1)}%</Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Day master card */}
      {isVisible(3) && dm ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{zh('日主分析')}</Text>
          {/*
            Three stat columns, label directly above its value.

            This was three full-width rows with the label hard left and the value
            hard right — so far apart that the eye couldn't pair them, and the
            right-alignment was optically WRONG as well as loose: 「戊（土陽）」 and
            「偏弱（39分）」 end in a full-width 「）」, whose glyph fills only the left
            half of its em box, while 「食神格」 ends in a solid glyph. Their layout
            boxes aligned perfectly at x=964 while their ink edges differed by half
            an em, which is exactly why 格局 looked like it didn't line up.

            Stacking label over value fixes both at once: the pairing is immediate,
            and centred columns make trailing-punctuation width irrelevant.
          */}
          <View style={styles.dmStats}>
            <DmStat
              label="日主"
              value={data.dayMasterStem ?? '—'}
              sub={`${dm.element}${zh(dm.yinYang)}`}
              color={getChartElementColor(dm.element)}
            />
            <View style={styles.dmDivider} />
            <DmStat
              label="旺衰"
              value={zh(STRENGTH_LABELS[dm.strength] || dm.strength)}
              sub={`${dm.strengthScore} ${zh('分')}`}
            />
            <View style={styles.dmDivider} />
            <DmStat label="格局" value={zh(dm.pattern || '—')} />
          </View>
          {/*
            strength bar — was white 10pt on saturated Material green/orange,
            measuring 2.10:1 and 2.03:1 against a 4.5:1 requirement. Now dark ink
            on light tints of the same hues: >9:1, on-palette against cream, and
            the label sits at 13pt instead of 10.
          */}
          <View style={styles.strengthBar}>
            <View style={[styles.strengthSame, { flex: Math.max(dm.sameParty, 1) }]}>
              <Text style={styles.strengthBarText} numberOfLines={1}>
                {zh('同黨')} {Math.round(dm.sameParty)}%
              </Text>
            </View>
            <View style={[styles.strengthOpp, { flex: Math.max(dm.oppositeParty, 1) }]}>
              <Text style={styles.strengthBarText} numberOfLines={1}>
                {zh('異黨')} {Math.round(dm.oppositeParty)}%
              </Text>
            </View>
          </View>
          <View style={styles.godsRow}>
            {([
              ['喜神', dm.favorableGod],
              ['用神', dm.usefulGod],
              ['閒神', dm.idleGod],
              ['忌神', dm.tabooGod],
              ['仇神', dm.enemyGod],
            ] as const).map(([label, val]) => (
              <View key={label} style={styles.godTag}>
                <Text style={styles.godLabel}>{zh(label)}</Text>
                <Text style={[styles.godVal, { color: getChartElementColor(val) }]}>{val || '—'}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Luck periods */}
      {isVisible(4) && data.luckPeriods && data.luckPeriods.length ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{zh('大運')}</Text>
          {/*
            The strip used to hard-clip the 4th card at the container edge with no
            fade and no indicator, so it read as a layout defect rather than an
            invitation — and with eight periods most users never scrolled. Now the
            current period is scrolled into view on mount and a trailing fade marks
            the overflow.
          */}
          <View style={styles.luckViewport}>
            <ScrollView
              ref={luckScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.luckRow}
              // onContentSizeChange, NOT onLayout: onLayout reports the frame
              // before contentSize is known, so scrollTo can clamp to 0 (seen on
              // Android). The ref makes it fire once — otherwise any later layout
              // pass yanks a user who had scrolled manually back to the present.
              onContentSizeChange={() => {
                if (didAutoScrollRef.current) return;
                const idx = data.luckPeriods?.findIndex((lp) => lp.isCurrent) ?? -1;
                if (idx > 0) {
                  didAutoScrollRef.current = true;
                  // Land the current card one slot in from the left so the
                  // preceding period stays visible as context.
                  luckScrollRef.current?.scrollTo({
                    x: Math.max(0, (idx - 1) * (LUCK_CARD_W + LUCK_GAP)),
                    animated: false,
                  });
                }
              }}
            >
              {data.luckPeriods.map((lp, i) => (
                <View key={i} style={[styles.luckCard, lp.isCurrent && styles.luckCardCurrent]}>
                  <Text style={styles.luckAge}>
                    {lp.startAge}–{lp.endAge}
                    {zh('歲')}
                  </Text>
                  <Text style={styles.luckYear}>
                    {lp.startYear}–{lp.endYear}
                  </Text>
                  <Text style={[styles.luckGz, { color: getChartElementColor(getStemElement(lp.stem)) }]}>
                    {lp.stem}
                    {lp.branch}
                  </Text>
                  <Text style={styles.luckTenGod}>{zh(lp.tenGod)}</Text>
                  {lp.isCurrent ? <Text style={styles.luckCurrent}>← {zh('目前')}</Text> : null}
                </View>
              ))}
            </ScrollView>
            <LinearGradient
              colors={['rgba(255,255,255,0)', colors.bgCard]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.luckFade}
              pointerEvents="none"
            />
          </View>
        </View>
      ) : null}

      {/* 神煞 & 空亡 */}
      {isVisible(5) ? (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{zh('神煞 & 空亡')}</Text>
        <View style={styles.tagWrap}>
          {data.allShenSha && data.allShenSha.length ? (
            data.allShenSha.map((sha, i) => (
              <Pressable
                key={i}
                style={styles.shaBigTag}
                onPress={() =>
                  openSheet({
                    elementType: 'shensha',
                    value: sha.name,
                    pillar: (sha.pillar as PillarKey) || 'day',
                    pillarLabel: PILLAR_LABELS[sha.pillar] || '',
                  })
                }
                accessibilityRole="button"
              >
                <Text style={styles.shaBigText}>
                  {zh(sha.name)}（{zh(PILLAR_LABELS[sha.pillar] || '')}·{sha.branch}）
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.cellText}>{zh('此命盤無特殊神煞')}</Text>
          )}
        </View>
        {data.kongWang && data.kongWang.length ? (
          <View style={styles.kongWangRow}>
            <Text style={styles.kongWangLabel}>{zh('空亡')}：</Text>
            {data.kongWang.map((b, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  const pk = pillarForBranch(b);
                  openSheet({ elementType: 'kong_wang', value: b, pillar: pk.key, pillarLabel: pk.label });
                }}
                accessibilityRole="button"
              >
                <Text style={styles.kongWangTag}>{b}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      ) : null}

      {/* Between-stage reveal placeholder (spinner + contextual message). */}
      {revealing && (visibleSections ?? 6) < 6 ? (
        <View style={styles.revealPlaceholder}>
          <ActivityIndicator color={colors.red} />
          <Text style={styles.revealText}>{zh(REVEAL_MESSAGES[visibleSections ?? 0] ?? '')}</Text>
        </View>
      ) : null}

      <ElementExplanation
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        info={selected}
        godRoles={godRoles}
        fourPillars={fourPillars}
        isSubscriber={isSubscriber}
        gender={gender}
      />
    </View>
  );
}

// ── Small layout helpers ──
/**
 * `zebra` alternates a faint row tint. Together with the stronger rules this is
 * what makes the four pillars read as columns — previously the 1.14:1 hairline
 * was the ONLY structure and the grid read as floating text.
 */
function GridRow({
  label,
  children,
  zebra,
}: {
  label: string;
  children: React.ReactNode;
  zebra?: boolean;
}) {
  const zh = useZh();
  return (
    <View style={[styles.row, zebra && styles.rowZebra]}>
      <View style={styles.labelCell}>
        <Text style={styles.labelText}>{zh(label)}</Text>
      </View>
      {children}
    </View>
  );
}
/** `highlight` paints the 日柱 emphasis band — the day master is the chart's anchor. */
function Cell({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return <View style={[styles.cell, highlight && styles.cellDay]}>{children}</View>;
}
function ClickCell({
  children,
  onPress,
  highlight,
}: {
  children: React.ReactNode;
  onPress: () => void;
  highlight?: boolean;
}) {
  return (
    <Pressable
      style={[styles.cell, highlight && styles.cellDay]}
      onPress={onPress}
      accessibilityRole="button"
    >
      {children}
    </Pressable>
  );
}
/**
 * One 日主分析 column: label on top, value beneath, optional sub-value.
 *
 * `sub` always occupies a line — an empty one when absent — so the three columns'
 * value baselines stay level regardless of which stats the chart provides.
 */
function DmStat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  const zh = useZh();
  return (
    <View style={styles.dmStat}>
      <Text style={styles.dmLabel}>{zh(label)}</Text>
      <Text style={[styles.dmValue, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.dmSub} numberOfLines={1}>
        {sub ?? ' '}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.lg },
  // ── merged chart card (masthead + table) ──
  // Elevation lives here; clipping lives on chartClip. Putting `overflow:'hidden'`
  // on this node would clip its own iOS shadow — see the JSX comment.
  chartCard: {
    ...surfaces.card,
    borderRadius: radius.lg,
  },
  chartClip: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  chartHeader: {
    paddingTop: spacing.lg2,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerEyebrow: {
    ...T.caption,
    color: colors.textOnRed,
    opacity: 0.85,
    // Generous tracking so the ◆ ornaments read as set rather than typed.
    letterSpacing: 2.4,
    fontWeight: '600',
  },
  headerName: {
    ...T.title,
    color: colors.textOnRed,
    textAlign: 'center',
  },
  headerMeta: {
    ...T.caption,
    color: colors.textOnRed,
    opacity: 0.9,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  // 時辰未知 basis paragraph — left-aligned per CLAUDE.md 時辰未知 UX spec.
  basisLine: {
    ...T.bodyTight,
    textAlign: 'left',
    color: colors.textSecondary,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  hint: { ...T.caption, textAlign: 'center', color: colors.textMuted },
  card: {
    ...surfaces.card,
    borderRadius: radius.lg,
    padding: spacing.lg2,
    gap: spacing.md,
  },
  revealPlaceholder: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  revealText: { ...T.bodyTight, color: colors.textMuted },

  // ── table furniture ──
  // Rules were `borderLight` (gold @15% → 1.14:1 on white, i.e. invisible).
  // ruleHair sits at ~1.41:1: quiet, but it actually reads as a rule.
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ruleHair },
  rowZebra: { backgroundColor: colors.zebra },
  // The header tint lives on the ROW, not on each pillar cell — otherwise the
  // empty label cell stays white and punches a notch out of the top-left corner
  // now that the table runs edge-to-edge inside the card.
  headRow: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: colors.ruleHeader,
    backgroundColor: colors.bgBannerWarm,
  },
  // Row backgrounds go edge-to-edge (per the canonical table treatment) but the
  // label TEXT still needs breathing room from the card edge.
  labelCell: { width: 68, justifyContent: 'center', paddingVertical: spacing.sm, paddingLeft: spacing.md },
  labelText: { ...T.caption, color: colors.textMuted },
  pillarHead: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  pillarHeadDay: { backgroundColor: '#FDEFE4' },
  pillarHeadText: { ...T.label, color: colors.textAccent },
  cell: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
  cellDay: { backgroundColor: colors.columnTint },
  cellText: { ...T.bodyTight, color: colors.textPrimary },
  cellSmall: { ...T.caption, color: colors.textPrimary, textAlign: 'center' },
  dayYuan: { ...T.label, color: colors.textMuted },
  ganZhi: T.ganzhi,
  unknownStem: { ...T.bodyTight, color: colors.textMuted },
  zodiac: { ...T.caption, color: colors.textMuted },

  // ── 藏干 (two-line, see the row comment) ──
  hiddenStemGroup: { alignItems: 'center' },
  hiddenStemGroupGap: { marginTop: spacing.xs },
  hiddenStem: { fontSize: 13, lineHeight: 17, fontWeight: '600', textAlign: 'center' },
  hiddenStemMinor: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  hiddenStemGod: { fontSize: 11, lineHeight: 15, color: colors.textMuted, textAlign: 'center' },

  // ── 神煞 pills ──
  shenShaPill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  shenShaPillText: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
  pill_auspicious: { backgroundColor: '#FBF3E2', borderColor: 'rgba(154,111,8,0.30)' },
  pill_inauspicious: { backgroundColor: '#FBEDEA', borderColor: 'rgba(166,58,37,0.28)' },
  pill_neutral: { backgroundColor: '#F5F2EC', borderColor: 'rgba(122,100,73,0.22)' },
  pillText_auspicious: { color: '#8A6208' },
  pillText_inauspicious: { color: '#A63A25' },
  pillText_neutral: { color: colors.textMuted },
  shenShaMore: { paddingHorizontal: spacing.xs, paddingVertical: 2 },
  shenShaMoreText: { fontSize: 11, lineHeight: 16, color: colors.textAccent, fontWeight: '600' },

  palaceRow: { flexDirection: 'row', gap: spacing.sm },
  palaceCard: { flex: 1, backgroundColor: colors.bgCard, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.ruleHair },
  palaceLabel: { ...T.caption, color: colors.textMuted },
  palaceGz: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 26, fontWeight: '700', color: colors.textPrimary },
  // was fontSize: 10 — CJK strokes merged; 11 is the hard minimum for dense cells.
  palaceNayin: { fontSize: 11, lineHeight: 15, color: colors.textMuted },
  seasonalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  seasonalTag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.bgCard, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.ruleHair },
  seasonalElement: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  seasonalState: { ...T.caption, color: colors.textSecondary },
  sectionTitle: { ...T.section, color: colors.textAccent },

  // ── 五行 rings ──
  ringRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  // flexShrink:0 is load-bearing — without it a width overrun silently squeezes the
  // wrapper while the fixed-size <Svg> inside does not follow, which is how the arcs
  // clipped and the labels overflowed the stroke. If they ever overflow the row
  // again the RIGHT fix is to lower RING_BOX_MAX, not to let flexbox deform them.
  ringItem: { alignItems: 'center', flexShrink: 0, gap: 3 },
  // width/height are injected per-render from useRingGeometry.
  ringWrap: { alignItems: 'center', justifyContent: 'center' },
  ringChar: { fontFamily: fonts.serifBold, fontSize: 19, lineHeight: 24, fontWeight: '700' },
  ringPct: { ...T.dataSmall, color: colors.textSecondary },

  // ── 日主分析 stat columns ──
  dmStats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ruleHair,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  dmStat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: spacing.xs },
  dmDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.ruleHair, marginVertical: spacing.xs },
  dmLabel: { ...T.caption, color: colors.textMuted },
  dmValue: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 29, fontWeight: '700', color: colors.textPrimary },
  dmSub: { ...T.caption, color: colors.textSecondary },

  strengthBar: { flexDirection: 'row', height: 30, borderRadius: radius.sm, overflow: 'hidden', marginVertical: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ruleHair },
  strengthSame: { backgroundColor: 'rgba(139,195,74,0.30)', alignItems: 'center', justifyContent: 'center' },
  strengthOpp: { backgroundColor: 'rgba(245,166,35,0.32)', alignItems: 'center', justifyContent: 'center' },
  strengthBarText: { ...T.label, color: colors.textPrimary },

  godsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  godTag: { alignItems: 'center', gap: 2 },
  godLabel: { ...T.caption, color: colors.textMuted },
  godVal: { fontFamily: fonts.serifBold, fontSize: 19, lineHeight: 24, fontWeight: '700' },

  // ── 大運 ──
  luckViewport: { position: 'relative' },
  luckRow: { gap: LUCK_GAP, paddingVertical: spacing.xs, paddingRight: spacing.xl },
  luckCard: { width: LUCK_CARD_W, backgroundColor: colors.bgSecondary, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: colors.ruleHair },
  luckCardCurrent: { borderColor: colors.red, borderWidth: 1.5, backgroundColor: colors.bgBannerWarm },
  luckAge: { ...T.data, color: colors.textPrimary },
  // was fontSize: 10
  luckYear: { fontSize: 11, lineHeight: 15, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  luckGz: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 26, fontWeight: '700' },
  luckTenGod: { ...T.caption, color: colors.textSecondary },
  luckCurrent: { ...T.caption, color: colors.red, fontWeight: '600' },
  luckFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: spacing.xl },

  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  shaBigTag: { backgroundColor: colors.bgBannerWarm, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ruleHair },
  shaBigText: { ...T.bodyTight, color: colors.textAccent },
  kongWangRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  kongWangLabel: { ...T.bodyTight, color: colors.textMuted },
  kongWangTag: { ...T.body, color: colors.textAccent, fontWeight: '700' },
});
