# Issue F Doctrine Verification

**File**: `packages/bazi-engine/app/stem_combinations.py::detect_true_transformed_stems`
**Reviewer claim**: condition (v) ("no 克 element to 化神 with strong root") has an independent-loop bug — outer loop finds a stem of `breaker_el`, inner loop finds any branch with `breaker_el` 本氣, but they're not linked, so a rootless breaker stem can wrongly trigger `breaker_strong=True`.

---

## 1. Is the bug real?

**Verdict: Real bug, but the reviewer's framing is incomplete.**

The two loops ARE structurally independent — that part of the diagnosis is correct. But the reviewer's specific example ("year=丁(火) is rootless AND 午 branch is in the hour pillar") is incoherent: if 午 is in the chart, then 丁 IS rooted in 午 (午's 本氣 IS 丁). So the reviewer's narrative example would not produce the bug they describe.

The bug DOES bite in two real (but different) scenarios:

- **Direction A** (buggy says `strong=True`, fix says `strong=False`):
  Stem 丙 + chart has 午 (no 巳, no 寅, no 戌, no 未). Under strict yin-yang rooting, 丙 (陽火) does NOT root in 午 (本氣=丁陰火); but the buggy code sees "a 火 stem exists" AND "a 火-本氣 branch exists" and blocks 真化.
- **Direction B** (buggy says `strong=False`, fix says `strong=True`):
  `ziping_niu_jianbo` (庚寅 乙酉 癸亥 丙辰): 丙 hour stem is rooted in 寅 (中氣 = 丙). The fixed code correctly sees the rooted breaker. The buggy code sees "丙 火 stem exists" but "no branch has 火 本氣" (寅's 本氣 = 甲, not 丙) → wrongly allows 真化.

Both directions of error are real possibilities; the reviewer only saw Direction A.

---

## 2. What is the correct classical doctrine?

Sources:

- **《滴天髓·化象》**: 「化得真者只論化，化神還有幾般話」 — "When 真化 is achieved, discuss only the transformation; the 化神 still has several considerations."
- **任鐵樵《滴天髓闡微·假化》** (paraphrased through guoyi360, suanzhun, sina blog 至真齋主): 真化 requires
  (a) 月令 supports 化神 (得令);
  (b) 化神 has root (本氣 or 中氣 in branches);
  (c) 局中無沖破;
  (d) **無克化神之神，或克者被制**.
- **《滴天髓》原文 on 假化**: 「如丙辛之合，日主是火，生於冬令，重重金水，既合且化，**嫌其柱中有土**，暗來損我化神」 — even in an otherwise-真化 setup, the presence of a 克化神 element (here 土 克 水) downgrades to 假化.
- **算準網 / 星塵算命 (modern reference for 乙庚化金 conditions)**:
  「四柱不能有火來損金，**或者有火被制**」 — "no 火 in the chart that can damage 金, OR if 火 is present, it must be restrained/controlled."
- **Critical zhihu passage** (《滴天髓》原文討論): 「乙木如果有寅卯根，寅卯受制，這時乙庚合化金」 — "Even if 乙木 has 寅卯 roots, if those 寅卯 are 受制, 乙庚 still 合化 successfully" → strength of root matters, not mere presence.

### Synthesis

A 克 element blocks 真化 only if the 克 stem has **operative force** in the chart. Operative force is established through 通根 (the breaker stem must have its own root: 本氣 or 中氣 in some branch). A naked rootless 克 stem with no branch support is too weak to disrupt 化氣.

The proposed fix (`stem in hidden[:2]`, requiring SPECIFIC stem to be in 本氣 or 中氣) implements the **strict yin-yang same-stem 通根** doctrine. This is more conservative than the 同氣通根 alternative (any same-element root counts) used elsewhere in some implementations.

---

## 3. Is the proposed fix correct?

**Verdict: Yes, doctrinally aligned, but with one caveat.**

The proposed fix correctly enforces:
- Outer condition: stem of `breaker_el` exists in chart.
- Inner condition (correctly linked to outer): that **specific** stem has 通根 (本氣 or 中氣) in some branch.

This matches:
- 「克者被制」 doctrine — a rootless breaker is effectively "制" (restrained) by its own weakness.
- 子平 mainstream 通根 definition: stem rooted iff stem element appears as 本氣 or 中氣 (餘氣 too weak to count for breaker purposes; the existing `hidden[:2]` threshold matches Phase 12b Fix D's "weaker_rooted" semantics).

**Caveat**: The fix uses **strict yin-yang stem-in-hidden** (e.g., 丙 NOT rooted in 午, only 丁 is). The alternative 同氣通根 (loose) would say 丙 IS rooted in 午. The strict view is the more conservative doctrine and is consistent with how `_fix_d_check_liu_he` checks roots (via `STEM_ELEMENT` element match across stems and `BRANCH_ELEMENT` for branches — i.e., element-level, NOT exact stem). So the fix is actually MORE strict than Fix D's analogous check.

This stricter behavior is acceptable for blocking purposes (better to allow 真化 in marginal cases than block it spuriously) and matches what the existing 3b test `test_breaker_present` expects.

---

## 4. Risk assessment

### Charts affected in the validation corpus (n=50)

Mechanical scan: only 1 of 50 charts shows `buggy != fixed` in the breaker check.

| Chart | Pillars | DM | V2 | combo | buggy | fixed | Reaches gate (v)? |
|---|---|---|---|---|---|---|---|
| `ziping_niu_jianbo` | 庚寅 乙酉 癸亥 丙辰 | 癸 | 55.0 | 乙庚化金 | False | True | NO (V2≥35 → `check_cong_ge` early-returns None at line 543) |

All 6 other corpus charts with adjacent 五合 pairs produce `buggy == fixed` in the breaker check (I verified each pair by hand-tracing the loops).

The 3 V2<35 charts with active 真化 detection (`anchor_cong_cai_yiwuming`, `ziping_li_canzheng`, `ziping_fan_taifu`) all have `buggy == fixed == False` (no breaker triggered either way) AND their classical readings explicitly affirm 真化 (per `reasoning` field). The fix preserves correct behavior for all 3.

### `anchor_cong_cai_yiwuming` impact

Pillars 庚申 乙酉 丙申 己丑, DM=丙. Combo = 乙庚化金, formed_el=金, breaker_el=火.

- Outer loop: 丙 (day stem) is 火 → matches.
- Inner loop (buggy): branches 申/酉/申/丑. None has 火 本氣 → buggy=False.
- Inner loop (fixed): is 丙 in any branch's hidden[:2]? 申=[庚,壬,戊], 酉=[辛], 丑=[己,癸,辛] → 丙 nowhere. → fixed=False.

Both verdicts agree: **breaker_strong=False, 真化 fires, 從格 succeeds**. The anchor chart is unaffected.

### Real-user impact estimation

The bug only matters when ALL of the following hold simultaneously:
1. Adjacent 五合 stem pair in the chart.
2. 月令 supports 化神 (gate ii, multiplier ≥ 1.5).
3. 化神 rooted (gate iii).
4. No 沖 on either combining branch (gate iv).
5. DM V2 < 35 (so `check_cong_ge` doesn't early-return).
6. The breaker check differs between buggy and fixed logic.

Heuristic: combinations 1–5 already constitute < 5% of charts. Condition 6 layered on top suggests **<1% of real-user charts** will see a behavior change.

When the bug DOES fire, the impact is also bounded: only 從格 vs non-從格 classification flips, which is a high-stakes flip but always was guarded by the 5 gate prerequisites.

---

## 5. Comparison with Phase 12b Fix D (六合 真化)

**Fix D does NOT have a breaker check at all.** Its 4 conditions (lines 1358–1372 of `annual_enhanced.py`) are:
  (i) Valid 六合 pair.
  (ii) Weaker combining branch has no independent root.
  (iii) 化神 transparent in flow-year, flow-month, or any natal stem.
  (iv) 化神 strict 旺 in flow_month_branch (multiplier ≥ 1.5).
  (v) No 沖/刑 on either combining branch.
  (vi) No 爭合 (≥2 combinations sharing month branch).

There is no equivalent of Pattern 3b's condition (v) "no 克 element with strong root". So Fix D **does not have this bug** — it doesn't have the check.

**Why didn't Pattern 3b mirror Fix D exactly?** The validation_fix_doctrine_verification.md plan explicitly added condition (v) as an extension because Pattern 3b's stakes are higher (从格 classification), and the doctrine cites 「化神被克」. The plan's choice was reasonable but introduced the buggy check.

**Should Fix D add the check too?** Probably not in the same form. Fix D operates on flow-year/month branches (transient), where doctrine is more permissive about 假化 vs 真化 (modern Bazi doesn't distinguish strongly for monthly scoring). For chart-level 真化 detection (Pattern 3b), the breaker check IS warranted by 滴天髓·假化.

---

## 6. Recommendation

**Fix it.** The bug is real (in both directions), the proposed fix is doctrinally aligned, and the risk is minimal:

1. **Apply the proposed fix** (move the inner loop inside the outer, require `stem in hidden[:2]`).
2. **Don't backport to Fix D** — Fix D is a different mechanism (flow-year scoring, not chart-level 從格 detection).
3. **Add 1 regression test** for `ziping_niu_jianbo` to guard the new behavior even though it doesn't change `check_cong_ge`'s output (V2=55 short-circuits). The test should:
   - Verify `detect_true_transformed_stems` returns `{}` for `ziping_niu_jianbo` after the fix (because 丙 IS rooted in 寅 中氣).
   - Verify `check_cong_ge` still returns None (no behavior regression on the chart-level result).
4. **Add 1 new test** for the Direction A theoretical case: e.g., 庚寅 乙酉 戊午 丙子 (丙 hour stem + 午 day branch, no 巳, no 寅 root for 丙). Under buggy code, breaker_strong=True (午 has 火 本氣). Under fix, breaker_strong=False (丙 not in 午=[丁,己][:2]). The fix should allow 真化 here per doctrine (rootless 丙 doesn't break 化金).

### Things to flag

- **Strict vs loose 通根**: The fix uses strict yin-yang stem-in-hidden. Some classical sources allow 同氣通根 (any same-element root). Engine should pick a consistent stance. Current `_fix_d_check_liu_he` `has_root` logic uses element-match (loose) — slightly inconsistent with Pattern 3b's stricter check. Consider documenting this explicitly in CLAUDE.md alongside the Phase 12d notes.
- **Branch-only breakers**: If a chart has 巳/午 branches but no 火 stem, neither buggy nor fixed code treats this as a breaker. This is a separate (deeper) doctrinal question — both versions ignore branch-only breakers. Stays out of scope for Issue F.
- **Test naming**: existing `test_chong_disrupts_transformation` (test_phase_12d_pattern_3b.py) has a misleading docstring (acknowledged inline) about which branch is in clash. Worth a comment cleanup but not part of Issue F.

### Recommended fix code (replacing lines 368–385)

```python
# (v) No 克 element to 化神 with strong root (本氣 or 中氣 of the SPECIFIC stem)
breaker_el = ELEMENT_OVERCOME_BY.get(formed_el, '')
breaker_strong = False
for pp in ('year', 'month', 'day', 'hour'):
    stem = pillars[pp]['stem']
    if STEM_ELEMENT.get(stem) != breaker_el:
        continue
    # Inner loop NOW LINKED to outer: check this specific stem's own root.
    for pp2 in ('year', 'month', 'day', 'hour'):
        branch = pillars[pp2]['branch']
        hidden = HIDDEN_STEMS.get(branch, [])
        # 本氣 or 中氣 (餘氣 too weak to make stem operative as breaker)
        if stem in hidden[:2]:
            breaker_strong = True
            break
    if breaker_strong:
        break
if breaker_strong:
    continue
```
