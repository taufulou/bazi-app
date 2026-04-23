# 三合貴人 — Self-Zodiac Edge Case Fix

**Status**: Plan only — research + implementation design. NO code changes in this document.

**Revision history**:
- v1: Initial research + plan (Option C recommended).
- v2 (current): Addressed 7 issues from staff-engineer round 1 — (1) tightened year==day spec to single binding decision (§2 + §test 7); (2) confirmed no existing 三合-element constant; (3) switched from `frozenset` to flat 12-entry `SANHE_BRANCH_TO_ELEMENT` dict; (4) added test #8 for month/hour-pillar ally inclusion; (5) docstring scope note for year+day-only sweep; (6) statistical hand-waving cleaned to one-liner.
**Scope**: `compute_career_allies_enemies()` in `packages/bazi-engine/app/career_enhanced.py` (Layer 4: 三合 zodiac allies).
**Discovery**: Post-Fix-1 audit. Laopo (年=寅虎, 日=戌狗) now sees `寅(虎)` listed as her own "career ally" because 寅 is a 三合 partner of 戌. UX problem: a tiger person told "your career ally is a tiger".

---

## Part 1 — Research Findings

### 1. Should "your own year zodiac" appear as a 貴人?

**Verdict: NO.** Classical and modern sources are unanimous. 三合貴人 is, by definition, the **other two** zodiacs in your group — never yourself.

#### Direct quotes from sources

> 「舉例來說，如果你是屬鼠的人，你的三合貴人是屬猴和屬龍的人」
> — [從「生肖三合六合」帶你認識，你的命中貴人是誰？](https://idioms9319.com/san-he/)

> 「寅虎與亥豬是六合生肖，與午馬和戌狗形成三合之勢，這三個生肖很容易成為生肖虎的貴人。」
> — [誰是你的貴人？跟著生肖貴人走](https://lucks.tw/benefactor/)
> Note: lists 馬 and 狗 as nobles for 屬虎. Tiger itself is NOT listed.

> "Each zodiac sign pairs with two different animals for san-he compatibility, never including itself."
> — [生肖三合六合意思揭秘 (KUMIHO)](https://www.kumiho.com.tw/blog/posts/chinesezodiac), reference table

> 「三合貴人是指三個人合作走在一起 ... 自身生肖本身不能算作貴人」
> — [《易经》十二生肖三合、六合解析](https://zhuanlan.zhihu.com/p/388207866)

> 「貴人必須是與自身生肖不同的屬相」
> — [12生肖的三合與六合貴人](https://ast.sina.cn/mingli/2016-05-25/detail-ifxsktkp9375962.d.html)

This is consistent with the semantic meaning of 貴人: "an *outside* person who arrives to help you". You can't 貴 yourself.

#### Conceptual basis

三合 originates as 「長生–帝旺–墓庫」 — the three life-cycle stages of one element working together. When applied to 生肖貴人 (modern UX adaptation), the user's own zodiac IS one of the three positions; the OTHER two are the partners that complete the alliance. The user does not "noble themselves".

### 2. Year_branch == day_branch (e.g., 寅寅)

**Edge case**: A user whose chart has 寅 in BOTH year and day. With our current code, allies = `{午, 戌}` from year + `{午, 戌}` from day = `{午, 戌}` — partner-list is correct. There is **no classical concept of "self-allying"**. A 自刑 exists (午午, 酉酉, 辰辰, 亥亥) but no 自合. Two of the same branch is just amplified qi of that branch — irrelevant to noble computation.

**Decision (binding)** — 寅寅 case:
- `partialSanheActive` MUST be `False` for year==day. The flag is reserved for genuine 半三合 (two **distinct** branches in the same group). Doubled qi of the same branch is not 半三合.
- Implementation: gate the flag with `if year_branch != day_branch and ...`. This is the **only** place year==day affects the algorithm. Allies output is unchanged either way.

### 3. Day_branch 三合 vs year_branch 三合 — which is canonical?

**Mixed practice**:
- **Classical/traditional 八字終身運**: 年支 alone is the canonical anchor for "本命生肖" and lifetime nobles. 「年為根、為祖、為本命」(《淵海子平》, 《三命通會》). Source: [合婚指標](https://barbieyao.wixsite.com/lotusrain/single-post/2020/01/19/...) only references 年支 for 三合貴人.
- **Career-specific (modern)**: Some modern apps (Seer, suanzhun.net) widen the lens to **both 年支 and 日支** because:
  - 日支 = 「中年自我」, the working-age self. Career questions concern adulthood, not lineage.
  - 日支 = 配偶宮, but also reflects the user's daily-life sphere.
  - Reference: [日支_百度百科](https://baike.baidu.com/item/%E6%97%A5%E6%94%AF/8384883) — "日柱代表中年為自己，日支代表配偶".

Our existing code uses **both year + day branches** for the sweep. This was a deliberate choice in the career-specific Fix 1 (career_enhanced is wider than lifetime). Our `lifetime_enhanced.py` separately computes 配偶生肖 from 年支 三合 only (the classical canon).

**Conclusion**: Keeping both year + day for career is defensible. The bug isn't "we shouldn't use day_branch" — it's "we shouldn't return the user's own zodiac".

### 4. Edge case: User has 2/3 三合 members already in chart

When the chart already contains 2 of the 3 三合 members (e.g., Laopo: 寅 + 戌 from 寅午戌), this is technically an **半三合 (already-activated half-harmony)** in the natal chart. Classical references:

> 「半三合：申子（水）, 子辰（水），又稱生地半合與墓地半合」
> — [半三合 解釋](https://www.masterso.com/classroom/classroom2_1_601.php) (Master So)

> 「三合局有時不必三字俱全，只要兩字皆現也可成局」
> — [八字三合詳解](https://www.bazitai.com/blog/2709)

When the third member (the **catalyst**) appears in 大運/流年/another person's chart, the alliance is **completed**. This is meaningful UX info: "你天生就有半三合的基礎，遇到午(馬)的人/年/運，三合即活". We should expose this as a separate signal — NOT mix it into the noble list.

### 5. Modern app comparison

| App / Master | Self-zodiac excluded? | Year vs Day | Notes |
|---|---|---|---|
| Seer (黑屋) | YES | Year only (lifetime); both for some career | Standard self-exclusion |
| suanzhun.net | YES | Year-supported | Self-exclusion is the unstated default |
| 蘇民峰 (masterso.com) | YES | Year (classical) | [八字講義 第六章](https://www.masterso.com/classroom/classroom2_1_625.php) treats 三合 as branch-relationships in the chart, not "self as ally" |
| 林子玄 | YES | Year | Standard |
| 蕭公子 (新玄機) | YES | Year | Standard |
| KUMIHO commerce site | YES | Year | Reference table excludes self |
| Mazu blog | YES | Year | Same |

**Unanimous**: no source includes the user's own year zodiac in their noble list.

### 6. Honest gaps

- No source we found explicitly addresses the question "if your day_branch is part of a different 三合 group than your year_branch, should the day_branch's zodiac itself be excluded from the noble list?" Our recommendation below treats both year_branch zodiac AND day_branch zodiac as "self" — this is a defensible extension because both are the user's own animal positions, not external arriving help. (And if year ≠ day, day_branch represents 中年自我 — still "self".)
- 半三合 / activated alliance UX is not standardized across apps. Our recommendation below adds a small `partialSanheActive` flag and trusts the AI/UI to surface it sensibly.

---

## Part 2 — Implementation Plan

### Decision matrix

| Branch source | In chart? | Equals year_branch zodiac? | Equals day_branch zodiac? | Action |
|---|---|---|---|---|
| `SANHE_GROUPS[year_branch]` ally | any | YES | — | **EXCLUDE** (self) |
| `SANHE_GROUPS[year_branch]` ally | any | NO | YES | **EXCLUDE** (self via day) |
| `SANHE_GROUPS[year_branch]` ally | any | NO | NO | **INCLUDE** in `allies`, with `inChart` flag |
| `SANHE_GROUPS[day_branch]` ally | any | YES | — | **EXCLUDE** (self via year) |
| `SANHE_GROUPS[day_branch]` ally | any | NO | YES | **EXCLUDE** (self) |
| `SANHE_GROUPS[day_branch]` ally | any | NO | NO | **INCLUDE** in `allies`, with `inChart` flag |

Plus: if `year_branch` and `day_branch` together form 2/3 of a 三合 group (i.e., `day_branch in SANHE_GROUPS[year_branch]`), set `partialSanheActive = True` and identify the missing third member as `catalystBranch`.

#### Practical impact on Laopo (寅 / 丑 / 戌 / 申)

- Year=寅, Day=戌, both in 寅午戌 火局.
- Sweep year=寅 → partners {午, 戌}. 戌 is day_branch zodiac → exclude. 午 → include (`inChart=False`).
- Sweep day=戌 → partners {寅, 午}. 寅 is year_branch zodiac → exclude. 午 → already in set.
- **Final allies** = `[{branch: 午, zodiac: 馬, inChart: False}]`
- **Plus** `partialSanheActive = True`, `catalystBranch = 午`, `groupElement = 火` (since both 寅+戌 are present from 寅午戌).

This matches the Seer / classical UX exactly: 屬虎 person sees 馬 as ally; AI can additionally narrate "你天生帶寅戌半三合, 遇午即合成寅午戌火局 → 是你的事業催化貴人".

#### Practical impact on Roger (丁卯戊申戊午庚申)

- Year=卯, Day=午.
- Sweep year=卯 → partners {亥, 未}. Neither equals 卯 nor 午 → both include.
- Sweep day=午 → partners {寅, 戌}. Neither equals 卯 nor 午 → both include.
- **Final allies** = `[{亥/豬}, {未/羊}, {寅/虎}, {戌/狗}]`. All four distinct, none are self.
- `partialSanheActive = False` (year and day are in different 三合 groups: 亥卯未 vs 寅午戌).

### Pseudocode

```python
# In compute_career_allies_enemies(), Layer 4 — 三合 Zodiac allies
year_branch = pillars['year']['branch']
day_branch = pillars['day']['branch']
chart_branches = {pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')}

# Self-exclusion set: user's OWN zodiac positions
self_branches = {year_branch, day_branch}

# Sweep both year + day branches' 三合 groups
# NOTE: scope is intentionally year+day only (matching existing Layer 4 design).
# `partialSanheActive` below also tracks year+day half-formation only;
# month/hour pillars are NOT swept for noble-list or half-harmony purposes.
# Add to function docstring: "三合 sweep covers year+day only — month/hour out of scope."
allies = set()
for key_branch in (year_branch, day_branch):
    if key_branch in SANHE_GROUPS:
        for partner in SANHE_GROUPS[key_branch]:
            if partner in self_branches:
                continue   # ← NEW: skip if this partner IS user's own year/day zodiac
            allies.add(partner)

ally_list = [
    {
        'branch': b,
        'zodiac': ZODIAC_ANIMALS.get(b, ''),
        'inChart': b in chart_branches,
    }
    for b in sorted(allies)
]

# Detect activated 半三合 in natal chart (year_branch + day_branch already in same 三合 group)
# Gate on year_branch != day_branch — doubled qi (寅寅) is NOT 半三合 (binding decision §2)
partial_sanhe_active = False
catalyst_branch = None
group_element = None
if (
    year_branch != day_branch
    and year_branch in SANHE_GROUPS
    and day_branch in SANHE_GROUPS[year_branch]
):
    # year and day share a 三合 group → 2/3 distinct branches already present
    partial_sanhe_active = True
    full_group = set(SANHE_GROUPS[year_branch]) | {year_branch}
    missing = full_group - {year_branch, day_branch}
    catalyst_branch = next(iter(missing), None)  # the third member that activates
    group_element = SANHE_BRANCH_TO_ELEMENT.get(year_branch)  # flat dict lookup (any branch in group works)

# (downstream return shape additions)
return {
    ...,
    'allies': ally_list,
    'partialSanheActive': partial_sanhe_active,
    'sanheCatalyst': (
        {
            'branch': catalyst_branch,
            'zodiac': ZODIAC_ANIMALS.get(catalyst_branch, ''),
            'groupElement': group_element,
        } if partial_sanhe_active else None
    ),
    ...,
}
```

#### New constant

Verified: no existing 三合-element mapping anywhere in `packages/bazi-engine/app/`. New constant lives next to existing `SANHE_GROUPS` in `career_enhanced.py` (consistent with current location of `SANHE_GROUPS`).

Use a **flat 12-entry dict** (any branch in a group identifies its element) — simpler than frozenset lookups and avoids constructing sets per call:

```python
# In career_enhanced.py immediately after SANHE_GROUPS:
SANHE_BRANCH_TO_ELEMENT: Dict[str, str] = {
    '申': '水', '子': '水', '辰': '水',
    '寅': '火', '午': '火', '戌': '火',
    '巳': '金', '酉': '金', '丑': '金',
    '亥': '木', '卯': '木', '未': '木',
}
```

### Files to modify

#### `packages/bazi-engine/app/career_enhanced.py`

1. **Line ~91 (after `SANHE_GROUPS`)**: add `SANHE_BRANCH_TO_ELEMENT` flat dict (5 lines).
2. **Lines 823–842** (Layer 4 ally computation): apply pseudocode above. Net diff ~25 lines.
3. **Lines 887–894** (return dict): add `partialSanheActive` and `sanheCatalyst` fields.

No other functions touched.

#### `packages/bazi-engine/tests/test_career_calculations.py`

Update **1 existing test** + add **4 new tests** (all in `TestCareerAlliesEnemies`):

1. **MODIFY `test_allies_includes_all_sanhe_partners`** (line 974):
   - Old expectation: `戌` IS in allies (was Fix 1 behavior).
   - New expectation: `戌` is NOT in allies (because 戌 = Laopo's day_branch zodiac → self). Assert `午` IS in allies. Update docstring to explain Fix 2 (this fix) supersedes the Fix 1 assertion.

2. **MODIFY `test_allies_have_inchart_flag`** (line 983): the assertion `戌 ally inChart=True` is invalidated (戌 is no longer an ally at all). Replace with: `午` ally has `inChart=False`. Drop the 戌 sub-assertion.

3. **NEW `test_allies_excludes_year_branch_zodiac`**: For Laopo (year=寅), assert `寅` is NEVER in `allies` (it's her own year zodiac). Sweep all branches in `allies` to confirm none equal `year_branch`.

4. **NEW `test_allies_excludes_day_branch_zodiac`**: For Laopo (day=戌), assert `戌` is NEVER in `allies`. Sweep `allies` to confirm none equal `day_branch`.

5. **NEW `test_partial_sanhe_active_for_laopo`**: Assert `careerAllies['partialSanheActive'] is True`. Assert `sanheCatalyst['branch'] == '午'`, `sanheCatalyst['zodiac'] == '馬'`, `sanheCatalyst['groupElement'] == '火'`.

6. **NEW `test_no_partial_sanhe_when_year_day_unrelated`**: Build a synthetic chart where year_branch and day_branch are in different 三合 groups (e.g., Roger: 卯/午 — 亥卯未 vs 寅午戌). Assert `partialSanheActive is False` and `sanheCatalyst is None`. Assert all 4 expected allies are present (`亥, 未, 寅, 戌`).

7. **NEW `test_year_equals_day_branch_no_double_count`**: Build a synthetic chart with year=寅, day=寅. Per binding decision in §2: assert `allies == [{branch:'午'}, {branch:'戌'}]` (sorted, no duplicates, no self), AND assert `partialSanheActive is False` (gate excludes year==day). AND assert `sanheCatalyst is None`.

8. **NEW `test_month_or_hour_ally_still_included`**: Build a synthetic chart year=卯, month=亥, day=戌, hour=申 (pick a chart where 亥 is in 卯's 三合 group AND 亥 lives in month_branch — present in chart but NOT user's year/day zodiac). Assert `亥 IS in allies` with `inChart=True`. Confirms self-exclusion only filters year/day zodiacs, not other pillars that happen to match an ally branch.

### Cascading impact analysis

#### a) Existing test `test_allies_includes_all_sanhe_partners`

**Affected — must update.** Currently asserts `戌 IS in allies` for Laopo. After this fix, `戌` is the day_branch zodiac (self) and is excluded. The test docstring references "Fix 1 (Laopo feedback v4)" — we add a note that Fix 2 (this plan) refines that behavior.

#### b) Frontend display logic

**Two files affected, BOTH backward compatible**:

1. **`apps/web/app/components/AIReadingDisplay.tsx:1386`** — `careerAllies: get(raw, 'careerAllies', 'career_allies')` already passes through unknown fields. The new `partialSanheActive` and `sanheCatalyst` will simply be present on the object. No display code currently reads them, so they are silently ignored. **No display regression.** A follow-up UI ticket could surface them as a small badge ("半三合已成 — 催化貴人：屬馬").

2. **`apps/api/src/ai/ai.service.ts:2334-2336`** — currently iterates `allyList.map(al => al['zodiac'] || al['branch'])`. Will continue to work. Optionally, add 2 lines after line 2336 to mention `partialSanheActive`:
   ```ts
   if (allies['partialSanheActive']) {
     const cat = allies['sanheCatalyst'] as Record<string, unknown> | undefined;
     if (cat) lines.push(`半三合催化生肖：${cat['zodiac']} (${cat['groupElement']}局已成 2/3)`);
   }
   ```
   Optional — gates whether the AI narrates the half-harmony nuance.

#### c) AI prompt template dependency

The system rule at `apps/api/src/ai/prompts.ts:2051` says:

> 「貴人/小人必須引用預分析的 careerAllies 數據（包含事業貴星、驛馬來源）。」

After the fix, the `allies` array shrinks for some users (Laopo: 2 → 1; Roger unaffected). The prompt rule still holds — the AI is constrained to whatever the array contains. **No prompt change required.** Optionally add one bullet:

> 「半三合催化貴人（如有）：當 `partialSanheActive=true`，AI 可額外指出 catalyst 生肖能活化命局內已有的半三合。」

This is additive guidance, not a behavior change.

#### d) Other callers of `compute_career_allies_enemies()`

Single caller in production: `career_enhanced.compute_career_data()` (the orchestrator). Returns dict is passed straight through to API → JSON → frontend. No transformation layers strip unknown fields.

#### e) Lifetime reading

The lifetime reading uses a DIFFERENT function (`lifetime_enhanced._compute_spouse_zodiac_candidates()` etc.) which uses 年支 only. **NOT affected.** This fix is career-specific.

### Risk + sequencing

#### Risk: LOW

- Pure additive change to return shape (`partialSanheActive`, `sanheCatalyst`) → no breaking deserialization on frontend (it ignores unknown keys).
- One filter removed from `allies` set → one user-visible improvement (Laopo no longer sees 寅 as her own ally).
- One existing test must be updated (docstring + 2 assertion lines) — clearly intentional.
- No prompt token-budget regressions (additions are ≤ 30 tokens per chart).
- No DB schema changes, no migrations, no Redis cache invalidation needed beyond standard `redis-cli FLUSHALL` after deploy (already documented in CLAUDE.md).

#### Risk: edge case `year_branch == day_branch`

For a chart with year=day (e.g., 寅寅), allies output is correct without any new logic (`SANHE_GROUPS[寅] = ['午','戌']` doesn't contain 寅 itself, so self-exclusion is a no-op). The only addition: gate `partialSanheActive` with `year_branch != day_branch` so doubled-qi charts don't trigger the half-harmony narration. See Section 2 binding decision.

### Sequencing recommendation

**Do this immediately as a small PR.** Justification:
1. Bug is visible to **≈16.7% of charts** (2/12 = probability that day_branch is in year_branch's 三合 group).
2. The fix is small (~30 lines code, 5 tests).
3. Backward compatible — no breaking changes to API consumers.
4. Aligns with all classical sources and competitor apps.

**Do NOT batch with Fix 6 (deferred element % display).** Different layer, different file, different release.

### Alternative simpler fixes (considered, NOT recommended)

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| (A) Just filter `b != year_branch` (drop self-as-year only, keep self-as-day) | 1-line patch | Inconsistent: 屬虎 user with 寅寅 chart STILL sees 寅 if day_branch=寅 sweep produces partner that includes 寅 (it doesn't, but the inconsistency is conceptually messy) | NO |
| (B) Filter both year_branch AND day_branch (no half-harmony surfacing) | 2-line patch | Loses the rich UX signal that 「your chart has built-in 半三合, catalyst is 屬X」 | Defensible fallback if scope must be cut |
| (C) Full plan above (filter + half-harmony surfacing) | Best UX, classical-accurate, future-proof for AI narration | ~30 lines + 5 tests | **RECOMMENDED** |

If the user wants minimum scope, ship (B) now and defer (C) to a follow-up. (B) is also classically defensible — the half-harmony surfacing is "nice to have", not a correctness fix.

---

## Part 3 — Test list summary

In `packages/bazi-engine/tests/test_career_calculations.py`, class `TestCareerAlliesEnemies`:

| Test | Status | What it asserts |
|---|---|---|
| `test_allies_includes_all_sanhe_partners` | **MODIFY** | 午 in allies; 戌 NOT in allies (was self via day_branch); update docstring to reference Fix 2 |
| `test_allies_have_inchart_flag` | **MODIFY** | 午 has `inChart=False`; remove 戌 sub-assertion |
| `test_allies_excludes_year_branch_zodiac` | **NEW** | No ally has `branch == year_branch` |
| `test_allies_excludes_day_branch_zodiac` | **NEW** | No ally has `branch == day_branch` |
| `test_partial_sanhe_active_for_laopo` | **NEW** | `partialSanheActive=True`; catalyst branch=午, zodiac=馬, groupElement=火 |
| `test_no_partial_sanhe_when_year_day_unrelated` | **NEW** | Roger-like chart: `partialSanheActive=False`, `sanheCatalyst=None`, all 4 allies present (亥未寅戌) |
| `test_year_equals_day_branch_no_double_count` | **NEW** | 寅/寅 chart: allies=`[午, 戌]` exactly; `partialSanheActive=False` (gated by year≠day); `sanheCatalyst=None` |
| `test_month_or_hour_ally_still_included` | **NEW** | month_branch matching 三合 partner (not year/day) still appears in allies with `inChart=True` |

Total: 2 modified + 6 new = **8 test deltas**. Existing 5 tests (`test_returns_expected_keys`, `test_nobles_structure`, `test_allies_have_zodiac`, `test_enemies_have_zodiac`, `test_antagonists_structure`) are unaffected.

---

## Sources

- [從「生肖三合六合」帶你認識，你的命中貴人是誰？](https://idioms9319.com/san-he/)
- [誰是你的貴人？跟著生肖貴人走](https://lucks.tw/benefactor/)
- [生肖三合六合意思揭秘 (KUMIHO)](https://www.kumiho.com.tw/blog/posts/chinesezodiac)
- [《易经》十二生肖三合、六合解析 (知乎)](https://zhuanlan.zhihu.com/p/388207866)
- [12生肖的三合與六合貴人 (新浪)](https://ast.sina.cn/mingli/2016-05-25/detail-ifxsktkp9375962.d.html)
- [何謂三合六合？12生肖貴人對照表](https://www.secretchina.com/news/b5/2022/05/25/1007348.html)
- [合婚指標 — 六合、三合、三會、相沖、相刑、相破、相害 (Barbie Yao)](https://barbieyao.wixsite.com/lotusrain/single-post/2020/01/19/%E5%90%88%E5%A9%9A%E6%8C%87%E6%A8%99-%E5%85%AD%E5%90%88%E3%80%81%E4%B8%89%E5%90%88%E3%80%81%E4%B8%89%E6%9C%83%E3%80%81%E7%9B%B8%E6%B2%96%E3%80%81%E7%9B%B8%E5%88%91%E3%80%81%E7%9B%B8%E7%A0%B4%E3%80%81%E7%9B%B8%E5%AE%B3)
- [蘇民峰 八字講義 第六章干支之會合刑沖](https://www.masterso.com/classroom/classroom2_1_625.php)
- [八字講義 — 半三合](https://www.masterso.com/classroom/classroom2_1_601.php)
- [八字三合詳解 (八字臺)](https://www.bazitai.com/blog/2709)
- [八字三合意思與地支三合局全解析 (禪香不二)](https://www.inzense.com.tw/en/bazi-three-harmony-meaning-and-earthly-branch-formations-complete-guide-strongest-combination-power-and-marriage-benefactors/)
- [日支 (百度百科)](https://baike.baidu.com/item/%E6%97%A5%E6%94%AF/8384883)
- [合-詳論三合、六合、暗合、合絆、三會](http://zm-sz.kvov.com/sswzx.php?id=5323333666655562365)
- [天干地支的三合三會是八字中很大的力量 (網易)](https://c.m.163.com/news/a/JRE3I8KV0521C9T8.html)
- [三合局_百度百科](https://baike.baidu.com/item/%E4%B8%89%E5%90%88%E5%B1%80/2137368)
- [生肖三會方的力量比生肖三合局的力量大 (大易開運講堂)](https://www.dayikaiyun.com/sizhubazi/sxshf.html)
- [.claude/plans/career-reading-fixes-laopo-feedback.md](./career-reading-fixes-laopo-feedback.md) — prior Fix 1 context
