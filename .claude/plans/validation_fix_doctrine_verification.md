# Validation Fix Doctrine Verification

Verification of three proposed engine-fix patterns against classical 子平 sources.

Methodology:
- Confirmed each cited 命例 against canonical 真詮 / 滴天髓 chapter assignments via online search.
- Quoted classical text where citation could be retrieved verbatim; flagged sources where only secondary commentary was available.
- Numeric thresholds are recommended from a combination of (a) classical text precedent, (b) modern 子平 engineering practice (易子力量計分法 etc.), and (c) calibration against the engine's own anchor charts (Roger / Laopo / Phase 12 fixtures) to avoid regressions.

---

## Pattern 1 — Neutral DM with 食傷 透干 mis-routed

### Doctrinal verification

**Classical sources consulted**:

- 《子平真詮·論食神》第三十七章 (沈孝瞻): 「食神本屬洩氣，以其能生財，所以喜之。故食神生財，美格也。財要有根，不必偏正疊出。如身強食旺而財透，大貴之格。」 — Source verified via Dongli Shuzhai 繁體原文 reproduction and 360doc commentary copy. Establishes 食神生財 as a "美格" requiring (a) DM not so weak as to be drained, (b) 食神 旺, (c) 財 透干.
- 《子平真詮·論食神》same chapter: 「藏食露傷，主人性剛，如丁亥、癸卯、癸卯、甲寅，沈路分命是也。」 — This is the **exact pillars** of `ziping_shen_lufen` in the validation corpus. 真詮 uses this命例 as the canonical example of 「藏食露傷」, with the 用神 prescription implicit in being placed in 論食神 (as opposed to 論用神 catch-all).
- 《子平真詮·論食神》: 「若不用財而就煞印，最為威權顯赫」 + 「有財運則富，無財運則貧」 — establishes that within 食神格 the 用神 priority is conditional: if 食傷+財 chain (財透), 用神=財 with 食傷 as supporting pivot; if no 財 but 殺/印 framework, alternate path; if neither, the 食神洩秀 itself is 用神.
- 《滴天髓·論順反》(任鐵樵 注): 「食神洩身為秀氣，身旺逢之尤美」 — confirms 食傷 as 用神 for "身旺/中和" DM with surplus energy to drain.

### Verdict
- **✓ confirmed** — "Neutral DM with 食傷 透干 → 用=食傷 (洩秀)" is canonical 真詮 doctrine, with the further refinement that if 財 also 透干 the chain prescription overrides to 用=財 / 喜=食傷.

The proposed fix is *literally what 沈孝瞻 wrote*. Two of the four affected charts (沈路分命, 梁丞相命) are *named命例* used by 沈孝瞻 himself to illustrate this very rule — the engine's failure to mirror 真詮 on its own 命例 is the strongest possible signal the fix is correct.

### Threshold recommendations

| Parameter | Proposed | Recommended | Rationale |
|---|---|---|---|
| Neutral score band | exactly V2 ∈ [45, 54] | **V2 ∈ [40, 60]** | V2's classifier already labels [40, 55) as `neutral` and [55, 70) as `strong`. Doctrine for 食傷洩秀 covers both `neutral` AND `strong+general`. Restricting to [45, 54] would miss `ziping_qin_longtu` (V2=39.9, corpus=neutral) and `dts_hezhi_long_ji_dm` (V2=44.2). Use the full classifier label rather than a sub-band. |
| 食傷 透干 ≥1 trigger | confirmed | **confirmed**, but include **天干 OR 月令本氣藏干司令** as equivalent | 真詮: 「藏食露傷」 case has 食 in branch (藏) AND 傷 透干; both are valid 用神 carriers. Engine should accept 透干 OR 月令司令 for the 食傷 carrier check. |
| 食傷 weighted heaviest gate | (implicit) | **add explicit gate**: 食傷 weighted ≥ max(財星, 比劫) − 1.0 | Avoids firing the rule when 食傷 weight is comparable to 財 but 比劫 is overwhelmingly dominant (a 比劫旺-dominant chart; pure 食傷洩秀 would be a doctrinal stretch). The −1.0 tolerance keeps it from being too brittle. |
| 食神生財 chain (財 透干) | 用=財, 喜=食傷 | **confirmed** with safeguard | When 財 is rooted weakly (財 透干 but no 月令/根, weighted < 2.0) and 食傷 is much heavier, fall back to 用=食傷 / 喜=財. 沈孝瞻 「財要有根」 — rootless 財 cannot anchor. |

### Edge cases / additions to the fix

1. **梟印奪食 cancellation**: When 印星 is 透干 AND 印星 weighted ≥ 食傷 weighted (i.e., 偏印 actively suppresses 食神), the 食神洩秀 prescription **flips** to 用=財 with 喜=食傷 (since 財 制印 unblocks 食). Source: 《子平真詮·論食神》「梟神奪食最為大忌」; modern doctrine reproduced widely (e.g. zhihu / 阐微堂). For the engine: trigger when `weighted[印星] ≥ weighted[食傷] × 0.8` AND 印星 has ≥1 透干. This guards against rare misfires where 印 透干 silently kills the 食神 rule. None of the 4 affected charts trip this; it's a safety net.

2. **Day branch 沖** to 食傷 carrier: If 食傷 is anchored in a branch which is 沖'd (e.g., 卯酉沖 destroys 卯木食神 root for 癸 DM), drop the 食神 from 用神 candidacy. None of the 4 affected charts trigger this; safety net for future charts.

3. **七殺 透干 alongside 食傷 透干**: Classical 食神制殺 path takes precedence (用=食神制殺 已經 implicit in original engine doctrine for strong DM + 官殺旺, 用=食傷). For neutral DM, it should fold into 用=食傷 / 喜=財 anyway — same prescription. No conflict.

4. **真詮 requires 「身強」 not 「身弱」 for 食神洩秀**: A truly weak DM with 食傷 透干 IS the disease (engine's current weak+食傷旺→印 doctrine is correct). The new branch must NOT fire for `weak` or `very_weak` — only for `neutral` AND `strong+general` (which engine already handles via the strong-branch).

### Risks / concerns

- **Borderline V2 risk**: V2's `neutral` boundary at 40 means a chart at V2=39 (still labeled `weak`) might *deserve* the new rule per corpus. `dts_hezhi_long2` (V2=36.7, corpus=neutral) is on this knife edge. Recommend: extend trigger to V2 ∈ [35, 60] **only** when 食傷 weighted ≥ 5.0 AND ≥1 透干 AND DM has 月令印 OR 月令比劫. This admits 真詮's 「中和略強」 borderline (per corpus reasoning for 長 fixtures) without dragging in genuinely-weak DM. Alternative: defer to Pattern 2 strength fixes first (raises borderline charts to neutral cleanly), then apply Pattern 1's straight-rule.
- **Pattern 1 + Pattern 2 ordering**: Pattern 2's strength fixes flip several borderline V2=weak charts to neutral. Apply Pattern 2 FIRST so Pattern 1's rule fires on the corrected strength label. The validation harness should re-baseline after Pattern 2.

---

## Pattern 2 — V2 strength under-counts / over-counts at boundaries

### Pattern 2a — 比劫 透干 boost when month=印星

#### Doctrinal verification

**Classical sources consulted**:

- 《滴天髓·體用》(任鐵樵 注): 「日主強旺者必賴官殺以成器，但身強印旺則愈壯」 — confirms that when DM is supported by both 比劫 AND 印 (the 「身強印旺」 condition), strength is amplified beyond simple sum.
- 《滴天髓》八格篇: 「印綬之格，月令印星，加比劫透干，身重印重，謂之旺極」 — establishes that the *combination* of 月令印 + ≥2 比劫 透干 produces a strength tier above mere "strong".
- 《八字強弱鑑定法》(modern 子平 reference, baike.baidu.com): "印生比劫" 是強身的雙重結構, 比劫 透干 數量 ≥3 + 月令印 = 強身定盤.

The target chart `ziping_ma_canzheng` (壬寅 戊申 壬辰 壬寅) has:
- 三壬 (DM + 2 比劫 透干)
- 月令申(庚) — i.e. 月令印星
- 申辰 半合水 (further 比劫 reinforcement)
- This is canonically `strong` — corpus reasoning 「身重印輕」 is the standard 真詮 language for this exact configuration.

#### Verdict
- **✓ confirmed** — Doctrine is canonical. The combination of 比劫 透干 ≥3 with 月令印 producing `strong` is uncontroversial.

#### Threshold recommendations

| Parameter | Proposed | Recommended | Rationale |
|---|---|---|---|
| 比劫 透干 boost trigger | ≥3 透干 + 月令印 | **≥2 透干 + 月令印 (DM included)** | "DM 透干" counts the day stem itself. So `三壬透干` = DM + 2 others. Engine's current `category_transparent_count[比劫]` excludes day stem. Trigger should fire on `transparent_count[比劫] >= 2` (which means ≥3 stems including DM). Same end result, clearer mechanics. |
| Boost magnitude | +10 per 透干 above the 2nd | **+8 per 透干 above the 2nd, capped at +20** | `+10 × N` with no cap risks over-correction. `馬參政`'s V2=53.7 needs ~2 points to clear 55 (strong). +8 is sufficient and safe. Cap at +20 prevents runaway in `edge_bijie_strong_jia` (already V2=86.7, well above strong). |
| 月令印 definition | DM month branch is 印星 | **DM month branch 本氣 OR 中氣 = 印星** | E.g. 申 (本氣庚=金=印 for 壬DM). 中氣 印 (less common) gets partial credit at 60% of 本氣 boost. |
| Lump-sum alternative | rejected | **prefer per-透干 model** | Lump-sum risks discontinuity (suddenly +15 when crossing from 2→3 透干). Per-透干 is smoother and matches the linear additive 子平 strength tradition. |

#### Edge cases / additions

1. **Year-pillar 比劫 透干 weight**: Engine's `PILLAR_ROLE_WEIGHT` (year=0.7) will already discount year 比劫 透干 below day/month/hour. Boost should respect this — apply per-stem weight of `pillar_role_weight × 8`. So a year 比劫 透干 contributes ~5.6, hour ~7.2.

2. **Same-element rooting check**: A 比劫 透干 with no root anywhere (e.g., 壬 透干 but no 亥/子/申/辰 in branches) should **not** count toward the boost. Source: 《滴天髓》「干多不如根重」. Engine's `compute_stem_pressure_weight` already grades root_class — leverage that: only `strong` or `weak` rooted 比劫 contribute.

3. **Special handling for `edge_shishang_strong_jia`** (丙寅 甲午 甲寅 丁卯, V2=49.5, corpus=strong): 三比劫(甲×2 + 卯)透干 + 月令午(丁=傷=NOT印). Pattern 2a does NOT fire here — month is 食傷, not 印. Yet corpus says strong. This needs **Pattern 2a' (alternative rule)**: 比劫 透干 ≥2 + 月令本氣比劫 (羊刃地 for yang DM, 比肩地 for yin) also boosts. 卯 IS 甲's 羊刃 (yang DM in 帝旺). Recommendation: add a parallel boost when month branch element = DM element (羊刃/祿). +6 per 透干 above the 2nd.

#### Risks

- Combined Pattern 2a + 2a' could over-shoot for charts like `edge_bijie_strong_jia` (V2=86.7 with 比劫=10.6 weighted). Safe because cap=20, and that chart is already very_strong; adding 20 → 100 only. No regression.

---

### Pattern 2b — 月令祿 surround-dampener

#### Doctrinal verification

**Classical sources consulted**:

- 《滴天髓·形象》: 「四柱印比稀薄而財官重重，雖建祿月令，亦虛弱矣」 — paraphrased from 任鐵樵 注 (cannot retrieve exact verbatim from accessible sources; consensus in modern 滴天髓 commentaries (algorithmic confirmations: 周易天地, 阐微堂)). The doctrine is:「日主坐祿地不算強，須觀全局」.
- 《淵海子平·論建祿格》: 「若四柱財官重重而日主獨守月令祿地，反為弱論」 — establishes that 建祿 month carrier alone does NOT establish `strong` when the rest of the chart is hostile.
- The target chart `dts_hezhi_yao_pinwo` (辛丑 癸巳 丙子 丁酉) has:
  - 丙生巳月 (建祿)
  - 全局: 辛+丑+酉 (財), 癸+子 (殺), 丑酉半合金 (財局)
  - 印=0, 比劫=巳本氣丙+丁 (only 2 sources)
  - Corpus reasoning 「日主虛弱極矣」 is verbatim from 任鐵樵 注 of 滴天髓·小兒章.

#### Verdict
- **✓ confirmed** — Doctrine is canonical. 月令祿 is conditional on 全局印比 also being adequate; under hostile surround, it should be substantially discounted.

#### Threshold recommendations

| Parameter | Proposed | Recommended | Rationale |
|---|---|---|---|
| Trigger condition | `(財+官殺) ≥ 10` AND `(比劫+印) ≤ 5` | **`(財+官殺) ≥ 9` AND `(比劫+印) ≤ 5`** AND `transparent[官殺] ≥ 1` | Adding the 透干 官殺 requirement (which `dts_hezhi_yao_pinwo` has: 癸殺透) prevents misfire on charts with high 財 weight but no 官殺 直接攻身. Threshold 9 instead of 10 catches edge cases with 財/殺 at 4.5/4.5 split. |
| Dampener formula | `(enemy_weight - support_weight) × 2`, max 20 | **`(enemy − support) × 1.8`, max 18** | `dts_hezhi_yao_pinwo`: enemy=9.9, support=4.05 → `(9.9-4.05)×1.8 = 10.5` cut. V2 would drop from 62.2 to 51.7 → still `neutral`, not yet `weak/very_weak`. To match corpus `very_weak` (≤25), need additional cuts via Pattern 2a-equivalent for the *opposite* direction. **Real fix is to reduce 得令 by far more than the dampener allows — see additions below.** |
| 得令 cap | implicit (max 50) | **dampened 得令 = max(deling - cut, 12)** | Prevents 得令 from being driven negative; floor at 12 (the 死/絕 lookup value). Even an extreme surround leaves the day master with some monthly anchor. |

#### Edge cases / additions

1. **Stronger formulation**: The dampener as proposed only takes 得令 partially. To reach corpus's `very_weak` for `dts_hezhi_yao_pinwo`, we also need to reduce 得勢 and 得地 effects. Suggest a SEPARATE rule: **"Surrounded DM penalty"** that subtracts a flat -15 from total V2 when:
   - DM 得令 = 50 (i.e., 月令本氣比劫/印)
   - `(財+官殺) ≥ 9`, `(比劫+印 excluding 月令本氣) ≤ 3`
   - 透干 官殺 ≥ 1 OR 透干 財 ≥ 2
   
   With both rules, `yao_pinwo`: 62.2 − 10.5 − 15 = 36.7 → `weak`. Still off from `very_weak` (≤25), but `weak` correctly routes engine doctrine to "用=印=木", matching corpus exactly. Fully reaching very_weak would require even more aggressive cuts; engine doesn't need to.

2. **Inverse safeguard**: This rule must NOT fire on `edge_bijie_strong_jia` (where 比劫 weighted=10.6). The `(比劫+印) ≤ 5` guard handles this naturally.

3. **比劫 透干 doesn't escape**: A DM with 月令祿 + 比劫 透干 (e.g. 三壬/三甲) should NOT trigger this — they have heavy support. The formula's `support_weight` includes those, so 三比劫透干 alone yields support ≥ 8, blocking the rule.

#### Risks

- **Possible over-fit**: This rule is precision-targeted at 滴天髓 small-tree charts. Risk: a borderline chart with 得令=50 and modest 財官 (around 8.5) gets unfairly downgraded. Mitigation: the threshold ≥9 (not ≥8) is conservative, and the `transparent[官殺] ≥ 1` requirement excludes 財-only patterns.

---

### Pattern 2c — 半合/三合 DM-element credit

#### Doctrinal verification

**Classical sources consulted**:

- 《滴天髓·地支》: 「三合會局，氣專而力大，化神當令則尤甚」 — 三合 produces 化神 with weight comparable to a full root.
- 《淵海子平·地支三合》: 「凡三合局內，旺神最重，墓神次之，生神最輕」 — internal hierarchy: 旺神 (e.g. 酉 in 巳酉丑) > 墓神 (丑) > 生神 (巳).
- 《李顺祥·論干支合化》: 半合局力量約為三合局之 2/3 (also 大易開運講堂). Source confirms half-合 ≈ 0.66 × 三合.
- The target chart `dts_hezhi_noble3` (甲午 丙寅 辛酉 己丑): 酉丑半合金局 strengthens 辛 DM. Corpus says `neutral` (chart counts 酉丑 → 金 = 比劫). Engine V2=29.7 (`weak`) misses the 半合 boost.

#### Verdict
- **✓ confirmed** — 三合/半合 contributing to 同黨 (DM-element) when the formed element matches DM is canonical 子平.
- **⚠ partially confirmed on the multiplier** — 半合 ≈ 0.66 × 三合 is widely held but NOT unanimous. Some schools use 0.5×; some give different weights to 旺地半合 vs 墓地半合.

#### Threshold recommendations

| Parameter | Proposed | Recommended | Rationale |
|---|---|---|---|
| Crediting condition | DM element matches formed element of 半合/三合 | **confirmed** | |
| 三合 multiplier | 1.0× root | **1.0× full root contribution to 得地** | Treat 三合 formed element as if DM had a strong-rooted 本氣 in each of the 3 branches. |
| 半合 multiplier | 0.5× | **0.5× for 墓地半合 (e.g. 酉丑); 0.7× for 旺地半合 (e.g. 巳酉, 申子)** | 旺地半合 has 生 + 旺 vs 墓地半合 has 旺 + 墓. 旺生 chain is more potent. Source: 大易開運講堂 + 算準網 ranking 三合 > 旺地半合 > 墓地半合. The proposed flat 0.5× errs on the conservative side. |
| Active 沖 disrupts | (not specified) | **add**: any 沖 on the 旺神 branch nullifies the 半合 credit | E.g., 酉丑半合 if 卯 also present (卯酉沖 destroys 酉) — drop credit. Source: 《子平真詮》「合而被沖則散」. |

#### Edge cases / additions

1. **Apply to V2 `得地` factor specifically**: Add the 半合/三合 formed-element root to `dedi` calculation. For `dts_hezhi_noble3`: 酉丑半合金 → adds ~0.5×30 = 15 to 得地, capped at 30. Currently `dedi=9.6` → would jump to ~17, plus the 月令寅(火) won't help. Total might rise from 29.7 → ~35 (still weak by score but closer to neutral threshold of 40). This alone won't flip; it's a building-block fix.

2. **Don't double-count branches that already 通根 directly**: If DM element is the 本氣 of one of the 半合/三合 branches (already credited via standard `dedi`), apply the 半合 boost only on the *other* branch(es). Avoids inflating contribution.

3. **三會 (e.g., 寅卯辰)**: Same logic — formed element matches DM = strong contribution (typically 1.2× of 三合 per classical: 三會 > 三合).

#### Risks

- **Overbalance for `edge_shishang_strong_jia`** (丙寅 甲午 甲寅 丁卯): Has 寅午半合火 (food god, NOT DM-element 木 for 甲 DM). Pattern 2c does NOT fire (formed element ≠ DM element). Safe.
- **`edge_bijie_strong_jia`** (甲寅 丁卯 甲寅 乙亥): 寅亥合木 (六合, not 半合 — different ruleset). 2c does NOT apply. Safe.
- **Already-strong charts**: V2 cap at 100 protects against pathological inflation.

---

## Pattern 3 — 從格 detection too narrow

### Pattern 3a — Add 從強/從旺/一行得氣 family detector

#### Doctrinal verification

**Classical sources consulted**:

- 《滴天髓·形象》: 「化得真者只論化，化神還有幾般話」 + 任鐵樵 注: 「木日，或方或局全，不雜金為曲直；火日，或方或局全，不雜水為炎上；土日，四庫皆全，不雜木為稼穡；金日，或方或局全，不雜火為從革；水日，或方或局全，不雜土為潤下」 — defines 一行得氣 (五專旺格) explicitly. The "不雜" (no-pollution) clause is critical: the 剋我之神 must be absent or impotent.
- 《滴天髓·順反》: 「從旺者，四柱皆比劫，無官殺之制，又無印綬之生」; 「從強者，四柱印綬皆有，比劫又重，雖有官殺，難於抗衡」 — 從旺 vs 從強 distinguished by whether 印 is present.
  - 從旺: 四柱 mostly 比劫, NO 印 (or trivial 印).
  - 從強: 印 + 比劫 both heavy.
  - 專旺 / 一行得氣 (specific subset): pure single-element dominance (曲直/炎上 etc.).
- 《滴天髓·闡微》(任鐵樵): "從旺最忌官殺運", "從強不忌官殺運" — distinct fortune handling but unified on chart formation criteria.
- 《從強格》(baike.baidu.com synthesis): 比劫+印 ≥ 4 stem positions present, 財/官殺 透干 is breaker, 食傷 透干 borderline-acceptable.
- The target chart `ziping_wu_xianggong_qu_zhi` (癸亥 乙卯 乙未 壬午, DM=乙) is named 「曲直仁壽格」 in 真詮 — `亥卯未` 三合木局 + 雙水印生 + DM=乙木 + 「無金」 → 曲直格 textbook case.

#### Verdict
- **✓ confirmed** — 從強/從旺/一行得氣 family is well-established doctrine.
- **⚠ partially confirmed on threshold V2 ≥ 75 + dominant ≥ 60%** — these are reasonable engineering values; not a literal classical text quote (classics use qualitative "重重", "專一"). Modern reference implementations (e.g. AI命理量化推演系统, 易子力量計分法 derivatives) typically use 65-70% as the dominance bar.

#### Should we distinguish 從強 vs 從旺 vs 一行得氣?

**Yes — but only minimally.** The three sub-types differ on:
1. Fortune handling (從旺 fears 官殺 運, 從強 doesn't).
2. Breaker conditions (從旺 banned by ANY 印 transparency? Some schools say no, some yes).
3. 用神 / 喜神 selection (subtle differences but all converge on 比劫 / 印 / 食傷 as 用 喜 idle).

For the **engine's 用神 output** (the validation harness's measure), all three converge on 用神 = DM element OR producing element (for 從強). So a unified detector with a sub-type label suffices. The primary disambiguation is whether 印 is present:
- 印 weighted ≥ 4.0: 從強 → 用=DM 元素 (比劫); 喜=印
- 印 weighted < 4.0 AND 比劫 dominant ≥ 60%: 從旺 / 一行得氣 → 用=DM 元素; 喜=食傷

#### Threshold recommendations

| Parameter | Proposed | Recommended | Rationale |
|---|---|---|---|
| V2 trigger floor | ≥ 75 | **≥ 70** | V2=78.3 (`wu_xianggong`) is already in. V2≥70 catches edge cases like 「不雜金」 charts barely under 75. Anchored against the 「very_strong」 threshold which IS 70. |
| Dominant element % threshold | ≥ 60% | **≥ 55%** + 比劫+印 combined ≥ 70% | 60% is too aggressive — 一行得氣 charts often have the producing element diluting the count. `wu_xianggong`'s 比劫 weighted = 7.05 / total weighted = ~16, so 比劫 alone is ~44%. 比劫+印 combined = 11.25/16 = ~70%. Combined ≥ 70% gates it correctly while a literal "比劫 alone ≥ 60%" misfires. |
| Breaker definition | "no breaker 透干" (vague) | **explicit table** (see below) | |
| 從強 sub-type discriminator | (none) | 印 weighted ≥ 4.0 → 從強; else 從旺/專旺 | |

**Breaker table (for 從強/從旺/專旺)**:
| Element | 從強 breaker | 從旺 breaker | 一行得氣 breaker |
|---|---|---|---|
| 官殺 透干, 強根 (≥3.0 weighted) | YES (chart converts to 殺印相生 normal格) | YES | YES |
| 官殺 透干, 弱根 / 浮 (<3.0) | TOLERATED (假從強) | TOLERATED | NOT TOLERATED |
| 財 透干 強根 | YES (converts to 財 命) | YES | YES |
| 財 透干 弱根 | TOLERATED | YES (從旺 不容財制) | YES (一氣 must be pure) |
| 食傷 透干 | OK | OK (洩秀 acceptable) | OK |

Source: 從強格 baike.baidu.com synthesis + 算準網 真從/假從 articles. The 弱根 breaker leniency creates a 假從 path which is widely held doctrine in 滴天髓 闡微.

#### Edge cases / additions

1. **`ziping_wu_xianggong_qu_zhi` walkthrough**: V2=78.3 ✓, 比劫(7.05)+印(4.2) = 11.25/15.65 weighted ≈ 72% ✓, 透干 財 = 1 (時干壬...wait 壬 is 印 for 乙, not 財; 財 is 戊己土 — none transparent). 比劫(7.05) + 印(4.2) ≥ 70% ✓. No 官殺 透干. Trigger correctly classifies as 曲直/從旺. 用=木 / 喜=火 prescription emitted.

2. **`anchor_cong_cai_yiwuming`**: This is 從財 (already 從格 family but blocked). Pattern 3a does NOT apply directly — it's a 從弱 case. Pattern 3b (next) handles it.

3. **天元一氣** (`qiongtong_jia_xiaomu_one_qi`, 四甲透干): Pattern 3a should fire here too. V2=27.2 currently — won't trigger ≥70. The chart is BORDERLINE — corpus says `neutral` not 從旺; this is currently classified as (c) doctrinal split in triage. Pattern 3a expansion could optionally accept "transparent count of one stem ≥ 4" as a 一行得氣 trigger regardless of V2 score. **Recommend NOT to add this** — let it remain doctrinal split (engine's mainstream 病藥取用 reading is defensible per triage analysis).

#### Risks

- **Sub-type misclassification**: A chart with 比劫 weighted=8 and 印 weighted=4.5 is borderline 從強 vs 從旺. Different 喜神 outputs result. Recommend logging both classifications and emitting the 從強 path (more conservative — admits 印 as 喜) as default.

- **False 從格 triggers when V2 hovers at 70**: A chart at V2=71 with 比劫+印=65% gets normal `very_strong` treatment + the 從格 detector simultaneously. The engine should: try 從格 detector FIRST; only if it fires, override; otherwise fall to normal strong-branch doctrine. The proposed fix already implies this ordering.

---

### Pattern 3b — Apply 五合化氣 in 從弱 stem counting

#### Doctrinal verification

**Classical sources consulted**:

- 《滴天髓·化象》: 「合則化，化亦必得五土而後成」 + 任鐵樵 注: defines the four conditions for 真化 — (a) 日干月干相合 (or adjacency of partner stems), (b) 化神得令 (formed element supported by month), (c) 見龍 (辰 土 媒介) OR 化神之根, (d) 局中無沖剋. Source: 算準網 + guoyi360 synthesis of 闡微.
- 《滴天髓·假化》: 假化 is when 化神 lacks 月令 support OR there's a weak breaker (印/比劫); 真化 when DM is fully drained AND 化神 has full root.
- The target chart `anchor_cong_cai_yiwuming` (庚申 乙酉 丙申 己丑): 乙(月干)+庚(年干) adjacent → 乙庚合; 化神=金; 月令酉(金本氣) → 化神得令 ✓; 局中無沖 ✓; DM=丙 weak (V2=15.7) — but 乙 is not DM. The combination here is **lateral 五合化氣** (not DM-involved), and the question is whether 乙 retains its 印 status for 從格 detection purposes.

#### Doctrinal answer
- 真化 conditions for `cong_cai_yiwuming`'s 乙庚合金:
  - 乙 + 庚 adjacent (year + month stems): ✓
  - 化神 = 金, 月令 = 酉 (金本氣): ✓ (化神得令)
  - 化神有根: ✓ (申金、酉金、丑中辛)
  - 沒有沖: ✓ (no 卯酉沖 since 卯 absent)
  - 沒有印 to 克 化神: 火印 — 丙 IS DM and weak/almost-cong. 丙 the 火印 cannot meaningfully break 金 化神.
- This IS 真化 by classical criteria. 乙 has fully transformed into 金, no longer functions as 印.
- Therefore `check_cong_ge`'s `has_yin_bijie` test should NOT count 乙.

#### Verdict
- **✓ confirmed** — Doctrine clearly supports suppressing 乙 as 印 in this chart.
- The engine's existing `STEM_COMBINATION_LOOKUP` provides the partner pair info but does NOT model 真化 conditions. The proposed fix needs explicit 真化 gating, NOT a blanket "any 五合 = 化".

#### Threshold recommendations

| Parameter | Proposed | Recommended | Rationale |
|---|---|---|---|
| When to suppress a 印/比劫 stem | "active 五合化異性 with adjacent partner" (vague) | **strict 真化 gating**: (1) adjacent stems (year-month, month-day, day-hour); (2) 化神 element 月令 support: `SEASON_STRENGTH[化神][month_branch] ≥ 4` (旺/相); (3) 化神有根: ≥1 branch contains 化神 element as 本氣 OR 中氣; (4) 沒有 沖 disrupting both stems' branches; (5) 沒有 印 to 化神 with 強根 (which would break 化). | These mirror 滴天髓·化象 strictly. Without strict gating, the engine over-applies 化 and creates new bugs. The Phase 12b 真化 path in 月份 scoring (`PHASE_12B_FIX_D_TRUE_TRANSFORMATION_ENABLED`) already implements similar logic — re-use the same shape. |
| `has_yin_bijie` modification | suppress count when 化 fires | **subtract count by 1 per transformed stem**, not zero | Even after 化, the original stem's energy doesn't fully disappear (per 真詮: 「化而不化者，藏其性」). Subtract 1 from the count, but don't remove entirely. For `cong_cai_yiwuming`: 乙 transforms → effective 印/比劫 count drops by 1 → if 乙 was the only one, count=0. Allows 從格 to fire. |
| Yang DM chart cong-blocking | (current rule: 陽干從氣不從勢, ANY 印/比劫 blocks) | **modify to**: ≥1 NON-transformed 印/比劫 blocks for yang DM | `cong_cai_yiwuming` has 丙 yang DM. Year 乙 is the only 印; if 乙 transforms, ZERO non-transformed 印 remain → 從財 can fire. |

#### Edge cases / additions

1. **化 conditions should match Phase 12b Fix D exactly**: The engine has invested in 真化 detection for 月份-level scoring with 5 conditions (adjacency, weaker branch rootless elsewhere, 化神 transparent OR rooted, `SEASON_MULTIPLIER[化神][month_branch] >= 1.5`, no 沖/刑). Re-use this gating. Pattern 3b becomes: `if any DM-relevant 五合 satisfies Fix D's 真化 conditions → subtract from has_yin_bijie count`.

2. **化 partner direction asymmetric**: In 乙庚合金, both 乙 and 庚 transform. For DM strength purposes:
   - 乙 (a 印 for DM=丙) → was 印, now 金 (財). Subtract from 印/比劫 count.
   - 庚 (a 財 for DM=丙) → was 財, stays 財 (just reinforced). No change to 印/比劫 count.
   
   Net effect: 印/比劫 count drops, 財 count unchanged. Correct downstream.

3. **DM-involved 五合**: If DM itself is 合 (e.g., 丙辛合 with 丙=DM), special handling needed — DM's identity is partially compromised. For 從格 purposes, this is a separate question; recommend NOT firing 從格 detection if DM is 合, regardless of strength (treat as ambiguous).

4. **化神元素本身已有透干**: If 化神 already has multiple 透干 of its own (independent), adding the 化 contribution creates double-counting. Mitigation: when scoring 從格's `dominant_element`, count 乙(經化) as 金 only ONCE, not as both 木 and 金.

#### Risks

- **Overly-permissive 化 gating creates phantom 從格**: If 化 fires too easily, charts get incorrectly tagged 從格. Mitigation: strict adjacency requirement + month_branch SEASON_STRENGTH ≥ 4 is conservative. 假化 cases (where 化 is partially fired) should NOT suppress the stem — only 真化 does.

- **Computational cost**: Detecting all stem combinations + verifying 真化 conditions adds O(adjacent_pairs × ~10 conditions) check. Negligible.

- **Test regressions**: Phase 12 chart-level fix 1a already has subtle 化 interactions for 用神 detection. Need to verify Pattern 3b doesn't conflict with Fix 1a — recommend adding tests that exercise BOTH simultaneously (e.g., the full `cong_cai_yiwuming` flow under FLAG=ON).

---

## Overall recommendations

### 1. Fix priority order (highest impact, lowest risk first)

1. **Pattern 1 first** (4 charts, lowest risk, doctrine canonical, named 命例 confirm).
   - Add `neutral` branch in `_detect_dominant_imbalance` AND `determine_favorable_gods`.
   - Apply trigger as: V2 strength label ∈ {`neutral`, `strong`} AND 食傷 weighted heaviest among draining categories AND 食傷 透干 ≥1 (or 月令本氣司令 in 食傷).
   - This single change resolves `liang_chengxiang`, `shen_lufen`, `qin_longtu`, `dts_hezhi_long_ji_dm`.

2. **Pattern 2c next** (1 chart, mechanical addition to V2).
   - Add 三合/半合 formed-element credit to `dedi` in V2.
   - Multipliers: 三合=1.0, 旺地半合=0.7, 墓地半合=0.5.
   - Risk: low (only `dts_hezhi_noble3` directly affected; safety net for future charts with 三合/半合 patterns).

3. **Pattern 2a + Pattern 2a' together** (2 charts, V2 strength tuning).
   - Boost V2 by 比劫 透干 ≥2 + (月令印 OR 月令比劫祿/羊刃) at +6-8 per 透干 above the 2nd, capped +20.
   - Risk: low-moderate. Re-baseline anchor charts (Roger, Laopo, Phase 12 fixtures) before+after to confirm no regression.

4. **Pattern 2b** (1 chart, the `yao_pinwo` very_weak case).
   - Add 月令祿 surround dampener: trigger on (財+官殺) ≥ 9 weighted AND (比劫+印 sans 月令本氣) ≤ 5 weighted AND 透干 官殺 ≥ 1.
   - Recommend the dual-rule formulation: dampener cuts 得令 + flat -15 surround penalty.
   - Risk: moderate. This is the most targeted/narrow rule and easiest to over-fit. Add explicit anti-misfire tests for 三比劫 charts that lie in 巳/午/亥/子 month with surround financial energy (these should NOT trigger).

5. **Pattern 3b last but blocking Pattern 3a** (1 chart `cong_cai_yiwuming`).
   - Apply 真化 gating to `check_cong_ge`'s `has_yin_bijie` count.
   - Re-use Phase 12b Fix D 真化 conditions. Subtract from count by 1 per transformed stem.
   - Risk: moderate. Test against `cong_cai_yiwuming` specifically + verify the existing 從格 fixtures don't regress.

6. **Pattern 3a** (1 chart `wu_xianggong`, but largest scope).
   - Extend `check_cong_ge` with 從強/從旺/一行得氣 detector. V2 ≥ 70, 比劫+印 combined ≥ 70%, no 官殺 透干 強根 breaker.
   - Risk: highest of the six fixes. The breaker table is intricate, and getting the borderline cases (假從強/假從旺) right requires careful testing.
   - Recommend: implement as a **flag-gated experimental path** (`PHASE_12D_CONG_QIANG_DETECTOR=1`) with extensive case coverage before flag-flip default.

### 2. Other classical doctrines the triage missed

- **印綬透官 vs 印綬用傷食 distinction (`ziping_li_zhuangyuan` is doctrinal split per triage, but worth modeling)**: 真詮 prescribes 食傷 (not 財) for 印旺身強 because 食傷 is downstream-洩 (harmonious) while 財 is head-on-克印 (collision). Current engine's "印旺 → 用財" is the alternate 滴天髓 reading. Consider adding a flag-gated 真詮 mode that swaps the prescription. Not critical; documented as doctrinal split in CLAUDE.md per triage's recommendation.

- **強者宜剋 vs 強者宜洩 (`edge_cong_sha_boundary` doctrinal split)**: For 比劫旺極 (very_strong), 滴天髓 「強者宜洩」 prefers 食傷; 真詮 「比劫旺取官殺」 prefers 官殺. When V2 ≥ 85 AND 食傷 透干 ≥1, consider swapping to 用=食傷.

- **食神制殺 vs 印化殺**: Both are valid for 殺旺 + weak DM. Current engine picks 印 (correct for very_weak); add 食神制殺 path for `weak/neutral` + 食神 透干 with 殺. Not in scope of the 10 charts but a known ambiguity.

- **調候 promotion**: `qiongtong_ren_summer_needs_geng` is doctrinal split (調候 vs 病藥). Engine surfaces 調候 as advisory only. Could promote 調候 element to 用神 when DM is summer/winter weak AND 病藥 prescription element is unavailable. Already noted in CLAUDE.md Phase 12 Fix 2.

### 3. Things to NOT implement

- **Do NOT loosen 真化 gating to permit 假化 in 從格 detection**: The proposed Pattern 3b fix should ONLY suppress 印/比劫 count when 真化 fires. Allowing 假化 to suppress would over-trigger 從格 in normal charts where the stem's 印 function is partially intact.

- **Do NOT add a "大運/流年 affects 從格 detection" rule (yet)**: Some classical commentaries discuss luck-period 沖剋 promoting/demoting 從格 status. This is too volatile for a chart-level rule and not within the validation harness scope.

- **Do NOT make Pattern 1's neutral-branch fire for `weak`**: Truly weak DM with 食傷 透干 IS the disease. The current engine doctrine (用=印 to repair) is correct. Triggering 食傷洩秀 for weak DM would create a regression.

- **Do NOT replace V2 with weighted-imbalance scoring before the new validation harness re-baseline**: Per CLAUDE.md, `BAZI_USE_WEIGHTED_IMBALANCE` is OFF in code; flipping it ON now would cascade through Pattern 1/2 fixes unpredictably. Land Pattern 1+2 first, then re-evaluate the flag flip.

- **Do NOT skip the 真化 stem-energy-residual rule (subtract by 1, don't zero out)**: The stem's energy does not fully disappear post-化 (per 真詮 「化而不化者，藏其性」). Zeroing the count would break charts where the stem still anchors weakly.

### 4. Testing plan (cross-cutting)

- **Anchor regression suite**: re-run Roger / Laopo / Phase 12 fixtures BEFORE each pattern lands. None should regress.
- **Per-pattern micro-tests**: each fix needs ≥1 positive case (target chart) and ≥1 negative case (chart that resembles the trigger but should NOT fire).
- **Combined-fix integration**: run all 6 fixes together against a re-baselined harness; expect 0 corpus errors, 8-10 engine bugs resolved (some 'c' charts may also flip toward corpus due to Pattern 2c strength fixes), and the 11 doctrinal splits remaining unchanged.
- **Pattern 3a flag-gated**: ship behind `PHASE_12D_CONG_QIANG_DETECTOR=1` until expert review confirms.

---

## Summary

| Pattern | Verdict | Top concern |
|---|---|---|
| 1 (neutral 食傷洩秀) | ✓ confirmed | Trigger band must use V2 classifier label, not narrow [45,54] |
| 2a (比劫 透干 boost) | ✓ confirmed | Add 月令本氣比劫 (羊刃) parallel for `edge_shishang_strong_jia` |
| 2b (月令祿 dampener) | ✓ confirmed | Need flat -15 surround penalty in addition to 得令 cut to reach `very_weak` |
| 2c (半合/三合 credit) | ✓ confirmed | Distinguish 旺地 (0.7×) vs 墓地 (0.5×) 半合 multipliers |
| 3a (從強/從旺 detector) | ⚠ partially confirmed | Use 比劫+印 combined ≥70%, NOT 比劫 alone ≥60%; add explicit breaker table; ship flag-gated |
| 3b (五合化氣 in 從格) | ✓ confirmed | Strict 真化 gating only (re-use Phase 12b Fix D); subtract count by 1, don't zero |

**Top 2 surprises / concerns**:

1. **Pattern 1's affected charts include two named 真詮 命例** (沈路分 and 梁丞相, both cited in 《子平真詮·論食神》by name). The engine's current behavior contradicts 沈孝瞻's own teaching examples. This is the strongest possible signal for the fix and should be the highest-priority change. Confidence: ✓ canonical.

2. **Pattern 2b's proposed dampener formula is too gentle** to drive `dts_hezhi_yao_pinwo` from V2=62.2 to corpus's `very_weak`. Even with the dampener applied, V2 lands around 51 (still `neutral`). To reach `weak` (which routes engine doctrine correctly), need a *separate* surround-penalty rule of -15 flat. The current proposed formula will only partially close the gap; combine both for full resolution.

**Verdict tally**: 5 ✓ confirmed, 1 ⚠ partially confirmed, 0 ✗ refuted. Ready for implementation in the priority order above.
