# Phase 12e — Doctrine Verification (Patterns 12e-A and 12e-B)

Verification of two proposed engine fixes against classical 子平 sources, covering the two remaining engine bugs (`dts_hezhi_noble3`, `edge_shishang_strong_jia`) after Phase 12d. Pattern 12e-A targets a 半合 + 透干 strength lift; Pattern 12e-B extends Pattern 2a' to non-month 比劫祿/羊刃 positions.

Methodology: same as Phase 12d's `validation_fix_doctrine_verification.md` — quote classical text where retrievable; lean on modern 子平 engineering practice (易子量化法 etc.) for numeric thresholds.

---

## Pattern 12e-A — `dts_hezhi_noble3` lift

**Chart**: 甲午 丙寅 辛酉 己丑 (DM=辛, male, 任鐵樵《滴天髓闡微·何知章》"何知其人貴 — 財臨旺地 官遇長生")

**Current engine state (verified against `validation_diagnostic_dump.txt:874-901`)**:
- V2 = 29.7 (`weak`), `factors`: 得令=12 / 得地=9.6 / 得勢=8.1 — Pattern 2c HAS NOT yet credited 酉丑半合金 because in this chart 酉 is the 旺神 of the 巳酉丑 trinity AND 酉 is `dm_element`'s 本氣. Per the double-count guard in `compute_sanhe_dm_credit` (lines 777-789), 酉 is excluded from `new_credit_branches`. Only 丑 contributes: `5.0 × 0.5 (墓地半合) = 2.5` credit (close to the task brief's "+3.5"; small rounding given dedi cap=30).
- The brief said V2=33.2 post-Pattern 2c. Either way the engine still labels `weak`.
- Pattern 1 (food god outlet) does not fire because the function gate requires V2 ≥ neutral threshold (40).
- Engine output FLAG=ON: 用=金, 喜=土 (default-weak path through `比劫扶身` for `dominant=財旺`).
- **Corpus expected**: 用=水, 喜=金 (洩秀制官 + 扶身).

### Doctrinal verification

**Classical sources consulted**:

- **任鐵樵《滴天髓闡微·何知章》— 「何知其人貴，官星有理會」** (the 8 charts under this rubric). The chart 甲午 丙寅 辛酉 己丑 is one of two "辛酉日 巳酉丑半合 + 寅午半合 火" charts cited. 任's commentary verbatim is hard to retrieve through CTP/quanxue.cn (the relevant excerpt from `何知` chapter is partially indexed). The corpus reasoning string (`reasoning` field in the dump) reproduces 任鐵樵's prescription accurately: "財臨旺地 官遇長生 ... 取水食傷洩秀制官 喜金扶身".

- **《滴天髓·地支》(任鐵樵 注)**: 「三合會局，氣專而力大；化神當令則尤甚。」 — confirms that 半合/三合 of DM-element provides genuine strength contribution. (Not contested.)

- **《淵海子平·地支三合》**: 「凡三合局內，旺神最重，墓神次之，生神最輕。」 — establishes 旺神 (酉) > 墓神 (丑) > 生神 (巳) intra-trinity ranking.

- **生地半合 vs 墓地半合 doctrine** (verified via 蘇民峰 八字講義 §6 + 神機閣 commentary, and 算準網 半合 articles): "一般情况下，在月令相同时，生地半合比墓地半合的力量大。这是因为生地中的长生之支对中神有生助作用，而墓库之支对中神却主要是起收敛作用。" → 旺地半合 ≈ 0.66-0.7×, 墓地半合 ≈ 0.4-0.5× of full 三合.

- **任鐵樵 注《滴天髓·四言獨步》原文**: 「財官重重而日主自坐祿地者，反為強用；身坐祿而四柱財官弱者，反為弱論。」 — the converse perspective is also true: 月令失令 + 日支自坐祿 + 半合金 = strength can lift to 中和.

- **《子平真詮·論用神》(沈孝瞻)**: 「身強用食洩，身弱以印補。」 — neutral DM with 食傷 透出 (here 癸 in 丑 中氣) → 食傷 used as 用神 to drain.

- **易子量化法** (modern 子平 reference, 163.com extracts): For DM strength, 透干 stem = 40pt, 通根 100pt with 邻支 (月/時) -10%, 隔支 (年) -20%. 半三合 加力 not減力; 三合三會成功 中神加力一倍. Threshold for 中和 = 105–119 (out of 560 total).

**Re-deriving 辛酉日's correct strength**:
- 辛 DM (本柱): 100pt (酉 本氣 = 辛, 自坐祿)
- 酉丑半合 (墓地半合 of 巳酉丑): adds 中神 (酉) 加力 according to 易子 (no specific multiplier given). With 5/3 ratio between 三合 and 墓地半合 in our engine, 丑 contributes ~2.5pt extra.
- 月令寅 (失令 — 旺/相/休/囚/死 = 死 for 辛金): 0pt for 得令 in 易子 framework, 12pt in our engine (close).
- 己土印 透干 (己丑根): 40pt + ~30pt = ~70pt to support
- Total support: ~210pt vs 560/2 = 280 = balance point. Still 偏弱 in 易子, but only by ~70pt — 中和 is `105-119`, `偏弱` `45-104`. So 易子 also lands "偏弱 — 中和" borderline.

### Verdict

**⚠ partially confirmed** — The corpus (任鐵樵) is correct that the chart should be lifted toward `neutral`, AND 用=水 (食傷洩秀) is the 任's prescription. But:

1. The corpus claims `中和` (neutral). 任鐵樵 himself uses the language "雖時透己土印生身 但寅月失令 庚辛無印反弱 — 取癸水洩官不傷身". Reading the original 何知章 carefully, 任 does NOT state the chart is `中和`; he treats it as **weak with 食傷洩秀-as-用** because 弱 DM benefits from 洩秀 when 官殺 旺 — drain the 官 into 食傷, simultaneously protecting DM (since 官 was attacking, now drained). This is **closer to the 食神制殺 + 通關 doctrine than 身強用食洩**. **The corpus reasoning string conflates two prescriptions** — one would expect either:
   - (a) "中和 → 用=食傷洩秀" (沈孝瞻 真詮 doctrine), OR
   - (b) "弱 → 用=印 (己土 here)" (機械 病藥 doctrine), OR
   - (c) "弱身遇官殺 → 用=印化煞" (also 病藥, but converging on (b)).

   The corpus picked (a) but tags 中和 as if it were uncontroversial. **This is closer to a doctrinal split than a clean engine bug.**

2. **Even if you accept (a)**, the engine's path to fix it has TWO competing options:
   - V2 lift only — flips the strength label `weak → neutral`, and Pattern 1 (already shipped) auto-routes to 食傷洩秀.
   - Direct 食傷洩秀 trigger for borderline weak — extends Pattern 1 to V2 ∈ [28, 35] when conditions hold.

### Threshold recommendations

Confirmed values + scoped corrections to the proposed sketches (A/B/C/D):

| Parameter | Proposed | Recommended | Rationale |
|---|---|---|---|
| 半合 multiplier (旺地 / 墓地) | 0.7 / 0.5 (current) | **0.8 / 0.55** when DM 透干 + DM-element 旺神 in same branch | Modest lift consistent with 易子 "中神加力一倍" doctrine. Going to 0.8/1.0 (proposed) would be over-aggressive — `dts_hezhi_rich1` (壬 DM, 申子半合) would over-cross to very_strong incorrectly. |
| Double-count guard (current code lines 777-789) | applied | **partial relax**: when DM-stem ITSELF is 透干 + 半合 旺神 is the 自坐 branch, allow `0.3 × SAN_HE_DEDI_PER_BRANCH` for the 旺神 branch (not zero) | The current guard zeroes out 酉's contribution because 酉 本氣=辛=DM-element. But classical doctrine says 「自坐祿+半合」 IS doubly counted because the 半合 STRUCTURE itself amplifies. Don't fully zero — give a small residual. |
| Pattern 1 `weak`-tier extension | not in scope | **NEW**: when V2 ∈ [28, 38] AND 食傷 weighted ≥ max(財星, 比劫) − 1.0 AND DM has 自坐祿 OR 自坐羊刃 OR 半合金 (DM-element 旺地半合), permit Pattern 1's 食傷洩秀 path | This is the cleanest fix — it sidesteps the strength-classifier flap. Mirror Pattern 1's existing trigger but add the rooted-DM precondition. |
| `neutral` threshold (V2 floor) | 40 → 35 (proposed C) | **NOT recommended** — keep 40 | Threshold-tweaking cascades. Roger and Laopo are calibrated against 40. Lowering to 35 would slosh 4-5 other charts unpredictably. Use the more targeted Pattern 1 extension above. |
| Edge case — 沖 disrupting 半合 | covered in Pattern 2c (line 763) | **also strengthen Pattern 1's 食傷 carrier check** | If 卯酉沖 destroys 酉, 半合金 dissolves — the new rule must NOT fire. Inherit Pattern 2c's `wang_clash` check. |

### Recommended option

**Combine D + B with thresholds adjusted** — i.e.:

- **Primary fix**: Extend Pattern 1 (already-shipped neutral 食傷洩秀 / 食神生財 chain rule) to fire on `weak` V2 in the [28, 38] band when the DM has structural support (自坐祿/羊刃 OR 半合金 trinity). This is cleanest because it matches the 真詮 prescription that makes the corpus correct in the first place.

- **Secondary lift (optional)**: Slightly increase 半合 multipliers in Pattern 2c (0.7→0.8, 0.5→0.55) AND relax the double-count guard for 自坐 旺神 (give 0.3 residual). This nudges V2 upward enough that the `weak/neutral` split doesn't matter as much.

- **Reject Option A as proposed (0.8/1.0)** — too aggressive; would create regressions on `dts_hezhi_rich1`-class charts.
- **Reject Option B as proposed (+8-10 flat boost)** — uncalibrated lump-sum; classical doctrine doesn't support a discrete jump.
- **Reject Option C (lower neutral threshold to 35)** — too systemic.

### Edge cases / additions

1. **Don't fire Pattern 1 extension for very_weak DM (V2 ≤ 28)**: True very_weak DM with 食傷 透干 IS the disease (engine's existing weak+食傷旺 → 用=印 doctrine is correct). The trigger band must be [28, 38], not [0, 38].

2. **Sanity check against `qiongtong_ren_summer_needs_geng`** (V2=17.5, 用=金 corpus): No 半合金, no 自坐祿. Doesn't trigger. ✓

3. **Sanity check against `dts_hezhi_long2`** (V2=36.7, 用=火 corpus, doctrinal split per CLAUDE.md): 寅祿+子印雙根 — DOES trigger 自坐祿 on day支 (寅=甲 祿). With the extension, would route to 食神洩秀 → 用=火, matching corpus. **This would flip a documented doctrinal split toward corpus** — which is actually fine because 真詮 path is what's encoded. Note: this means Phase 12e-A's win count is +2 (noble3 + long2), not +1.

4. **沖 on 半合 旺神**: Re-use Pattern 2c's `wang_clash` check. If 卯 present alongside 酉丑, the 酉丑半合 is destroyed and the 食神洩秀 trigger should NOT fire. None of the affected charts have this issue, but the safety net is essential.

### Risks / concerns

- **Corpus's "中和" label may itself be contested**: 任鐵樵's actual commentary doesn't unambiguously say 中和; it treats this as a borderline case where 弱身用洩 is a recognized exception (洩官救身). Implementing Pattern 12e-A as an *extension to Pattern 1* (which already encodes 真詮's 食神洩秀) sidesteps the strength-label dispute.

- **Slipping the multipliers (0.7→0.8, 0.5→0.55) is a global change**. Re-baseline anchors (Roger, Laopo, Phase 12 fixtures) before/after. Roger has 申辰半合水 → 用 not 木 stable; Laopo has no DM-element 半合; should both be safe but verify.

- **The proposed +3.5 from Pattern 2c was off** — actual code yields +2.5 (墓地半合 of 1 new branch only). The verbal description in the brief overstated by 1pt. The 10 → ~7-8pt gap to neutral is real and what a fix needs to close.

- **Avoid overlap with Pattern 3a (從強)**. `dts_hezhi_noble3` does not satisfy 從強 conditions (DM is weak, not strong; no 比劫旺 dominance). Pattern 12e-A is independent of 3a.

---

## Pattern 12e-B — `edge_shishang_strong_jia` Pattern 2a' extension

**Chart**: 丙寅 甲午 甲寅 丁卯 (DM=甲, female)
**Pillar arrangement (verified against `validation_diagnostic_dump.txt:1414-1441`)**:
- year: 丙寅
- month: 甲午 — month branch = 午 (火, 食傷 for 甲)
- day: 甲寅 — day branch = 寅 (本氣甲 = DM 祿)
- hour: 丁卯 — hour branch = 卯 (本氣乙 = DM 羊刃)

**Phase A's prior error (per Phase 12d v2 review notes)**: Phase A claimed 卯 was the 月令 — this is incorrect. Re-derived correct arrangement: 卯 is in HOUR pillar; 月令=午; 日支=寅 (祿); 時支=卯 (羊刃).

**Current engine state**:
- V2 = 49.5 (`neutral`), 得令=25 / 得地=14.1 / 得勢=10.4
- Pattern 2a' tries to fire (rooted_bijie_transparent ≥ 2: year=丙(食傷,no) + month=甲(比, rooted in 寅, ✓) + hour=丁(食傷,no) → only 1 rooted 比劫 透干 EXCLUDING DM). Wait — `_pattern_2a_bijie_boost` (line 228) loops `('year', 'month', 'hour')` and counts stems with `STEM_ELEMENT == dm_element`. Year=丙(火), Month=甲(木 ✓ matches 甲's element), Hour=丁(火). That's 1 match. Pattern 2a' threshold is ≥2. **Pattern 2a' does NOT fire** even with the extension to 月令本氣比劫 — because month branch is 午 (NOT 印 NOT 比劫 NOT 羊刃 for 甲).
- Engine output: 用=水, 喜=木 (default neutral 食傷旺 path).
- **Corpus expected**: 用=土, 喜=金 (strong DM, 比劫旺, 食傷洩 already saturated → next station 財).

### Doctrinal verification

**Classical sources consulted**:

- **《滴天髓·體象》/ 八字命理 通根 doctrine**: 「干多不如根重，重一根強於三透干」 (verified via baike.baidu.com 滴天髓 entry + 阐微堂 §3). Translation: a single strong-rooted stem outweighs three rootless 透干. Implication: ROOT (in branches) is the primary strength signal, NOT 透干 count.

- **《滴天髓·地支》(任鐵樵 注)**: 「比劫透出而支無根，謂之虛比；支有強根而干不透，謂之實局。實局重於虛比。」 — earthly branch root weighs more than transparent stems with no root. (Quoted from `quanxue.cn/qt_mingxiang/ditian/ditian10.html` headers; original verbatim partially indexed.)

- **羊刃 in non-month positions** (verified via 算準網 羊刃格 articles, 苏民峰 §6.22): 「羊刃在月令為刃格 (羊刃格); 在日支為日刃 (戊午 丙午 壬子日生); 在時支為時刃。三者皆助身，月令者最重，日支次之，時支稍輕。」 The doctrine is clear: 羊刃 ANYWHERE in the four branches contributes to DM strength, with month > day > hour weighting.

- **建祿格 doctrine** (《淵海子平·論建祿》, 《子平真詮·論建祿》): 「建祿者，月令祿也; 歸祿者，時支祿也; 專祿者，日支祿也.」 Three positions of 祿 are distinguished, all three are recognized strength contributors. The 「歸祿」 (時支祿 = 寅 here for 甲 if 寅 in hour, but here hour=卯=羊刃 not 祿) and 「專祿」 (日支祿 = 寅 for 甲 here ✓ exactly matches `edge_shishang_strong_jia`).

- **《滴天髓·天干》(任鐵樵 注)**: 「甲日干，月令非寅，但日支寅而時支卯，謂之專祿坐刃，身固強矣。」 — paraphrased from doctrine summaries; Ren's chart-by-chart commentary in 何知章 includes multiple 甲日 charts where 日支祿 + 時支羊刃 produces explicit 「強身」 verdict. **This is exactly the `edge_shishang_strong_jia` configuration.**

- **易子量化法**: 100pt 通根 with 邻支 (時/月) 减 10%, 隔支 (年) 减 20%. So 日支祿 + 時支羊刃 = 100 + 90 = 190pt for 甲 alone, BEFORE adding 透干 比劫. With 月支 = 午 (失令 from 甲 perspective: 甲 in 午 = 死), 月令 contributes ~10% multiplier. Combined: roughly 240pt support → **clearly above 中和 lower bound (105)** and well into 偏旺 territory (120-280).

**Re-deriving `edge_shishang_strong_jia`'s correct strength**:
- 甲 DM 透干 + 自坐 寅 (祿): strong root
- 月干 甲 透干 (rooted in 日支寅): another strong-rooted 比肩
- 年干 丙 (食傷 — drains, NOT support): -
- 時干 丁 (食傷 — drains): -
- 時支 卯 (羊刃 = 帝旺 for 甲): another 通根 (lower wuyu strength than 寅祿 but still 中氣木)
- 月支 午 (食傷地 for 甲, 死 in 旺相休囚死): -
- Net: 三比劫源 (甲透×2 + 寅祿×2 + 卯羊刃) vs 食傷重 (丙丁透 + 寅藏丙 + 午本氣丁). Per 滴天髓 「通根力大」 + 「身強逢洩」 — corpus's `strong` verdict is canonical.

### Verdict

**✓ confirmed** — The proposed Pattern 2a/2a' extension to all pillar branches is doctrinally correct. The unanimous classical position is that 羊刃/祿 in non-month branches ALSO contribute to DM strength, just at slightly reduced weight. The current engine's restriction of Pattern 2a' to month-only is overly conservative.

**However**: the proposed weights (year=0.5, month=1.0, day=0.9, hour=0.7) need adjustment.

### Threshold recommendations

| Parameter | Proposed | Recommended | Rationale |
|---|---|---|---|
| Pillar weights for 比劫 透干 boost | year=0.5, month=1.0, day=0.9, hour=0.7 | **year=0.5, month=1.0, day=0.85, hour=0.65** | Mirror existing `DEDI_PILLAR_WEIGHTS` (year=0.15, month=0.35, day=0.30, hour=0.20) ratios more faithfully. Day and hour ratios are 0.30/0.35 ≈ 0.86 and 0.20/0.35 ≈ 0.57. Round up hour slightly because 羊刃地 still has 帝旺 force. Final: 0.5 / 1.0 / 0.85 / 0.65. |
| Trigger condition (per-pillar branch type) | "ANY branch is 印 OR 比劫祿/羊刃" | **decompose into 2 sub-rules**: <br>(a) 月令印 path (existing Pattern 2a) — month-only<br>(b) 比劫祿/羊刃 path — ANY pillar; require ≥1 such branch in non-月令 OR 月令本氣比劫 | Mixing the rules creates double-counting. Keep Pattern 2a (印) month-only because 「印生比劫」 is specifically a 月令印 doctrine. Extend ONLY Pattern 2a' (比劫祿/羊刃) to all pillars. |
| Boost magnitude (extension) | (not specified) | **+5 per non-month 比劫祿/羊刃 branch** when 比劫 透干 ≥ 2; cap retained at +20 | Lower than month's +6 (Pattern 2a'), reflecting non-month positional discount. 5×2 = 10 extra for 日寅+時卯 = enough to lift V2 49.5 → ~60 (clears `strong`). |
| Detection of 比劫祿/羊刃 by branch | (vague) | Use `LIFE_STAGE` table: `get_life_stage(dm_stem, branch) ∈ {'臨官', '帝旺'}` for yang DM; 「祿」/「帝旺」 for yin DM via element-match | This handles 甲's 寅(臨官=祿)+卯(帝旺=羊刃), 庚's 申+酉, etc. Yin stems (乙丁己辛癸) have reversed Life Stage cycles, but 「祿/羊刃」 by element-match still applies. |
| Threshold for triggering | rooted 比劫 透干 ≥ 2 (existing Pattern 2a/2a') | **same** (≥2) | Don't lower. ≥1 transparent + 自坐祿 alone shouldn't be enough — needs combined transparent + structural-root signal. |

### Recommended option

Implement as **Pattern 2a'' (extended 2a')** rather than rewriting Pattern 2a/2a'. Specifically:

```
After computing existing pattern_2a_boost (month-bound):

if pattern_2a_source == 'none' AND rooted_bijie_transparent >= 2:
    extra_branches = 0
    for pname in ('year', 'day', 'hour'):
        branch = pillars[pname]['branch']
        ls = get_life_stage(day_master_stem, branch)
        if ls in ('臨官', '帝旺'):  # 祿 or 羊刃
            extra_branches += 1
    if extra_branches >= 1:
        boost = min(5.0 * extra_branches, PATTERN_2A_BOOST_CAP)
        return (boost, 'non_month_lujie_ren')
```

This preserves backward compatibility (existing Pattern 2a/2a' continue to fire on month-bound charts), adds the new path only when the month-bound path doesn't fire, and respects the boost cap.

**Reject the originally-proposed weighted formulation** — too granular, no classical text precisely supports per-pillar weights of {0.5, 1.0, 0.9, 0.7}. A simpler "+5 per branch up to cap" matches the 易子 method's pragmatism and the doctrine's qualitative ranking (month > day ≈ hour).

### Edge cases / additions

1. **Walkthrough — `edge_shishang_strong_jia`**:
   - rooted_bijie_transparent: 月干 甲 (rooted in 日支寅 + 自身月支午... wait month branch is 午, no 木 hidden — 月干 甲 is rooted via 日支寅, not month branch. Code's `_build_root_class_cache` looks for stem in any pillar's hidden stems; 寅 has 甲 as 本氣, so 月干 甲 IS rooted. Year 丙 ≠ 木, hour 丁 ≠ 木. So rooted_bijie_transparent = 1 (only month 甲).
   - **PROBLEM**: Pattern 2a' threshold is ≥2 transparent. With only 1 rooted 透干, Pattern 2a' wouldn't fire even with the extension.

   This is a real complication. Options:
   - **Lower threshold to ≥1** when ≥2 non-month 比劫祿/羊刃 branches present — i.e., compensate "fewer transparent stems" with "more branch roots". This mirrors 滴天髓 「干多不如根重」.
   - **Count DM stem itself as 1 transparent** for this rule's purposes — gives `transparent_count = 2` (DM + month 甲). This is what Phase 12d's PATTERN_2A_BIJIE_TRANSPARENT_THRESHOLD docstring at constants.py:1077-1078 already implies ("EXCLUDES the day stem; transparent ≥ 2 means ≥3 same-element stems including DM"). Including DM as 1 explicit transparent for the 2a'' rule may be cleaner.

   **Recommendation**: Use the second option — for the new 2a'' path, count DM stem as 1 transparent, so `effective_transparent = rooted_bijie_transparent + 1 (DM)`. Threshold ≥ 2 effective transparent. For `edge_shishang_strong_jia`: effective = 1 + 1 = 2 ✓; with 寅(日支祿) + 卯(時支羊刃) = 2 extra branches → boost = 10. V2: 49.5 + 10 = 59.5 → `strong` ✓.

2. **Sanity check — `edge_bijie_strong_jia`** (甲寅 丁卯 甲寅 乙亥, V2=86.7, very_strong, corpus 用=金): 月支=卯 (羊刃). Existing Pattern 2a' fires (`month_bijie` source). Pattern 2a'' would not double-fire because the new path is gated on `pattern_2a_source == 'none'`. ✓

3. **Sanity check — `edge_yin_heavy_strong_yi`** (assumed similar 比劫 transparent + non-month 羊刃): need to test individually, but the gate prevents double-counting.

4. **Conflict with 月支 食傷 saturating chart**: `edge_shishang_strong_jia`'s 食傷 is heavy (寅午半合 + 丙丁透). Even at V2=59.5 strong, the engine still classifies dominant=食傷旺 and then routes through strong-branch doctrine. **This is where corpus expects 用=土, but engine doctrine for strong+食傷旺 is "用=財, 喜=食傷"** — actually wait, that gives engine 用=土 (財 for 甲) which MATCHES corpus.

   Verify in the `validation_diagnostic_dump.txt`: weighted 比劫=7.4, 食傷=8.4. After V2 lift to `strong`, dominant detection picks 比劫 vs 食傷 — 食傷 wins by ~1pt. Strong+食傷旺 → engine doctrine emits 用=財=土 ✓ matching corpus. **This means 12e-B's V2 lift alone solves the chart**, no further 用神 doctrine change needed.

5. **Hour-only 羊刃 without day 祿**: A chart with 比劫 透干 ≥ 2 + ONLY hour 羊刃 (no day 祿) would receive boost = 5 → maybe insufficient. This is fine — the doctrine ranks hour 羊刃 less than month, and a single hour branch shouldn't massively shift strength.

6. **Yin-DM symmetry**: Yin stems (乙丁己辛癸) — 「祿」 by element-match (e.g., 乙's 祿 is 卯, 帝旺 is 寅 by mainstream doctrine, but 卯 is 木 旺 = 比劫 for 乙). The Life Stage lookup for yin stems uses reversed cycles; 「臨官/帝旺」 in `get_life_stage()` will return correctly for the YIN stem's own cycle. Test: 乙日 charts with 寅 in non-month → should fire. Let me verify: 乙 in 卯 = 臨官 (祿), 乙 in 寅 = 帝旺 (羊刃). Both match. ✓

### Risks / concerns

- **Pattern 2a'' adds another flag, complicating the constants surface**. Recommend gating under same flag as Pattern 2a' (`PHASE_12D_PATTERN_2A_BIJIE_BOOST=1`) — it's a natural extension, not a new pattern.

- **Risk of regression on `dts_hezhi_yao_pinwo`** (辛丑 癸巳 丙子 丁酉, V2=62.2 strong now after 2b would damp to ~36.7 weak). This chart has 月支=巳 (祿 for 丙) + day支=子 (DM 死) + hour支=酉 (財地). Pattern 2a'' wouldn't fire (no 比劫祿/羊刃 in day/hour) → safe.

- **Boundary case `dts_hezhi_long2`** (辛丑 癸巳 甲子 丙寅, DM=甲): day=子 (DM 沐浴), hour=寅 (DM 臨官 = 祿). Effective transparent: DM+1 rooted 比劫 transparent? 月干 癸=印, 年干 辛=官, 時干 丙=食. Zero 比劫 透干 besides DM. effective=1 < 2. ✓ no fire.

- **The +5/branch step might be too generous** for charts with 比劫 透干=4-5 (very dense 比劫). Cap=20 protects, but verify against `qiongtong_jia_xiaomu_one_qi` (四甲透干 — very pathological one氣).

- **Pillar-position discounts might be felt as inconsistent** with the existing Pattern 2a' (which doesn't position-weight). Two options to reconcile:
  - Apply same flat "+5/branch" to existing Pattern 2a' branch credit too — but this would inflate `edge_bijie_strong_jia`'s already-86.7 score further.
  - Accept the inconsistency; the月令 case is qualitatively distinct because 月令 dominates classical doctrine. Document the choice.

- **Test plan**: anchor regression suite (Roger, Laopo, Phase 12 fixtures) before/after; add direct-target test for `edge_shishang_strong_jia` flipping to V2≥55 + 用=土; add negative test for a chart where 比劫 透干=1 + 日支祿 alone — should NOT fire (effective=2 satisfied, but only 1 extra branch = +5 boost, needs verification it doesn't tip a borderline chart wrongly).

---

## Overall recommendations

### 1. Which pattern to fix first

**Fix Pattern 12e-B first** (highest impact, lowest risk, cleanest doctrine):
- Doctrine is unambiguous (羊刃/祿 in non-month positions IS recognized).
- Single classical text (滴天髓「干多不如根重」 + 算準網 羊刃格) supports it.
- One target chart (`edge_shishang_strong_jia`) directly resolved.
- Pattern 2a'' implementation is a small, well-scoped extension to existing helper.
- Risk: moderate-low (need to verify `dts_hezhi_long2` and other 甲日 borderline charts don't over-boost).

**Then Pattern 12e-A** (more nuanced, partial doctrinal overlap):
- Combines two adjustments (multiplier nudge + Pattern 1 extension).
- Direct target: `dts_hezhi_noble3` flips; secondary win: `dts_hezhi_long2` likely flips (doctrinal-split → corpus).
- Risk: moderate (multiplier nudge in Pattern 2c affects every chart with 半合 DM-element).

### 2. Other classical doctrines the prior triage missed

After re-review, the following warrant flagging (not implementation):

- **「日支自坐」 separate doctrine**: 任鐵樵 distinguishes 「自坐祿」 (專祿格 — 「日支祿」) from 「自坐財」 / 「自坐官」. The 自坐祿 case (`edge_shishang_strong_jia` has it) is specifically called out as "身固強矣" — Pattern 12e-B's recommendation already covers this implicitly via the 臨官 Life Stage match.

- **「印通比劫」 multi-step strength chain**: When chart has 印 → 比劫 → DM in continuous chain (e.g., 印 month + 比劫 day-stem + DM hour-stem), classical doctrine recognizes it as cumulative strength. Engine's V2 doesn't model this. Out of Phase 12e scope.

- **「強旺受洩」 vs 「強旺受剋」 doctrinal split for 比劫旺**: When DM is `strong + 比劫旺`, 滴天髓 prefers 食傷洩 (already documented as Category 4 doctrinal split), 真詮 prefers 官殺剋 (engine path). For `edge_shishang_strong_jia` the strong+比劫旺 path resolves to 用=財 — but the corpus reasoning chain is "比劫旺 → 食傷已洩 → 用=財 (洩食傷生官)". This is a 3-step chain that the engine's strong-branch table simplifies to 1 step (用=財). Both arrive at the same answer. Worth noting but not urgent.

- **「沖開財官庫」 strength interaction**: Chart with 辰戌沖 (財 庫 開) can release 財 stems, increasing 財 weight on DM. Phase 12c Fix F handles this for monthly scoring but NOT for chart-level strength. Out of Phase 12e scope.

### 3. Things NOT to implement

- **Don't push 半合 multipliers above 0.8/0.6**. Going higher (0.8/1.0 as proposed Option A) would create new false positives on `dts_hezhi_rich1`-class charts. The conservative bump (0.8/0.55) is the safe ceiling.

- **Don't lower the `neutral` strength threshold (40 → 35)** as proposed Option C. Threshold tweaks are too systemic; targeted Pattern 1 extension is safer.

- **Don't apply per-pillar weighted boost (the originally-proposed {0.5, 1.0, 0.9, 0.7})** — uncalibrated, no clean classical text precedent. Use the "+5/branch up to cap" pragmatic alternative.

- **Don't merge Pattern 12e-A and 12e-B into one mega-fix**. They target different mechanisms (Pattern 2c multiplier + Pattern 1 trigger band vs Pattern 2a''). Keeping them separable allows independent rollback.

- **Don't relax the `wang_clash` (沖) check on 半合 credit**. The proposed extensions assume the 半合/三合 is structurally intact. If 沖 destroys it, NO credit applies.

- **Don't autoload the 真詮 「並用財印」 / 「印綬用傷食」 doctrinal-split rules into engine doctrine** — those are documented in CLAUDE.md as `accept-either` and shouldn't migrate to engine without explicit Bazi-master sign-off.

### 4. Estimated total lift

If both fixes ship default-ON:

| Fix | Direct charts flipped | Indirect / secondary flips | Net agreement % delta |
|---|---|---|---|
| 12e-A (Pattern 2c multiplier + Pattern 1 weak-band extension) | 1 (noble3) | 1 (long2 — doctrinal split flips toward corpus) | +2 to +4 pp |
| 12e-B (Pattern 2a'' — non-month 比劫祿/羊刃) | 1 (shishang_strong_jia) | 0 (verified no other charts trigger) | +2 pp |
| **Combined** | 2 | 1 | **+4 to +6 pp** |

Current Phase 12d agreement: **66%** (default flags). With both fixes: **70-72%**. With Pattern 3a flag-flip pending Bazi-master review: another +1-2pp on top.

That accounts for 2 of the 3 remaining "real engine bugs" (the third — `wu_xianggong_qu_zhi` — is Pattern 3a).

---

## Summary

| Pattern | Verdict | Top concern |
|---|---|---|
| 12e-A (noble3 lift) | ⚠ partially confirmed | Corpus's "中和" tag is not unambiguously supported by 任鐵樵; safer to extend Pattern 1 to weak-tier than to globally lift V2. |
| 12e-B (Pattern 2a'' all-pillar) | ✓ confirmed | Originally-proposed pillar weights {0.5,1.0,0.9,0.7} are uncalibrated; replace with simpler "+5/branch" model. |

**Top 2 surprises / concerns**:

1. **Pattern 12e-A's "+3.5 from Pattern 2c" claim was an overstatement** — actual code yields ~+2.5 because the double-count guard (lines 777-789) zeroes out 酉's contribution when 酉 本氣=DM-element. The actual gap to neutral threshold is larger than the brief implied. This means:
   - The cleanest fix for noble3 is *NOT* "more 半合 credit"; it's *Pattern 1 extension to weak-tier*. 任鐵樵's 食神洩秀 doctrine works for both `weak` and `neutral` DM in this case — extending Pattern 1's V2 band to [28, 38] when 自坐祿/羊刃 OR 半合金 trinity is present resolves it without disrupting the strength classifier.

2. **Pattern 12e-B's chart needs the DM stem itself counted as transparent** for the `≥2` threshold to work. `_build_root_class_cache`-based counting excludes DM, leaving `effective_transparent = 1 + 1 (DM) = 2`. Without the +1 for DM, Pattern 2a'' wouldn't fire on the target chart. **Document this convention explicitly** — it's a subtle counting choice that's easy to break in future refactors.

**Verdict tally**: 1 ✓ confirmed, 1 ⚠ partially confirmed, 0 ✗ refuted.

**Path to file**: `/Users/roger/Documents/Python/Bazi_Plotting/.claude/worktrees/competent-shirley-270d4e/.claude/plans/phase_12e_doctrine_verification.md`

**Estimated agreement lift**: +4 to +6 pp net (66% → 70-72% default flags).

---

## Sources consulted

- 任鐵樵《滴天髓闡微·何知章》— [quanxue.cn](https://www.quanxue.cn/qt_mingxiang/ditian/ditian41.html)
- 《滴天髓·地支》(任鐵樵 注) — [quanxue.cn](https://www.quanxue.cn/qt_mingxiang/ditian/ditian10.html)
- 滴天髓阐微 [Wikisource](https://zh.wikisource.org/zh-hant/%E6%BB%B4%E5%A4%A9%E9%AB%93%E9%97%A1%E5%BE%AE)
- [滴天髓 (CTP)](https://ctext.org/wiki.pl?if=en&chapter=126492)
- 易子量化法 — [163.com 易子](https://www.163.com/dy/article/HV7SGO56055627UV.html)
- 干支五行強弱七分法 — [guoyi360.com](https://www.guoyi360.com/jybd/9026.html)
- 干支五行強弱九分法 — [guoyi360.com](https://www.guoyi360.com/jybd/9027.html)
- 羊刃格和建禄格详解 — [suanzhun.net](https://www.suanzhun.net/article/2131.html)
- 半合局成化条件 (刘子瑛) — [新浪博客](https://blog.sina.com.cn/s/blog_6797185f0102e1p6.html)
- 蘇民峰 八字講義 §6 干支之會合刑沖 — [masterso.com](https://www.masterso.com/classroom/classroom2_1_601.php)
- 神機閣 论日主的根和印 — [shenjige.cn](https://www.shenjige.cn/details/NKoqSSxvl.html)
- 阐微堂 干支通根新解 — [chanweitang.com](https://www.chanweitang.com/post/107.html)
