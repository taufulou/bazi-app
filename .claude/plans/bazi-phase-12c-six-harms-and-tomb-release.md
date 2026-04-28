# Phase 12c — 六害 role-aware penalty + 沖庫釋放方向性 (v3 APPROVED)

**Origin**: Laopo24 (post-12b) vs Seer comparison surfaced 2 remaining gaps:
- **癸巳月**: engine 大吉, classical 吉 — 寅巳害(無恩) hits 喜神 寅; current scorer ignores branch 害
- **壬辰月**: engine 凶中有吉, classical 凶 — 辰沖戌 releases 戊(仇)+辛(忌)+丁(閒) all hostile to weak DM; current scorer ignores release direction

User explicitly listed 寅巳/丑午/子卯 as the penalty examples. 子卯 is 六刑(無禮之刑) not 六害, but reuses Fix E machinery for parsimony.

**Status**: Approved by staff engineer after v1 (17 issues, Needs rework) → v2 (5 conditions) → v3 (all closed). Hold for user go-ahead before implementation.

---

## Approval trail

- v1 → 17 issues (LOW → HIGHEST), "Needs rework"
- v2 → resolved all 17, "Approved with conditions" (5 follow-ups)
- v3 → 5 conditions resolved cleanly, **Approved**
- "Phase 12c is approved for Day 8 flag-flip pending the two signoffs in the runbook."

---

## Fix E — 六害 role-aware penalty (+ 子卯刑 piggyback)

### Classical sources
- 《三命通會·論六害》: 「以吉害凶，未必能去凶；以凶害吉，亦能損吉」
- 163.com (modern 子平): 「命中的喜用之神，不能害；被害則事業容易受到暗中的牽制、阻礙和妨害。命中的仇忌之神，反而喜害」
- 寅巳 specifically: 《三命通會》「不恤所生，遙相剋制，故曰無恩」 → 1.2× wuEn modifier
- 子卯: 「無禮之刑」 — modifier 1.0 per classical sources

### 6 害 pairs (verbatim from `branch_relationships.SIX_HARMS`)
```
子-未 (妒嫉之害), 丑-午 (官鬼之害), 寅-巳 (無恩之害),
卯-辰 (凌長之害), 申-亥 (爭進之害), 酉-戌 (嫉妬之害)
```

### 1 刑 pair handled here (Fix E machinery reuse)
```
子-卯 (無禮之刑)
```
Other 三刑 (寅巳申, 丑戌未) and 六破 → Phase 12d.

### Logic
For each natal pillar branch B forming 害 (or 子卯刑) with `flow_month_branch`:
1. `role = element_role(B, day_master_stem, effective_gods)`
2. If `role in (用神, 喜神)`:
   - Compute `effective_score = wuEn_modifier × dampening`
     - `wuEn_modifier = 1.2` if pair is (寅巳/巳寅); else 1.0
     - `dampening = 0.5` if 六合 binds B with another natal branch; else 1.0
   - Suppression:
     - 沖 fires on same flow branch → suppress (沖 supersedes)
     - 三刑 fires on same flow branch → suppress (三刑 supersedes; placeholder for 12d)
   - If `Σ effective_score across all pillars ≥ 0.6` → **-1 label step** (cap at -1 total per month)
   - Else → narrative-only entry
3. If `role in (忌神, 仇神)` → narrative-only entry "害去忌神" (no label change)
4. If `role == 閒神` → narrative-only entry

### Cap doctrine
> 害 is 暗箭 (silent friction), not cumulative damage. Multiple pillars 害ing flow branch → still -1 step max per month. Classical: 《三命通會》treats 害 as positional fragility, not violent rupture.

### Pillar weighting
**DROPPED for v1.** Aligns with Fix B (no pillar weight). Year pillar gets full weight when the harm is 寅巳 (wuEn modifier compensates). Pillar-specific weighting deferred to 12d after empirical regression data.

### Output field
```typescript
interface LiuHaiInteraction {
  pair: string;             // e.g., "寅-巳" or "子-卯"
  kind: 'liuhai' | 'liuxing_ziwei';
  pillar: 'year' | 'month' | 'day' | 'hour';
  role: '用神' | '喜神' | '忌神' | '仇神' | '閒神';
  wuEn: boolean;            // true for 寅巳/巳寅
  dampening: number;        // 0.5 if 六合 binds, else 1.0
  applied: boolean;         // true → contributed to label downgrade
}
```

### Tests (8 cases)
- 害 hits 喜/用 → -1 step
- 害 hits 忌/仇 → narrative only
- 害 hits 閒 → narrative only
- 寅巳 wuEn modifier (year pillar) → applied
- 六合 binds harmed branch → ×0.5 dampening, threshold not crossed
- 沖 same branch → suppress
- 三刑 same branch → suppress (testing 12d hook)
- 子卯刑 → applied via Fix E machinery
- Multiple pillars sum cap at -1 step

---

## Fix F — 沖庫釋放方向性 (downgrade-only v1)

### Classical sources
- 《子平真詮·論墓庫刑沖》: 「至於財官為水，沖則反為累」
- 蘇民峰 Ch.6 on 庫沖
- 《淵海子平》/《三命通會》: 「沖開庫藏吉凶取決於藏干十神對日主之利害」

### Doctrine block (load-bearing comment in code)
```python
# Phase 12c doctrine — DO NOT RELAX WITHOUT CLASSICAL REVIEW:
# Stem rescue (用/喜 stem 透干) can mitigate SHAPE MODIFIERS (蓋頭, 伏吟) but
# CANNOT cancel STRUCTURAL RELEASES (沖庫釋放, 三刑成立). The doctrine traces
# back to 《滴天髓·論墓庫》: 「庫沖則開, 開則藏干釋放, 不論天干能否化」 —
# the release is structural and time-bound, not subject to stem moderation.
```

### Logic
1. **Skip if `is_cong_ge`** (從格 follows 順勢, 庫沖機制 不適用)
2. **Skip if** `month_branch ∉ {辰戌丑未}` OR no natal `branch ∈ {辰戌丑未}` forms 沖
3. For natal 庫 pillar B forming 沖 with flow_month_branch:
   - released_stems = HIDDEN_STEMS[B.branch] = [本氣, 中氣, 餘氣]
   - For each released stem, role_score:
     - 用神=+1.0, 喜神=+0.6, 閒神=0, 仇神=-0.6, 忌神=-1.0
   - `net = 0.6 × r(本氣) + 0.3 × r(中氣) + 0.1 × r(餘氣)`
4. Threshold ladder (v1, downgrade-only):
   - `net ≤ -0.5` → action='downgrade', steps=1
   - `net ≥ +0.5` → **NOT IMPLEMENTED IN v1** (Phase 12d)
   - else → narrative-only
5. Stacking with Fix C: if Fix C upgrades AND Fix F downgrades, net them (cap at no-op). Same direction → cap at ±1.

### Output field
```typescript
interface ChongKuRelease {
  natalPillar: 'year' | 'month' | 'day' | 'hour';
  natalBranch: '辰' | '戌' | '丑' | '未';
  releasedStems: { stem: string; position: 'benqi' | 'zhongqi' | 'yuqi'; role: string; weight: number; }[];
  netRoleScore: number;
  action: 'downgrade';   // v1 downgrade-only; upgrade in Phase 12d
  steps: 1;
  stemRescueApplied: false;  // doctrine assertion
}
```

### Tests (10 cases)
- net=-0.66 (Laopo 壬辰 named test) → downgrade
- net=-0.7, -0.5, -0.49, 0, +0.5, +0.7 boundary tests
- All 4 tomb pillars (year/month/day/hour) × 2 directions = 8 sub-cases
- 從格 guard → no fire
- v1 downgrade-only assertion (positive net → action=None)
- Stacking with Fix C: opposite directions cap at no-op

---

## Execution order (locked, snapshot-tested)

`C → A → F → B → E → D`

5 commutativity claims tested explicitly:
- C and A: when C fires, A skipped (existing 12b assertion)
- F and A: independent (label invariant under reorder)
- E and B: independent (commutativity)
- F and C: opposite-direction stacking → no-op
- D and E: 六合 binding affects 害 dampening — non-commutative, order locked

### Sample composition table
| Starting | C | A | F | B | E | D | Final |
|---|---|---|---|---|---|---|---|
| Laopo 癸巳 大吉 | no | no | n/a | no | -1 (寅巳 wuEn 喜) | bound_only hour | **吉** |
| Laopo 壬辰 凶中有吉 | no | no | -1 (戌釋放 net=-0.66) | no | no | — | **凶** |
| Laopo 庚子 大吉 | upgrade | skip | n/a | no | no | bound_only month | **大吉** |

---

## Per-rule flags
```python
PHASE_12C_RULES_ENABLED = {
    'E': _env_enabled('PHASE_12C_FIX_E_ENABLED', True),
    'F': _env_enabled('PHASE_12C_FIX_F_ENABLED', True),
}
```

Rollout: dev/staging default ON; **prod default OFF** at PR1 merge. Day 8 flip after corpus measurement.

---

## CI matrix (6 cells)
- (a) all-on (12b + 12c)
- (b) E off, F on
- (c) E on, F off
- (d) E off, F off (Phase 12b parity baseline)
- (e) all-12b-off + 12c-on (isolates 12c from 12b interaction)
- (f) Fix C + Fix F only (highest-risk pairing)

---

## Validation corpus (n=50 for blast radius + n=12 for tomb directional)

### n=12 directional corpus (Phase 12b corpus + 4 tomb-stress charts)
- Roger, Laopo, 從殺格, 從財格, 化氣格, 強DM+官殺+印, neutral
- + 4 tomb charts: 庫 in year / month / day / hour, each tested with 用/喜 release AND 忌/仇 release (8 sub-cases)

### n=50 blast-radius corpus
- DM elements × tomb-branch positions × strength tiers
- Run engine flag-off vs flag-on across 50 charts × 12 months = 600 reading-months
- Classify each label-change:
  - (a) expected — matches Fix E/F rule trace
  - (b) neutral — within 1 step + matching trace, no rule-level concern
  - (c) regression — label change WITHOUT matching rule trace
- **Hard gate**: `regression_count == 0` before flag flip
- **Validity**: ≥30 expected (a) changes proves rules fire (across 600 reading-months)

---

## AI prompt deliverables (first-class, NOT a one-liner)

### `apps/api/src/ai/prompts.ts::ANNUAL_V2_PROMPTS` placeholders
- `{{liuHaiInteractions}}` — JSON array
- `{{chongKuRelease}}` — JSON object or null

### Anti-hallucination clauses (verbatim)
```
若 `liuHaiInteractions` 為空陣列，禁止在月運敘述中提及『害』、『穿』、『沖害』等概念。
若 `chongKuRelease` 為 null，禁止在月運敘述中提及『沖開庫藏』、『沖庫』、『藏干釋放』。
禁止虛構未提供的 `pair`、`pillar`、`role`、`releasedStems`. 僅可使用結構化欄位中明確提供的數值。
```

### Validation test
`apps/api/test/ai-prompts.spec.ts`: given `liuHaiInteractions=[]` + `chongKuRelease=null`, assert generated prompt has no occurrence of regex `/害|穿|沖庫|藏干釋放/`.

### Fixture diff
Roger + Laopo prompts pre/post Phase 12c attached as PR comment for reviewer.

---

## TS types (in-place extension, no rename)

`packages/shared/src/types.ts`:
```typescript
export interface Phase12bMonthlyExtras {
  // ... existing fields preserved
  liuHaiInteractions?: LiuHaiInteraction[];
  chongKuRelease?: ChongKuRelease | null;
}
```

PR checklist includes `node_modules/@repo/shared` symlink-repoint check from CLAUDE.md.

---

## Day 8 flag-flip approval (named, two-signer)

Required signoffs (both, in order):
1. **Plan author (Roger)** — confirms corpus replay numbers match ±20% expectation
2. **On-call** — confirms staging soak metrics for 72h prior have ≥98% no-regression

Either signer can BLOCK the flip. No "merge and figure it out" path.

### Flip command
```bash
sed -i 's/PHASE_12C_FIX_E_ENABLED=0/PHASE_12C_FIX_E_ENABLED=1/' apps/api/.env
sed -i 's/PHASE_12C_FIX_F_ENABLED=0/PHASE_12C_FIX_F_ENABLED=1/' apps/api/.env
redis-cli FLUSHALL
psql -U bazi_user -d bazi_platform -c "DELETE FROM reading_cache;"
pm2 restart api
```

Cache flush MUST occur AFTER env change but BEFORE API restart. Sub-second stale-label window between env change and restart is expected and self-healing on restart — document for on-call.

### UI banner during 30-day post-flip window
```
本月運程計算已升級，部分月份標籤已調整
（中、英文雙語; subscriber only; dismissible）
```

---

## Files to change

- `apps/api/.env` — 2 env vars: `PHASE_12C_FIX_E_ENABLED`, `PHASE_12C_FIX_F_ENABLED`
- `packages/bazi-engine/app/annual_enhanced.py` — 2 helpers + wire into `_compute_single_month`
- `packages/bazi-engine/tests/test_phase_12c_monthly.py` — 18+ tests
- `packages/bazi-engine/tests/test_phase_12c_composition.py` — composition + ruleTrace snapshot
- `packages/bazi-engine/tests/validation/phase12c_corpus_50.csv` — blast-radius corpus
- `packages/shared/src/types.ts` — 2 new interfaces in-place
- `apps/api/src/ai/prompts.ts` — 2 placeholders + 3 anti-hallucination clauses
- `apps/api/test/ai-prompts.spec.ts` — anti-hallucination regex test

---

## Out of scope (Phase 12d candidates)

- Fix F **upgrade path** (when net ≥ +0.5)
- 三刑 role-aware penalty (寅巳申, 丑戌未)
- 六破 role-aware penalty
- Numeric-score scoring (replacing label-step)
- Pillar weighting for Fix E (deferred until empirical data)

---

## Non-blocking polish items from final approval

1. Snapshot test asserts full `ruleTrace` array, not just label
2. Fix F `assert action == 'downgrade'` test locks v1 scope
3. Synthetic all-rules-fire chart fixture in a registry for reuse across composition tests
4. On-call runbook documents sub-second stale-label window between env edit and restart
