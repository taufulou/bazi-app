# Phase 12e Implementation Plan Review v2.1 (final)

**Reviewer**: staff engineer (same as v1 + v2)
**Date**: 2026-04-29
**Plan version reviewed**: v2.1 (`.claude/plans/phase_12e_implementation_plan.md`)
**Verdict**: **Approve, ship it**

---

## v2 → v2.1 fix verification

| N-fix | Verified? | Notes |
|---|---|---|
| **N1 — Inline import dropped** | ✓ | Plan section 1-4 (lines 125-174) no longer contains `from .life_stages import get_life_stage`. The replacement at lines 158-159 explicitly comments "get_life_stage already imported at module level (line 56); handles yin/yang DM cycles correctly via reversed life-stage tables." Clean fix. |
| **N2 — Compat trace completed + Angelababy cascade documented** | ✓ | Lines 304-327 contain the full trace table for **all 9 individuals** (Jay Chou, Hannah, Big S, Wang Xiaofei, Tse Tinghua, Cheung Bochi, Wong Yibo, Huang Xiaoming, Angelababy). Each row has per-pillar life-stage classification, qualifying branch count, pre/post-12e V2 score, and classification change flag. The trace surfaces **two firings**: Wong Yibo (2 qualifying: day=午+hour=午, both 帝旺) — score clamped at 100, classification unchanged; Angelababy (2 qualifying: year=巳 帝旺 + hour=午 臨官 for yin DM 己) — score 22.8 → 32.8, **very_weak → weak cascade flagged**. Math verified: 22.8 + 5×2 = 32.8 ✓. Mandatory pre-merge test `test_angelababy_v2_classification_under_12e` added at line 324, plus xfail-status protocol at line 325 ("If any xfail flips to passing (XPASS), update markers accordingly. If any new test fails, BLOCK merge for triage."). Yin-DM life-stage handling explicitly noted at line 327. End-to-end traced via `CHANGSHENG_BRANCH['己']='酉'` reversed cycle: year=巳→帝旺, day=未→冠帶, hour=午→臨官 — matches plan exactly. |
| **N3 — Cap test rewritten to use monkeypatch** | ✓ | Old "mock chart with qualifying=5" path gone. New test `test_boost_cap_clamps_via_per_branch_increase` at line 206 uses "monkeypatch `PATTERN_2A_PP_PER_BRANCH_BOOST=8`; chart with 3 qualifying branches → 8×3=24 → clamped at 20" with documentation note "(cap is defensive; 4-pillar charts max at 3 branches × 5 = 15, never reaching 20 by default)". Testable path; no infrastructure required beyond standard `monkeypatch.setattr`. |

## Optional NT items

| NT | Addressed? | Notes |
|---|---|---|
| **NT2 — Laopo matrix polish** | ✓ | Line 214 cell now reads cleanly: "year=寅(臨官)→1, day=戌(養), hour=申(絕). Total qualifying=1". No "let me re-check" inline derivation. |
| **NT3 — Test name decimal convention** | ✓ | Renamed to `test_anchor_laopo_v2_unchanged` at line 202 (with reviewer-feedback note). Sidesteps the underscore-as-decimal awkwardness entirely. |
| NT1 — Flag name length | not addressed | Still 33 chars (`PHASE_12E_PATTERN_2A_PP_NON_MONTH`). Non-blocking, called out explicitly in v2 as non-blocking. |

## Any new issues introduced by v2.1's surgical edits?

- **None critical.**
- The N2 trace surfaced the Angelababy cascade — this is a **legitimate new finding**, not an issue introduced by v2.1, and it's correctly flagged with a mandatory pre-merge test. Previously this was a "TBD" gap; now it's a known, tested cascade.
- The anchor regression matrix in section 1-8 was unaffected by the trace (the 6 charts there are non-compat anchors). No conclusions changed.
- Errata note (lines 21-24) cleanly summarizes the 3 fixes for future readers without re-flowing the v2 → v2.1 history.
- No infrastructure changes required for the monkeypatched cap test.
- The xfail-handling protocol at line 325 is correct — if Angelababy's cascade flips any xfail to XPASS, the implementer updates markers, and any new failure blocks merge for triage. Defensive enough.

## Verdict

Ship it. All 3 N-fixes are correctly applied with the right classical-doctrine reasoning preserved (especially the Angelababy yin-DM cascade math, which I verified end-to-end through `CHANGSHENG_BRANCH` + `STEM_YINYANG['己']='陰'` + the reversed-cycle offset). No new critical issues. The plan is now a finalized spec ready for implementation.
