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

function extractAnnualEnhanced(cd: Record<string, unknown>): Record<string, unknown> | undefined {
  return cd?.annualEnhancedInsights as Record<string, unknown> | undefined;
}

// --- Annual English→Chinese translation maps (Python engine returns English enums) ---
const IMPACT_ZH: Record<string, string> = {
  'positive': '有利', 'negative': '不利', 'very_positive': '非常有利',
  'very_negative': '非常不利', 'mixed': '吉凶參半',
};

const TRACK_TYPE_ZH: Record<string, string> = {
  'romance': '桃花', 'celebration': '喜慶',
};

const VITALITY_ZH: Record<string, string> = {
  'peak': '高峰', 'strong': '充沛', 'strengthening': '增強', 'rising': '上升',
  'nurturing': '調養', 'renewing': '更新', 'unstable': '不穩', 'declining': '下降',
  'dormant': '蟄伏', 'weak': '虛弱', 'very_weak': '極弱', 'critical': '危急', 'unknown': '未知',
};

const DANGER_LEVEL_ZH: Record<string, string> = {
  'none': '無', 'low': '低', 'high': '高', 'critical': '危急',
};

const ROMANCE_LEVEL_ZH: Record<string, string> = {
  'very_strong': '極旺', 'strong': '偏強', 'moderate': '中等', 'quiet': '平靜',
};

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
      const next = periods.find((p) => p.periodOrdinal === current.periodOrdinal! + 1);
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
// Builder: annual sections (V2 — uses annualEnhancedInsights)
// ============================================================

/** Shared annual base: flow year core + gods system */
function buildAnnualBase(cd: Record<string, unknown>): TechRefGroup[] {
  const groups: TechRefGroup[] = [];
  const enhanced = extractAnnualEnhanced(cd);
  const gods = getEffectiveGods(cd);

  // Extract flow year data from annualEnhancedInsights
  const flowYear = enhanced?.flowYear as { stem?: string; branch?: string; tenGod?: string; auspiciousness?: string; year?: number } | undefined;
  const flowYearHarmony = enhanced?.flowYearHarmony as { pattern?: string; description?: string } | undefined;
  const career = enhanced?.career as { tenGodRole?: string } | undefined;
  const luYangRen = enhanced?.luYangRen as {
    luShen?: { active?: boolean; favorable?: boolean };
    yangRen?: { active?: boolean; favorable?: boolean; dangerLevel?: string };
  } | undefined;

  // 【流年干支】
  if (flowYear) {
    groups.push(
      ...filterNull([
        buildGroup('【流年干支】', [
          {
            label: '流年',
            value: `${flowYear.stem || ''}${flowYear.branch || ''}年（${flowYear.year || ''}）`,
          },
          {
            label: '流年天干十神',
            value: flowYear.tenGod
              ? `${flowYear.tenGod}${career?.tenGodRole ? `（${career.tenGodRole}）` : ''}`
              : '',
          },
          {
            label: '流年吉凶',
            value: flowYear.auspiciousness || '',
          },
        ]),
      ]),
    );
  }

  // 【干支關係】
  if (flowYearHarmony?.pattern) {
    groups.push(
      ...filterNull([
        buildGroup('【干支關係】', [
          {
            label: '天干地支關係',
            value: `${flowYearHarmony.pattern}${flowYearHarmony.description ? ` — ${flowYearHarmony.description}` : ''}`,
          },
        ]),
      ]),
    );
  }

  // 【用忌神對照】
  groups.push(
    ...filterNull([
      buildGroup('【用忌神對照】', [
        { label: '用神', value: gods.usefulGod },
        { label: '喜神', value: gods.favorableGod },
        { label: '忌神', value: gods.tabooGod },
        { label: '仇神', value: gods.enemyGod },
      ]),
    ]),
  );

  // 【祿神/羊刃】
  if (luYangRen) {
    const items: TechRefItem[] = [];
    if (luYangRen.luShen?.active) {
      items.push({
        label: '祿神',
        value: `到位${luYangRen.luShen.favorable ? '（有利）' : '（不利）'}`,
      });
    }
    if (luYangRen.yangRen?.active) {
      items.push({
        label: '羊刃',
        value: `到位${luYangRen.yangRen.favorable ? '（有利）' : '（不利）'}${luYangRen.yangRen.dangerLevel ? ` · 危險度：${DANGER_LEVEL_ZH[luYangRen.yangRen.dangerLevel || ''] || luYangRen.yangRen.dangerLevel || ''}` : ''}`,
      });
    }
    if (items.length > 0) {
      groups.push(...filterNull([buildGroup('【祿神/羊刃】', items)]));
    }
  }

  return groups;
}

/** annual_overview — flow year overview */
function buildAnnualOverview(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);
  const enhanced = extractAnnualEnhanced(cd);

  // Add taiSui summary to overview
  const taiSui = enhanced?.taiSui as { hasTaiSui?: boolean; summary?: string } | undefined;
  if (taiSui) {
    groups.push(
      ...filterNull([
        buildGroup('【太歲概要】', [
          { label: '犯太歲', value: taiSui.hasTaiSui ? '是' : '否' },
          { label: '太歲摘要', value: taiSui.summary || '' },
        ]),
      ]),
    );
  }

  return groups;
}

/** annual_tai_sui — per-pillar tai sui analysis */
function buildAnnualTaiSui(cd: Record<string, unknown>): TechRefGroup[] {
  const groups: TechRefGroup[] = [];
  const enhanced = extractAnnualEnhanced(cd);
  const taiSui = enhanced?.taiSui as {
    hasTaiSui?: boolean;
    summary?: string;
    pillarResults?: Array<{
      pillar?: string;
      types?: string[];
      branchRole?: string;
      isActuallyFavorable?: boolean;
      is_actually_favorable?: boolean;
      affectedPalace?: string;
      affected_palace?: string;
    }>;
  } | undefined;

  if (!taiSui) {
    const fallback = buildBasicGodsGroup(cd);
    return fallback ? [fallback] : [];
  }

  // 【太歲總覽】
  groups.push(
    ...filterNull([
      buildGroup('【太歲總覽】', [
        { label: '犯太歲', value: taiSui.hasTaiSui ? '是' : '否' },
        { label: '摘要', value: taiSui.summary || '' },
      ]),
    ]),
  );

  // 【四柱犯太歲明細】
  const pillarResults = taiSui.pillarResults;
  if (pillarResults && pillarResults.length > 0) {
    const items: TechRefItem[] = pillarResults.map(pr => {
      const types = pr.types?.join('、') || '';
      const favorable = (pr.isActuallyFavorable ?? pr.is_actually_favorable) ? '有利' : '不利';
      const palace = pr.affectedPalace || pr.affected_palace || '';
      return {
        label: `${pr.pillar || ''}柱`,
        value: `${types}（${favorable}）${palace ? ` · ${palace}` : ''} · 地支角色：${pr.branchRole || ''}`,
      };
    });
    groups.push(...filterNull([buildGroup('【四柱犯太歲明細】', items)]));
  }

  return groups;
}

/** annual_dayun_context — major period background */
function buildAnnualDayunContext(cd: Record<string, unknown>): TechRefGroup[] {
  const groups: TechRefGroup[] = [];
  const enhanced = extractAnnualEnhanced(cd);
  const dayun = enhanced?.dayunContext as {
    available?: boolean;
    stem?: string;
    branch?: string;
    tenGod?: string;
    role?: string;
    favorability?: string;
    startYear?: number;
    endYear?: number;
    start_year?: number;
    end_year?: number;
  } | undefined;

  if (!dayun?.available) {
    groups.push(...filterNull([buildGroup('【大運背景】', [
      { label: '狀態', value: '尚無大運（大運未起）' },
    ])]));
    return groups;
  }

  groups.push(
    ...filterNull([
      buildGroup('【大運背景】', [
        {
          label: '當前大運',
          value: `${dayun.stem || ''}${dayun.branch || ''}`,
        },
        {
          label: '大運十神',
          value: dayun.tenGod ? `${dayun.tenGod}${dayun.role ? `（${dayun.role}）` : ''}` : '',
        },
        {
          label: '大運年份',
          value: `${dayun.startYear || dayun.start_year || ''}-${dayun.endYear || dayun.end_year || ''}`,
        },
        {
          label: '大運有利度',
          value: dayun.favorability || '',
        },
      ]),
    ]),
  );

  // Add base gods for context
  const gods = getEffectiveGods(cd);
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

/** annual_career — enriched career section */
function buildAnnualCareer(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);
  const enhanced = extractAnnualEnhanced(cd);
  const career = enhanced?.career as {
    flowYearTenGod?: string;
    tenGodRole?: string;
    auspiciousness?: string;
    signals?: Array<{ type?: string; impact?: string }>;
    shenShaSignals?: string[];
    shen_sha_signals?: string[];
  } | undefined;

  if (career) {
    // 【事業十神角色】
    groups.push(
      ...filterNull([
        buildGroup('【事業十神角色】', [
          { label: '流年十神', value: career.flowYearTenGod || '' },
          { label: '十神角色', value: career.tenGodRole || '' },
          { label: '事業吉凶', value: career.auspiciousness || '' },
        ]),
      ]),
    );

    // 【事業信號】
    if (career.signals && career.signals.length > 0) {
      const items: TechRefItem[] = career.signals.map((s, i) => ({
        label: `信號${i + 1}`,
        value: `${s.type || ''}（${IMPACT_ZH[s.impact || ''] || s.impact || ''}）`,
      }));
      groups.push(...filterNull([buildGroup('【事業信號】', items)]));
    }

    // 【事業神煞】
    const shenSha = career.shenShaSignals || career.shen_sha_signals;
    if (shenSha && shenSha.length > 0) {
      groups.push(...filterNull([buildGroup('【事業神煞】', [
        { label: '神煞', value: shenSha.join('、') },
      ])]));
    }
  }

  // Natal shensha
  const natShensha = buildShenShaGroup(cd, 'career');
  if (natShensha) groups.push(natShensha);

  return groups;
}

/** annual_finance — enriched finance section */
function buildAnnualFinance(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);
  const enhanced = extractAnnualEnhanced(cd);
  const finance = enhanced?.finance as {
    wealthPresent?: boolean;
    wealth_present?: boolean;
    wealthCondition?: string;
    wealth_condition?: string;
    signals?: Array<{ type?: string; impact?: string; detail?: string }>;
  } | undefined;

  if (finance) {
    const wealthPresent = finance.wealthPresent ?? finance.wealth_present;
    const wealthCondition = finance.wealthCondition || finance.wealth_condition || '';

    // 【財星狀態】
    groups.push(
      ...filterNull([
        buildGroup('【財星狀態】', [
          { label: '財星到位', value: wealthPresent ? '是' : '否' },
          {
            label: '身財關係',
            value: wealthCondition === 'strong_dm' ? '身強扛財' : wealthCondition === 'weak_dm' ? '身弱財壓' : wealthCondition,
          },
        ]),
      ]),
    );

    // 【財運信號】
    if (finance.signals && finance.signals.length > 0) {
      const items: TechRefItem[] = finance.signals.map((s, i) => ({
        label: `信號${i + 1}`,
        value: `${s.type || ''}（${IMPACT_ZH[s.impact || ''] || s.impact || ''}）${s.detail ? ` — ${s.detail}` : ''}`,
      }));
      groups.push(...filterNull([buildGroup('【財運信號】', items)]));
    }
  }

  const natShensha = buildShenShaGroup(cd, 'finance');
  if (natShensha) groups.push(natShensha);

  return groups;
}

/** annual_relationships — palace relationships */
function buildAnnualRelationships(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);
  const enhanced = extractAnnualEnhanced(cd);
  const relationships = enhanced?.relationships as {
    palaceRelationships?: Record<string, {
      palace?: string;
      status?: string;
      interactions?: Array<{ type?: string; detail?: string }>;
    }>;
    palace_relationships?: Record<string, {
      palace?: string;
      status?: string;
      interactions?: Array<{ type?: string; detail?: string }>;
    }>;
  } | undefined;

  const palaces = relationships?.palaceRelationships || relationships?.palace_relationships;
  if (palaces) {
    const items: TechRefItem[] = [];
    for (const [key, palace] of Object.entries(palaces)) {
      const interactions = palace.interactions?.map(i => `${i.type || ''}${i.detail ? `(${i.detail})` : ''}`).join('、') || '';
      items.push({
        label: `${palace.palace || key}`,
        value: `${palace.status || ''}${interactions ? ` · ${interactions}` : ''}`,
      });
    }
    if (items.length > 0) {
      groups.push(...filterNull([buildGroup('【四柱宮位互動】', items)]));
    }
  }

  return groups;
}

/** annual_love — enriched love/marriage section */
function buildAnnualLove(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);
  const enhanced = extractAnnualEnhanced(cd);
  const marriage = enhanced?.marriageStar as {
    romanceLevel?: string;
    romance_level?: string;
    romanceScore?: number;
    romance_score?: number;
    trackCount?: number;
    track_count?: number;
    tracks?: Array<{ track?: string; active?: boolean; trackType?: string; track_type?: string; detail?: string }>;
  } | undefined;

  if (marriage) {
    const romanceLevel = marriage.romanceLevel || marriage.romance_level || '';
    const romanceScore = marriage.romanceScore ?? marriage.romance_score;

    // 【桃花活躍度】
    groups.push(
      ...filterNull([
        buildGroup('【桃花活躍度】', [
          {
            label: '桃花等級',
            value: romanceLevel
              ? `${ROMANCE_LEVEL_ZH[romanceLevel] || romanceLevel}${romanceScore != null ? `（${romanceScore}分）` : ''}`
              : '',
          },
          {
            label: '姻緣信號數',
            value: `${marriage.trackCount ?? marriage.track_count ?? 0}個`,
          },
        ]),
      ]),
    );

    // 【姻緣軌道】
    if (marriage.tracks && marriage.tracks.length > 0) {
      const items: TechRefItem[] = marriage.tracks.map(t => ({
        label: t.track || '',
        value: `${t.active ? '✓ 活躍' : '✗ 不活躍'}${(t.trackType || t.track_type) ? ` · ${TRACK_TYPE_ZH[t.trackType || t.track_type || ''] || t.trackType || t.track_type || ''}` : ''}${t.detail ? ` — ${t.detail}` : ''}`,
      }));
      groups.push(...filterNull([buildGroup('【姻緣軌道（五軌分析）】', items)]));
    }
  }

  // 【配偶宮互動】
  const spousePalace = enhanced?.spousePalace as {
    interactions?: Array<{ type?: string; detail?: string }>;
  } | undefined;
  if (spousePalace?.interactions && spousePalace.interactions.length > 0) {
    groups.push(...filterNull([buildGroup('【配偶宮互動】', spousePalace.interactions.map((i, idx) => ({
      label: `互動${idx + 1}`,
      value: `${i.type || ''}${i.detail ? ` — ${i.detail}` : ''}`,
    })))]));
  }

  const natShensha = buildShenShaGroup(cd, 'love');
  if (natShensha) groups.push(natShensha);

  return groups;
}

/** annual_family — seal star + hour pillar */
function buildAnnualFamily(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);
  const enhanced = extractAnnualEnhanced(cd);
  const sealStar = enhanced?.sealStar as {
    isSealYear?: boolean;
    is_seal_year?: boolean;
    sealRole?: string;
    seal_role?: string;
    signals?: Array<{ type?: string; impact?: string }>;
  } | undefined;

  if (sealStar) {
    const isSealYear = sealStar.isSealYear ?? sealStar.is_seal_year;
    const sealRole = sealStar.sealRole || sealStar.seal_role || '';

    // 【印星分析】
    groups.push(
      ...filterNull([
        buildGroup('【印星分析】', [
          { label: '印星年', value: isSealYear ? '是' : '否' },
          { label: '印星角色', value: sealRole || '—' },
        ]),
      ]),
    );

    if (sealStar.signals && sealStar.signals.length > 0) {
      const items: TechRefItem[] = sealStar.signals.map((s, i) => ({
        label: `信號${i + 1}`,
        value: `${s.type || ''}（${IMPACT_ZH[s.impact || ''] || s.impact || ''}）`,
      }));
      groups.push(...filterNull([buildGroup('【印星信號】', items)]));
    }
  }

  // Hour pillar (子女宮) status from relationships
  const relationships = enhanced?.relationships as {
    palaceRelationships?: Record<string, { palace?: string; status?: string; interactions?: Array<{ type?: string; detail?: string }> }>;
    palace_relationships?: Record<string, { palace?: string; status?: string; interactions?: Array<{ type?: string; detail?: string }> }>;
  } | undefined;
  const palaces = relationships?.palaceRelationships || relationships?.palace_relationships;
  const hourPalace = palaces?.hour;
  if (hourPalace) {
    groups.push(...filterNull([buildGroup('【時柱（子女宮）】', [
      { label: '時柱狀態', value: hourPalace.status || '' },
      {
        label: '時柱互動',
        value: hourPalace.interactions?.map(i => `${i.type || ''}${i.detail ? `(${i.detail})` : ''}`).join('、') || '無',
      },
    ])]));
  }

  return groups;
}

/** annual_health — enriched health section */
function buildAnnualHealth(cd: Record<string, unknown>): TechRefGroup[] {
  const groups = buildAnnualBase(cd);
  const enhanced = extractAnnualEnhanced(cd);
  const health = enhanced?.health as {
    lifeStage?: string;
    life_stage?: string;
    healthVitality?: { vitality?: string; label?: string };
    health_vitality?: { vitality?: string; label?: string };
    yangrenDanger?: boolean;
    yangren_danger?: boolean;
    riskOrgans?: Array<{ element?: string; organs?: string; source?: string }>;
    risk_organs?: Array<{ element?: string; organs?: string; source?: string }>;
    elementWarnings?: Array<{ element?: string; condition?: string; source?: string; detail?: string }>;
    element_warnings?: Array<{ element?: string; condition?: string; source?: string; detail?: string }>;
  } | undefined;

  if (health) {
    const vitality = health.healthVitality || health.health_vitality;
    const lifeStage = health.lifeStage || health.life_stage || '';
    const yangrenDanger = health.yangrenDanger ?? health.yangren_danger;
    const riskOrgans = health.riskOrgans || health.risk_organs || [];
    const elementWarnings = health.elementWarnings || health.element_warnings || [];

    // 【十二長生】
    groups.push(
      ...filterNull([
        buildGroup('【十二長生】', [
          { label: '生命階段', value: lifeStage },
          {
            label: '精力狀態',
            value: vitality ? `${VITALITY_ZH[vitality.vitality || ''] || vitality.vitality || ''}${vitality.label ? ` — ${vitality.label}` : ''}` : '',
          },
        ]),
      ]),
    );

    // 【風險臟腑】
    if (riskOrgans.length > 0) {
      const items: TechRefItem[] = riskOrgans.map(r => ({
        label: `${r.element || ''}行`,
        value: `${r.organs || ''}（${r.source || ''}）`,
      }));
      groups.push(...filterNull([buildGroup('【風險臟腑】', items)]));
    }

    // 【五行警報】
    if (elementWarnings.length > 0) {
      const items: TechRefItem[] = elementWarnings.map(w => ({
        label: `${w.element || ''}行`,
        value: `${w.condition || ''}${w.source ? `（${w.source}）` : ''}${w.detail ? ` — ${w.detail}` : ''}`,
      }));
      groups.push(...filterNull([buildGroup('【五行警報】', items)]));
    }

    // 【羊刃危險】
    groups.push(
      ...filterNull([
        buildGroup('【羊刃危險】', [
          { label: '羊刃高危', value: yangrenDanger ? '⚠ 是' : '否' },
        ]),
      ]),
    );
  }

  const natShensha = buildShenShaGroup(cd, 'health');
  if (natShensha) groups.push(natShensha);

  return groups;
}

/** monthly_XX — per-month tech ref */
function buildAnnualMonthly(cd: Record<string, unknown>, monthIndex: number): TechRefGroup[] {
  const groups: TechRefGroup[] = [];
  const enhanced = extractAnnualEnhanced(cd);
  const forecasts = enhanced?.monthlyForecasts as Array<{
    monthIndex?: number;
    month_index?: number;
    monthStem?: string;
    month_stem?: string;
    monthBranch?: string;
    month_branch?: string;
    monthTenGod?: string;
    month_ten_god?: string;
    auspiciousness?: string;
    isKongWang?: boolean;
    is_kong_wang?: boolean;
    stemBase?: string;
    stem_base?: string;
    branchBase?: string;
    branch_base?: string;
    aspects?: {
      career?: { tenGod?: string; ten_god?: string; signals?: string[] };
      finance?: { signals?: string[] };
      romance?: { signals?: string[] };
      health?: { signals?: string[] };
    };
  }> | undefined;

  if (!forecasts) {
    const fallback = buildBasicGodsGroup(cd);
    return fallback ? [fallback] : [];
  }

  const month = forecasts.find(m => (m.monthIndex ?? m.month_index) === monthIndex);
  if (!month) {
    const fallback = buildBasicGodsGroup(cd);
    return fallback ? [fallback] : [];
  }

  const stem = month.monthStem || month.month_stem || '';
  const branch = month.monthBranch || month.month_branch || '';
  const tenGod = month.monthTenGod || month.month_ten_god || '';
  const isKongWang = month.isKongWang ?? month.is_kong_wang;

  // 【月份概要】
  groups.push(
    ...filterNull([
      buildGroup('【月份概要】', [
        { label: '月柱', value: `${stem}${branch}` },
        { label: '月十神', value: tenGod },
        { label: '月吉凶', value: month.auspiciousness || '' },
        { label: '空亡', value: isKongWang ? '是（力量減弱）' : '否' },
      ]),
    ]),
  );

  // 【四大面向信號】
  const aspects = month.aspects;
  if (aspects) {
    const items: TechRefItem[] = [];
    const careerTenGod = aspects.career?.tenGod || aspects.career?.ten_god || '';
    if (careerTenGod || (aspects.career?.signals && aspects.career.signals.length > 0)) {
      items.push({
        label: '💼 事業',
        value: [careerTenGod, ...(aspects.career?.signals || [])].filter(Boolean).join('、'),
      });
    }
    if (aspects.finance?.signals && aspects.finance.signals.length > 0) {
      items.push({ label: '💰 財運', value: aspects.finance.signals.join('、') });
    }
    if (aspects.romance?.signals && aspects.romance.signals.length > 0) {
      items.push({ label: '💕 感情', value: aspects.romance.signals.join('、') });
    }
    if (aspects.health?.signals && aspects.health.signals.length > 0) {
      items.push({ label: '🏥 健康', value: aspects.health.signals.join('、') });
    }
    if (items.length > 0) {
      groups.push(...filterNull([buildGroup('【四大面向信號】', items)]));
    }
  }

  // Add base gods for context
  const gods = getEffectiveGods(cd);
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
  // Annual V2 sections
  annual_overview: buildAnnualOverview,
  annual_tai_sui: buildAnnualTaiSui,
  annual_dayun_context: buildAnnualDayunContext,
  annual_career: buildAnnualCareer,
  annual_finance: buildAnnualFinance,
  annual_relationships: buildAnnualRelationships,
  annual_love: buildAnnualLove,
  annual_family: buildAnnualFamily,
  annual_health: buildAnnualHealth,
  // Monthly sections (1-based monthIndex to match Python engine)
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `monthly_${String(i + 1).padStart(2, '0')}`,
      (cd: Record<string, unknown>) => buildAnnualMonthly(cd, i + 1),
    ])
  ),
};
