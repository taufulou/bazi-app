# Internal Research Memo: Handling Unknown Birth Hour (時辰不詳) in Our Bazi App

**Audience:** Product, Engine, Design · **Author:** Lead Bazi-Product Strategist · **Status:** Decision-ready
**Source:** Multi-agent research workflow (6 research angles + 8 adversarially-verified claims), 2026-06-09

---

## 1. TL;DR / Recommendation

- **Never block the user, never silently guess.** Add a first-class "我不知道出生時辰" path that produces an honest **三柱 (年/月/日) reading** — explicitly labeled — instead of defaulting to a guessed hour. A silent default to 子時/midnight or noon quietly commits the user to a wrong 時柱 and is the single worst thing we could ship (it is, doctrinally, "計算另一個人的八字").
- **Compute the full three hour-INDEPENDENT pillars and lock/tease the hour-dependent sections.** Roughly **70–80% of a full reading survives** (verified band); the ~20–30% that's lost is concentrated in 子女宮, 晚運/晚年, 命宮/身宮, 起運年齡 precision, and hour-branch 神煞 — so flag *those specific sections*, not the whole reading.
- **Offer an optional 時辰範圍 (2-hour segment / 上午-下午) picker** before falling back to full-unknown. The practical unit of Bazi uncertainty is the **2-hour 時辰, not the minute** — a rough window is often enough and dramatically improves the reading.
- **Build event-based 定盤 (time-rectification) as the premium "幫我找時辰" flow** — this is the genuine gold standard (matching documented life events against candidate 大運/流年), and it is a legitimate, ethical paid add-on. A **12-時辰 candidate comparison** view is the engine primitive that powers it.
- **Do NOT bake in folk physical heuristics** (髮旋/睡姿/face-the-hour/finger/sibling-order). Verdicts unanimously rate these **folk myth** — no classical canon, scientifically unsupported (a peer-reviewed hair-whorl study found no correlation), and they resolve only to a 4-hour parity *group*, never a single 時辰. At most they're an *optional* tie-breaker hint inside the rectification flow, never an automated default.
- **Our 配偶宮 = 日支 is a structural advantage.** Spouse-palace + 紅鸞/沖日支 romance logic keys off the **DAY branch (hour-independent)**, so our love/marriage core stays valid without the hour — a strong selling point we should surface in copy.

---

## 2. The Gold Standard — what a real Bazi master actually does

A serious master **does not refuse**, and **does not silently read a guessed hour as confirmed**. The mature protocol, ranked:

### (a) Legitimate professional practice — bake these in

1. **Event-based 定盤 / 校時 (time-rectification) — THE gold standard.** Cast all/both plausible 時辰 charts in parallel, then back-calculate the true hour by matching **documented, person-specific life events** (marriage year, a parent's death, a serious accident/illness, a sharp career turning point) against the 大運/流年 each candidate chart produces. Keep the 時辰 whose 應期 (event-timing) and 六親 outcomes fit reality. *Verified `confirmed`:* independent Chinese + English sources corroborate casting candidate charts and matching life events via 大運/流年 as the rigorous professional method. The qualifying event must be **non-universal** ("幾歲發生車禍骨折，幾歲結婚"). **Works on adults with event history; often fails for young children** ("小孩人生經歷太少").

2. **Blind-school (盲派) 定盤 is the most developed version of this** — built on 應期/event-triggering (an 象 fires when 大運/流年 combines with a natal character), not physical signs; uses tools like 串宮壓運 for 流年 timing. *Verified `partially_confirmed`:* the methodology is solidly corroborated as mainstream practice; **only the superlative "most developed" is unverifiable** (子平 and 六柱 schools also do event-rectification). Treat as "a leading, falsifiable protocol," not "the one true method." Caveat: popular sources frequently *conflate* 盲派 with the very physical heuristics it actually disavows.

3. **Narrow to a 時辰 RANGE / candidate set, not a single hour.** The realistic deliverable is a **shortlist of 1–2 candidate 時辰 with a stated best-fit**, cast as adjacent charts and weighed equally against life events. *Verified `partially_confirmed`:* the candidate-chart 定盤 workflow and the 真太陽時 vs 北京時間 adjustment (up to ~2 hr in far-western regions) are strongly confirmed. **⚠️ One sub-claim was REFUTED:** the specific "at a 時辰 seam, default to the LATER hour, prior hour leaves a residual influence (fallen-dynasty analogy)" rule has **no independent classical or modern support** — sources uniformly say cast BOTH adjacent charts and weigh them *equally*. The well-documented "子時 → next-day" convention is about **日柱 attribution at the 23:00 day-change (早子時/晚子時), a separate issue** from picking between two adjacent hour pillars. **Do not implement an auto "default to later hour" rule.**

4. **Read the 3 hour-independent pillars with explicit caveats.** When the hour is truly unrecoverable, read what survives — 日主 + broad 五行 balance, 格局 from 年月日, personality, wealth/power/resource element-logic, 大運 trend (less precise) — and **withhold** 子女, 晚年/晚運, 子女宮, fine career timing, and any 時柱-resident 格局. *Verified `confirmed`:* "A truly experienced Bazi master will never refuse you because you don't have the birth hour"; the survives/withheld split is corroborated almost verbatim. This three-pillar approach has **genuine classical lineage** — it's the original Tang 李虛中 系統; 徐子平 added the 時柱 in 《淵海子平》 to make the modern 四柱. *Verified `confirmed`:* historically legitimate but **doctrinally incomplete** — the hour pillar is load-bearing (governs 晚運/子女宮, and can make/break 格局 like 時上偏財格, 時上一位貴/時上七殺, confirmed verbatim in 淵海子平 via ctext.org). A purist minority (聚賢館) rejects 3-pillar reading entirely as "對子平八字的侮辱" — note it, but mainstream practice disagrees.

### (b) Folk myths to AVOID baking in

- **Physical/behavioral hour-indicators: 髮旋 (hair-whorl), 睡姿 (sleeping posture), 子午卯酉 face-reading, 指紋/螺紋, 兄弟排行口訣.** *Verified `confirmed` as `folk_myth` across multiple independent verdicts.* Key disqualifiers:
  - **No classical grounding** — searches of 子平真詮 / 三命通會 / 滴天髓 (ctext.org) surfaced *zero* physical-indicator mnemonics; these belong to 面相 physiognomy folklore, a separate non-命理 tradition. One English source attributes the sleeping-posture method specifically to a *Korean* BaZi lineage, underscoring its regional-folk (not canonical 子平) status.
  - **Scientifically unsupported** — a peer-reviewed study found **no statistically significant correlation** between hair-whorl location and birth time.
  - **Group-only resolution** — they map only to a 4-hour parity *group* (子午卯酉 / 寅申巳亥 / 辰戌丑未), **never a single 時辰**, and even proponents hedge ("偶爾的例外總是會有"; "general indication only … not a definitive answer").
  - **Verdict for us:** at most an *optional, clearly-labeled* narrowing hint *inside* the premium rectification flow ("這只是民俗參考，需用真實事件驗證"). Never an automated default, never presented as doctrine.

- **鐵板神數 考時定刻.** *Verified `confirmed`:* a **distinct, contested divination school — NOT core 子平 doctrine** (it's pure 數理推演; 子平八字 is merely one of several auxiliary skills a 鐵板 practitioner layers on). It refines past the 時辰 to 刻/15-min via reciting 六親 and asking the client to confirm/deny — and is **famous specifically for nailing 六親**, which critics (王亭之 published exposés; 了無居士《拆穿鐵算盤》) read as **the signature of cold reading**, not calculation. The 邵雍/邵康節 attribution lacks solid evidence (documented rise is 清乾隆/嘉慶). **Do not emulate.** (Nuance from the verdict: the cold-reading *critique* is well-evidenced; the "myth" label attaches to the 邵雍 attribution and supernatural-precision marketing, not to the documented existence of the technique.)

---

## 3. How competitors handle it

| App | "Unknown hour" option? | Default hour | Rectification feature? | Disclaimer quality |
|---|---|---|---|---|
| **astro.com / Astrodienst** (Western) | ✅ Explicit "unknown" | Noon (12:00), **labeled "hyp"** | Animate chart / power-user hypothetical hour | **Best-in-class** — structurally *suppresses* Ascendant + houses |
| **XuanSeal** (EN Bazi) | ✅ 3-state: Exact / 2-Hour Window / Unknown | None — drops 時柱 | — | Good — explicit partial 3-pillar; names hour pillar as 1 of 4 |
| **Ondo Destiny** (EN Bazi) | ✅ "Unknown time" box | None — **refuses to assume noon** | Describes event-based rectification | Good — full 3-pillar Y/M/D, honest copy |
| **天時子平** (CN pro) | ✅ "時辰未報/不詳起盤" advertised | (unverified — likely blanks 時柱) | — | Mainland 3-pillar convention |
| **測測 / 測測生日** (CN) | ✅ "時辰未報" charting | (unverified) | — | (low confidence — from store descriptions) |
| **科技紫微網 紫微定盤2.0** (TW) | n/a (this *is* the rectification product) | n/a | ✅ **Paid 定盤**, co-dev w/ 淡江大學; ~20/100 self-reported times need adjusting | Premium event-based rectification |
| **文墨天機 / 紫微排盤 apps** (TW/CN) | "時辰微調" cycle adjacent charts | — | ✅ Manual 定盤 (cycle 時辰) | Warns against using 預設時辰 for 紫微 |
| **bazi-calculator.app** (EN) | ✅ "Unknown" checkbox | (unverified post-select) | — | "For reference only" |
| **⚠️ QiAdvisor** (EN Bazi) | ✅ "Time unknown" checkbox | **Silently → 12:00 noon** | — | Discloses hour pillar = children/later-life, but the noon default is *applied silently* |
| **⚠️ Shen Shu** (EN Bazi) | Instructs user | **00:00 / 子時** (midnight) | — | Year/month/day flagged valid — **but 00:00 risks 早/晚子時 day-boundary ambiguity** |
| **⚠️ Co-Star / The Pattern / Sanctuary** (Western) | ❌ Force exact time | — | "Nudge ±1h if it feels off" (crude) | **Anti-pattern** — silently renders a possibly-wrong Rising/angle |
| **爱星盘/iXingpan** (Western-in-CN) | Pick noon, then ignore Ascendant/houses | Noon | — | Noon-default pattern |

**Doctrinally-bad defaults to call out and avoid:**
- **QiAdvisor's silent noon (午時)** and **Shen Shu's silent 00:00 (子時)** commit the user to opposite 時柱 with no visible labeling — and 00:00 specifically risks the **早子時/晚子時 day-boundary** flipping the *day* pillar.
- **Co-Star / The Pattern / Sanctuary's "force a time"** trades statistical honesty for frictionless onboarding — the user sees a possibly-wrong angle with false confidence.
- The **careful camp (astro.com, XuanSeal, Ondo)** all *avoid picking an hour* and instead suppress/drop the hour-dependent layer. **This is the camp we should join.**

---

## 4. Western astrology cross-reference (transferable patterns)

Western astrology has the most mature codified convention, and it maps cleanly:

- **The "noon chart" convention** = set time to 12:00 because it **bounds the Moon's positional error to ~6°** (Moon moves ~12–13°/day; noon is the midpoint of the 24h window). This is a *deterministic error-minimization* argument, not folklore. **Bazi analog:** if we ever must pick a single hour for an internal calc, noon (午時) is defensible — but **we should prefer suppressing the 時柱 over picking one.**
- **The hard line on what's lost:** no birth time → **no Ascendant/Rising, no MC/IC/DC angles, no house placements, no house-based timing** (profections, zodiacal releasing). **What survives:** Sun sign, all planetary signs, aspects, usually the Moon sign — with a **sign-boundary caveat** (Moon ambiguous on ~40% of birthdays). The direct parallel: our 時柱 (and 命宮/身宮) = the "angles/houses," our 年/月/日 = the stable planetary signs, and the **Moon-near-boundary caveat ≈ our 子時/day-boundary edge case.**
- **The "solar/sunrise/whole-sign" fallback** (put Sun on Ascendant) = a graceful, *clearly-labeled approximation* — like a magazine horoscope. **Bazi analog:** emphasize the 3 determinate pillars and treat hour-dependent analysis as a labeled approximation.
- **Rectification is the direct parallel to 定盤** — and *every* Western source flags it as **inexact** ("twelve astrologers, twelve answers"; inaccurate angles drop forecast precision "從9成降為7成"). **Transferable lesson:** offer rectification as a guided, clearly-caveated premium/expert flow, **never as a deterministic answer.**
- **5 transferable UX patterns:** (1) explicit "time unknown" toggle; (2) if defaulting, **visibly label the time hypothetical**; (3) **structurally suppress what you can't compute**; (4) **persistent standing disclaimer** ("always more accurate with an exact time"); (5) offer a narrowing/rectification path.

---

## 5. Technical impact on OUR engine

What we compute today, split by hour-dependence:

| Computation | Status w/o hour | Notes |
|---|---|---|
| **日主 (Day Master) identity** | ✅ VALID | Day stem is the immovable reference |
| **配偶宮 (spouse palace) = 日支** | ✅ VALID | **Our engine keys this on the DAY branch — hour-independent.** Big advantage. |
| **紅鸞 / 沖日支 romance day-branch logic** | ✅ VALID | Keys off DAY branch — survives intact |
| **月令格局 (month-command structure)** | ✅ VALID | 月令 is the basis of 取格局 + 旺衰; hour-independent |
| **年/月/日 十神, 藏干, 十二運, 納音, 旺相休囚死, 空亡** | ✅ VALID | Three known pillars fully computable |
| **生肖, 胎元** | ✅ VALID | **胎元 derived from MONTH pillar alone** (干+1, 支+3) — confirmed by 3 sources; survives |
| **大運 干支 SEQUENCE + direction** | ✅ VALID | Direction = year-stem yin/yang + gender; sequence from MONTH pillar — no hour needed |
| **正緣桃花 romance years** (day-branch-driven parts) | ⚠️ MOSTLY VALID | Day-branch signals valid; any 時支-keyed signal missing |
| — | — | — |
| **時柱 (四柱 row) + 時柱十神/藏干/納音** | ❌ LOST | Entire hour layer — children, subordinates, late-career, latent talents |
| **子女宮 (children palace)** | ❌ LOST | Is the 時柱; cannot read children |
| **晚年/晚運 (~age 48–55+)** | ❌ LOST | The "harvest" quarter of life |
| **命宮 + 身宮** | ❌ LOST | **Both formulas require 時支** — cannot compute. (胎元/胎息 — verify 胎息's dependency in our code) |
| **大運 起運年齡 (start age)** | ⚠️ DEGRADED | Sequence valid; **start-age precision lost** — birth time refines the 節氣 day-count (~1 時辰 ≈ 5–10 days ≈ fraction of a year of drift). Decade *turnover dates* become fuzzy, not the pillars. |
| **Hour-branch 神煞** | ⚠️ DEGRADED | 金神 (keyed on 日/時柱) uncomputable; 童子煞 partly hour-based; **桃花/驛馬/文昌/天乙貴人 get false-negatives** when a real hit sits on the missing 時支 (scanned across 年月日時) |
| **用神/喜神/忌神 (病藥取用法) + 五行比重 rings** | ⚠️ SHIFT RISK | Hour pillar = stem+branch+hidden ≈ **25% of raw five-element mass** (時干~10% + 時支~5% of strength weighting, ~15% of strength tally). 旺衰 (月令) is hour-independent, but the 強弱 *tally* sums all four pillars — **can flip borderline 中和↔偏弱 charts**, cascading into 用神 selection. **Tail risk:** special structures (化氣格, 三陽/三陰, 日祿歸時格) can be qualitatively mis-classified — the hour is *decisive*, not marginal, for these. |

**Estimated hour-dependent fraction: ~20–30%** (verified band; one EN source ~75% usable → ~25% lost; consistent with 時柱 ≈ 1 of 4 pillars). **High variance:** low for ordinary charts, high for special 格局. The loss is **not uniform** — it's concentrated in late-life/children/timing, while early-mid-life, personality, DM, wealth/career, **spouse palace**, and the 大運 ladder stay intact.

**Engine implication for our pipeline:** since we run engine → pre-analysis → AI, the cleanest design is a `hour_known: bool` flag threaded from input through pre-analysis. When false: compute the 3 pillars, set 時柱/命宮/身宮/子女宮 fields to a structured `null`-with-reason, mark 用神/五行比重 outputs with a `confidence: 'reduced'` flag, and have the AI layer's prompt **suppress** (not hallucinate) the locked sections — mirroring our existing anti-hallucination discipline.

---

## 6. Recommended product design for our app

### 6.1 Input UX (progressive disclosure)

Single time-resolution control with a clear, non-shaming branch — keep date/place required and visible; reveal heavier options on demand:

```
出生時辰
  ○ 我知道確切時辰        → HH:MM (or 時辰 dropdown)
  ○ 我只記得大概時段       → reveals: 上午/下午/晚上  OR  2-hour 時辰 picker (e.g. 午時 11–13)
  ○ 我不知道出生時辰       → 三柱 reading, hour sections locked
  ○ 幫我找出時辰（定盤）    → premium event-based rectification flow
```

- The **"我不知道出生時辰" radio must be first-class** — equal visual weight, no false hierarchy, **no default pre-selection on the time field** (NN/G explicitly permits a no-default for genuinely-unknowable info).
- **Inline reassurance microcopy** at the point of hesitation (under the field):
  > 「不確定也沒關係 — 可先用『時辰未知』看三柱命盤，日後想起再補上。」
- The **approximate-range option is high-value**: the practical Bazi uncertainty unit is the **2-hour 時辰**, and adjacent-時辰 comparison is the standard disambiguation technique. A rough window often recovers most of the reading.
- **Edge case to surface in copy:** since we currently use **wall-clock time (True Solar Time DISABLED)**, a boundary-時辰 or far-west-longitude user is a known inaccuracy. Worth a one-line note in the approximate-range branch.

### 6.2 Engine behavior — recommendation

**Recommendation: compute the 3-pillar reading + clearly label/lock hour-dependent sections. Do NOT silently default to a single hour. Do NOT auto-compute all 12 candidates for the base reading.**

Rationale:
- **Against silent single-hour default:** doctrinally "計算另一個人的八字"; this is the competitor anti-pattern (QiAdvisor noon / Shen Shu 00:00) we explicitly reject. If an internal calc *forces* a value, use a clearly-flagged placeholder and still suppress the displayed 時柱.
- **Against auto-12-candidate as the base reading:** showing 12 contradictory charts is confusing noise for a user who just wants *their* reading, and it's computationally heavier with no payoff at the free tier. **Reserve the 12-時辰 comparison as the engine primitive that powers the premium rectification flow** (and an optional power-user "compare adjacent 時辰" view).
- **For 3-pillar + lock:** matches the verified gold-standard "read-with-caveats" stance and the best-in-class competitor camp (astro.com / XuanSeal / Ondo). Structurally suppress what we can't compute.

**Tiered behavior:**
- **Free / base:** 3-pillar reading. Hour-dependent sections rendered **locked/blurred with a clear reason** (not hidden, not faked).
- **Premium 定時 add-on:** guided questionnaire → engine casts the 12 (or, if a range was given, the 2–3) candidate 時辰 charts → ranks them by matching the user's dated life events against each candidate's 大運/流年 → returns a best-fit 時辰 + confidence + the 2nd-best alternative. **Frame the output as "best-fit, not certainty."** Optional folk-trait hints allowed inside this flow *only as labeled民俗 tie-breakers*.

### 6.3 Disclaimer & confidence framing (verbatim zh-TW)

Lead the result with a **basis line** (the "X 成命局 / based-on-what-you-provided" move builds trust and pre-empts "why is this wrong?"):

> **本次解讀以年、月、日三柱推算（時辰未知）。**
> 性格、日主、事業、財運、感情（夫妻宮）等主軸仍清晰可讀（約可掌握命局的七成）；
> 子女、晚年運勢、命宮/身宮，以及部分精細的起運年齡，因缺少時辰暫不顯示 — 補上時辰後即可解鎖。

Per-section badge on locked content:
> 🔒 **此段需要出生時辰** — 時柱主管子女與晚年，補上時辰即可解鎖。

Standing disclaimer (mirror our existing entertainment disclaimer cadence):
> 命盤準確度與出生時辰相關；提供確切時辰可獲得最完整的解讀。

**Anti-over-claim guard** (consistent with our existing no-absolute-language rules): on hour-dependent or rectified output, **forbid 一定/必然/精準保證**; rectified 時辰 must read "最符合" / "推測為", never "確定為".

### 6.4 Monetization / cross-sell

- **Soft paywall, not hard block.** The **3-pillar core reading must be genuinely useful for free / base credits** — get the user to the "a-ha" before asking for payment. Lock features that *enhance*, never *enable*, the core.
- **Tease the locked hour-dependent sections** (子女宮/晚年運) blurred with an unlock CTA → routes to either "add your 時辰" or "幫我找時辰（定盤）".
- **定時 questionnaire = legitimate paid add-on** (parallels 科技紫微網 紫微定盤2.0 and Western "Birth Time Rectification" reports). Price it as optional *help*, framed honestly as approximate. **Ethical guardrail:** the user must always be able to get a complete, honest 3-pillar reading **without paying to unlock the hour** — otherwise the missing-time state becomes a manufactured upsell trap.
- **No confirmshaming.** The skip/proceed-without-time and decline-定時 buttons must be neutral and equally prominent — never "我不在乎準確度", never burying the free path under a dominant "購買定時服務". Guilt-tripping users about an often-genuinely-unrecorded birth hour is especially corrosive for a trust-dependent premium brand.

### 6.5 What to compute vs hide vs tease

| | Sections |
|---|---|
| **COMPUTE & SHOW (free)** | 年/月/日 三柱 table, 日主 + 旺相休囚死, 月令格局, 十神/藏干/納音/十二運/空亡 (3 pillars), **配偶宮 (日支) + 紅鸞/沖日支 romance core**, 五行比重 rings *(flagged "reduced precision")*, 用神/喜神/忌神 *(flagged, with a note that the hour can shift borderline charts)*, 大運 干支 **sequence**, 胎元, 生肖 |
| **HIDE / STRUCTURED-NULL** | 時柱 row, 時柱十神/藏干, 命宮, 身宮 (both need 時支) — return `null` with a reason, not a fabricated value |
| **TEASE (locked/blurred + unlock CTA)** | 子女宮 / 子女運, 晚年/晚運, 大運 **起運年齡** precision, hour-branch 神煞 (金神/童子 etc.), 時柱-resident 格局 (時上偏財/時上七殺) |
| **PREMIUM (定時 flow)** | 12-時辰 (or range-narrowed 2–3) candidate comparison + event-matching rectification → best-fit 時辰 |

---

## 7. Risks & open questions

1. **用神/五行比重 displayed without the hour can be *wrong*, not just imprecise** — for borderline 中和↔偏弱 charts and special 格局 (化氣格/三陽三陰/日祿歸時格), the hour is *decisive*. **Open question:** should we (a) still show 用神 with a "reduced confidence" flag, or (b) detect borderline/special-structure charts and *also* lock 用神? Recommend (b) for the special-structure tail — engine should flag when the 強弱 tally is within a threshold of the 中和 boundary and downgrade 用神 confidence accordingly.
2. **胎息 dependency unverified.** Research confirmed 胎元 (month-only, survives) and 命宮/身宮 (need 時支, lost). **We display 胎息 too — confirm in our own engine code whether 胎息 needs the hour** before deciding to show/hide it.
3. **早子時/晚子時 day-boundary.** A user entering "midnight / 00:00" or "around 子時" can flip the **DAY pillar** (the 23:00 day-change). Our approximate-range and unknown paths must handle this explicitly — and our **wall-clock (no True Solar Time)** setting compounds boundary risk. Decide the day-attribution rule for ambiguous 子時 input.
4. **Rectification quality depends entirely on user-supplied event accuracy** and **fails for young children / low-event-history users.** The flow must gate on "do you have ≥2–3 dated major life events?" and degrade gracefully (return "範圍縮小至 X–Y 時辰" rather than a false single answer) when it can't converge.
5. **"70%" is a practitioner heuristic with high variance**, not a measured figure — use soft framing ("約七成"/"大部分"), and avoid implying a precise guarantee.
6. **Do not let 盲派 marketing creep in.** Popular sources conflate 盲派 with folk physical methods; our rectification copy must stay on the event-based, falsifiable side and avoid mystique claims.
7. **AI-layer suppression must be enforced, not hoped for.** Given our three-layer pipeline, the locked sections must be suppressed *deterministically* at the pre-analysis layer (structured null + prompt rule), consistent with our existing anti-hallucination discipline — the AI must never narrate a 時柱 it wasn't given.

---

## 8. Citations

**Gold standard / 定盤 / 3-pillar doctrine**
- https://zhuanlan.zhihu.com/p/11090049057
- https://www.douban.com/note/871739335/
- https://www.suanzhun.net/article/2488_5.html
- https://novamastersconsulting.com/do-i-need-my-exact-birth-time-for-a-bazi-chart/
- https://ondodestiny.com/dont-know-your-birth-time-heres-how-to-still-use-bazi/
- https://www.whisperofdao.com/post/how-to-read-full-bazi-chart-without-birth-hour
- https://zhuanlan.zhihu.com/p/559436202
- https://www.guoyi360.com/bzmr/lxz/274.html
- https://zh.wikipedia.org/zh-hans/%E6%9D%8E%E8%99%9B%E4%B8%AD
- https://www.quanxue.cn/qt_mingxiang/yuanhaizp/yuanhaizp06.html
- https://zhuanlan.zhihu.com/p/565368852
- https://zhuanlan.zhihu.com/p/603531482
- https://www.quanxue.cn/qt_mingxiang/mangpaimd/mangpaimd04.html
- https://www.deeporacle.ai/bazi/blog/bazi-schools-comparison
- https://vocus.cc/article/63ed8a5dfd897800017b58de
- https://en.wikipedia.org/wiki/Four_Pillars_of_Destiny
- https://www.cosmictao.com/bazi
- https://www.juxian.com.hk/r008/
- https://m.k366.com/bazi/36106.htm
- https://m.k366.com/bazi/178954.htm
- https://www.163.com/dy/article/JKQS2NN20521C9T8.html
- https://lifecoach.tw/year-interpretation/
- https://www.jiyuntang.com/bazi/19857.html
- https://www.epochtimes.com/b5/19/12/8/n11708626.htm
- https://www.sohu.com/a/282887887_100262664
- https://zhuanlan.zhihu.com/p/1943100081759843898

**Folk-myth indicators / 鐵板神數 (flagged AVOID)**
- https://m.sohu.com/n/481190933/
- https://www.guoyi360.com/12sc/ms/6927.html
- https://zhuanlan.zhihu.com/p/675853298
- https://zhuanlan.zhihu.com/p/565703102
- https://www.oreateai.com/blog/research-on-accurate-calculation-methods-of-birth-time-in-bazi-astrology/77c171fbd21ba8855681a07c90c4f3f2
- https://ctext.org/wiki.pl?if=gb&res=532360
- https://www.sunredcharm.com/blogs/news/forgot-your-birth-hour-6-practical-chinese-methods-to-pinpoint-your-character-hour-for-bazi-analysis
- https://k-saju.co.kr/birth-time-korean-saju-reading-traditional-methods/
- https://www.scirp.org/html/68060_68060.htm
- https://www.dajiazhao.com/htm_nobirth.htm
- https://udn.com/news/story/7268/8278994
- https://zh.wikipedia.org/wiki/%E9%90%B5%E7%89%88%E7%A5%9E%E6%95%B8
- https://en.wikipedia.org/wiki/Tie_ban_shen_shu
- https://www.kankanwoo.com/?p=3731
- https://fate-ziwei.com/post/tieban-shenshu-principles-explained-fate
- https://www.epochtimes.com/gb/9/10/7/n2680944.htm
- https://www.epochtimes.com/b5/10/11/28/n3098102.htm

**Competitor / app UX**
- https://qiadvisor.ai/en/free-tools/bazi-chart
- https://www.shen-shu.com/en/bazi-reading
- https://xuanseal.com/chinese-astrology/calculator
- https://bazi-calculator.app/
- https://www.32r.com/app/134264.html
- https://play.google.com/store/apps/details?id=com.lingocc.cc5
- https://www.click108.com.tw/sam/sam0605-4.php
- https://www.8698.tw/%E6%B3%A8%E6%84%8F%E4%BA%8B%E9%A0%85/%E4%B8%8D%E7%9F%A5%E9%81%93%E5%87%BA%E7%94%9F%E6%99%82%E9%96%93%E6%80%8E%E9%BA%BC%E8%BE%A6
- https://jasonlee0404.pixnet.net/blog/post/337896239
- https://apps.apple.com/us/app/%E7%B4%AB%E5%BE%AE%E6%96%97%E6%95%B8%E6%8E%92%E7%9B%A4/id445270462
- https://xp.ixingpan.com/natal.php
- https://www.p8zi.com/blog/d26e6674775
- https://www.fatebook.cc/fatebook/fate/fate10034.html
- https://www.fatebook.cc/fatebook/fate/fate10033.html

**Western astrology cross-reference**
- https://theastrologypodcast.com/2020/09/08/how-to-read-a-natal-chart-with-no-birth-time/
- https://www.chani.com/astro-education/how-can-i-work-with-my-astrology-chart-if-i-dont-know-my-birth-time
- https://www.augurine.com/learn/astrology-without-birth-time
- https://www.astro.com/faq/fq_de_time_e.htm
- https://horoscopes.astro-seek.com/birth-chart-horoscope-online
- https://support.astrograph.com/support/solutions/articles/66000476614-desktop-manual-timepassages
- https://www.costarastrology.com/
- https://www.thepattern.com/natalchart
- https://www.sanctuaryworld.co/
- https://www.ixingpan.com/article/1930.html
- https://kerykeion.net/content/learn-astrology/branches-rectification-methods
- https://chaninicholas.zendesk.com/hc/en-us/articles/4411093003539-Unknown-Birth-Time

**Technical impact / engine + UX design**
- https://www.masterso.com/classroom/classroom2_1_4.php
- https://www.masterso.com/classroom/classroom2_1_3.php
- https://health.baidu.com/m/detail/ar_9422221961595547097
- https://www.guoyi360.com/bzjc/wxxk/6579.html
- https://zhuanlan.zhihu.com/p/668468840
- http://astro.sina.com.cn/e/2016-03-09/doc-ifxqaffy3790112.shtml
- http://www.360doc.com/content/24/1201/19/49273461_1140892916.shtml
- https://baike.baidu.com/item/%E5%9B%9B%E6%9F%B1%E7%A5%9E%E7%85%9E/9604255
- https://www.suanzhun.net/article/2789.html
- https://www.suanzhun.net/article/2459.html
- https://www.100percentastrology.com/missing-hour-pillar-chart-rectification/
- https://www.skillon.com/Bazi_FengShui.cfm/topic/Missing_hour_of_birth_in_BaZi_Four_Pillars_of_Destiny_reading
- https://www.yuceju.com/ask/125/
- https://m.k366.com/bazi/206557.htm
- https://www.gongjugou.com/jieri/dayun/
- https://vivian040788.pixnet.net/blog/post/339112059
- https://www.bastillepost.com/hongkong/article/10083285
- https://blog.logrocket.com/ux-design/progressive-disclosure-ux-types-use-cases/
- https://lollypop.design/blog/2025/may/progressive-disclosure/
- https://www.nngroup.com/articles/radio-buttons-default-selection/
- https://www.alfdesigngroup.com/post/form-ux-best-practices
- https://accessibilitymadeeasy.org/accessible-radio-buttons-your-comprehensive-how-to-guide/
- https://www.revenuecat.com/blog/growth/hard-paywall-vs-soft-paywall/
- https://www.airbridge.io/en/blog/hard-vs-soft-paywalls
- https://www.deceptive.design/types/confirmshaming
- https://blog.logrocket.com/ux-design/negative-effects-confirmshaming/
- https://www.deceptive.design/book/contents/chapter-16
- https://weareyellowball.com/guides/micro-copy-ux-words/
- https://www.zionandzion.com/how-microcopy-in-the-hidden-ux-of-trust-drives-e-commerce-confidence/
- http://lucidchateau.blogspot.com/2018/03/blog-post.html
- https://buy.astrosage.com/service/birth-time-rectification
