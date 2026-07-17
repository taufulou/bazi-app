import { useMemo, useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, radius, spacing, fontSize, fonts, shadows } from '../theme';
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

const RING_RADIUS = 28;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const ELEMENT_ORDER = ['木', '火', '土', '金', '水'] as const;

type PillarKey = 'year' | 'month' | 'day' | 'hour';

interface BaziChartProps {
  data: BaziChartData;
  name?: string;
  birthDate?: string;
  isSubscriber?: boolean;
  gender?: string;
}

export default function BaziChart({ data, name, birthDate, isSubscriber = false, gender = 'male' }: BaziChartProps) {
  const zh = useZh();
  const [selected, setSelected] = useState<ElementClickInfo | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);

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

  return (
    <View style={styles.wrapper}>
      {/* Header */}
      <View style={styles.headerBanner}>
        <Text style={styles.headerText}>◆ {zh('八字命格')} ◆</Text>
      </View>
      {name || birthDate ? (
        <Text style={styles.subHeader}>
          {name ? zh(name) : ''}
          {name && birthDate ? ' · ' : ''}
          {birthDate ?? ''}
          {hourUnknown ? `  (${zh('時辰未知')})` : ''}
        </Text>
      ) : null}
      {/* 時辰未知: beginner-friendly basis line (load-bearing UX — CLAUDE.md). */}
      {hourUnknown ? (
        <Text style={styles.basisLine}>
          {zh(
            '由於未提供出生時辰，本命盤只用「年、月、日」推算，約可掌握七成。與時辰有關的內容（出生那個時辰、子女運、晚年運等）暫不顯示。',
          )}
        </Text>
      ) : null}
      {showHint ? <Text style={styles.hint}>💡 {zh('點擊任意欄位查看解讀')}</Text> : null}

      {/* Pillars grid */}
      <View style={styles.card}>
        {/* header row */}
        <View style={styles.row}>
          <View style={styles.labelCell} />
          {pillars.map((col) => (
            <View key={col.key} style={styles.pillarHead}>
              <Text style={styles.pillarHeadText}>{zh(col.label)}</Text>
            </View>
          ))}
        </View>

        {/* 十神 */}
        <GridRow label="十神">
          {pillars.map((col) =>
            col.key === 'day' ? (
              <Cell key={col.key}>
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
        <GridRow label="天干地支">
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
              <Cell key={col.key}>
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

        {/* 藏干 */}
        <GridRow label="藏干">
          {pillars.map((col) => {
            const hsg = col.p.hiddenStemGods;
            return (
              <Cell key={col.key}>
                {hsg && hsg.length ? (
                  hsg.map((h, i) => (
                    <Pressable
                      key={i}
                      onPress={() =>
                        openSheet({ elementType: 'hidden_stem', value: h.stem, pillar: col.key, pillarLabel: col.label })
                      }
                      accessibilityRole="button"
                    >
                      <Text style={[styles.hiddenStem, { color: getChartElementColor(h.element), opacity: i === 0 ? 1 : 0.7 }]}>
                        {h.stem}
                        {h.element}（{zh(h.tenGod)}）
                      </Text>
                    </Pressable>
                  ))
                ) : (col.p.hiddenStems || []).length ? (
                  col.p.hiddenStems.map((s, i) => (
                    <Text key={i} style={[styles.hiddenStem, { color: getChartElementColor(STEM_ELEMENT[s] || '') }]}>
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
          <GridRow label="十二運">
            {pillars.map((col) => (
              <ClickCell
                key={col.key}
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
              onPress={() => openSheet({ elementType: 'nayin', value: col.p.naYin, pillar: col.key, pillarLabel: col.label })}
            >
              <Text style={styles.cellSmall}>{zh(col.p.naYin)}</Text>
            </ClickCell>
          ))}
        </GridRow>

        {/* 神煞 */}
        <GridRow label="神煞">
          {pillars.map((col) => (
            <Cell key={col.key}>
              {(col.p.shenSha || []).length ? (
                col.p.shenSha.map((s, i) => (
                  <Pressable
                    key={i}
                    onPress={() => openSheet({ elementType: 'shensha', value: s, pillar: col.key, pillarLabel: col.label })}
                    accessibilityRole="button"
                  >
                    <Text style={styles.shenShaTag}>{zh(s)}</Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.cellText}>—</Text>
              )}
            </Cell>
          ))}
        </GridRow>
      </View>

      {/* Extra palaces */}
      {data.mingGong || data.shenGong || data.taiYuan || data.taiXi ? (
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
      {data.seasonalStates ? (
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
      {data.fiveElementsBalanceZh ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{zh('五行能量')}</Text>
          <View style={styles.ringRow}>
            {ELEMENT_ORDER.map((el) => {
              const pct = data.fiveElementsBalanceZh?.[el] ?? 0;
              return (
                <View key={el} style={styles.ringItem}>
                  <Svg width={70} height={70} viewBox="0 0 70 70">
                    <Circle cx={35} cy={35} r={RING_RADIUS} stroke="rgba(0,0,0,0.06)" strokeWidth={4} fill="none" />
                    <Circle
                      cx={35}
                      cy={35}
                      r={RING_RADIUS}
                      stroke={getChartElementColor(el)}
                      strokeWidth={4}
                      fill="none"
                      strokeDasharray={CIRCUMFERENCE}
                      strokeDashoffset={CIRCUMFERENCE * (1 - pct / 100)}
                      strokeLinecap="round"
                      transform="rotate(-90 35 35)"
                    />
                  </Svg>
                  <Text style={[styles.ringChar, { color: getChartElementColor(el) }]}>{el}</Text>
                  <Text style={styles.ringPct}>{pct.toFixed(1)}%</Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Day master card */}
      {dm ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{zh('日主分析')}</Text>
          <DmRow label="日主" value={`${data.dayMasterStem ?? ''}（${dm.element}${zh(dm.yinYang)}）`} color={getChartElementColor(dm.element)} />
          <DmRow label="旺衰" value={`${zh(STRENGTH_LABELS[dm.strength] || dm.strength)}（${dm.strengthScore}${zh('分')}）`} />
          <DmRow label="格局" value={zh(dm.pattern || '—')} />
          {/* strength bar */}
          <View style={styles.strengthBar}>
            <View style={[styles.strengthSame, { flex: Math.max(dm.sameParty, 1) }]}>
              <Text style={styles.strengthBarText}>{zh('同黨')} {Math.round(dm.sameParty)}%</Text>
            </View>
            <View style={[styles.strengthOpp, { flex: Math.max(dm.oppositeParty, 1) }]}>
              <Text style={styles.strengthBarText}>{zh('異黨')} {Math.round(dm.oppositeParty)}%</Text>
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
      {data.luckPeriods && data.luckPeriods.length ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{zh('大運')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.luckRow}>
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
        </View>
      ) : null}

      {/* 神煞 & 空亡 */}
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
function GridRow({ label, children }: { label: string; children: React.ReactNode }) {
  const zh = useZh();
  return (
    <View style={styles.row}>
      <View style={styles.labelCell}>
        <Text style={styles.labelText}>{zh(label)}</Text>
      </View>
      {children}
    </View>
  );
}
function Cell({ children }: { children: React.ReactNode }) {
  return <View style={styles.cell}>{children}</View>;
}
function ClickCell({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable style={styles.cell} onPress={onPress} accessibilityRole="button">
      {children}
    </Pressable>
  );
}
function DmRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const zh = useZh();
  return (
    <View style={styles.dmRow}>
      <Text style={styles.dmLabel}>{zh(label)}</Text>
      <Text style={[styles.dmValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.lg },
  headerBanner: {
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  headerText: { fontFamily: fonts.serifBold, color: colors.textOnRed, fontSize: fontSize.lg, fontWeight: '700' },
  subHeader: { textAlign: 'center', color: colors.textSecondary, fontSize: fontSize.sm, marginTop: -spacing.sm },
  // 時辰未知 basis paragraph — left-aligned per CLAUDE.md 時辰未知 UX spec.
  basisLine: {
    textAlign: 'left',
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.6,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  hint: { textAlign: 'center', color: colors.textMuted, fontSize: fontSize.xs },
  card: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, ...shadows.warm },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight },
  labelCell: { width: 52, justifyContent: 'center', paddingVertical: spacing.sm },
  labelText: { fontSize: fontSize.xs, color: colors.textMuted },
  pillarHead: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, backgroundColor: colors.bgBannerWarm },
  pillarHeadText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textAccent },
  cell: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
  cellText: { fontSize: fontSize.sm, color: colors.textPrimary },
  cellSmall: { fontSize: fontSize.xs, color: colors.textPrimary, textAlign: 'center' },
  dayYuan: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
  ganZhi: { fontFamily: fonts.serifBold, fontSize: fontSize.xxl, fontWeight: '700' },
  unknownStem: { fontSize: fontSize.sm, color: colors.textMuted },
  zodiac: { fontSize: fontSize.xs, color: colors.textMuted },
  hiddenStem: { fontSize: fontSize.xs, textAlign: 'center' },
  shenShaTag: { fontSize: fontSize.xs, color: colors.textAccent },
  palaceRow: { flexDirection: 'row', gap: spacing.sm },
  palaceCard: { flex: 1, backgroundColor: colors.bgCard, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.borderLight },
  palaceLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  palaceGz: { fontFamily: fonts.serif, fontSize: fontSize.lg, color: colors.textPrimary },
  palaceNayin: { fontSize: 10, color: colors.textMuted },
  seasonalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  seasonalTag: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.bgCard, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.borderLight },
  seasonalElement: { fontSize: fontSize.sm, fontWeight: '700' },
  seasonalState: { fontSize: fontSize.xs, color: colors.textSecondary },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent },
  ringRow: { flexDirection: 'row', justifyContent: 'space-between' },
  ringItem: { alignItems: 'center' },
  ringChar: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', marginTop: -46, marginBottom: 26 },
  ringPct: { fontSize: fontSize.xs, color: colors.textSecondary },
  dmRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  dmLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  dmValue: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '600' },
  strengthBar: { flexDirection: 'row', height: 26, borderRadius: radius.sm, overflow: 'hidden', marginVertical: spacing.sm },
  strengthSame: { backgroundColor: colors.scoreGood, alignItems: 'center', justifyContent: 'center' },
  strengthOpp: { backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  strengthBarText: { fontSize: 10, color: '#fff', fontWeight: '600' },
  godsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  godTag: { alignItems: 'center' },
  godLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  godVal: { fontSize: fontSize.base, fontWeight: '700' },
  luckRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  luckCard: { minWidth: 96, backgroundColor: colors.bgSecondary, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: colors.borderLight },
  luckCardCurrent: { borderColor: colors.red, backgroundColor: colors.bgBannerWarm },
  luckAge: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  luckYear: { fontSize: 10, color: colors.textMuted },
  luckGz: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700' },
  luckTenGod: { fontSize: fontSize.xs, color: colors.textSecondary },
  luckCurrent: { fontSize: fontSize.xs, color: colors.red, fontWeight: '600' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  shaBigTag: { backgroundColor: colors.bgBannerWarm, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  shaBigText: { fontSize: fontSize.sm, color: colors.textAccent },
  kongWangRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  kongWangLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  kongWangTag: { fontSize: fontSize.base, color: colors.textAccent, fontWeight: '700' },
});
