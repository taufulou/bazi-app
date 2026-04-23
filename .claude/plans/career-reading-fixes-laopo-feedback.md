# 事業詳批 (Career Reading) — Laopo Feedback Fixes

**Reference chart**: Laopo, female, 1987-01-25 16:53, 柔佛
- 八字: 丙寅 / 辛丑 / 甲戌 / 壬申
- DM: 甲木 (very_weak, strength=20.6)
- 格局: 正官格 (辛 透 from 丑中本氣)
- 喜用神: 用神=水 (印), 喜神=木 (比劫), 閒神=火 (食傷), 仇神=土 (財), 忌神=金 (官殺)

This document research-validates 6 suspected bugs/weaknesses identified during Seer comparison and proposes implementation fixes.

**Revision history**:
- v1: Initial research + plan
- v2: Addressed 14 issues from staff-engineer review round 1
- v3: Addressed 3 blockers from round 2 — table arithmetic, Fix 3 閒神 consistency, `cong_ge` param. APPROVED by reviewer round 3.
- v4 (current): User decisions locked in — **UD-1: defer Fix 6 entirely** (option c — see UD-1 section); UD-2/3/4: defaults accepted. Implementation order: Fix 1 → Fix 3 → Fix 4 → Fix 2 + Fix 5. Fix 6 SKIPPED.

---

## ⚠️ User decisions — RESOLVED (v4)

**UD-1**: Deferred Fix 6 entirely (option c). Rationale: classical truth is BOTH readings should equally weight 月令本氣; the proposed split was engineering pragmatism, not Bazi theology. Seer may be the outlier rather than us being wrong. Fix 6 is cosmetic (display % only); the analytical scores are unaffected. Revisit later as a holistic recalibration.

**UD-2** (Fix 6 magnitude): N/A — Fix 6 deferred.

**UD-3** (`sealRescueBonus` visibility in `subScores`): KEEP visible (default).

**UD-4** (`inChart` flag on allies): INCLUDE the field (default); ship without it only if TS types churn unacceptably.

---

## (Original UD-1 discussion preserved for reference)

### UD-1 — Cross-reading 五行% inconsistency (Fix 6) — RESOLVED: Defer

After Fix 6, the **career reading display** will show ~30-32% 土 for Laopo (with 月令本氣 boost), while the **lifetime reading ring chart** will continue to show ~25% 土 (no boost). A user buying both readings on the same chart will see different percentages and different `level` labels (e.g., "土強" in lifetime vs "土很強" in career).

**Three options**:
- **(a) Career-only with disclosure** *(plan default — recommend)*. Add UI tooltip/footnote on the career display: "事業詳批 包含 月令本氣加權 — 與終身運的計算方式略有差異". CLAUDE.md already documents that career and lifetime use different element-calculation functions intentionally.
- **(b) Backport to lifetime display**. Add the same `+1.5` boost to `calculate_five_elements_balance_seasonal()`. Risk: that function is also used analytically in places — any flow into `analyze_day_master_strength()` would shift Roger's classification away from the post-R5 baseline. Requires careful tracing.
- **(c) Defer Fix 6 entirely**. Skip the boost; live with the 25% vs Seer's 33.8% gap for now.

**Recommend (a)** — keeps the engineering scope tight, preserves the lifetime baseline that was carefully tuned in R5, and the existing CLAUDE.md note about "display vs analysis" already establishes the precedent that the two readings can diverge in display details.

**ACTION REQUIRED**: User must pick (a), (b), or (c) before Fix 6 is implemented.

---

## Part A — Research Findings per Item

### Item 1 — 三合貴人 only listing one of two partner branches

**Symptom**: Laopo's 生肖虎 (年支寅). 寅午戌 → 馬+狗 should both be listed as 事業貴人. Our `careerAllies.allies` only contains 午, missing 戌 (because day_branch=戌 is filtered out).

#### Verdict: **YES — we are wrong**

The bug is in `compute_career_allies_enemies()` at [`career_enhanced.py:789`](packages/bazi-engine/app/career_enhanced.py#L789):

```python
ally_list = [
    {'branch': b, 'zodiac': ZODIAC_ANIMALS.get(b, '')}
    for b in sorted(allies) if b != year_branch and b != day_branch  # ← BUG
]
```

Filtering out branches that already appear in the natal chart is **conceptually wrong** for "who are my zodiac allies?" The presence of an ally branch already in the chart does NOT remove that zodiac animal from your set of "people who naturally support you" — it actually means **part of your noble support is already built into your destiny**. The intended UX answer to "what zodiacs am I compatible with for partnerships, hires, marriage, etc." is the *complete* 三合 partner set.

#### Classical evidence

- **《淵海子平》 / 《三命通會》**: 三合 represents 「長生、帝旺、墓庫」 — three life-cycle stages of one element working together. The classical descriptive use is at the natal-chart level (do all three appear → activated 三合局).
- For the **生肖貴人 / 配偶生肖** modern app concept (which is what `careerAllies.allies` exposes), all three zodiacs in the 三合 group are listed as compatible / nobles, regardless of whether the user already "owns" one of them in their chart.
- Sources:
  - [合婚指標 — 六合、三合、三會、相沖、相刑、相破、相害](https://barbieyao.wixsite.com/lotusrain/single-post/2020/01/19/...) — explicitly lists "三合貴人 — 屬虎者：馬、狗" without exclusion.
  - [屬虎的貴人屬相](https://blog.sina.com.cn/s/blog_14552df340102vl4l.html) — for 屬虎, 貴人 = 馬 + 狗 (full pair listed).
  - [千古流传：神秘的属相三合、六合、六害、六冲知识](http://www.360doc.com/content/19/0325/21/62726487_824133094.shtml) — same.
  - [八字三合意思與地支三合局全解析](https://www.inzense.com.tw/en/bazi-three-harmony-meaning-and-earthly-branch-formations-complete-guide-strongest-combination-power-and-marriage-benefactors/) — 「寅虎、午馬、戌狗三合（火局）」 listed as a unit; no rule that already-present branches are excluded.

#### Modern competitor behavior
- **Seer**: lists both 馬+狗 for 屬虎.
- **百度百科 / 360doc / sina blog**: list both regardless of natal presence.

#### The correct algorithm
For each "key branch" (year branch and day branch), enumerate all 三合 partner branches. **Deduplicate** by zodiac (don't repeat the same zodiac if 寅 is both year+day, hypothetically). Do **not** filter out branches already present in the natal chart.

```pseudocode
allies = set()
for key_branch in {year_branch, day_branch}:
    for partner in SANHE_GROUPS[key_branch]:
        allies.add(partner)
# DO NOT filter `allies` by year_branch/day_branch presence
ally_list = [{branch: b, zodiac: ZODIAC[b]} for b in sorted(allies)]
```

**Optional refinement (for UI)**: tag whether the ally is "已在命局" vs "外求", e.g.:
```python
{'branch': b, 'zodiac': ZODIAC[b], 'inChart': b in chart_branches}
```
This adds value without breaking existing consumers (frontend can choose to badge or ignore).

---

### Item 2 — 流月過度悲觀 (monthly forecasts too pessimistic)

**Symptom**: 8/12 months in 2026 evaluated as 凶/大凶. Specific failures:
- 1月 庚寅: ours 凶 (because 庚=正官=忌神). But 寅=用神 (比劫) AND 寅沖申 沖去時支忌神 → should be 吉 or 平.
- 10月 己亥: ours 凶 (己=正財=仇神). But 亥=用神 (印生身) → should be 平/小吉.
- 11月 庚子: ours 凶 (庚=忌神). But 子=正印=用神 → should be 平/小吉.
- 9月 戊戌: 大凶 — see Item 5.

#### Verdict: **YES — we are wrong (severely)**

The current monthly algorithm at [`career_enhanced.py:1015-1085`](packages/bazi-engine/app/career_enhanced.py#L1015) **only uses the month's stem element** (`month_element = STEM_ELEMENT.get(month_stem, '')`) to derive auspiciousness. The branch element is **completely ignored** for auspiciousness; branch is only checked for 伏吟/六合/六沖 with the day branch.

This is a flagrant misalignment with classical methodology, which says **「重地支變化」** ("the branch carries the seasonal qi — give it the dominant weight").

#### Classical evidence

- **《淵海子平》 / 《三命通會》**: 流月 represents seasonal qi shifts within the year. Branches carry season → branches are dominant. Quote: 「'流月'為一年四季之分屬，所以'流月'的五行之氣重地支變化」. Source: [八字如何看"流月"的吉凶](https://www.163.com/dy/article/JU81TQJD055691XW.html).
- **天干代表上半月，地支代表下半月**: each month splits into a stem half (first ~15 days) and a branch half (last ~15 days). Combined evaluation is the rule.
- **干支互動法則 (consensus rule across all sources)**:
  | 天干 | 地支 | 整體 |
  |-----|-----|------|
  | 喜用 | 喜用 | **吉月** (大吉 if both 用神) |
  | 忌仇 | 忌仇 | **凶月** (大凶 if both 忌神) |
  | 喜用 | 忌仇 | 先吉後凶 → 平 / 小凶 |
  | 忌仇 | 喜用 | 先凶後吉 → 平 / 小吉 |
  | 喜用 | 閒神 | 小吉 |
  | 閒神 | 喜用 | 吉 (because branch dominates) |

  Source: [算準網 — 大運、流年、流月、流日之間如何作用](https://www.suanzhun.net/article/2761.html), [八字如何看"流月"的吉凶](https://www.163.com/dy/article/JU81TQJD055691XW.html).

- **流年 cap rule** ("流月依附於流年"): 「流年大吉，'流月'就沒有大凶；流年不好，'流月'再好也是'昙花一現'」. Annual context provides ceiling/floor on monthly extremes. Our current code already passes `annualContext` but doesn't use it for capping (only for AI display).

#### Modern competitor behavior
- **Seer**: uses combined stem+branch with branch dominance. Their 1月 庚寅 for Laopo = 中吉 (because 寅=用神 dominates), 10月 己亥 = 平, 11月 庚子 = 中吉.
- **suanzhun.net / shenjige**: same pattern — branch dominant, stem moderating.

#### The correct algorithm (v2 — math corrected per review Issue 12)

**Weights renormalized to sum to 1.0**: stem 0.30 + branch本氣 0.55 + 中氣 0.10 + 餘氣 0.05 = **1.00**. (v1 mistakenly added hidden-stem weights on top of a 35/65 split, summing to 1.15 and breaking the threshold mapping.)

**Note**: Step 1's "branch本氣" IS what `BRANCH_ELEMENT[month_branch]` returns (the 本氣 hidden stem's element). To avoid double-counting, the hidden-stem loop in Step 3 starts from index 1 (skip the 本氣).

```pseudocode
ROLE_TO_SCORE = {'用神': +2, '喜神': +1, '閒神': 0, '仇神': -1, '忌神': -2}

WEIGHT_STEM     = 0.30
WEIGHT_BENQI    = 0.55
WEIGHT_ZHONGQI  = 0.10
WEIGHT_YUQI     = 0.05
# Total = 1.00; raw score range = [-2, +2]

# Threshold bands (chosen so each band requires a meaningful tilt):
#   ≥ +1.20  → 大吉
#   ≥ +0.50  → 吉
#   ≥ -0.50  → 平
#   ≥ -1.20  → 凶
#   else     → 大凶
THRESHOLDS = [(1.20,'大吉'), (0.50,'吉'), (-0.50,'平'), (-1.20,'凶')]
# Below -1.20 → 大凶

INTERACTION_CAP = 1   # max ±1 tier shift from interactions (Issue 8)

def assess_monthly(pillars, day_branch, day_master_stem,
                   month_stem, month_branch,
                   effective_gods, annual_auspiciousness):
    # Step 1: stem + branch本氣 + hidden stems
    stem_role   = effective_gods.get(STEM_ELEMENT[month_stem],   '閒神')
    benqi_role  = effective_gods.get(BRANCH_ELEMENT[month_branch], '閒神')
    score = ROLE_TO_SCORE[stem_role]  * WEIGHT_STEM \
          + ROLE_TO_SCORE[benqi_role] * WEIGHT_BENQI

    # Step 2: hidden stems beyond 本氣 (skip index 0 = 本氣 already counted)
    hidden = HIDDEN_STEMS.get(month_branch, [])
    if len(hidden) > 1:
        zhongqi_role = effective_gods.get(STEM_ELEMENT.get(hidden[1], ''), '閒神')
        score += ROLE_TO_SCORE[zhongqi_role] * WEIGHT_ZHONGQI
    if len(hidden) > 2:
        yuqi_role = effective_gods.get(STEM_ELEMENT.get(hidden[2], ''), '閒神')
        score += ROLE_TO_SCORE[yuqi_role] * WEIGHT_YUQI

    # Step 3: map to base label
    base_label = '大凶'
    for cutoff, label in THRESHOLDS:
        if score >= cutoff:
            base_label = label
            break

    # Step 4: interaction modifiers — capped at ±INTERACTION_CAP total
    label = base_label
    tier_delta = 0       # signed tier shift accumulator
    notes = []
    counted_branches = set()  # dedupe across step 4a/4b (Issue 8)

    # 4a: month_branch vs day_branch (伏吟 / 六合 / 六沖)
    if month_branch == day_branch:  # 伏吟 — delegate to Fix 5 helper
        label, fuyin_note = _apply_fuyin_modifier(label, branch_role=benqi_role)
        notes.append(fuyin_note)
        counted_branches.add(day_branch)
        # NOTE: _apply_fuyin_modifier handles its own tier shift; do not also count here
    elif BRANCH_LIUHE.get(month_branch) == day_branch:
        tier_delta += +1
        notes.append({'type':'六合','description':'月支合日支','effect':'貴人相助、人際和諧'})
        counted_branches.add(day_branch)
    elif LIUCHONG_PAIRS.get(month_branch) == day_branch:
        day_branch_role = effective_gods.get(BRANCH_ELEMENT[day_branch], '閒神')
        if day_branch_role in ('忌神','仇神'):
            tier_delta += +1
            notes.append({'type':'六沖','description':'月支沖日支(沖去忌仇)','effect':'破舊立新'})
        else:
            tier_delta += -1
            notes.append({'type':'六沖','description':'月支沖日支(沖去喜用)','effect':'變動劇烈'})
        counted_branches.add(day_branch)

    # 4b: 月支沖 OTHER natal branches that hold 忌仇 — cap at +1 total even if multiple
    if tier_delta < INTERACTION_CAP:  # only add if cap not already hit
        for pname in ('year','month','day','hour'):
            nb = pillars[pname]['branch']
            if nb in counted_branches:
                continue
            if LIUCHONG_PAIRS.get(month_branch) == nb:
                nb_role = effective_gods.get(BRANCH_ELEMENT[nb], '閒神')
                if nb_role in ('忌神','仇神'):
                    tier_delta += +1
                    notes.append({'type':'沖','description': f'月支沖{nb}({pname[0]}支忌仇)','effect':'沖去忌神'})
                    counted_branches.add(nb)
                    break  # only credit ONCE for the cap

    # Step 5: clamp tier_delta and apply
    tier_delta = max(-INTERACTION_CAP, min(INTERACTION_CAP, tier_delta))
    label = _shift_tier(label, tier_delta)

    # Step 6: 流年 cap — bound monthly extremes by annual context
    if annual_auspiciousness == '大吉' and label == '大凶': label = '凶'
    if annual_auspiciousness == '大凶' and label == '大吉': label = '吉'

    return label, notes


def _shift_tier(label, delta):
    """Shift label up/down within ordered tier list, clamped at ends."""
    TIERS = ['大凶','凶','小凶','平','小吉','吉','大吉']
    try:
        idx = TIERS.index(label)
    except ValueError:
        return label
    new_idx = max(0, min(len(TIERS)-1, idx + delta))
    return TIERS[new_idx]
```

#### Complete label vocabulary (post-fix) — Issue 7

The combined output of Fix 2 + Fix 5 produces labels from this **7-tier set**:

```
['大凶', '凶', '小凶', '平', '小吉', '吉', '大吉']
```

**Existing label set** in `test_monthly_auspiciousness_valid` ([test_career_calculations.py:~1035](packages/bazi-engine/tests/test_career_calculations.py)) is:
```
{'大吉', '吉', '吉中有凶', '平', '小凶', '凶中有吉', '凶中帶機', '凶', '大凶'}
```

**Decision**: **drop** the legacy `'吉中有凶'`, `'凶中有吉'`, `'凶中帶機'` labels — they were used by the old algorithm to encode mixed-element results. The new score-based algorithm produces a clean tier on its own. The `小吉`/`小凶` tiers cover the previous "mixed" semantics.

**Required test/type updates** (must be done IN THE SAME PR as Fix 2):
1. **`test_monthly_auspiciousness_valid`**: replace valid set with 7 tiers above.
2. **TypeScript types**: grep `apps/web` and `packages/shared` for `auspiciousness` literal types — replace any `'吉中有凶'`/`'凶中有吉'`/`'凶中帶機'` literals with the new 7-tier union.
3. **AI prompt placeholders**: grep `apps/api` for any prompt template that encodes auspiciousness label vocabulary — update.
4. **UI label-to-color map**: grep `apps/web` for color-mapping objects keyed by auspiciousness label — add `小吉`/remove dropped labels.
5. **Lifetime reading**: lifetime's annual auspiciousness still uses the legacy 9-tier set per CLAUDE.md. **Decision: keep lifetime untouched** for now — the two readings will use different label sets. Add a short note to CLAUDE.md career-strategy section.

#### Worked validation table (v3 — Issue 2.1 R2: regenerated mechanically with actual HIDDEN_STEMS)

Computed using the actual `HIDDEN_STEMS` table from `constants.py:92-105`. Branches with single hidden stem (子/卯/酉) contribute ONLY 本氣 (no 中氣/餘氣). Branches with 2 hidden stems (午/亥) contribute 本氣 + 中氣 only (no 餘氣).

Laopo: DM=甲(very_weak); 用神=水, 喜神=木, 閒神=火, 仇神=土, 忌神=金. day_branch=戌; chart branches={寅,丑,戌,申}; annual 2026=平 (no 流年 cap).

Role lookup: 甲乙木→喜(+1), 丙丁火→閒(0), 戊己土→仇(-1), 庚辛金→忌(-2), 壬癸水→用(+2).

| 月 | 干支 | hidden  | stem(0.30)  | 本氣(0.55)  | 中氣(0.10)  | 餘氣(0.05)  | score   | base | interaction | final |
|----|------|---------|-------------|-------------|-------------|-------------|---------|------|-------------|-------|
| 1  | 庚寅 | 甲丙戊  | 忌·0.30=-0.60 | 喜·0.55=+0.55 | 閒·0.10=0    | 仇·0.05=-0.05 | **-0.10** | 平 | 寅沖申(時支=忌) → +1 | **小吉** |
| 2  | 辛卯 | 乙      | -0.60       | +0.55       | —           | —           | **-0.05** | 平 | 卯合戌(日支) → +1   | **小吉** |
| 3  | 壬辰 | 戊乙癸  | 用·0.30=+0.60 | 仇·0.55=-0.55 | 喜·0.10=+0.10 | 用·0.05=+0.10 | **+0.25** | 平 | 辰沖戌(日支, day_role=仇) → +1 | **小吉** |
| 4  | 癸巳 | 丙庚戊  | +0.60       | 閒·0.55=0    | 忌·0.10=-0.20 | 仇·0.05=-0.05 | **+0.35** | 平 | 巳沖亥(無亥) → 0    | **平**  |
| 5  | 甲午 | 丁己    | 喜·0.30=+0.30 | 閒·0.55=0    | 仇·0.10=-0.10 | —           | **+0.20** | 平 | 午沖子(無子) → 0    | **平**  |
| 6  | 乙未 | 己丁乙  | +0.30       | 仇·0.55=-0.55 | 閒·0.10=0    | 喜·0.05=+0.05 | **-0.20** | 平 | 未沖丑(月支=仇) → +1 | **小吉** |
| 7  | 丙申 | 庚壬戊  | 閒·0.30=0    | 忌·0.55=-1.10 | 用·0.10=+0.20 | 仇·0.05=-0.05 | **-0.95** | 凶 | 申沖寅(年=喜, 沖喜用 not in current sweep — see scope cut) → 0 | **凶**  |
| 8  | 丁酉 | 辛      | 0           | -1.10       | —           | —           | **-1.10** | 凶 | 酉沖卯(無) → 0      | **凶**  |
| 9  | 戊戌 | 戊辛丁  | 仇·0.30=-0.30 | 仇·0.55=-0.55 | 忌·0.10=-0.20 | 閒·0.05=0    | **-1.05** | 凶 | **戌戌伏吟**(Fix 5: 仇神 mod on 凶 → 凶) | **凶**  |
| 10 | 己亥 | 壬甲    | 仇·0.30=-0.30 | 用·0.55=+1.10 | 喜·0.10=+0.10 | —           | **+0.90** | 吉 | 亥沖巳(無) → 0      | **吉**  |
| 11 | 庚子 | 癸      | -0.60       | +1.10       | —           | —           | **+0.50** | 吉 | 子沖午(無) → 0      | **吉**  |
| 12 | 辛丑 | 己癸辛  | -0.60       | -0.55       | 用·0.10=+0.20 | 忌·0.05=-0.10 | **-1.05** | 凶 | 丑沖未(無) → 0      | **凶**  |

**Distribution**: 吉×2 (10,11), 小吉×4 (1,2,3,6), 平×2 (4,5), 凶×4 (7,8,9,12), 大凶×0. Total = 12 ✓.

**Threshold band check** (cutoffs: ≥+1.20→大吉; ≥+0.50→吉; ≥-0.50→平; ≥-1.20→凶; <-1.20→大凶):
- 11月 score=+0.50 lands EXACTLY at the 吉 cutoff. If thresholds are tightened in future calibration, 11月 could drop to 平. Acceptable for v1 — note for monitoring.
- No row reaches 大吉 (max +0.90) or 大凶 (min -1.10). Consistent with "balanced 平年" expectation for Laopo's 2026.

**Validation against user's expected outcomes**:
- 1月 庚寅 (user expected 吉/平): got **小吉** ✓ (in range; close to 吉)
- 10月 己亥 (user expected 平/小吉): got **吉** — slightly more positive than user; acceptable since 亥=用神主氣 dominates
- 11月 庚子 (user expected 平/小吉): got **吉** — borderline (+0.50 = exact cutoff)
- 9月 戊戌 (user expected NOT 大凶): got **凶** ✓
- ≤ 5 凶 months sanity test: got 4 (凶×4 + 大凶×0) ✓
- Old algorithm produced 8/12 凶+ months; new algorithm produces 4/12. Significant improvement, no over-correction (still has 4 unfavorable months in a 身弱官殺旺 chart, which is realistic).

**v2 worked-table errors that this v3 corrects** (for transparency):
- 2月 辛卯: v2 said +0.05 → v3 says **-0.05** (v2 added phantom 中氣 — 卯 only has 1 hidden stem)
- 3月 壬辰: v2 said +0.20 → v3 says **+0.25** (v2 arithmetic error)
- 4月 癸巳: v2 said +0.55 → v3 says **+0.35** (band 吉 → 平; v2 missed 中氣 庚=忌 and 餘氣 戊=仇)
- 5月 甲午: v2 said +0.25 → v3 says **+0.20** (v2 missed 中氣 己=仇)
- 6月 乙未: v2 said -0.35 → v3 says **-0.20** (v2 missed 餘氣 乙=喜)
- 7月 丙申: v2 said -1.35 → v3 says **-0.95** (band 大凶 → 凶; v2 omitted 中氣 壬=用 contribution)
- 8月 丁酉: v2 said -1.30 → v3 says **-1.10** (band 大凶 → 凶; v2 added phantom 中氣 — 酉 only has 1 hidden)
- 11月 庚子: v2 said +0.70 → v3 says **+0.50** (v2 added phantom 中氣 — 子 only has 1 hidden)

**Distribution v2 vs v3**: v2 claimed {吉×3, 小吉×4, 平×1, 凶×2, 大凶×2} (impossible — sums to 12 but the row-band assignments were inconsistent). v3 corrected: {吉×2, 小吉×4, 平×2, 凶×4, 大凶×0}.

**Threshold sensitivity note**: If 10月/11月 should be `小吉` rather than `吉` to match user intuition more precisely, the `吉` cutoff can be raised from `+0.50` to `+0.70`. This is a tunable knob — leave at `+0.50` for v1, revisit after gathering 5+ chart samples.

**Algorithm coverage gaps acknowledged** (intentional for scope):
- Step 4a only checks LIUHE/LIUCHONG with day_branch. Extending to all natal branches would catch e.g. 11月 子合丑(month_branch) — left as deliberate scope cut to avoid over-counting (CAP=±1 already constrains the problem).
- Step 4b only sweeps for 沖 of 忌仇 (asymmetric — favorable direction only). Adding the symmetric "沖去喜用 = downgrade" sweep would be more balanced but risks over-pessimism. Defer to v2.
- 三刑/三會/半合 detection in 流月 — not currently included. These are weaker signals than 六合/六沖. Defer.

**Test additions for the worked table** (in addition to user-facing tests in Fix 2):
```python
def test_monthly_score_arithmetic_jan_geng_yin(laopo10_pillars):
    """Mechanical verification — Jan 2026 should compute to score=-0.10, base=平, +1 from 寅沖申, final=小吉."""
    label, notes = _assess_monthly_combined(
        laopo10_pillars, day_branch='戌', day_master_stem='甲',
        month_stem='庚', month_branch='寅',
        effective_gods={'水':'用神','木':'喜神','火':'閒神','土':'仇神','金':'忌神'},
        annual_auspiciousness='平')
    assert label == '小吉'
    assert any('沖申' in n.get('description','') for n in notes)
```

---

### Item 3 — 傷官見官 indicator fires unconditionally

**Symptom**: 2027 丁未 (丁=傷官) flagged with `傷官見官 為禍百端 — 官場風波、降職風險` even though Laopo's 正官 (辛) is 忌神 (官殺旺 attacking weak DM). Classically when 正官=忌神, 傷官 sees 官 is **beneficial** (傷官制官 helps weak DM).

#### Verdict: **YES — we are wrong**

Current code at [`career_enhanced.py:1949-1963`](packages/bazi-engine/app/career_enhanced.py#L1949):

```python
if year_ten_god == '傷官' and '正官' in manifest_gods:
    indicators.append({'type': 'danger', 'label': '傷官見官', ...})
if year_ten_god == '正官' and '傷官' in manifest_gods:
    indicators.append({'type': 'danger', 'label': '傷官見官', ...})
```

There is **no check** for whether 正官 is 用/喜 (true danger) vs 忌/仇 (actually beneficial).

#### Classical evidence

- **《三命通會》**: 「女命傷官見官，克夫喪子，**若帶財印反成貴格**」 — 傷官見官 is dangerous for women UNLESS 財/印 mediates. Source: [傷官見官 — 三命通會](https://baike.baidu.com/item/%E4%BC%A4%E5%AE%98%E8%A7%81%E5%AE%98/2651732)
- **百度百科 (傷官見官)**: 「**如官為忌，傷官見官反以吉論**」 — direct quote: "When 官 is 忌神, 傷官見官 is judged as auspicious." Source: [伤官见官_百度百科](https://baike.baidu.com/item/%E4%BC%A4%E5%AE%98%E8%A7%81%E5%AE%98/2651732)
- **【命理】傷官可愛又可恨 (大紀元)**: 「正官為用神，大運流年最忌傷官，犯之主破緣，官司，破財等事。**如果正官為忌的話，遇傷則喜，反而對整個命理是有利的**」. Source: [命理 — 傷官](https://www.epochtimes.com/b5/20/10/8/n12461081.htm)
- **蘇民峰 《八字講義》**: classifies 傷官 as 凶 only when 正官 is the chart's 用神. Source: [masterso.com](https://www.masterso.com/classroom/classroom2_1_618.php)
- **《特殊命格》(vocus)**: 「傷官傷盡」 (no 官 in chart) is actually a celebrated pattern. Source: [vocus — 特殊命格](https://vocus.cc/article/610b3599fd897800018759a4)

#### Modern competitor behavior
- **Seer**: only flags 傷官見官 as danger when 正官 is 用神. Otherwise tags as opportunity.
- **suanzhun / shenjige**: same conditional rule.

#### The correct algorithm

```pseudocode
def detect_shang_guan_jian_guan(year_ten_god, manifest_gods, day_master_stem,
                                 effective_gods, ten_god_dist):
    # Get the role of the OFFICER (正官) element
    dm_element = STEM_ELEMENT[day_master_stem]
    officer_element = ELEMENT_OVERCOME_BY[dm_element]  # element that 克 DM
    officer_role = effective_gods.get(officer_element, '閒神')

    # Get the role of the SHANG GUAN (傷官) element
    shangguan_element = ELEMENT_PRODUCES[dm_element]  # element DM produces
    shangguan_role = effective_gods.get(shangguan_element, '閒神')

    has_official_natally = '正官' in manifest_gods
    has_shangguan_natally = '傷官' in manifest_gods

    triggers = (
        (year_ten_god == '傷官' and has_official_natally) or
        (year_ten_god == '正官' and has_shangguan_natally)
    )
    if not triggers:
        return None

    # Decision matrix
    if officer_role in ('用神', '喜神'):
        # 正官 IS favorable — 傷官 attacking it IS a danger
        return {
            'type': 'danger',
            'label': '傷官見官',
            'description': '為禍百端 — 官場風波、降職風險、人事衝突',
        }
    elif officer_role in ('忌神', '仇神'):
        # 正官 is unfavorable — 傷官 制官 is BENEFICIAL
        return {
            'type': 'opportunity',
            'label': '傷官制官',
            'description': '傷官有力制過旺官殺，事業壓力減輕、敢於突破、容易出頭',
        }
    else:
        # 官 is 閒神 — no actionable info; suppress to avoid noise (Issue 1)
        return None
```

**Cascading — LP-scope is INTENTIONALLY deferred** (Issue 6 from review):
- Per grep: there is no `_detect_lp_indicators` function. The existing `_detect_career_indicators` accepts `lp_ten_god` as a parameter but never uses it for 傷官見官 detection — meaning the buggy danger flag never fired for 大運 either, AND the post-fix opportunity flag also won't fire for 大運.
- **Decision**: leave 大運-scope detection out of THIS fix to keep blast radius small. Add a `# TODO(career-fixes-v3): apply same 傷官見官 decision matrix to lp_ten_god` comment.
- Follow-up task: `mcp__ccd_session__spawn_task` after this PR merges, scope = "extend Fix 3 decision matrix to 大運 scope".

---

### Item 4 — 印通關 missing bonus in `wealthScore`

**Symptom**: Laopo gets 38分 (平常). She has **壬(偏印)透時柱 + 癸(正印)藏丑中氣** → 印通關 (印 strengthens DM AND blocks 財's drain on weak DM, allows DM to "carry" some 財). Per 蕭公子 《新玄機》: 「財旺身弱，必須要有印星有力透出而不受破壞」 — having 印 transforms a 屋富人貧 chart into 中富.

#### Verdict: **YES — we are wrong (under-scoring 中富 charts)**

[`compute_wealth_score`](packages/bazi-engine/app/career_enhanced.py#L237) has 5 factors but **none recognize the classical 印通關 救應**. Specifically:
- Factor 1 (`wealthFavorability`) gives only 10/100 base when wealth_role ∈ 忌仇 (Laopo's case: 仇神)
- Factor 4 (`treasury`) requires `is_strong AND wealth_favorable` for 逢沖開庫 bonus → doesn't apply
- No factor checks for **身弱 + 財旺 + 印透干** save pattern

This makes weak-DM-with-rescue charts look identical to weak-DM-without-rescue charts.

#### Classical evidence

- **《子平真詮》, 沈孝瞻**: 「**財格而身弱無印者，不能擔財**」 (literally: "wealth-pattern with weak body and no 印 cannot carry wealth"). Conversely, weak body **with** 印 CAN carry wealth.
- **《三命通會》**: 「身弱財多，得印星生扶，反為富命」 (paraphrased throughout the volume on 財格).
- **蕭公子 《新玄機》 N.197**: 「**若月令得財局，身衰透印助，須當富命看**」 (If the month-pillar produces a wealth combination and the weak body is helped by 印 透出, it must be regarded as a wealth destiny). Source: [新玄機 N.197 — 蕭公子 身弱財格命局探討](https://fengshui-magazine.com.hk/No.197-Nov13/A199.htm)
- **蘇民峰 《八字講義 第五章》**: 「日干弱，即財多身弱，**有印綬生身**，比劫幫身」 — explicitly lists 印 as the standard 救應. 「**先財後印即可成福，先印後財，必成其辱**」 — *position* of the 印 relative to 財 matters. Source: [masterso.com classroom 619](https://www.masterso.com/classroom/classroom2_1_619.php)
- **聚賢館 — 身弱財多點會唔窮**: lists three save conditions: 「劫比強、天干合印鄰生、傷食通關」. Source: [juxian.com.hk](https://www.juxian.com.hk/e030/)

#### Modern competitor behavior
- **Seer**: explicitly grades Laopo as 中富 (50-60), not 平常. Their algorithm appears to award ~+15-20 to wealth tier when 身弱+財旺+印透干 is detected.
- **shenjige / suanzhun**: same — 印通關 is a recognized "fix" that lifts 平常 → 小富/中富.

#### The correct algorithm

Add a **new sub-factor** to `compute_wealth_score`: `seal_rescue_bonus` (印通關救應加分). Apply ONLY when:
1. DM strength is `weak` or `very_weak` AND
2. `wealth_role ∈ ('忌神','仇神')` (財旺 attacking weak DM) AND
3. 印星 (`produces_me` element) is present in the chart.

Bonus magnitude based on quality of 印 救應:

```pseudocode
def _compute_seal_rescue_bonus(pillars, day_master_stem, effective_gods, strength_v2):
    """
    印通關救應加分 — classical 子平 rule:
    "財多身弱無印 → 屋富人貧；有印透干 → 中富 (擔得起財)"
    """
    if strength_v2.get('category') not in ('weak', 'very_weak'):
        return 0  # rule applies only to weak DM

    dm_element = STEM_ELEMENT[day_master_stem]
    wealth_element = ELEMENT_OVERCOMES[dm_element]
    seal_element = ELEMENT_PRODUCED_BY[dm_element]

    wealth_role = effective_gods.get(wealth_element, '閒神')
    if wealth_role not in ('忌神', '仇神'):
        return 0  # rule applies only when 財 is the imbalance

    all_stems = _get_all_stems(pillars)
    all_hidden = _get_all_hidden_stems(pillars)
    seal_stems = [s for s in all_stems if STEM_ELEMENT.get(s) == seal_element]
    seal_hidden = [h for h in all_hidden if STEM_ELEMENT.get(h) == seal_element]

    if not (seal_stems or seal_hidden):
        return 0  # 屋富人貧 — no 印 to carry the 財

    bonus = 0

    # Tier 1: 印透干 (visible stem) — strongest
    if seal_stems:
        bonus += 25  # base 印透干

        # Tier 1a: 印透 + 通根 (rooted in branch)
        if seal_hidden:
            bonus += 15  # 既透又有根 — full 印 power

        # Tier 1b: 印 IS at 月令本氣 — even stronger ("印當令")
        month_branch = pillars['month']['branch']
        month_main_hidden = HIDDEN_STEMS.get(month_branch, [''])[0]
        if STEM_ELEMENT.get(month_main_hidden) == seal_element:
            bonus += 10  # 印當令

        # Tier 1c: penalty if 印 透干 is broken by 財 directly adjacent
        # 「先財後印即可成福，先印後財，必成其辱」(蘇民峰)
        # If 財 stem is adjacent to 印 stem, deduct
        for pname_idx, pname in enumerate(['year', 'month', 'day', 'hour']):
            stem_el = STEM_ELEMENT.get(pillars[pname]['stem'], '')
            if stem_el == wealth_element:
                # check adjacent pillars for 印
                neighbors = []
                if pname_idx > 0:
                    neighbors.append(pillars[['year','month','day','hour'][pname_idx-1]]['stem'])
                if pname_idx < 3:
                    neighbors.append(pillars[['year','month','day','hour'][pname_idx+1]]['stem'])
                # If 財 sits BETWEEN DM and 印, OR 印 is destroyed by 財 next to it
                for n in neighbors:
                    if STEM_ELEMENT.get(n) == seal_element:
                        bonus -= 8  # 財 破 印
                        break

    # Tier 2: 印 only藏支 — partial rescue
    elif seal_hidden:
        bonus += 12  # 印藏不透 — limited but meaningful

    return min(40, bonus)  # cap to prevent overshoot
```

**Integration into `compute_wealth_score`**:
- Apply `seal_rescue_bonus` AFTER the weighted sum, as a **post-bonus** (not as a 6th weighted factor — this avoids needing to renormalize existing weights and won't accidentally penalize charts where this rule doesn't apply).
- Add to the final score: `final_score = max(0, min(100, round(raw_score + seal_rescue_bonus)))`

**Validation for Laopo**:
- DM=甲 weak ✓
- wealth_element=土, role=仇神 ✓
- 壬 (偏印) 透時干 ✓ → +25
- 癸 (正印) 藏 丑中氣 ✓ → +15
- 月令本氣=己土 (NOT 印) → no Tier 1b bonus
- No 財 adjacent to 印 (戊 is in 戌 hidden, not 透干) → no penalty
- **Total bonus: +40** (capped)
- New score: 38 + 40 = 78 → 大富 (overshoot)

Hmm — that's too generous. The cap is too high. Let me **lower the cap and tighten Tier 1**:

```python
# Tier 1: 印透干 — base
if seal_stems:
    bonus += 15  # base 印透干 (was 25)
    if seal_hidden:
        bonus += 8   # 通根 (was 15)
    if month_main_at_seal:
        bonus += 6   # 印當令 (was 10)
    bonus -= adjacent_penalty  # 財破印
elif seal_hidden:
    bonus += 7   # 印藏不透 (was 12)

return min(20, max(-5, bonus))  # cap at +20, floor at -5
```

For Laopo: 15 + 8 = +23 → cap to +20. New score: 38 + 20 = **58** → 中富. Aligns with Seer (50-60).

**This calibration pass is critical** — when implementing, do a 5-chart smoke test (Roger 中和+食神格 should NOT get this bonus; existing tests for `wealthScore` should be checked for regressions).

---

### Item 5 — 戌戌伏吟 evaluated as 大凶 too readily

**Symptom**: 9月 戊戌 vs 甲戌日 → 戌戌伏吟. We label 大凶. Seer says 一般 (mild negative).

#### Verdict: **PARTIALLY WRONG** — the overall severity tier is too coarse, but 大凶 isn't always wrong (depends on element role).

Current logic at [`career_enhanced.py:1031-1042`](packages/bazi-engine/app/career_enhanced.py#L1031):
```python
if month_branch == day_branch:  # 伏吟
    ...
    if combined == '吉':  combined = '大吉'
    elif combined == '凶': combined = '大凶'
```

The intensification (吉→大吉, 凶→大凶) makes sense **directionally** but ignores **scope**: classical sources distinguish severity by **位置 (which pillars)** and **scope (流月 vs 流年 vs 大運 vs 歲運並臨)**.

#### Classical evidence

- **林子玄 / 算準網**: 「**發生在流年的伏吟最不好，次之是大運、次之是本命**」 (流年 伏吟 worst, then 大運, then natal). 流月 伏吟 alone is **secondary** to all three. Source: [林子玄 — 八字伏吟](https://blog.udn.com/vivian040788/180833752), [算準網 — 伏吟和反吟](https://www.suanzhun.net/article/2224.html)
- **算準網 — 伏吟詳解**: 「歲運並臨」(流年=大運伏吟) is the worst case — 大凶. Single 流月 伏吟 alone is "需注意" but not catastrophic. 
- **百度百科 (伏吟返吟)**: 「天干地支完全相同的伏吟帶來的負面影響比較嚴重，而單某一個天干或地支伏吟的影響相對較小」 — Same stem AND branch is severe; same branch only is mild.
- **《三命通會》**: 伏吟 is NOT inherently 凶 — 「視乎所伏者為何神」 (depends on the ten god being doubled). Quote: 「為忌時不利，為用時受益」.
- Source: [八字命理伏吟通俗詳解 (知乎)](https://zhuanlan.zhihu.com/p/605431735): explicitly states 「為忌時，本人有災，為用時，本人獲利」 — context-dependent, not universally 凶.

#### Modern competitor behavior
- **Seer**: 流月 伏吟 alone with 忌仇 element = "一般" (平/小凶). Reserves "大凶" for 歲運並臨 or 流年 沖+伏吟 stack.
- **suanzhun / shenjige**: similar tiered approach.

#### The correct algorithm

Replace the binary intensification with a **tiered severity scale** based on:
1. **Scope of 伏吟**: 流月 alone (mild) < 大運 (moderate) < 流年 (severe) < 歲運並臨 (most severe)
2. **Element role**: 忌仇 worse than 喜用 worse than 閒神
3. **Pillar位置**: 日柱伏吟 (self/spouse) > 月柱伏吟 (parents/career) > 年/時柱

For **流月-on-day-branch 伏吟** (the case in question), scope is "minor" → maximum severity should be 凶, not 大凶. Detailed mapping:

```pseudocode
def fuyin_modifier(month_branch, day_branch, branch_role, base_label):
    """
    Returns a modified auspiciousness label, plus an interaction note.
    """
    if month_branch != day_branch:
        return base_label, None  # not 伏吟

    # 流月 伏吟 alone is at the LOWER end of severity (per 林子玄, 算準網)
    if branch_role in ('忌神', '仇神'):
        # Worst case for 流月 伏吟
        # 凶 → 凶 (no further downgrade — already 凶)
        # 平 → 小凶 (stress but not catastrophic)
        # 吉 → 平 (positive intent muted by 反覆)
        intensified = {
            '大吉': '吉', '吉': '平', '平': '小凶',
            '凶': '凶', '大凶': '大凶',  # cap — never make 流月 伏吟 worse than 大凶 from base
        }.get(base_label, base_label)
        note = '伏吟日支：忌仇加倍，反覆不安、壓力加大'
    elif branch_role in ('用神', '喜神'):
        # 伏吟 of 喜用 is mostly positive
        intensified = {
            '大吉': '大吉', '吉': '吉', '平': '小吉',
            '凶': '平', '大凶': '小凶',  # mitigating since the doubled element helps
        }.get(base_label, base_label)
        note = '伏吟日支：喜用加倍，但仍有反覆波動'
    else:  # 閒神
        intensified = base_label  # no change for 閒神 伏吟
        note = '伏吟日支：氣場反覆，事務需多檢視'

    return intensified, note
```

**Validation for Laopo's 9月 戊戌**:
- branch_role = 仇神 (土=仇神 for 甲木 weak)
- base_label from new 流月 algorithm (Item 2): combined_score = -1.00 → 凶
- After 伏吟 modifier: 凶 → 凶 (no further downgrade)
- **Result: 凶** (not 大凶). Aligns with Seer's "一般-to-mild-negative".

For the **rare** case where 大凶 IS correct (流月 = 流年 干支同 → essentially 歲運並臨 mini-version):
```python
# Special escalation: if month forms 干支同 with annual stem AND branch
if month_stem == year_stem and month_branch == year_branch:
    # 月 = 流年 — extremely rare event but extreme amplification
    intensified = downgrade_two_steps(intensified) if branch_role in ('忌神','仇神') else intensified
    note = '月柱伏吟流年柱，能量加倍倍 — 重大變動'
```

**Cascading**: lifetime_enhanced.py also uses `-5 for 伏吟 day/month` in luck-period scoring (line 1874-1877) — this is for **大運 伏吟** which has higher severity than 流月. The current `-5` is conservative and probably fine, but worth review.

---

### Item 6 — SEASON_MULTIPLIER may be too narrow for 月令本氣

**Symptom**: Laopo 生於丑月. Our 五行 calc: 土 25.2%, Seer: 土 33.8%. R5 calibration changed multipliers from (1.8/1.4/1.0/0.7/0.5) → (1.5/1.3/1.0/0.8/0.6). Did R5 over-correct?

#### Verdict: **NO — keep current SEASON_MULTIPLIER, BUT add a separate 月令本氣 bonus**

This item required the most careful research because **changing SEASON_MULTIPLIER cascades to 八字終身運** (Roger's chart). The CLAUDE.md doc explicitly warns about this.

#### Classical evidence

- **《子平真詮》論旺相休囚死**: provides ordinal scale (旺>相>休>囚>死) but **NO numeric multipliers**. Source: confirmed by [suanzhun.net 八字与用神 朱祖夏](https://www.suanzhun.net/book/1278.html) which states the system is descriptive, not numerical.
- **易子《五行強弱判斷量化法》**: Modern quantification system. Does NOT use 旺相休囚死 as multipliers at all. Instead: every 地支 = 100 base points, every 天干 = 40 base points; adjustments come from 通根/合化/沖刑 (percentage subtractions), not seasonal multipliers. Source: [易子量化法 (163.com)](https://www.163.com/dy/article/HV7SGO56055627UV.html)
- **算準網 八字旺衰打分定量分析法**: Uses 4天干×36 + 8地支×100 = 544 base points. No 旺相休囚死 multipliers; instead uses raw points. Source: [算準網 — 八字旺衰打分](https://www.suanzhun.net/article/1414.html)
- **現代化"科學算命"打分方法**: Uses simple 5/4/3/2/1 ranking (linear), with day-master receiving a `+1` bonus and a `2x` multiplier for 5+本氣 — no 1.5/1.3 ratios. Sources: [豆瓣 — 現代化打分方法](https://www.douban.com/note/691688936/), [星塵算命](http://m-sz.kvov.com/szws.php)

**Key insight**: There is **NO classical or even modern quantitative consensus on the 旺相休囚死 → multiplier mapping**. Our 1.5/1.3/1.0/0.8/0.6 ratio is a defensible engineering choice. So is 1.8/1.4/1.0/0.7/0.5. Neither matches Seer's 33.8%.

#### Why does Seer give 土 33.8% for Laopo?

Most likely Seer applies **multiple compounding bonuses** for 月令本氣:
1. Raw weight (60% from 丑本氣=己, contributing to 土)
2. Seasonal multiplier
3. **An additional "月令本氣 boost" that we don't have** (e.g., +0.5 to +1.0 raw points to the 月令本氣 element)

Or Seer uses a **lower seasonal multiplier ratio** but a much bigger 月令本氣 raw bonus — net same direction.

#### Modern competitor behavior
- **Seer**: 33.8% (unknown algorithm, but clearly weights 月令 more heavily than us).
- **百度百科**: provides only qualitative descriptions.
- **suanzhun.net / 神机阁**: roughly 25-30% range for 土 in similar 丑月 charts — closer to us than Seer.

#### The correct algorithm — RECOMMENDATION: Keep SEASON_MULTIPLIER, add 月令本氣 raw bonus

Adding a constant raw-score bonus to the 月令本氣 element accomplishes two things:
1. Brings Laopo's 土 closer to 30% (within Seer range)
2. Does NOT change the inter-element seasonal ratio (preserves Roger's 中和 classification)

```pseudocode
# In _accumulate_raw_element_scores or calculate_weighted_five_elements:
def _add_yueling_benqi_bonus(element_scores, month_branch):
    """
    Add raw bonus to the 月令本氣 element to reflect classical
    "月令乃八字權力之最" emphasis.

    Bonus magnitude calibrated so that:
    - Roger (戊午 day in 申月) — bonus to 金 doesn't push DM strength classification
    - Laopo (甲戌 day in 丑月) — bonus to 土 brings 土% to ~30-32%
    """
    benqi_stem = HIDDEN_STEMS.get(month_branch, [''])[0]
    benqi_element = STEM_ELEMENT.get(benqi_stem)
    if benqi_element:
        element_scores[benqi_element] += 1.5  # tunable; start at 1.5
    return element_scores
```

**Why 1.5 raw points (not seasonal multiplier change)?**
- Each manifest stem = 1.0 raw point
- Each 本氣 hidden stem = 0.6-1.0 raw point
- Adding +1.5 to 月令本氣 element = "本氣 counts as if there were ~2x stems contributing"
- This matches the classical principle 「月令乃八字權力之最」 (month decree = supreme weight) without distorting other elements' relative ratios

**Estimated impact**:
- Laopo 丑月: 土 raw goes from ~5 → ~6.5 → after seasonal multiplier (1.5) → larger denominator → **estimated 30-32% 土** (closer to Seer's 33.8%)
- Roger 申月: 金 raw goes from ~3 → ~4.5 → 金 boost ~3-5pp. Need to recompute strength_v2 to confirm Roger's classification stays 偏弱 (per CLAUDE.md, this is the post-R5 baseline).

**SAFER ALTERNATIVE — only apply 月令本氣 bonus to display weighting, NOT to strength_v2 / DM classification**:

The cleanest fix is to add the bonus ONLY in `calculate_weighted_five_elements()` (used for display bar charts in career reading) and NOT in `_accumulate_raw_element_scores()` (which is also called by `calculate_five_elements_balance()` used for analytical decisions). This **isolates** the change to display-only and **eliminates regression risk** for 八字終身運's DM strength classification, 從格 detection, and 用神 assignment.

```python
# In calculate_weighted_five_elements only:
element_scores = _accumulate_raw_element_scores(pillars)
element_scores = _add_yueling_benqi_bonus(element_scores, month_branch)  # NEW
# ... rest of seasonal multiplier and normalization unchanged
```

**This is the recommended approach.** It addresses the user's symptom (display % too low for 土) while leaving SEASON_MULTIPLIER alone (no cascade risk).

**Validation strategy**:
- Run `test_career_calculations.py::TestWeightedFiveElements` — if percentage assertions fail, adjust the +1.5 magnitude
- Run `test_lifetime_enhanced.py` — should show ZERO regressions since `calculate_five_elements_balance()` and `analyze_day_master_strength()` are untouched
- Manually verify Laopo's 土% lands in 30-33% range
- Verify Roger's career display still shows 食神 ~38-44% range

---

## Part B — Implementation Plan

All changes are scoped to **`packages/bazi-engine/app/`** unless noted.

### Fix 1: 三合貴人 — remove filter

**File**: `packages/bazi-engine/app/career_enhanced.py:782-790`

**Function**: `compute_career_allies_enemies()`

**Change**:
```python
# OLD
ally_list = [
    {'branch': b, 'zodiac': ZODIAC_ANIMALS.get(b, '')}
    for b in sorted(allies) if b != year_branch and b != day_branch
]

# NEW
chart_branches = {pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')}
ally_list = [
    {
        'branch': b,
        'zodiac': ZODIAC_ANIMALS.get(b, ''),
        'inChart': b in chart_branches,  # NEW field for UI to optionally tag
    }
    for b in sorted(allies)
]
```

**Test additions** in `tests/test_career_calculations.py::TestCareerAlliesEnemies`:
```python
def test_allies_includes_all_sanhe_partners(self, laopo10_career_result):
    """For Laopo (寅虎 year, 戌狗 day): allies must include both 午 and 戌 even if 戌 is in chart."""
    allies = laopo10_career_result['careerAllies']['allies']
    branches = {a['branch'] for a in allies}
    assert '午' in branches, "Missing 午 (馬) — 寅午戌 partner"
    assert '戌' in branches, "Missing 戌 (狗) — 寅午戌 partner (was filtered out by old bug)"

def test_allies_have_inchart_flag(self, laopo10_career_result):
    """Allies should be marked whether they're in the natal chart."""
    allies = laopo10_career_result['careerAllies']['allies']
    for ally in allies:
        assert 'inChart' in ally
        assert isinstance(ally['inChart'], bool)
    # 戌 is in Laopo's day branch
    xu_ally = next((a for a in allies if a['branch'] == '戌'), None)
    assert xu_ally and xu_ally['inChart'] is True
```

**Cascading impact** (Issue 3 from review — TS type check required):
- Python side: function isolated to career reading. No other reading uses `careerAllies`.
- **TypeScript side**: before adding the new `inChart` field, run:
  ```bash
  grep -rn "careerAllies\|allies\[" packages/shared apps/web apps/api
  ```
  If `careerAllies.allies[*]` has a strict TS type (in `packages/shared/types.ts` or similar), update it to include `inChart: boolean`. If type is `Record<string, any>` or untyped, no TS update needed.
- **AI prompt placeholders**: grep `apps/api` for `{{allies}}` or `{{careerAllies}}` interpolations. Most likely the AI just iterates over `branch`+`zodiac`; adding a field is non-breaking.
- **Fallback option** (if TS strictness creates churn): ship Round 1 WITHOUT `inChart` (keeps the bug fix scope tight), then add `inChart` in a Round 2 frontend PR. The bug fix value (correctly listing 戌) stands alone without `inChart`.

**Validation strategy**: After fix, regenerate Laopo's career reading and confirm `careerAllies.allies` contains both 午 and 戌. Run full `test_career_calculations.py` — only the new test should be added; existing tests should still pass since they don't assert on `allies` content beyond presence.

---

### Fix 2: 流月 algorithm rewrite

**File**: `packages/bazi-engine/app/career_enhanced.py:985-1087`

**Function**: `compute_monthly_forecast_data()`

**Change**: Replace the stem-only auspiciousness logic with the combined stem+branch (+ hidden stems) algorithm from Part A Item 2. Implement as a new helper `_assess_monthly_combined()`.

**New helper signature**:
```python
def _assess_monthly_combined(
    pillars: Dict,
    day_master_stem: str,
    month_stem: str,
    month_branch: str,
    effective_gods: Dict[str, str],
    annual_auspiciousness: str,
) -> Tuple[str, List[Dict[str, str]]]:
    """
    Returns (auspiciousness_label, list_of_branch_interaction_notes).
    """
    ...
```

The function must:
1. Compute `combined_score` from stem (35%) + branch本氣 (65%) + hidden 中氣 (10%) + 餘氣 (5%) using `role_to_score = {'用神':+2, '喜神':+1, '閒神':0, '仇神':-1, '忌神':-2}`
2. Map to base label via 5-band threshold (大吉/吉/平/凶/大凶)
3. Apply day-branch interaction modifiers (伏吟→ delegate to Fix 5 helper; 六合 upgrade; 六沖 context-aware)
4. Sweep all natal branches for 沖 of 忌仇 → upgrade label by 1 step
5. Apply 流年 cap rule (大吉 caps monthly at 凶; 大凶 caps monthly at 吉)

**Test additions** in `tests/test_career_calculations.py::TestMonthlyForecast`:
```python
def test_laopo_jan_2026_geng_yin_is_favorable(self, laopo10_career_result):
    """1月 庚寅: 庚=忌 but 寅=喜 + 寅沖申(時支忌) — should land in favorable range (per v3 worked table: 小吉)."""
    months = laopo10_career_result['monthlyForecasts']
    jan = next(m for m in months if m['stem'] == '庚' and m['branch'] == '寅')
    assert jan['auspiciousness'] in ('小吉', '吉', '平'), \
        f"1月 庚寅 should be 小吉/吉/平 (favorable-ish), got {jan['auspiciousness']}"

def test_laopo_oct_2026_ji_hai_is_balanced(self, laopo10_career_result):
    """10月 己亥: 亥=用神(印) dominates — should be 平 or 吉."""
    months = laopo10_career_result['monthlyForecasts']
    oct_m = next(m for m in months if m['stem'] == '己' and m['branch'] == '亥')
    assert oct_m['auspiciousness'] in ('平', '吉'), \
        f"10月 己亥 should be 平 or 吉, got {oct_m['auspiciousness']}"

def test_laopo_nov_2026_geng_zi_is_balanced(self, laopo10_career_result):
    """11月 庚子: 子=正印=用神 dominates 庚=忌 — should be 平 or 吉."""
    months = laopo10_career_result['monthlyForecasts']
    nov = next(m for m in months if m['stem'] == '庚' and m['branch'] == '子')
    assert nov['auspiciousness'] in ('平', '吉'), \
        f"11月 庚子 should be 平 or 吉, got {nov['auspiciousness']}"

def test_no_more_than_5_inauspicious_months_for_laopo(self, laopo10_career_result):
    """Sanity: a 身弱官殺旺 chart should not have 8+ 凶 months in a single year."""
    months = laopo10_career_result['monthlyForecasts']
    bad = [m for m in months if m['auspiciousness'] in ('凶', '大凶')]
    assert len(bad) <= 5, f"Too many 凶 months ({len(bad)}); algorithm too pessimistic"
```

**Cascading impact**: NONE outside career_enhanced.py. Lifetime reading does not have monthly forecasts. Compatibility uses different logic.

**Validation strategy**:
- Re-run Laopo's 12-month forecast: count 吉/平/凶 distribution. Target: ≤5 凶, ≥3 吉, with 1月/10月/11月 specifically improved.
- Re-run Roger's 12-month forecast (DM=戊 偏弱, 用神=火, 喜神=土): confirm distribution looks reasonable, not all flipped to opposite extreme.

---

### Fix 3: 傷官見官 conditional logic

**File**: `packages/bazi-engine/app/career_enhanced.py:1949-1963`

**Function**: `_detect_career_indicators()`

**Change**: Replace the unconditional flag with a 3-branch decision based on `officer_role = effective_gods[officer_element]`.

```python
# OLD (lines 1949-1963)
if year_ten_god == '傷官' and '正官' in manifest_gods:
    indicators.append({'type': 'danger', 'label': '傷官見官', ...})
if year_ten_god == '正官' and '傷官' in manifest_gods:
    indicators.append({'type': 'danger', 'label': '傷官見官', ...})

# NEW
shang_guan_situation = (
    (year_ten_god == '傷官' and '正官' in manifest_gods) or
    (year_ten_god == '正官' and '傷官' in manifest_gods)
)
if shang_guan_situation:
    dm_element = STEM_ELEMENT[day_master_stem]
    officer_element = ELEMENT_OVERCOME_BY[dm_element]
    officer_role = effective_gods.get(officer_element, '閒神')

    if officer_role in ('用神', '喜神'):
        indicators.append({
            'type': 'danger',
            'label': '傷官見官',
            'description': '為禍百端 — 官場風波、降職風險、人事衝突',
        })
    elif officer_role in ('忌神', '仇神'):
        indicators.append({
            'type': 'opportunity',
            'label': '傷官制官',
            'description': '傷官有力制過旺官殺，事業壓力減輕、突破舊框架',
        })
    # else: 官 is 閒神 — suppress (per Issue 1 R1 + Issue 2.7 R2: avoid noise)
```

**Test additions** in `tests/test_career_calculations.py::TestAnnualForecast`:
```python
def test_laopo_2027_ding_wei_no_shangguan_jian_guan_danger(self, laopo10_career_result):
    """2027 丁未: 丁=傷官 + 辛(正官)=忌神 → should NOT flag as danger."""
    annual = laopo10_career_result['annualForecasts']
    year_2027 = next(a for a in annual if a['year'] == 2027)
    indicators = year_2027['careerIndicators']
    danger_labels = [i['label'] for i in indicators if i['type'] == 'danger']
    assert '傷官見官' not in danger_labels, \
        "傷官見官 should NOT fire as danger when 正官 is 忌神"
    # Should be opportunity instead
    opp_labels = [i['label'] for i in indicators if i['type'] == 'opportunity']
    assert '傷官制官' in opp_labels, \
        "Should flag 傷官制官 (opportunity) when 正官 is 忌神"

def test_strong_dm_with_official_yongshen_still_danger(self):
    """Synthetic strong-DM chart where 正官=用神 should STILL flag 傷官見官 as danger."""
    # Construct minimal pillars + effective_gods where:
    # - DM strong, e.g. 庚 strong → 用神=火(正官 for 庚)
    # - 流年 傷官 = 癸
    # Expect: 'danger' tag with label '傷官見官'
    ...
```

**Cascading impact**: NONE.

**Validation**: After fix, Laopo's 2027 careerIndicators no longer has the false 傷官見官 danger; instead has 傷官制官 opportunity. Verify against existing tests for `_detect_career_indicators` (should be 0 — function is private and not directly tested).

---

### Fix 4: 印通關 wealth bonus

**File**: `packages/bazi-engine/app/career_enhanced.py:237-383`

**Functions**:
- `compute_wealth_score()` — add post-bonus
- New helper `_compute_seal_rescue_bonus()` (placed near `_compute_treasury_score`)

**Change**:
```python
# Inside compute_wealth_score, BEFORE final clamping:
seal_rescue_bonus = _compute_seal_rescue_bonus(
    pillars, day_master_stem, effective_gods, strength_v2,
    cong_ge=cong_ge,  # threaded from compute_wealth_score's cong_ge param
)
final_score = max(0, min(100, round(raw_score + seal_rescue_bonus)))

# In return dict:
return {
    'score': final_score,
    'tier': tier,
    'subScores': {
        'wealthFavorability': round(f1_score),
        'wealthReality': round(f2_score),
        'outputGenerating': round(f3_score),
        'treasury': round(f4_score),
        'luckPeriodSupport': round(f5_score),
        'sealRescueBonus': seal_rescue_bonus,  # NEW: visible for transparency
    },
}
```

The new helper (full impl in Part A Item 4 above):
```python
def _compute_seal_rescue_bonus(
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict[str, str],
    strength_v2: Dict,
    cong_ge: Optional[Dict] = None,  # NEW (Issue 2.4 R2): skip rescue for 從格 charts
) -> int:
    """印通關救應加分 — 「身弱財旺有印透干 → 中富擔財」(《新玄機》/蘇民峰)"""
    # Skip 從格 — 從財格/從殺格 invert 喜忌 (財/殺 become 用神, 印 becomes 忌神)
    if cong_ge is not None:
        return 0
    if strength_v2.get('category') not in ('weak', 'very_weak'):
        return 0
    dm_element = STEM_ELEMENT[day_master_stem]
    wealth_element = ELEMENT_OVERCOMES[dm_element]
    seal_element = ELEMENT_PRODUCED_BY[dm_element]
    if effective_gods.get(wealth_element) not in ('忌神', '仇神'):
        return 0
    all_stems = _get_all_stems(pillars)
    all_hidden = _get_all_hidden_stems(pillars)
    seal_stems = [s for s in all_stems if STEM_ELEMENT.get(s) == seal_element]
    seal_hidden = [h for h in all_hidden if STEM_ELEMENT.get(h) == seal_element]
    if not (seal_stems or seal_hidden):
        return 0  # 屋富人貧 — no rescue
    bonus = 0
    if seal_stems:
        bonus += SEAL_RESCUE_WEIGHTS['transparent_base']
        if seal_hidden:
            bonus += SEAL_RESCUE_WEIGHTS['rooted']
        month_branch = pillars['month']['branch']
        month_main = HIDDEN_STEMS.get(month_branch, [''])[0]
        if STEM_ELEMENT.get(month_main) == seal_element:
            bonus += SEAL_RESCUE_WEIGHTS['ruling_month']
        # 財破印 adjacency penalty
        pnames = ['year', 'month', 'day', 'hour']
        for i, pname in enumerate(pnames):
            if STEM_ELEMENT.get(pillars[pname]['stem'], '') != wealth_element:
                continue
            for j in (i-1, i+1):
                if 0 <= j < 4 and STEM_ELEMENT.get(pillars[pnames[j]]['stem'], '') == seal_element:
                    bonus -= SEAL_RESCUE_WEIGHTS['adjacency_penalty']
                    break
    elif seal_hidden:
        bonus += SEAL_RESCUE_WEIGHTS['hidden_only']
    return min(SEAL_RESCUE_WEIGHTS['cap_max'], max(SEAL_RESCUE_WEIGHTS['cap_min'], bonus))
```

**Constants** (place at module top, near `GAITOU_SET`):
```python
# 印通關救應加分 — 「身弱財旺有印透干 → 中富擔財」(《新玄機》, 蘇民峰)
# Issue 2 from review: extract magic numbers; tunable via this dict.
# Issue 10 from review: cap raised from +20 to +25 to give Laopo headroom in 中富 band.
SEAL_RESCUE_WEIGHTS = {
    'transparent_base':  15,  # 印透干 base
    'rooted':             8,  # 印透干 + 通根
    'ruling_month':       6,  # 印當令 (印 sits at 月令本氣)
    'adjacency_penalty':  8,  # 財 stem adjacent to 印 stem (subtracted)
    'hidden_only':        7,  # 印藏不透 (partial rescue)
    'cap_max':           25,  # final clamp upper bound
    'cap_min':           -5,  # final clamp lower bound
}
```

**Calibration prediction for Laopo**: 15(transparent) + 8(rooted) + 0(印當令 — 月令本氣是己土, 不是印水) + 0(no 財破印 — 戊只藏戌中, 不透) = +23. Within new cap of 25. New score: 38 + 23 = **61** → mid-中富 band (55-69), with ~+9 headroom above the floor and ~+8 below the ceiling. Less brittle than v1's 58.

**Test additions** in `tests/test_career_calculations.py`:
```python
class TestSealRescueBonus:
    def test_laopo_gets_seal_rescue_bonus(self, laopo10_pillars):
        """Laopo (壬偏印透時, 癸正印藏丑) should get full 印透干+通根 bonus."""
        from app.career_enhanced import _compute_seal_rescue_bonus
        effective_gods = {'水': '用神', '木': '喜神', '火': '閒神', '土': '仇神', '金': '忌神'}
        strength_v2 = {'category': 'very_weak'}
        bonus = _compute_seal_rescue_bonus(laopo10_pillars, '甲', effective_gods, strength_v2)
        assert bonus >= 15, f"Laopo should get strong seal rescue bonus, got {bonus}"

    def test_no_bonus_for_strong_dm(self, laopo10_pillars):
        """Strong DM should not get the bonus (rule scope)."""
        from app.career_enhanced import _compute_seal_rescue_bonus
        effective_gods = {'水': '用神', '木': '喜神', '火': '閒神', '土': '仇神', '金': '忌神'}
        strength_v2 = {'category': 'strong'}
        bonus = _compute_seal_rescue_bonus(laopo10_pillars, '甲', effective_gods, strength_v2)
        assert bonus == 0

    def test_no_bonus_when_wealth_is_yongshen(self, laopo10_pillars):
        """If 財=用神 (e.g., strong DM), no rescue needed."""
        from app.career_enhanced import _compute_seal_rescue_bonus
        effective_gods = {'土': '用神', '金': '喜神', '水': '閒神', '木': '仇神', '火': '忌神'}
        strength_v2 = {'category': 'very_weak'}
        bonus = _compute_seal_rescue_bonus(laopo10_pillars, '甲', effective_gods, strength_v2)
        assert bonus == 0

def test_laopo_wealth_score_lifted_by_seal_rescue(self, laopo10_career_result):
    """End-to-end: Laopo's wealth score should land in 小富/中富 — NOT pinned to a specific number to avoid brittleness (Issue 10)."""
    wealth = laopo10_career_result['wealthScore']
    assert wealth['tier'] != '平常', \
        f"Laopo should escape 平常 tier post-seal-rescue, got {wealth['tier']} ({wealth['score']})"
    assert wealth['tier'] in ('小富', '中富'), \
        f"Expected 小富/中富, got {wealth['tier']} ({wealth['score']})"
    # Sanity bound — should NOT shoot into 大富 (would mean over-correction)
    assert wealth['score'] < 75, \
        f"Score overshoot: {wealth['score']}; bonus may be too generous"
```

**Cascading impact**: 
- Existing `compute_wealth_score` tests — may need updates if they assert on Laopo's specific score (currently 38). After fix expected ~58.
- 八字終身運 does NOT use `compute_wealth_score`, so no cascade there.

**Validation**: Re-run `test_career_calculations.py::TestComputeWealthScore` — update any hardcoded score assertions for Laopo. Roger's chart (DM=戊 偏弱, 財=水=用神 — no rescue triggered): bonus should be 0 → no regression.

---

### Fix 5: 伏吟 tiered severity

**File**: `packages/bazi-engine/app/career_enhanced.py:1031-1042`

**Function**: Inside `compute_monthly_forecast_data()` (or extract as helper)

**Change**: Replace binary intensification with the role-aware tiered modifier from Part A Item 5.

This integrates with Fix 2 — the new monthly algorithm produces a base label, and the 伏吟 modifier transforms it. Provide as a helper:

```python
def _apply_fuyin_modifier(
    base_label: str,
    branch_role: str,
    *,
    lp_branch: Optional[str] = None,
    year_branch: Optional[str] = None,
    month_branch: str = '',
) -> Tuple[str, Dict]:
    """
    Apply 流月 伏吟 modifier — capped severity per classical sources.
    流月 伏吟 alone is at the LOWER end (per 林子玄, 算準網).

    Issue 5 from review: if 流月 伏吟 STACKS with 大運/流年 伏吟 on the same branch,
    escalate severity by one tier (the 「歲運並臨」-style amplification).
    """
    # Detect stacking — same branch repeating across scopes
    stacking = (
        (lp_branch == month_branch) or       # 大運支 = 流月支
        (year_branch == month_branch)        # 流年支 = 流月支
    )

    if branch_role in ('忌神', '仇神'):
        intensified = {
            '大吉': '吉', '吉': '平', '平': '小凶',
            '凶': '凶', '大凶': '大凶',
        }.get(base_label, base_label)
        if stacking:
            # Escalate one tier downward (歲運並臨-style amplification)
            intensified = _shift_tier(intensified, -1)
        note = {
            'type': '伏吟',
            'description': '月支與日支伏吟（忌仇加倍）' + ('+大運/流年同支' if stacking else ''),
            'effect': '反覆不安、壓力加大' + ('（多重伏吟，影響加倍）' if stacking else ''),
        }
    elif branch_role in ('用神', '喜神'):
        intensified = {
            '大吉': '大吉', '吉': '吉', '平': '小吉',
            '凶': '平', '大凶': '小凶',
        }.get(base_label, base_label)
        # No upward escalation when stacking — even multi-scope 伏吟 of 喜用 is "good but reversed"
        note = {
            'type': '伏吟',
            'description': '月支與日支伏吟（喜用加倍）' + ('+大運/流年同支' if stacking else ''),
            'effect': '能量加倍但仍有反覆',
        }
    else:
        intensified = base_label
        note = {
            'type': '伏吟',
            'description': '月支與日支伏吟（閒神）',
            'effect': '氣場反覆',
        }
    return intensified, note
```

**Caller integration**: `_assess_monthly_combined()` already has access to `lp_branch` and `year_branch` from the surrounding context. Pass them through.

**Test additions**:
```python
def test_laopo_sep_2026_wu_xu_not_daxiong(self, laopo10_career_result):
    """9月 戊戌 vs 甲戌日: 戌戌伏吟 + 戌=仇神. Should be 凶 not 大凶."""
    months = laopo10_career_result['monthlyForecasts']
    sep = next(m for m in months if m['stem'] == '戊' and m['branch'] == '戌')
    assert sep['auspiciousness'] != '大凶', \
        f"9月 戊戌 流月 伏吟 alone should not be 大凶 (got {sep['auspiciousness']})"

def test_fuyin_with_yongshen_intensifies_positively(self):
    """伏吟 of 用神 element should be positive intensification, not negative."""
    from app.career_enhanced import _apply_fuyin_modifier
    label, note = _apply_fuyin_modifier('平', '用神')
    assert label == '小吉'

def test_fuyin_with_jishen_caps_at_xiong(self):
    """伏吟 of 忌神/仇神 already-凶 base should not become 大凶."""
    from app.career_enhanced import _apply_fuyin_modifier
    label, _ = _apply_fuyin_modifier('凶', '忌神')
    assert label == '凶', "流月 伏吟 alone should not escalate 凶 → 大凶"
```

**Cascading impact**: 
- `lifetime_enhanced.py:1874-1877` uses `-5` for 大運 伏吟 — DIFFERENT scope (大運 vs 流月). Keep unchanged.
- `annual_enhanced.py` uses 伏吟 in marriage signals — unrelated.

**Validation**: Combined with Fix 2, re-verify Laopo's monthly distribution.

---

### Fix 6: 月令本氣 boost (display only)

**File**: `packages/bazi-engine/app/five_elements.py`

**Function**: `calculate_weighted_five_elements()` (NOT `_accumulate_raw_element_scores` — keep that pure)

**Change**: Add a new step right before the seasonal multiplier:

```python
def calculate_weighted_five_elements(
    pillars: Dict,
    month_branch: str,
    extra_pillars: Optional[List[Dict[str, str]]] = None,
    branch_interactions: Optional[Dict] = None,
) -> Dict[str, Dict]:
    # Step 1: Base raw element scores (unchanged)
    element_scores = _accumulate_raw_element_scores(pillars)

    # Step 2: Extra pillar contributions (unchanged)
    if extra_pillars:
        ...

    # Step 2.5: NEW — 月令本氣 raw bonus (DISPLAY ONLY)
    # Classical: 「月令乃八字權力之最」 — month decree is supreme.
    # This bonus is applied ONLY in the weighted display function, NOT in
    # raw balance or DM strength — those use _accumulate_raw_element_scores
    # directly to avoid distorting analytical decisions.
    benqi_stem = HIDDEN_STEMS.get(month_branch, [''])[0]
    benqi_element = STEM_ELEMENT.get(benqi_stem)
    if benqi_element:
        element_scores[benqi_element] += 1.5  # tunable; calibrate against Laopo

    # Step 3: Seasonal multiplier (unchanged)
    ...
```

**Constants**: Add at top of `five_elements.py`:
```python
# 月令本氣 raw point bonus — adds extra weight to display calculation
# to reflect classical "月令乃八字權力之最" emphasis.
# Calibrated against Laopo (1987-01-25) so 土 lands ~30-32% (vs prior 25.2%).
# CALIBRATION CAUTION: tune this value if multiple charts produce off-target %s.
YUELING_BENQI_BONUS: float = 1.5
```

**Test additions** in `tests/test_career_calculations.py::TestWeightedFiveElements`:
```python
def test_laopo_tu_percentage_in_seer_range(self, laopo10_pillars):
    """Laopo's 土% in 丑月 should land in 30-33% range (close to Seer 33.8%)."""
    result = calculate_weighted_five_elements(laopo10_pillars, '丑')
    tu_pct = result['土']['percentage']
    assert 28.0 <= tu_pct <= 35.0, \
        f"土 should be 28-35% in laopo's 丑月 chart, got {tu_pct}"
```

Update existing tests if they assert on specific 土 percentage — find via:
```bash
grep -n "土.*percentage\|percentage.*土" packages/bazi-engine/tests/test_career_calculations.py
```

**Cascading impact** — **CRITICAL** (Issue 9 audit added):
- `_accumulate_raw_element_scores()` is **NOT modified** → `calculate_five_elements_balance()`, `calculate_five_elements_balance_seasonal()`, and `analyze_day_master_strength()` are **untouched**.
- `strength_v2`, 從格 detection, 用神 assignment, and DM classification — **all unaffected**. Roger's classification stays 偏弱 (post-R5 baseline).
- Lifetime reading uses `calculate_five_elements_balance_seasonal()` for ring chart → unaffected at the **percentage** level.
- **Career reading display** is the ONLY place where `percentage` changes — BUT see `level` cascade below.

**`level` field cascade audit** (Issue 9 from review): `calculate_weighted_five_elements()` returns `{element: {percentage, level, talents}}`. After Fix 6, the `percentage` of the 月令本氣 element shifts up ~5-7pp for typical charts → may cross a `level` threshold (e.g., '強' → '很強'). Need to enumerate downstream uses of `level`:

```bash
# Required pre-implementation greps (must be re-run by implementing agent):
grep -rn "weightedElements" packages/bazi-engine apps/web apps/api packages/shared
grep -rn "\.level\b" packages/bazi-engine/tests/ | grep -i "five\|element\|weighted"
grep -rn "five_element.*level\|element.*level" apps/web/app apps/api/src
```

**Predicted affected sites** (best estimate based on existing structure):
1. **Test assertions**: `tests/test_career_calculations.py::TestWeightedFiveElements` likely has assertions on `level` for fixture charts. Update Laopo's expected `土` level from '強' → '很強'. Roger's expected `金` level may shift from '一般' → '強' (申月 金=本氣).
2. **AI prompt placeholders**: `apps/api/src/.../prompts.ts` (or similar) probably interpolates `weightedElements[X].level` into the AI prompt. Re-run smoke test on AI output for tone consistency.
3. **UI badges**: `apps/web/app/components/.../WeightedElementsBar.tsx` (or similar) probably color-codes by `level`. No code change needed but visual review required.
4. **NO impact on career reading's other deterministic sections** — `weightedTenGods`, `wealthScore`, `reputationScore`, `careerAllies`, etc. all use ten_god distributions or strength_v2, NOT `weightedElements.level`.

**Calibration matrix** (Issue 4 from review — must be filled before implementing):

| Chart | DM | 月令 | 月令本氣元素 | Pre-fix % | Target % | Notes |
|-------|-----|------|------------|-----------|----------|-------|
| Laopo | 甲(very_weak) | 丑 | 土 | 25.2% | 30-33% | Anchor case; primary calibration target |
| Roger | 戊(偏弱) | 申 | 金 | ~31% | 33-37% | Must NOT push 金 over 40% (would distort 食神 narrative) |
| (Synthetic A) | 丙 strong | 午 | 火 | tbd | tbd | strong DM, 月令本氣=DM元素 — verify display reads sensibly |
| (Synthetic B) | 庚 | 寅 | 木 | tbd | tbd | 月令本氣 is DM's 財 — verify 財 doesn't blow out |
| (Synthetic C) | 壬 | 卯 | 木 | tbd | tbd | 月令本氣 is DM's 食傷 — verify |

**Calibration procedure** (do this BEFORE merging, NOT post-deploy):
1. Implement with `YUELING_BENQI_BONUS = 1.5` as starting value.
2. Run all 5 charts; record actual percentages and `level` outputs.
3. If Laopo lands outside 30-33%, adjust to 1.2 (lower) or 1.8 (higher).
4. If Roger's 金 exceeds 40% OR Roger's `_assess_element_auspiciousness` narrative breaks, lower the bonus.
5. If synthetic charts produce nonsense (e.g., DM-element pushed to 50%+), reconsider the entire approach — possibly cap the bonus at "raise by ≤8pp" rather than fixed magnitude.

**Validation** (post-fix smoke):
- `pytest tests/test_lifetime_enhanced.py -v` should show **zero changes** (the calculation it uses is bypassed)
- `pytest tests/test_career_calculations.py::TestWeightedFiveElements -v` will need 1-2 percentage assertions adjusted upward
- `pytest tests/test_career_calculations.py -v -k "level"` — find and update level-dependent assertions
- Roger's career display: 食神 (water in 申月) % may shift slightly — verify it stays in the 35-45% expected range
- AI prompt sample: regenerate Laopo and Roger career readings, eyeball the 五行 narrative section for "土很強" vs "土強" consistency

---

## Part C — Risk + Sequencing

### Dependency graph

```
Fix 1 (allies)         — INDEPENDENT
Fix 3 (傷官見官)       — INDEPENDENT
Fix 4 (印通關)         — INDEPENDENT
Fix 6 (月令本氣)       — INDEPENDENT (display only)
Fix 2 (流月 algo)      ─┐
Fix 5 (伏吟 tiers)     ─┴── INTEGRATED (Fix 5 is a helper inside Fix 2)
```

### Recommended implementation order

1. **Fix 1 (三合貴人)** — smallest, lowest risk, unambiguous bug. Build confidence.
2. **Fix 3 (傷官見官)** — small, classical evidence is overwhelming. Easy win.
3. **Fix 4 (印通關)** — moderate. Calibration of bonus magnitude is the risk; start conservative.
4. **Fix 6 (月令本氣 boost)** — moderate. Isolation to display function makes it safe; calibrate against Laopo+Roger.
5. **Fix 2 + Fix 5 (流月 + 伏吟)** — largest single change. Implement together since Fix 5 is integrated into Fix 2's modifier chain. Heavy testing required.

### Risk classification

| Fix | Risk | Reason |
|-----|------|--------|
| 1 | 🟢 Low | Single-line bug fix; isolated |
| 3 | 🟢 Low | Classical consensus is unambiguous |
| 4 | 🟡 Medium | Bonus magnitude needs calibration; affects wealth tier display |
| 5 | 🟡 Medium | New severity tiers; needs validation across multiple charts |
| 6 | 🟡 Medium | Touches `five_elements.py`; isolation strategy must be enforced strictly |
| 2 | 🟠 Medium-High | Largest algorithm rewrite; affects all 12 monthly entries; potential for over-correction |

### Cross-system regression watch

- **None of these fixes touch SEASON_MULTIPLIER, HIDDEN_STEM_WEIGHTS, TEN_GOD_CATEGORIES, GAITOU_SET, JIEJIAO_SET, or any other shared constant.** This is by design.
- **Lifetime reading (八字終身運)**: only Fix 6 touches `five_elements.py`, but the change is scoped to `calculate_weighted_five_elements()` which lifetime does NOT call (lifetime uses `calculate_five_elements_balance_seasonal()`). Run `test_lifetime_enhanced.py` after each fix to confirm zero regressions.
- **Compatibility / Romance**: untouched.
- **Annual enhanced**: untouched.

### Validation strategy (post-implementation) — Calibration smoke matrix (Issue 11)

The 2-chart validation in v1 was inadequate. v2 expands to **6 chart classes** covering the major cases each fix touches. Each row lists per-fix expected behavior. Implementing agent must verify ALL rows before declaring success.

| # | Chart class | Fix 1 (allies) | Fix 2 (流月) | Fix 3 (傷官見官) | Fix 4 (印通關) | Fix 5 (伏吟) | Fix 6 (月令本氣) |
|---|---|---|---|---|---|---|---|
| 1 | **Laopo** (target case): 甲 very_weak, 正官格, 印透干 | 午+戌 both listed | ≤5 凶 months, 1月/10月/11月 improved | 2027 = opportunity not danger | wealth tier ∈ {小富,中富}, score < 75 | 9月 戊戌 = 凶 not 大凶 | 土% in 30-33%, level may shift to 很強 |
| 2 | **Roger** (no-regression): 戊 偏弱, 食神格, 用神=火 | unchanged behavior | distribution shouldn't flip pessimistic | unchanged (no 傷官見官 trigger) | bonus = 0 (財=用神, no rescue triggered) | unchanged (no day-month 伏吟 in 2026) | 金% in 33-37%, 食神 narrative still coherent |
| 3 | **從財格 chart** (DM extremely weak, 從於財旺): pick a 戊 born in 子月 with 4-pillar 水 dominance | works | works | works (no special handling needed) | bonus = 0 (從格 should NOT trigger rescue — 從格 inverts 喜忌; verified via `cong_ge is not None` parameter — see Fix 4 helper signature update below) | works | works |
| 4 | **中和 chart** (no imbalance): pick a 庚 born in 寅月 with balanced elements | works | works | works | bonus = 0 (DM not weak) | works | works |
| 5 | **Strong-DM-with-印=忌神 chart**: pick a 甲 born in 寅月 with 水印 forming 印重身旺 | works | works | works (官 may be 用神 → danger correctly fires) | bonus = 0 (DM not weak) | works | works |
| 6 | **Chart with no 印 at all**: pick any chart with zero 水 stems and zero 水 in branch hidden stems | works | works | works | bonus = 0 (short-circuit on `not (seal_stems or seal_hidden)`) | works | works |

**How to construct charts 3-6 if no fixtures exist**:
- 從財格: 戊午 / 壬子 / 戊午 / 壬子 (pure 從財 toy — verify with engine before using)
- 中和: 庚寅 / 戊寅 / 甲午 / 丙寅 (rough balance — verify)
- Strong-DM-with-印忌: 甲寅 / 壬子 / 甲子 / 癸亥 (印重)
- No-印 chart: 甲午 / 丙午 / 戊戌 / 戊午 (no 水 anywhere — for 甲, 印=水)
- Pull from existing test fixtures first (`packages/bazi-engine/tests/fixtures/` if present); fall back to constructed charts.

**Test consolidation**:
1. **Per-fix unit tests** as outlined in each Fix section.
2. **Smoke matrix tests** — one parameterized test per chart class verifying each fix's expected behavior:
   ```python
   @pytest.mark.parametrize("chart_class,expected", [
       ('laopo', LAOPO_EXPECTATIONS),
       ('roger', ROGER_EXPECTATIONS),
       ('cong_cai', CONG_CAI_EXPECTATIONS),
       ...
   ])
   def test_smoke_matrix(chart_class, expected, ...):
       ...
   ```
3. **Full test suite regression**: `cd packages/bazi-engine && pytest tests/ -v` — all 1771 tests should pass (+ ~25-30 new tests once smoke matrix is added).
4. **Lifetime regression**: `pytest tests/test_lifetime_enhanced.py -v` should show **zero changes** before AND after Fix 6 (sanity check that isolation strategy held).
5. **Manual e2e**: regenerate Laopo's full career reading via the API; eyeball each section for sensibility (no contradictions between deterministic data and AI narrative).

### Items deferred / discussed-with-user (v2 — updated)

**Must be answered BEFORE Fix 6 implementation**:
- **UD-1 (top of doc)**: cross-reading 五行% inconsistency — pick (a) career-only with disclosure / (b) backport to lifetime / (c) defer Fix 6.

**Open questions that can be answered during implementation**:
- **Fix 6 calibration**: +1.5 magnitude is starting value; calibration matrix in this Part C lists 5 charts to verify. Adjust to 1.2-1.8 range if any chart misses target.
- **Fix 4 transparency**: `sealRescueBonus` exposed in `subScores` for now. If user prefers hidden, remove from return dict.
- **Fix 1 `inChart` field**: include in v1 if TS types accept it cleanly; defer to follow-up PR if it requires churn (see Fix 1 cascading section).

**Explicitly deferred follow-up tasks** (file via spawn_task after main PR merges):
- **LP-scope 傷官見官 detection**: extend Fix 3's decision matrix to 大運 scope. (Issue 6 from review)
- **Fix 2 step 4a extension to all natal branches**: currently only checks day_branch for LIUHE/LIUCHONG. Could extend to scan year/month/hour. CAP=±1 already constrains, but more comprehensive coverage may help. Defer.
- **Fix 2 symmetric step 4b**: add "沖去喜用 = downgrade" sweep alongside "沖去忌仇 = upgrade". Risks over-pessimism; defer until 3-month feedback collected.
- **Lifetime annual auspiciousness label vocabulary alignment**: lifetime currently uses 9-tier set with `凶中帶機` etc. Career switches to 7-tier. Aligning the two = future scope.

---

## Sources cited

### Item 1 — 三合貴人
- [合婚指標 — 六合、三合、三會、相沖、相刑、相破、相害](https://barbieyao.wixsite.com/lotusrain/single-post/2020/01/19/%E5%90%88%E5%A9%9A%E6%8C%87%E6%A8%99-%E5%85%AD%E5%90%88%E3%80%81%E4%B8%89%E5%90%88%E3%80%81%E4%B8%89%E6%9C%83%E3%80%81%E7%9B%B8%E6%B2%96%E3%80%81%E7%9B%B8%E5%88%91%E3%80%81%E7%9B%B8%E7%A0%B4%E3%80%81%E7%9B%B8%E5%AE%B3)
- [屬虎的貴人屬相 — sina blog](https://blog.sina.com.cn/s/blog_14552df340102vl4l.html)
- [八字三合意思與地支三合局全解析 — 禪香不二](https://www.inzense.com.tw/en/bazi-three-harmony-meaning-and-earthly-branch-formations-complete-guide-strongest-combination-power-and-marriage-benefactors/)
- [3合6合的區分+你的生肖貴人 — 知乎](https://zhuanlan.zhihu.com/p/663301647)

### Item 2 — 流月算法
- [八字如何看"流月"的吉凶 — 網易](https://www.163.com/dy/article/JU81TQJD055691XW.html) — primary source for 干支互動規則 + branch dominance
- [大運、流年、流月、流日之間如何作用 — 算準網](https://www.suanzhun.net/article/2761.html)
- [流年、流月、流日如何分析 — 算準網](https://www.suanzhun.net/article/2223.html)
- [八字命理 — 大運流年流月的進階學習 — 知乎](https://zhuanlan.zhihu.com/p/24603888781)

### Item 3 — 傷官見官
- [伤官见官 — 百度百科](https://baike.baidu.com/item/%E4%BC%A4%E5%AE%98%E8%A7%81%E5%AE%98/2651732) — direct quote 「如官為忌，傷官見官反以吉論」
- [《特殊命格》傷官見官，為禍百端 — vocus](https://vocus.cc/article/610b3599fd897800018759a4)
- [命運探索：傷官見官 為禍百端 — 大紀元](https://www.epochtimes.com/b5/13/6/1/n3884171.htm)
- [傷官可愛又可恨 矛盾又複雜的星 — 大紀元](https://www.epochtimes.com/b5/20/10/8/n12461081.htm) — 「正官為忌的話，遇傷則喜」
- [蘇民峰 — 八字講義 第六章](https://www.masterso.com/classroom/classroom2_1_618.php)

### Item 4 — 印通關擔財
- [新玄機 N.197 — 蕭公子 身弱財格命局探討](https://fengshui-magazine.com.hk/No.197-Nov13/A199.htm) — 「身衰透印助，須當富命看」
- [蘇民峰 — 八字講義 財格 第五章](https://www.masterso.com/classroom/classroom2_1_619.php) — 「先財後印即可成福，先印後財，必成其辱」
- [蘇民峰 — 第六章](https://www.masterso.com/classroom/classroom2_1_620.php) — 「財旺，用印而有官殺通關」
- [聚賢館 — 身弱財多點會唔窮](https://www.juxian.com.hk/e030/) — three save conditions
- [財多身弱 — 靈匣網](https://www.lnka.tw/html/topic/13422.html)
- [身弱財格 — 八字雜記](https://www.p8zi.com/blog/31fa2ba2d1b)

### Item 5 — 伏吟 severity
- [林子玄 — 八字伏吟在流年比大運還差](https://blog.udn.com/vivian040788/180833752) — "流年伏吟最差 > 大運 > 本命"
- [八字命理伏吟通俗詳解 — 知乎](https://zhuanlan.zhihu.com/p/605431735) — "為忌時災，為用時利"
- [伏吟和反吟 — 算準網](https://www.suanzhun.net/article/2224.html)
- [八字最全返呤伏吟、歲運並臨詳解 — 知乎](https://zhuanlan.zhihu.com/p/448546674)
- [伏吟返吟 — 百度百科](https://baike.baidu.com/item/%E4%BC%8F%E5%90%9F%E8%BF%94%E5%90%9F/524270)

### Item 6 — 月令本氣 / SEASON_MULTIPLIER
- [易子《五行強弱判斷量化法》— 網易](https://www.163.com/dy/article/HV7SGO56055627UV.html) — confirms NO classical multiplier consensus
- [八字旺衰打分定量分析法 — 算準網](https://www.suanzhun.net/article/1414.html)
- [八字入門之判斷旺衰的方法 — 算準網](https://www.suanzhun.net/article/1416.html)
- [現代化"科學算命"打分方法 — 豆瓣](https://www.douban.com/note/691688936/)
- [五行強旺及其運用 — 朱祖夏 八字與用神](https://www.suanzhun.net/book/1278.html)
- [月令是十分重要的 — 新浪](https://k.sina.cn/article_6412931317_17e3d90f5001002o3v.html)
