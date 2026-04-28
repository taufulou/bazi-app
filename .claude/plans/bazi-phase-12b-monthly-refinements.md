# Phase 12b — Monthly Scoring Refinements (v3 APPROVED)

**Origin**: Post-Phase-12 live comparison against Seer (2026-04-24) + classical
research identified 4 remaining gaps in `annual_enhanced.py::_compute_single_month`.

**Status**: Approved by staff engineer after v1 (22 issues) → v2 (5 conditions)
→ v3 (all conditions closed). Hold for user go-ahead before implementation.

---

## Target regressions (Laopo chart 2026)

| Month | Current | Target | Mechanism |
|---|---|---|---|
| 庚寅 | 吉中有凶 | **吉** | Fix A halving (庚絕寅) |
| 辛卯 | 吉中有凶 | **吉** | Fix A halving (辛絕卯) |
| 庚子 | 吉中有凶 | **大吉** | Fix C 殺印相生 (本氣印) |
| Roger all months | unchanged | **unchanged** | Regression guard |
| 從殺格 synthetic | classify | no Fix C activation | 從格 guard |
| 強DM + 官殺+印 月 | classify | Fix C mild negative | reverse logic |

---

## The 4 refinements

### Fix A — Rootedness-aware 蓋頭/截腳 moderation

**Classical source**: 《滴天髓闡微》任鐵樵 — 「蓋干頭喜支，運以重支，吉凶減半」.
Rule: when stem is 忌/仇 on branch 喜/用 (or reverse), the conflicting side's
effect is **halved** ONLY when that side is at 絕/死/墓 on the flow pillar's own
十二長生 table (classical「金絕寅卯」example).

**Key decision** (load-bearing — see reviewer's Issue #8/#21): halving gate is
based on **flow stem's 十二長生 state on its own flow branch**, NOT natal
rootedness. Helper:

```python
def _flow_stem_at_zero_position(stem: str, flow_branch: str) -> bool:
    return life_stages.get_life_stage(stem, flow_branch) in {'絕', '死', '墓'}
```

Applies symmetrically to 蓋頭 (stem-忌 on branch-喜) and 截腳 (branch-忌 under
stem-喜).

**Scoring**: base upgrades one step when halving fires — e.g., 吉中有凶 → 吉.

**Risk**: LOW. Only widens toward net-positive or net-negative by 1 step.
**Flag**: none.

### Fix B — Role-conditional 伏吟 amplification (multi-pillar)

**Classical source**: Modern consensus — 「用神伏吟應吉，忌神伏吟應凶」(知乎,
算准網). Extends existing day-branch-only 伏吟 handling to all 4 natal pillars.

**Rule**:
- For each natal pillar where `flow_month_branch == natal_pillar.branch`:
  - Determine natal branch's 十神 role via effective_gods (喜/用/忌/仇/閒).
  - Pillar weight: day=1.0, hour=1.0, month=**1.0**, year=0.5.
  - 喜/用 + weight ≥ 1.0 → upgrade 1 step. 忌/仇 + weight ≥ 1.0 → downgrade 1 step.
  - 閒神 → no effect.
  - weight=0.5 (year) → narrative-only flag, no label change.
- 沖 interaction: simultaneous 沖 at different pillar caps amplification at
  half-step (no label change), flags as 動蕩.

**New output field**: `fuYinInteractions: List[{pillar, role, direction, applied: bool}]`.

**Risk**: LOW-MED. Bounded to ±1 label. **Flag**: none.

### Fix C — 殺印相生 / 官印相生 transient activation

**Classical source**: 《子平真詮·論用神成敗救應》— 「印輕逢煞…以煞生印，為煞印
相生」. 百度百科 confirms transient activation at 流年/流月 level.

**Helper**: `detect_officer_seal_transient(pillars, day_master_stem, strength, month_stem, month_branch, effective_gods, is_cong_ge)` → Optional[Dict].

**Activation conditions (ALL must hold)**:
1. `strength in ('weak', 'very_weak')` AND `is_cong_ge == False`.
2. `month_ten_god in ('七殺', '正官')` — both bundled per 子平真詮.
3. Month branch 本氣 or 中氣 = 正印 or 偏印.
4. 印 has structural support: branch 印 is 本氣 itself OR 印 transparent in any
   natal stem. (No circular 用神 check — see Issue #13 resolution.)
5. Not blocked: no 財 stem transparent on flow month, no 食傷 stem transparent
   in natal year+month+hour (壞印/奪印).

**Scoring**: overrides stem-branch assessment entirely.
- Full activation (印 in 本氣): `base = '大吉'`.
- Partial (印 in 中氣): `base = '吉'`.
- 強 DM reverse logic: mild negative (-1 label step).

**New output field**: `officerSealActivation: {pattern: 'sha_yin'|'guan_yin', level: 'full'|'partial'}`.

**Risk**: MED. **Flag**: `PHASE_12B_FIX_C_ENABLED` (default True
dev/staging; True prod after 1 week dogfood).

### Fix D — 六合 strict 化氣 conditions (default 合而不化)

**Classical source**: 《滴天髓·論化象》4 化氣 conditions. Mainstream 算准網:
「地支六合只是加強所合之物的力量，所合雙方各自減輕作用力，仍保持各自原來的特性」.

**Helper**: `check_liu_he_transformation(month_branch, natal_branch, pillars, flow_year_stem, month_stem)` → `'true_transformation' | 'bound_only' | 'no_combination'`.

**Conditions for `'true_transformation'` (ALL must hold)**:
1. Valid 六合 pair (子丑/寅亥/卯戌/辰酉/巳申/午未).
2. Weaker combining branch has NO independent root (HARD gate).
3. 化神 transparent in flow-year/flow-month/any natal 4 stem.
4. `SEASON_MULTIPLIER[化神][flow_month_branch] >= 1.5` (strict 旺, 相 not enough).
5. No 沖/刑 on either combining branch.

**Scoring**:
- `'true_transformation'`: apply DM favorability lookup on 化神 → upgrade/downgrade
  base per standard element role mapping.
- `'bound_only'` (default): narrative-only flag, NO label delta.
- `'no_combination'`: no-op.

**New output field**: `boundInteractions: List[{pair, natal_pillar, notes}]` OR
`trueTransformation: {element, favorability}`.

**Risk**: MED for 真化 branch only. **Flag**: `PHASE_12B_FIX_D_TRUE_TRANSFORMATION_ENABLED`
for 真化 path (same rollout as C). Gated at helper's return statement.

---

## Execution order (load-bearing)

**C → A → B → D** — documented in composition table:

| Starting base | C fires? | A fires? | B fires? | D fires? | Final |
|---|---|---|---|---|---|
| 吉中有凶 (Laopo 庚子: 庚忌 on 子用=正印 本氣) | YES→大吉 | **SKIPPED** | no 子伏吟 natal | no 六合 | **大吉** |
| 吉中有凶 (Laopo 庚寅: 庚忌 on 寅喜=比肩) | no | YES→吉 | 寅伏吟年 (weight 0.5, narrative only) | no 六合 | **吉** |
| 吉中有凶 (Laopo 辛卯: 辛忌 on 卯喜) | no | YES→吉 | no | 卯戌合 → bound_only (戌忌/仇 bound, narrative only) | **吉** |
| 吉 (synthetic: stem=喜 on branch=忌 rooted) | no | no (仇 branch has root) | no | no | **吉** |
| 吉 (synthetic: 喜支 day-branch 伏吟) | no | no | 用/喜 伏吟 day weight 1.0 → upgrade | no | **大吉** |
| 凶 (synthetic: 忌支 day-branch 伏吟) | no | no | 忌/仇 伏吟 day → downgrade | no | **大凶** |
| 吉中有凶 (Fix C full activation + 伏吟 after) | YES→大吉 | SKIPPED | applies after C override | — | **大吉** (already max) |
| 大吉 + simultaneous 沖 at different pillar | no | no | 沖 caps amplification at half-step | — | stays **大吉**, flagged 動蕩 |
| 吉中有凶 (from element role) + 強DM + 官殺+印 month | YES→mild neg (reverse logic) | SKIPPED | — | — | **凶** |
| 吉 + 真化 favorable for DM | no | — | — | YES 真化 → upgrade | **大吉** |
| 吉 + bound_only on 用支 | no | — | — | YES bound_only → narrative only | **吉** (unchanged) |
| 平 (neutral) — no rules fire | no | no | no | no | **平** |

**Key decision — Fix C skips Fix A when C fires**: 殺印相生 is a 成格 archetype
override; 蓋頭 halving is a 運氣 modifier. Applying halving on top of 相生
double-counts forgiveness. Classical: 子平真詮 成格 > 滴天髓 運氣 modifier.

---

## Per-fix rollback flags

```python
PHASE_12B_RULES_ENABLED = {
    'A': os.environ.get('PHASE_12B_FIX_A', '1') in ('1', 'true'),
    'B': os.environ.get('PHASE_12B_FIX_B', '1') in ('1', 'true'),
    'C': os.environ.get('PHASE_12B_FIX_C_ENABLED', '1') in ('1', 'true'),
    'D_TRANSFORMATION': os.environ.get(
        'PHASE_12B_FIX_D_TRUE_TRANSFORMATION_ENABLED', '1') in ('1', 'true'),
}
```

Fix D bound_only always on (narrative-only, zero risk).

---

## ruleTrace observability

New field on each `monthlyForecast`:
```python
ruleTrace: List[str]  # capped at 6 entries; full trace in debug log
```

Examples:
- `['officer_seal_transient']` (Laopo 庚子: C fires, A skipped)
- `['gaitou_halving', 'fuyin_year_pillar_narrative']` (Laopo 庚寅)
- `['gaitou_halving', 'liuhe_bound_only_day']` (Laopo 辛卯)

Pinned contract via `test_rule_trace_ordering_c_a_b_d` to prevent silent reorder.

---

## TS types (additive only)

`packages/shared/src/types.ts` — extend `MonthlyForecast` with optional fields:
```typescript
interface MonthlyForecast {
  // existing unchanged...
  fuYinInteractions?: Array<{pillar, role, direction, applied}>;
  officerSealActivation?: {pattern: 'sha_yin'|'guan_yin', level: 'full'|'partial'};
  boundInteractions?: Array<{pair, natalPillar, notes}>;
  trueTransformation?: {element, favorability};
  ruleTrace?: string[];
}
```

Pre-PR1 consumer grep (mandatory):
```bash
rg "monthlyForecast\.|monthlyForecasts\[.*\]\." apps/web apps/api packages/shared --no-heading
rg "MonthlyForecast" packages/shared --no-heading
```
Results attached to PR description with ✅ annotation per match.

---

## Validation corpus (n ≥ 7)

Charts: Roger, Laopo, 從殺格 synth, 從財格 synth, 化氣格 synth,
強DM+官殺+印 synth, 中和 neutral synth. Each: 12-month pre/post dump,
classified (was-right-now-right / was-wrong-now-right / was-right-now-wrong /
ambiguous). Any **was-right-now-wrong** blocks merge without Bazi-master
sign-off.

---

## CI flag matrix (3 cells)

| Cell | A | B | C | D 真化 | Purpose |
|---|---|---|---|---|---|
| (a) all-on | ✓ | ✓ | ✓ | ✓ | target prod state |
| (b) C+D off | ✓ | ✓ | ✗ | ✗ | MED-risk rollback path |
| (c) C on, A off | ✗ | ✓ | ✓ | ✗ | isolates C-without-A moderation risk |

B always on (bounded). Full 16-cell matrix deferred.

---

## Pre-merge checklist

- [ ] validation corpus (n≥7) 12-month pre/post dump attached to PR, all diffs classified
- [ ] baseline `pytest -k auspiciousness` count published in PR description
- [ ] consumer grep output attached to PR with ✅ annotations
- [ ] pytest passes under all 3 CI flag cells
- [ ] prompts.ts narrative hooks for A/B/C/D bundled in same PR (each rule)
- [ ] Cache invalidation runbook (`redis-cli FLUSHALL` + `DELETE FROM reading_cache`) documented
- [ ] Bazi-master sign-off row for any "was-right-now-wrong" chart month

---

## Out of scope (Phase 12c candidates)

- **月令提綱 weighting rewrite** — monthly scorer still treats month branch equally vs day branch; 子平真詮 emphasizes 月令 primacy.
- **流年-vs-流月 stem 合 detection** — 丙辛合 between flow year stem and flow month stem is NOT in any of A/B/C/D. Fix A alone takes Laopo 辛卯 to 吉; 丙辛合 合去忌神 would push further but out of scope here.
- **Surgical `reading_cache` invalidation** — v1 stays with `FLUSHALL`.
- **Full 4-way CI flag matrix (16 cells)** — deferred until post-rollout stability.

---

## Research sources

Phase 12b research chats (in-session sub-agents):
- Bazi master research RQ1: 蓋頭截腳 penalty calibration (《滴天髓闡微》任鐵樵)
- Bazi master research RQ2: 伏吟 role-conditional amplification (modern consensus)
- Bazi master research RQ3: 殺印相生 / 官印相生 transient activation (《子平真詮·論用神成敗救應》)
- Bazi master research RQ4: 六合化氣 strict conditions (《滴天髓·論化象》)
- Classical verdict on 3 remaining Seer disagreements (verdict: Seer closer on 庚寅/辛卯; engine wrong on 庚子)

Staff engineer reviews: v1 (22 issues, Needs rework) → v2 (5 conditions,
Approved w/ conditions) → v3 (all conditions closed, **Approved**).
