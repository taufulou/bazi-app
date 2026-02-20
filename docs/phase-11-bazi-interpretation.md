# Phase 11: Bazi Interpretation Enhancement (COMPLETE)

> Extracted from CLAUDE.md. Read this when working on the Bazi pre-analysis layer, interpretation rules, or extending the engine.

## Review Status
- 3x Staff Engineer reviews (approved)
- 3x Bazi Domain Expert reviews (3 agents each round, approved)
- 1x Web Research Validation against Chinese-language Bazi textbook sources (百度百科, 三命通會, 國易堂, 滴天髓)
- Full plan with complete rule databases: `/Users/roger/.claude/plans/optimized-wandering-knuth.md`

## Architecture: Three Layers
```
User Birth Data
    |
Layer 1: Python Bazi Engine (existing)
    |-- Four Pillars, Ten Gods, Five Elements, Shen Sha, etc.
    |
Layer 2: Python Pre-Analysis (deterministic rules)
    |-- interpretation_rules.py -- main orchestrator + Ten God position rules + 從格 + conflict resolution
    |-- stem_combinations.py -- 天干合化 (5 pairs) + 天干七沖 (4 opposition pairs)
    |-- branch_relationships.py -- 地支關係 (六合/六沖/三合/三會/三刑/六害/六破 + 自刑 + 半合)
    |-- timing_analysis.py -- 歲運並臨/伏吟/反吟/天剋地沖 + 大運xnatal + 流年xnatal interactions
    |-- Output: preAnalysis JSON (keyFindings, careerInsights, loveInsights, etc.)
    |
Layer 3: AI Narration (enhanced prompts)
    |-- Receives: raw data + preAnalysis + constraints
    |-- Task: narrate, DON'T compute rules
    |-- Output: structured JSON (preview/full per section)
```

## Engine Bugs Fixed (Phase 11B)
1. **FIXED** `constants.py` TIANYI_GUIREN['庚'] = ['丑','未'] -> ['寅','午'] (modern practice school)
2. **FIXED** `constants.py` SEASON_STRENGTH -- full audit of ALL 5 element rows against canonical 旺相休囚死 table
3. **FIXED** `ten_gods.py` get_prominent_ten_god(): Added 透干 priority check (Source: 《子平真詮》)
4. **FIXED** `interpretation_rules.py` 得令 scoring: Changed from stem-specific Life Stage to element-wide SEASON_STRENGTH

## Data Previously NOT Fed to AI (now fixed in 11A)
1. 十二長生 (Life Stages) -- per pillar
2. 空亡 (Kong Wang)
3. Individual pillar elements + yinyang
4. Pillar-position significance
5. Season/月令 context
6. Na Yin -- only sent for Lifetime readings

## Calculations Added to Engine

### Tier 1 (Fundamental Accuracy)
- **天干合化** (5 stem combinations): 甲己→土, 乙庚→金, 丙辛→水, 丁壬→木, 戊癸→火. Adjacent pairs, default 合而不化. Flag Day Master involvement.
- **天干七沖** (Stem Clashes): 4 opposition pairs (甲庚, 乙辛, 丙壬, 丁癸) across 6 stem-pair combinations.
- **地支關係**: All 6 branch pairs for 六合/六沖/三合/三會/三刑/六害/六破. Score hierarchy: 三會(100) > 三合(90) > 六合(80) > 前半合(70) > 後半合(60).
- **Refined Day Master 3-factor scoring** (0-100 scale, `strengthScoreV2`):
  - 得令 (50%): SEASON_STRENGTH (旺相休囚死), NOT stem-specific Life Stage
  - 得地 (30%): 通根 root depth. Pillar weights: month=35%, day=30%, hour=20%, year=15%
  - 得勢 (20%): Supporting elements across ALL stems AND branch main qi (本氣)
  - **Known limitation:** Does NOT capture 三合/三會 element boosts or 生化鏈. See Phase 12.
- **從格 detection** -- inverts entire 喜忌 system for ~3-8% of charts:
  - 從財格, 從官格, 從兒格, 從勢格
  - Yang/Yin distinction (《滴天髓》)
  - Runs BEFORE determine_favorable_gods()

### Tier 2 (Significant Depth)
- **Shen Sha expansion** (8 → 27 types) with dual Day+Year Stem lookup for 文昌/學堂
- **Special day pillar detection**: 魁罡日, 陰陽差錯日, 十惡大敗日
- **Timing analysis with natal chart interaction**: 歲運並臨, 天剋地沖, 伏吟/反吟 + interactions
- **Gender-aware Ten God position rules**: 40 rules split male/female. 官殺混雜 (female only).
- **透干 analysis**, **用神 合絆 detection**, **墓庫 analysis**
- **Conflict resolution layer**: 從格 > 合絆 > 三合/三會 > 格局 > 官殺混雜(female only)

## Ten Gods Position Rules (40 rules: 10 gods x 4 positions)
Key examples:
- 正官 in 月柱 = most auspicious position for career/authority
- 食神 in 月柱 = talent recognized early
- 傷官 in 日支 = spouse argumentative
- 正財 in 日支 = capable/virtuous spouse
Complete database: `/Users/roger/.claude/plans/optimized-wandering-knuth.md`

## Life Domain Mapping Rules
- **Career by 用神 Five Element**: 木=教育/醫療/出版, 火=科技/能源/媒體, 土=房地產/建築, 金=金融/法律, 水=貿易/旅遊/IT
- **Health by Five Elements**: 木→肝膽, 火→心小腸, 土→脾胃, 金→肺大腸, 水→腎膀胱
- **Love indicators**: Male: 正財=wife, 偏財=romance; Female: 正官=husband, 偏官=romance; 日支=spouse palace

## Phase 11 Sub-phase Details

**Phase 11A -- Data Exposure:** Added `lifeStagesSummary`, `kongWangSummary`, `pillarElements` top-level fields to calculator output.

**Phase 11B -- Pre-Analysis Layer:**
- `stem_combinations.py` -- 天干合化 + 天干七沖 + combo-clash interaction
- `branch_relationships.py` -- 7 relationship types + 自刑 + 半合
- `interpretation_rules.py` -- Main orchestrator with all rules
- Tests: 210 (stem_combinations: 34, branch_relationships: 53, interpretation_rules: 49, existing_bugs: 20, real_world_validation: 54)

**Phase 11C -- AI Prompt Wiring + Anti-Hallucination:** See `docs/ai-prompt-engineering.md`

**Phase 11D -- Shen Sha Expansion + Timing Analysis:**
- Shen Sha: 8 → 27 types across 4 groups
- `timing_analysis.py` with full natal interaction detection
- Tests: 107

**Phase 11E -- Day Master V2 Scoring:** 3-factor formula validated against 4 historical charts.

## Real-world Validation (4 historical charts)
| Chart | Day Master | Professional | Engine Score | Status |
|---|---|---|---|---|
| 毛澤東 (癸巳甲子丁酉甲辰) | 丁 Fire | Weak | 12.3 (very_weak) | Pass |
| 蔣介石 (丁亥庚戌己巳庚午) | 己 Earth | Strong | 70.3 (very_strong) | Pass |
| 鄧小平 (甲辰壬申戊子壬子) | 戊 Earth | Very Weak | 32.0 (weak) | Pass |
| 周恩來 (戊戌甲寅丁卯丙午) | 丁 Fire | Strong | 61.3 (strong) | Pass |

**Known skip:** Deng Xiaoping 從格 detection -- deferred to Phase 12B.
