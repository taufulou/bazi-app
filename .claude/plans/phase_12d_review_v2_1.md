# Phase 12d Implementation Plan Review v2.1 (final)

**Reviewer**: staff engineer (same as v1 + v2)
**Date**: 2026-04-28
**Plan version reviewed**: v2.1 (`.claude/plans/phase_12d_implementation_plan.md`)
**Verdict**: **Approve, ship it**

---

## v2 → v2.1 fix verification

| Bug | Fix verified? | Notes |
|---|---|---|
| N1 — Pattern 3b SEASON_MULTIPLIER | ✓ | §3b-1 lines 736-737: two-step lookup `season_score = SEASON_STRENGTH.get(formed_el, {}).get(month_branch, 3)` then `if SEASON_MULTIPLIER.get(season_score, 1.0) < 1.5: continue`. Inline comment at lines 733-735 explicitly cites the v2.1 rationale. Default `season_score=3 → multiplier=1.0 < 1.5 → skip` is the correct conservative fallback. |
| N2 — Invariant scope | ✓ | §3a-5 line 1043 places `_assert_five_gods_distinct(effective_gods)` INSIDE the `if cong_ge.get('dmAsYongShen', False):` branch (lines 1029-1043). The 從弱 `else:` branch (lines 1044-1055) does NOT call the assertion and explicitly comments "preserves legacy 4-distinct shape … invariant does NOT apply here." Helper docstring (lines 1063-1066) reinforces the scoped restriction. Upstream dict construction at §3a-3 lines 978/996 sets `dmAsYongShen=True` only in the 從強/從旺 detector — 從弱's existing dict has no such key, so `cong_ge.get('dmAsYongShen', False)` correctly returns False. |
| N3 — Neutral-DM gating | ✓ | §1-4 line 630: `elif strength == 'neutral' and dominant == '財旺':` — exactly the single targeted sub-branch. Inline comment at lines 631-635 names the rationale and confirms neutral-general / 官殺旺 / 食傷旺 fall through to unchanged `else`. Line 640's `else:` comment ("neutral-not-財旺 (existing logic unchanged)") makes the intent explicit at the second site too. |
| N4 (non-critical) — Test naming | ✓ | §3a-6 table renames `test_five_gods_distinct_invariant` → `test_five_gods_distinct_for_cong_qiang_wang` (line 1084) AND adds new `test_cong_ruo_preserves_legacy_4_distinct` regression guard (line 1085). §1-6 adds `test_neutral_general_baseline_preserved` (line 660) for the N3 baseline guard. Errata footer (lines 1232-1235) cross-references all three with N1/N2/N3 markers. |

---

## Any new issues introduced by v2.1's surgical edits?

None.

The v2.1 deltas are:
- 2 lines added in §3b-1 (SEASON_STRENGTH lookup + comment) — does not interact with anything else.
- Assertion call relocated by 1 indent level in §3a-5 — the helper itself, the override branches, and the upstream `dmAsYongShen` flag are unchanged.
- Single condition tightened in §1-4 (`strength == 'neutral'` → `strength == 'neutral' and dominant == '財旺':`) — narrows scope, cannot widen behavior.
- 3 test entries added/renamed in three test tables — no production-code impact.

I checked the cross-pattern surface: the §1-3 `_detect_dominant_imbalance` insertion still returns `'財旺'` for the 食神生財 chain (line 602), which now correctly hits the v2.1-narrowed neutral branch in §1-4. No upstream caller assumed the old broader neutral block existed.

The errata commentary at line 1232 also correctly notes that the same `SEASON_MULTIPLIER` shape bug exists in `_fix_d_check_liu_he` (Phase 12b Fix D) but is out of scope for v2.1 — agreed; that's a separate Phase 12b cleanup item.

---

## Verdict

All three N-bugs are correctly fixed with surgical edits exactly as prescribed in the v2 review. No new issues introduced. Ship it.
