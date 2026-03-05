// ============================================================
// techRefBuilders.ts — Per-section professional reference data builders
// for the 專業命理依據 (Technical Reference Card)
//
// Each builder extracts section-specific pre-analysis data from chartData
// and returns grouped items for display. All data is deterministic —
// computed by the Python Bazi engine, not AI-generated.
// ============================================================

// ============================================================
// Types
// ============================================================

export interface TechRefItem {
  label: string;
  value: string;
}

export interface TechRefGroup {
  category: string; // e.g. '【格局分析】'
  items: TechRefItem[];
}

type TechRefBuilder = (cd: Record<string, unknown>) => TechRefGroup[];

// ============================================================
// Constants
// ============================================================

const STRENGTH_ZH: Record<string, string> = {
  very_strong: '極旺',
  strong: '偏強',
  neutral: '中和',
  weak: '偏弱',
  very_weak: '極弱',
};

// Translate English pillar names in interaction strings to Chinese
function translatePillarNames(s: string): string {
  return s
    .replace(/\byear/gi, '年')
    .replace(/\bmonth/gi, '月')
    .replace(/\bday/gi, '日')
    .replace(/\bhour/gi, '時');
}

// ============================================================
// Safe extraction helpers
// ============================================================

interface DayMasterData {
  element?: string;
  yinYang?: string;
  strength?: string;
  strengthScore?: number;
  pattern?: string;
  favorableGod?: string;
  usefulGod?: string;
  idleGod?: string;
  tabooGod?: string;
  enemyGod?: string;
}

interface PillarData {
  stem?: string;
  branch?: string;
  tenGod?: string;
  hiddenStemGods?: Array<{ stem: string; tenGod: string }>;
  shenSha?: string[];
}

function extractDm(cd: Record<string, unknown>): DayMasterData | undefined {
  return cd?.dayMaster as DayMasterData | undefined;
}

function extractPreAnalysis(cd: Record<string, unknown>): Record<string, unknown> | undefined {
  return cd?.preAnalysis as Record<string, unknown> | undefined;
}

function extractEnhanced(cd: Record<string, unknown>): Record<string, unknown> | undefined {
  return cd?.lifetimeEnhancedInsights as Record<string, unknown> | undefined;
}

function extractFourPillars(cd: Record<string, unknown>): Record<string, PillarData> | undefined {
  return cd?.fourPillars as Record<string, PillarData> | undefined;
}

/** Effective gods: prefer preAnalysis.effectiveFavorableGods (handles 從格), fallback to dayMaster */
function getEffectiveGods(cd: Record<string, unknown>) {
  const pa = extractPreAnalysis(cd);
  const efg = pa?.effectiveFavorableGods as Record<string, string> | undefined;
  const dm = extractDm(cd);
  return {
    usefulGod: efg?.usefulGod || dm?.usefulGod || '',
    favorableGod: efg?.favorableGod || dm?.favorableGod || '',
    tabooGod: efg?.tabooGod || dm?.tabooGod || '',
    enemyGod: efg?.enemyGod || dm?.enemyGod || '',
    idleGod: efg?.idleGod || dm?.idleGod || '',
  };
}

/** Collect all shensha from four pillars */
function collectNatalShenSha(cd: Record<string, unknown>): string[] {
  const fp = extractFourPillars(cd);
  if (!fp) return [];
  const all: string[] = [];
  for (const pillar of Object.values(fp)) {
    if (pillar?.shenSha) all.push(...pillar.shenSha);
  }
  return all;
}

/** Filter tenGodPositionAnalysis by tenGod types */
function filterTenGodPositions(
  pa: Record<string, unknown> | undefined,
  types: string[],
): Array<{ tenGod: string; pillarZh: string; interpretation?: string }> {
  const analysis = pa?.tenGodPositionAnalysis as
    | Array<{ tenGod: string; pillarZh: string; interpretation?: string }>
    | undefined;
  if (!analysis) return [];
  return analysis.filter((a) => types.includes(a.tenGod));
}

/** Filter touganAnalysis by tenGod types */
function filterTougan(
  pa: Record<string, unknown> | undefined,
  types: string[],
): Array<{ tenGod: string; status: string; description?: string; stem?: string }> {
  const analysis = pa?.touganAnalysis as
    | Array<{ tenGod: string; status: string; description?: string; stem?: string }>
    | undefined;
  if (!analysis) return [];
  return analysis.filter((a) => types.includes(a.tenGod));
}

// Shensha domain mapping
const SHENSHA_SECTION_MAP: Record<string, string[]> = {
  career: ['文昌', '驛馬', '將星', '天德', '月德', '華蓋', '學堂'],
  love: ['桃花', '紅鸞', '天喜', '咸池', '孤辰', '寡宿'],
  finance: ['劫煞', '天財', '祿神'],
  health: ['天醫', '羊刃', '劫煞', '災煞', '亡神'],
};

function filterShenShaByDomain(allShenSha: string[], domain: string): string[] {
  const relevant = SHENSHA_SECTION_MAP[domain] || [];
  const countMap = new Map<string, number>();
  for (const s of allShenSha.filter((s) => relevant.some((r) => s.includes(r)))) {
    countMap.set(s, (countMap.get(s) || 0) + 1);
  }
  return [...countMap.entries()].map(([name, count]) =>
    count > 1 ? `${name} x${count}` : name,
  );
}

/** Build a group — returns null if no items have values (omits empty groups) */
function buildGroup(category: string, items: TechRefItem[]): TechRefGroup | null {
  const filtered = items.filter((i) => i.value);
  return filtered.length > 0 ? { category, items: filtered } : null;
}

/** Format ten god positions as "pillarZh" locations */
function formatTenGodLocations(
  positions: Array<{ tenGod: string; pillarZh: string }>,
  tenGod: string,
): string {
  const matches = positions.filter((p) => p.tenGod === tenGod);
  if (matches.length === 0) return '未見';
  return matches.map((p) => p.pillarZh).join('、');
}

/** Build basic gods fallback group (used when richer data is missing) */
function buildBasicGodsGroup(cd: Record<string, unknown>): TechRefGroup | null {
  const gods = getEffectiveGods(cd);
  return buildGroup('【用忌神系統】', [
    { label: '用神（最有幫助的能量）', value: gods.usefulGod },
    { label: '忌神（最不利的能量）', value: gods.tabooGod },
  ]);
}

/** Build shensha group for a domain */
function buildShenShaGroup(cd: Record<string, unknown>, domain: string): TechRefGroup | null {
  const allShenSha = collectNatalShenSha(cd);
  const matched = filterShenShaByDomain(allShenSha, domain);
  if (matched.length === 0) return null;
  return buildGroup('【相關神煞】', [
    { label: '相關神煞（特殊標記）', value: matched.join('、') },
  ]);
}

// ============================================================
// Builder: chart_identity
// ============================================================

function buildChartIdentity(cd: Record<string, unknown>): TechRefGroup[] {
  const dm = extractDm(cd);
  if (!dm) return [];

  const pa = extractPreAnalysis(cd);
  const gods = getEffectiveGods(cd);
  const dayMasterStem = cd?.dayMasterStem as string | undefined;
  const fiveElements = cd?.fiveElementsBalanceZh as Record<string, number> | undefined;

  const groups: TechRefGroup[] = [];

  // 【日主概要】
  const prominentGod = pa?.prominentGod as string | undefined;
  groups.push(
    ...filterNull([
      buildGroup('【日主概要】', [
        {
          label: '日主（你的本質）',
          value: dayMasterStem
            ? `${dayMasterStem}（${dm.element || ''}${dm.yinYang || ''}）`
            : '',
        },
        { label: '格局（命盤核心主題）', value: dm.pattern || '' },
        { label: '格局十神', value: prominentGod || '' },
      ]),
    ]),
  );

  // 【日主強弱分析】
  const sv2 = pa?.strengthV2 as
    | {
        score?: number;
        classification?: string;
        factors?: { deling?: number; dedi?: number; deshi?: number };
        lifeStage?: string;
      }
    | undefined;
  if (sv2) {
    groups.push(
      ...filterNull([
        buildGroup('【日主強弱分析】', [
          {
            label: '綜合強度',
            value: dm.strength
              ? `${STRENGTH_ZH[sv2.classification || ''] || dm.strength}${sv2.score != null ? `（${sv2.score}分）` : ''}`
              : '',
          },
          {
            label: '得令（月令助力）',
            value: sv2.factors?.deling != null ? `${sv2.factors.deling}/50` : '',
          },
          {
            label: '得地（地支根氣）',
            value: sv2.factors?.dedi != null ? `${sv2.factors.dedi}/30` : '',
          },
          {
            label: '得勢（天干助力）',
            value: sv2.factors?.deshi != null ? `${sv2.factors.deshi}/20` : '',
          },
          { label: '月令十二長生', value: sv2.lifeStage || '' },
        ]),
      ]),
    );
  } else if (dm.strength != null) {
    // Fallback for older readings without strengthV2
    groups.push(
      ...filterNull([
        buildGroup('【日主強弱分析】', [
          {
            label: '日主強弱',
            value: `${STRENGTH_ZH[dm.strength || ''] || dm.strength}${dm.strengthScore != null ? `（${dm.strengthScore}分）` : ''}`,
          },
        ]),
      ]),
    );
  }

  // 【五行分布】
  if (fiveElements) {
    const parts = Object.entries(fiveElements).map(([k, v]) => `${k}${v}%`);
    groups.push(
      ...filterNull([
        buildGroup('【五行分布】', [{ label: '五行比例', value: parts.join(' / ') }]),
      ]),
    );
  }

  // 【用忌神系統】
  groups.push(
    ...filterNull([
      buildGroup('【用忌神系統】', [
        { label: '用神（最有幫助的能量）', value: gods.usefulGod },
        { label: '喜神（有利能量）', value: gods.favorableGod },
        { label: '忌神（最不利的能量）', value: gods.tabooGod },
        { label: '仇神（次要不利能量）', value: gods.enemyGod },
        { label: '閒神', value: gods.idleGod },
      ]),
    ]),
  );

  // 【地支關係】
  if (pa) {
    const pillarRels = pa.pillarRelationships as Record<string, unknown> | undefined;
    const branchRels = pillarRels?.branchRelationships as Record<string, unknown> | undefined;
    if (branchRels) {
      const branchItems: TechRefItem[] = [];
      const relTypes = [
        { key: 'tripleHarmonies', label: '三合' },
        { key: 'threeMeetings', label: '三會' },
        { key: 'harmonies', label: '六合' },
        { key: 'clashes', label: '六沖' },
        { key: 'punishments', label: '三刑' },
        { key: 'harms', label: '六害' },
        { key: 'breaks', label: '破' },
      ];
      for (const rt of relTypes) {
        const rels = branchRels[rt.key] as Array<{ description?: string }> | undefined;
        if (rels && rels.length > 0) {
          const descriptions = rels
            .map((r) => r.description || '')
            .filter(Boolean);
          if (descriptions.length > 0) {
            branchItems.push({ label: `地支${rt.label}`, value: descriptions.join('；') });
          }
        }
      }
      if (branchItems.length > 0) {
        groups.push({ category: '【地支關係】', items: branchItems });
      }
    }
  }

  // 【從格】
  if (pa) {
    const congGe = pa.congGe as { detected?: boolean; type?: string; name?: string } | undefined;
    if (congGe?.detected && (congGe.type || congGe.name)) {
      groups.push(
        ...filterNull([
          buildGroup('【從格（特殊格局）】', [
            { label: '從格類型', value: congGe.name || congGe.type || '' },
          ]),
        ]),
      );
    }
  }

  return groups;
}

// ============================================================
// Builder: finance_pattern
// ============================================================

function buildFinance(cd: Record<string, unknown>): TechRefGroup[] {
  const dm = extractDm(cd);
  if (!dm) return [];

  const pa = extractPreAnalysis(cd);
  const gods = getEffectiveGods(cd);
  const groups: TechRefGroup[] = [];

  // 【財運核心依據】
  groups.push(
    ...filterNull([
      buildGroup('【財運核心依據】', [
        { label: '用神', value: gods.usefulGod },
        { label: '忌神', value: gods.tabooGod },
      ]),
    ]),
  );

  // 【財星分布】 from tenGodPositionAnalysis
  if (pa) {
    const positions = filterTenGodPositions(pa, ['正財', '偏財']);
    if (positions.length > 0) {
      groups.push(
        ...filterNull([
          buildGroup('【財星分布】', [
            {
              label: '正財（穩定收入天賦）',
              value: formatTenGodLocations(positions, '正財'),
            },
            {
              label: '偏財（投機理財天賦）',
              value: formatTenGodLocations(positions, '偏財'),
            },
          ]),
        ]),
      );
    }

    // 【食傷生財鏈】 from touganAnalysis
    const shishang = filterTougan(pa, ['食神', '傷官']);
    if (shishang.length > 0) {
      const items: TechRefItem[] = [];
      for (const tenGod of ['食神', '傷官']) {
        const entry = shishang.find((s) => s.tenGod === tenGod);
        if (entry) {
          const statusText =
            entry.status === 'transparent'
              ? `${entry.tenGod}（${entry.stem || ''}）透出 ✓`
              : `${entry.tenGod} 藏支未透`;
          items.push({ label: `${tenGod}透干狀態`, value: statusText });
        } else {
          items.push({ label: `${tenGod}透干狀態`, value: '未見' });
        }
      }
      groups.push(...filterNull([buildGroup('【食傷生財鏈】', items)]));
    }

    // 【比劫爭財風險】
    const bijie = filterTenGodPositions(pa, ['比肩', '劫財']);
    if (bijie.length > 0) {
      groups.push(
        ...filterNull([
          buildGroup('【比劫爭財風險】', [
            { label: '比肩出現', value: formatTenGodLocations(bijie, '比肩') },
            { label: '劫財出現', value: formatTenGodLocations(bijie, '劫財') },
          ]),
        ]),
      );
    }
  }

  // 【相關神煞】
  const shensha = buildShenShaGroup(cd, 'finance');
  if (shensha) groups.push(shensha);

  return groups;
}

// ============================================================
// Builder: career_pattern
// ============================================================

function buildCareer(cd: Record<string, unknown>): TechRefGroup[] {
  const dm = extractDm(cd);
  if (!dm) return [];

  const pa = extractPreAnalysis(cd);
  const gods = getEffectiveGods(cd);
  const groups: TechRefGroup[] = [];

  // 【事業核心依據】
  const careerInsights = pa?.careerInsights as
    | { suitableIndustries?: string[]; workStyle?: string; prominentGod?: string }
    | undefined;
  const prominentGod = (pa?.prominentGod as string) || careerInsights?.prominentGod || '';
  groups.push(
    ...filterNull([
      buildGroup('【事業核心依據】', [
        {
          label: '格局十神',
          value: prominentGod
            ? `${prominentGod}${careerInsights?.workStyle ? ` → 工作風格：${careerInsights.workStyle}` : ''}`
            : '',
        },
        { label: '用神', value: gods.usefulGod },
        { label: '忌神', value: gods.tabooGod },
      ]),
    ]),
  );

  // 【事業宮分析（月柱）】
  const fp = extractFourPillars(cd);
  const monthPillar = fp?.month;
  if (monthPillar) {
    const items: TechRefItem[] = [
      {
        label: '月柱',
        value: `${monthPillar.stem || ''}${monthPillar.branch || ''}（${monthPillar.tenGod || ''}）`,
      },
    ];
    if (monthPillar.hiddenStemGods && monthPillar.hiddenStemGods.length > 0) {
      items.push({
        label: '月支藏干',
        value: monthPillar.hiddenStemGods
          .map((h) => `${h.stem}（${h.tenGod}）`)
          .join('、'),
      });
    }
    groups.push(...filterNull([buildGroup('【事業宮分析（月柱）】', items)]));
  }

  // 【官殺分布】
  if (pa) {
    const guansha = filterTenGodPositions(pa, ['正官', '偏官']);
    if (guansha.length > 0) {
      groups.push(
        ...filterNull([
          buildGroup('【官殺分布】', [
            { label: '正官（管理天賦）', value: formatTenGodLocations(guansha, '正官') },
            { label: '偏官（魄力天賦）', value: formatTenGodLocations(guansha, '偏官') },
          ]),
        ]),
      );
    }
  }

  // 【適合行業方向】
  if (careerInsights?.suitableIndustries && careerInsights.suitableIndustries.length > 0) {
    groups.push(
      ...filterNull([
        buildGroup('【適合行業方向】', [
          { label: '行業方向', value: careerInsights.suitableIndustries.join('、') },
        ]),
      ]),
    );
  }

  // 【相關神煞】
  const shensha = buildShenShaGroup(cd, 'career');
  if (shensha) groups.push(shensha);

  return groups;
}

// ============================================================
// Builder: boss_strategy
// ============================================================

function buildBoss(cd: Record<string, unknown>): TechRefGroup[] {
  const dm = extractDm(cd);
  if (!dm) return [];

  const pa = extractPreAnalysis(cd);
  const enhanced = extractEnhanced(cd);
  const groups: TechRefGroup[] = [];

  // 【格局風格分析】
  const bossCompat = enhanced?.bossCompatibility as
    | {
        dominantStyle?: string;
        idealBossType?: string | string[];
        workplaceStrengths?: string[];
        workplaceWarnings?: string[];
      }
    | undefined;

  if (bossCompat) {
    groups.push(
      ...filterNull([
        buildGroup('【格局風格分析】', [
          { label: '格局風格', value: bossCompat.dominantStyle || '' },
          {
            label: '理想主管類型',
            value: Array.isArray(bossCompat.idealBossType)
              ? bossCompat.idealBossType.join('、')
              : bossCompat.idealBossType || '',
          },
        ]),
      ]),
    );

    // 【職場優勢】
    if (bossCompat.workplaceStrengths && bossCompat.workplaceStrengths.length > 0) {
      groups.push(
        ...filterNull([
          buildGroup('【職場優勢】', [
            { label: '優勢', value: bossCompat.workplaceStrengths.join('、') },
          ]),
        ]),
      );
    }

    // 【職場注意事項】
    if (bossCompat.workplaceWarnings && bossCompat.workplaceWarnings.length > 0) {
      groups.push(
        ...filterNull([
          buildGroup('【職場注意事項】', [
            { label: '注意', value: bossCompat.workplaceWarnings.join('、') },
          ]),
        ]),
      );
    }
  }

  // 【正官/偏官分布】
  if (pa) {
    const guansha = filterTenGodPositions(pa, ['正官', '偏官']);
    if (guansha.length > 0) {
      groups.push(
        ...filterNull([
          buildGroup('【正官/偏官分布】', [
            { label: '正官', value: formatTenGodLocations(guansha, '正官') },
            { label: '偏官', value: formatTenGodLocations(guansha, '偏官') },
          ]),
        ]),
      );
    }
  }

  // Fallback: if no enhanced data, show basic gods
  if (!bossCompat) {
    const fallback = buildBasicGodsGroup(cd);
    if (fallback) groups.push(fallback);
  }

  return groups;
}

// ============================================================
// Builder: love_pattern
// ============================================================

function buildLove(cd: Record<string, unknown>): TechRefGroup[] {
  const dm = extractDm(cd);
  if (!dm) return [];

  const pa = extractPreAnalysis(cd);
  const groups: TechRefGroup[] = [];

  const loveInsights = pa?.loveInsights as
    | {
        spouseStar?: string;
        romanceStar?: string;
        spousePalaceGod?: string;
        spouseStarPillars?: string[];
        challenges?: string[];
      }
    | undefined;

  // 【配偶星分析】
  if (loveInsights) {
    groups.push(
      ...filterNull([
        buildGroup('【配偶星分析】', [
          { label: '配偶星（主）', value: loveInsights.spouseStar || '' },
          { label: '偏星（副）', value: loveInsights.romanceStar || '' },
          {
            label: '配偶星出現位置',
            value: loveInsights.spouseStarPillars?.length
              ? loveInsights.spouseStarPillars.join('、')
              : '未見',
          },
        ]),
      ]),
    );
  }

  // 【配偶宮分析（日支）】
  const fp = extractFourPillars(cd);
  const dayPillar = fp?.day;
  if (dayPillar || loveInsights?.spousePalaceGod) {
    groups.push(
      ...filterNull([
        buildGroup('【配偶宮分析（日支）】', [
          { label: '日支', value: dayPillar?.branch || '' },
          { label: '配偶宮十神', value: loveInsights?.spousePalaceGod || '' },
        ]),
      ]),
    );
  }

  // 【感情挑戰】
  if (loveInsights?.challenges && loveInsights.challenges.length > 0) {
    groups.push(
      ...filterNull([
        buildGroup('【感情挑戰】', [
          { label: '挑戰', value: loveInsights.challenges.join('；') },
        ]),
      ]),
    );
  }

  // 【相關神煞】
  const shensha = buildShenShaGroup(cd, 'love');
  if (shensha) groups.push(shensha);

  // Fallback: if no love insights, show basic gods
  if (!loveInsights) {
    const fallback = buildBasicGodsGroup(cd);
    if (fallback) groups.push(fallback);
  }

  return groups;
}

// ============================================================
// Builder: health
// ============================================================

function buildHealth(cd: Record<string, unknown>): TechRefGroup[] {
  const dm = extractDm(cd);
  if (!dm) return [];

  const pa = extractPreAnalysis(cd);
  const gods = getEffectiveGods(cd);
  const groups: TechRefGroup[] = [];

  const healthInsights = pa?.healthInsights as
    | {
        weakOrgans?: string[];
        excessElement?: string;
        deficientElement?: string;
        warnings?: string[];
      }
    | undefined;

  // 【體質核心分析】
  const coreItems: TechRefItem[] = [];
  if (gods.tabooGod) {
    coreItems.push({
      label: '忌神',
      value: `${gods.tabooGod}${healthInsights?.weakOrgans?.length ? ` → 注意器官：${healthInsights.weakOrgans.join('、')}` : ''}`,
    });
  }
  if (gods.enemyGod) {
    coreItems.push({ label: '仇神', value: gods.enemyGod });
  }
  groups.push(...filterNull([buildGroup('【體質核心分析】', coreItems)]));

  // 【五行偏態】 — only if at least one is non-null
  if (healthInsights?.excessElement || healthInsights?.deficientElement) {
    const fiveElements = cd?.fiveElementsBalanceZh as Record<string, number> | undefined;
    const items: TechRefItem[] = [];
    if (healthInsights.excessElement) {
      const pct = fiveElements?.[healthInsights.excessElement];
      items.push({
        label: '過旺五行',
        value: `${healthInsights.excessElement}${pct != null ? `（${pct}%）` : ''}`,
      });
    }
    if (healthInsights.deficientElement) {
      const pct = fiveElements?.[healthInsights.deficientElement];
      items.push({
        label: '不足五行',
        value: `${healthInsights.deficientElement}${pct != null ? `（${pct}%）` : ''}`,
      });
    }
    groups.push(...filterNull([buildGroup('【五行偏態】', items)]));
  }

  // 【健康警示】
  if (healthInsights?.warnings && healthInsights.warnings.length > 0) {
    groups.push(
      ...filterNull([
        buildGroup('【健康警示】', [
          { label: '警示', value: healthInsights.warnings.join('；') },
        ]),
      ]),
    );
  }

  // 【相關神煞】
  const shensha = buildShenShaGroup(cd, 'health');
  if (shensha) groups.push(shensha);

  return groups;
}

// ============================================================
// Builder: children_analysis
// ============================================================

function buildChildren(cd: Record<string, unknown>): TechRefGroup[] {
  const dm = extractDm(cd);
  if (!dm) return [];

  const enhanced = extractEnhanced(cd);
  const groups: TechRefGroup[] = [];

  const childInsights = enhanced?.childrenInsights as
    | {
        shishanManifestCount?: number;
        shishanLatentCount?: number;
        shishanTransparent?: string[];
        isShishanSuppressed?: boolean;
        shishanSuppressionDetail?: string;
        hourPillarTenGod?: string;
        hourBranchLifeStage?: string;
      }
    | undefined;

  if (childInsights) {
    // 【食傷星分析（子女星）】
    groups.push(
      ...filterNull([
        buildGroup('【食傷星分析（子女星）】', [
          {
            label: '食傷透干數',
            value:
              childInsights.shishanManifestCount != null
                ? `${childInsights.shishanManifestCount}${childInsights.shishanTransparent?.length ? `（${childInsights.shishanTransparent.join('、')}）` : ''}`
                : '',
          },
          {
            label: '食傷藏支數',
            value:
              childInsights.shishanLatentCount != null
                ? `${childInsights.shishanLatentCount}`
                : '',
          },
        ]),
      ]),
    );

    // 【偏印奪食偵測】
    groups.push(
      ...filterNull([
        buildGroup('【偏印奪食偵測】', [
          {
            label: '是否觸發',
            value: childInsights.isShishanSuppressed ? '是 ⚠️' : '否',
          },
          {
            label: '詳情',
            value: childInsights.isShishanSuppressed
              ? childInsights.shishanSuppressionDetail || '偏印奪食條件成立'
              : '',
          },
        ]),
      ]),
    );

    // 【時柱分析（子女宮）】
    groups.push(
      ...filterNull([
        buildGroup('【時柱分析（子女宮）】', [
          { label: '時柱十神', value: childInsights.hourPillarTenGod || '' },
          { label: '時支十二長生', value: childInsights.hourBranchLifeStage || '' },
        ]),
      ]),
    );
  } else {
    // Fallback
    const fallback = buildBasicGodsGroup(cd);
    if (fallback) groups.push(fallback);
  }

  return groups;
}

// ============================================================
// Builder: parents_analysis
// ============================================================

function buildParents(cd: Record<string, unknown>): TechRefGroup[] {
  const dm = extractDm(cd);
  if (!dm) return [];

  const enhanced = extractEnhanced(cd);
  const groups: TechRefGroup[] = [];

  const parentInsights = enhanced?.parentsInsights as
    | {
        fatherStar?: string;
        motherStar?: string;
        fatherElement?: string;
        motherElement?: string;
        fatherStarCount?: number;
        motherStarCount?: number;
        yearStemTenGod?: string;
        yearBranchMainTenGod?: string;
        yearPillarRelation?: string;
        yearPillarFavorability?: string;
      }
    | undefined;

  if (parentInsights) {
    // 【父星分析】
    groups.push(
      ...filterNull([
        buildGroup('【父星分析】', [
          {
            label: '父星（偏財）五行',
            value: parentInsights.fatherElement || '',
          },
          {
            label: '偏財出現數',
            value:
              parentInsights.fatherStarCount != null
                ? `${parentInsights.fatherStarCount}`
                : '',
          },
          { label: '年柱天干十神', value: parentInsights.yearStemTenGod || '' },
        ]),
      ]),
    );

    // 【母星分析】
    groups.push(
      ...filterNull([
        buildGroup('【母星分析】', [
          {
            label: '母星（正印）五行',
            value: parentInsights.motherElement || '',
          },
          {
            label: '正印出現數',
            value:
              parentInsights.motherStarCount != null
                ? `${parentInsights.motherStarCount}`
                : '',
          },
          {
            label: '年柱地支本氣十神',
            value: parentInsights.yearBranchMainTenGod || '',
          },
        ]),
      ]),
    );

    // 【年柱關係（父母宮）】
    groups.push(
      ...filterNull([
        buildGroup('【年柱關係（父母宮）】', [
          { label: '年柱生剋關係', value: parentInsights.yearPillarRelation || '' },
          { label: '年柱喜忌', value: parentInsights.yearPillarFavorability || '' },
        ]),
      ]),
    );
  } else {
    // Fallback
    const fallback = buildBasicGodsGroup(cd);
    if (fallback) groups.push(fallback);
  }

  return groups;
}

// ============================================================
// Builder: timing periods (current / next / best)
// ============================================================

interface LuckPeriodEnriched {
  stem?: string;
  branch?: string;
  startAge?: number;
  endAge?: number;
  startYear?: number;
  endYear?: number;
  tenGod?: string;
  stemTenGod?: string;
  branchTenGod?: string;
  score?: number;
  stemPhase?: string;
  branchPhase?: string;
  interactions?: string[];
  isCurrent?: boolean;
  periodOrdinal?: number;
  stemElement?: string;
  branchElement?: string;
}

function buildPeriodGroups(period: LuckPeriodEnriched | undefined | null): TechRefGroup[] {
  if (!period) return [];

  const groups: TechRefGroup[] = [];

  // 【大運概要】
  groups.push(
    ...filterNull([
      buildGroup('【大運概要】', [
        {
          label: '大運',
          value: `${period.stem || ''}${period.branch || ''}${period.periodOrdinal ? `（第${period.periodOrdinal}大運）` : ''}`,
        },
        {
          label: '大運評分',
          value: period.score != null ? `${period.score}/100` : '',
        },
        { label: '大運主十神', value: period.tenGod || '' },
      ]),
    ]),
  );

  // 【天干主導（前5年）】
  if (period.stemPhase) {
    groups.push(
      ...filterNull([
        buildGroup('【天干主導（前5年）】', [
          { label: '天干', value: period.stemPhase },
        ]),
      ]),
    );
  }

  // 【地支主導（後5年）】
  if (period.branchPhase) {
    groups.push(
      ...filterNull([
        buildGroup('【地支主導（後5年）】', [
          { label: '地支', value: period.branchPhase },
        ]),
      ]),
    );
  }

  // 【大運互動】
  if (period.interactions && period.interactions.length > 0) {
    groups.push(
      ...filterNull([
        buildGroup('【大運互動】', [
          { label: '互動', value: period.interactions.map(translatePillarNames).join('、') },
        ]),
      ]),
    );
  }

  return groups;
}

function buildCurrentPeriod(cd: Record<string, unknown>): TechRefGroup[] {
  const enhanced = extractEnhanced(cd);
  const det = enhanced?.deterministic as Record<string, unknown> | undefined;
  const periods = det?.luck_periods_enriched as LuckPeriodEnriched[] | undefined;

  if (periods) {
    const current = periods.find((p) => p.isCurrent);
    if (current) return buildPeriodGroups(current);
  }

  // Fallback
  const fallback = buildBasicGodsGroup(cd);
  return fallback ? [fallback] : [];
}

function buildNextPeriod(cd: Record<string, unknown>): TechRefGroup[] {
  const enhanced = extractEnhanced(cd);
  const det = enhanced?.deterministic as Record<string, unknown> | undefined;
  const periods = det?.luck_periods_enriched as LuckPeriodEnriched[] | undefined;

  if (periods) {
    const current = periods.find((p) => p.isCurrent);
    if (current && current.periodOrdinal != null) {
      const next = periods.find((p) => p.periodOrdinal === current.periodOrdinal + 1);
      if (next) return buildPeriodGroups(next);
    }
  }

  // Fallback
  const fallback = buildBasicGodsGroup(cd);
  return fallback ? [fallback] : [];
}

function buildBestPeriod(cd: Record<string, unknown>): TechRefGroup[] {
  const enhanced = extractEnhanced(cd);
  const det = enhanced?.deterministic as Record<string, unknown> | undefined;
  const bestPeriod = det?.best_period as LuckPeriodEnriched | undefined;

  if (bestPeriod) return buildPeriodGroups(bestPeriod);

  // Fallback
  const fallback = buildBasicGodsGroup(cd);
  return fallback ? [fallback] : [];
}

// ============================================================
// Builder: annual sections
// ============================================================

function buildAnnualBase(cd: Record<string, unknown>): TechRefGroup[] {
  const groups: TechRefGroup[] = [];
  const enhanced = extractEnhanced(cd);
  const det = enhanced?.deterministic as Record<string, unknown> | undefined;
  const annualTenGod = det?.annualTenGod as string | undefined;
  const gods = getEffectiveGods(cd);

  // 【流年核心】
  groups.push(
    ...filterNull([
      buildGroup('【流年核心】', [
        {
          label: '流年天干十神',
          value: annualTenGod ? `${annualTenGod}（與日主關係）` : '',
        },
      ]),
    ]),
  );

  // 【用忌神對照】
  groups.push(
    ...filterNull([
      buildGroup('【用忌神對照】', [
        { label: '用神', value: gods.usefulGod },
        { label: '忌神', value: gods.tabooGod },
      ]),
    ]),
  );

  return groups;
}

function buildAnnualFinance(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);
  const shensha = buildShenShaGroup(cd, 'finance');
  if (shensha) groups.push(shensha);
  return groups;
}

function buildAnnualCareer(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);
  const shensha = buildShenShaGroup(cd, 'career');
  if (shensha) groups.push(shensha);
  return groups;
}

function buildAnnualLove(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);

  // 【配偶宮互動】 — check if day branch has interactions this year
  const pa = extractPreAnalysis(cd);
  const loveInsights = pa?.loveInsights as { spousePalaceGod?: string } | undefined;
  if (loveInsights?.spousePalaceGod) {
    groups.push(
      ...filterNull([
        buildGroup('【配偶宮（日支）】', [
          { label: '配偶宮十神', value: loveInsights.spousePalaceGod },
        ]),
      ]),
    );
  }

  const shensha = buildShenShaGroup(cd, 'love');
  if (shensha) groups.push(shensha);
  return groups;
}

function buildAnnualHealth(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);
  const shensha = buildShenShaGroup(cd, 'health');
  if (shensha) groups.push(shensha);
  return groups;
}

// ============================================================
// Utility
// ============================================================

function filterNull<T>(arr: (T | null)[]): T[] {
  return arr.filter((x): x is T => x !== null);
}

// ============================================================
// Exported builder map
// ============================================================

export const SECTION_TECH_BUILDERS: Record<string, TechRefBuilder> = {
  chart_identity: buildChartIdentity,
  finance_pattern: buildFinance,
  career_pattern: buildCareer,
  boss_strategy: buildBoss,
  love_pattern: buildLove,
  health: buildHealth,
  children_analysis: buildChildren,
  parents_analysis: buildParents,
  current_period: buildCurrentPeriod,
  next_period: buildNextPeriod,
  best_period: buildBestPeriod,
  annual_finance: buildAnnualFinance,
  annual_career: buildAnnualCareer,
  annual_love: buildAnnualLove,
  annual_health: buildAnnualHealth,
};
