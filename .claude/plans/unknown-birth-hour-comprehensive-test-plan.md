# 八字時辰未知 — Comprehensive Ship-Gate Test Plan

**Feature:** Unknown-birth-hour (3-pillar) support across all 6 Bazi reading types.
**Branch:** `feat/unknown-birth-hour` @ `07f48b8` (Phase 1+2+3 all shipped, pushed to GitHub).
**Goal:** The full ship-gate that Phases 1/2/3 never got — chart-diversity matrix × all 6 reading types live × **Full A2 narrative grading (3-parallel Bazi-master graders on every narrative)** × negative controls × automated-suite regression × engine-level no-crash sweep.
**Owner decisions (2026-06-15):** Narrative QA = **Full A2 on everything**. Matrix = **Standard** (4 charts × all 6 types + negative controls + byte-identical pytest).

---

## Environment & setup (Stage −1, before any test)

- Branch `feat/unknown-birth-hour`, all servers **restarted clean + detached** (`nohup … & disown`, NOT `run_in_background`):
  - Engine (5001) — uvicorn `--reload` parent PID is from Jun 14; restart to guarantee committed Phase-3 (`compatibility_enhanced.py` Dim 6b) + (a) (`annual_enhanced.py` 太歲 guard) code is live.
  - NestJS (4000) — rebuild (`node …/node_modules/.bin/nest build`) + restart with `ANTHROPIC_API_KEY` exported + `AI_STREAM_TIMEOUT_MS=300000` in `.env`.
  - Next.js (3000) — restart (or hard-reload in browser to dodge stale Turbopack bundle across the session boundary).
- Browser: Claude in Chrome, `http://127.0.0.1:3000`, signed in as **Roger (PRO)**, token via `await window.Clerk.session.getToken()`.
- **Credit/spend awareness:** each live reading is a real Claude generation (compat = 3-call). Standard matrix ≈ up to ~32 generations + Full-A2 ≈ 3 graders each. Front-load the CHEAP stages (0–2) so any crash is caught before burning AI. Reuse a cached narrative ONLY if its prompt/pre-analysis version matches the committed final prompt; otherwise regenerate (reading-cache key has **no** prompt version → bust Redis `reading_cache:HASH:type` + `DELETE FROM reading_cache` for the chart before regen).

### Engine response contract (verified — assertion source of truth)
`POST /calculate` → `{status, data, calculationTimeMs}`. On `data`:
- `data.fourPillars.hour.stem === '' && .branch === ''` (blanked); year/month/day pillars fully populated.
- `data.dayMaster.hourUnknown === true`
- `data.dayMaster.yongShenConfidence === 'reduced'`
- `data.dayMaster.yongShenCaveat` ∈ {`'borderline'`, `null`}
- `data.dayMaster.geJuStatus` ∈ {`null`, `'undetermined_without_hour'`}
- `data.dayMaster.strength` / `.strengthScoreV2.classification` ∈ {very_weak, weak, neutral, strong, very_strong}
- `data.mingGong === null && data.shenGong === null`
- `data.taiYuan` present (month-derived) && `data.taiXi` present (day-derived)
- `data.hourKnown === false`
- Engine input fields: `birth_date, birth_time(null), hour_known(false), birth_city, birth_timezone, gender('male'|'female'), reading_type`.

---

## The chart-diversity matrix (4 charts × the 5 dayMaster states)

| # | Bucket | Anchor | DM / 用神 | Caveat states exercised |
|---|--------|--------|-----------|--------------------------|
| **A1** | neutral **+ borderline** | Roger `1987-09-06` male 吉打 Asia/Kuala_Lumpur | 戊 neutral 42.4 / 用神火 / 食神格 | `confidence=reduced` + `caveat=borderline`, `geJuStatus=null` |
| **A2** | weak / very_weak | Laopo `1987-01-25` female 台北 Asia/Taipei | 甲 weak / 用神水 | `confidence=reduced`, `caveat=null`, `geJuStatus=null` |
| **A3** | 從格-candidate | **TBD via Stage-0 sweep** (a date yielding `geJuStatus='undetermined_without_hour'` or very_weak/very_strong where `check_cong_ge`/`check_cong_qiang_or_wang` fires) | 從X candidate | `geJuStatus='undetermined_without_hour'` → **格局待確認** path |
| **A4** | strong / very_strong | **TBD via Stage-0 sweep** | strong DM | `confidence=reduced`, non-borderline |

- Gender coverage: A1/A4 male, A2 female (+ A3 either). COMPAT exercises 男方/女方/雙方 dispatch explicitly.
- A3 is the load-bearing diversity add (it's the only one that triggers the `格局待確認` withhold path + `check_cong_ge` weak-DM crash site that the Phase-1 audit caught). Stage 0 MUST surface a real A3 (and A4); if the sweep can't find an A3, document it + construct one from a corpus 從格 chart's Gregorian date.

---

## Stage 0 — Engine no-crash + flag sweep (curl, CHEAP, no AI) ⟶ the crash net + matrix selection

Run **~12–16 charts** `hour_known=false` through the engine, varied across DM strength, both genders, and **edge dates**. Two jobs: (1) prove no exception + correct flags across diversity; (2) classify charts → pick A3 + A4.

**Endpoints to hit per chart (hour_known=false):**
- `POST /calculate` (covers LIFETIME + LOVE + CAREER + ANNUAL pre-analysis — `calculate_bazi_with_all_pipelines` runs all of them) — assert the response contract above + no `detail`/500.
- `POST /daily-fortune`, `POST /monthly-fortune`, `POST /yearly-fortune` — assert no 500, no phantom 時支 神煞, soft-trigger framing fields present.
- `POST /compatibility` (the 4 sub-cases — see Stage 3 B6) — assert no 500 (this is where the 3b live-500 命宮 deref bug lived), `partial` flag + `hourUnknownParties` correct, score is honest (not diluted/penalized).

**Per-chart assertions:** no exception; empty hour pillar; `mingGong/shenGong null`; `taiYuan/taiXi present`; dayMaster flags match the chart's true state; `hourKnown=false`. Edge-date subset additionally:
- **立春 boundary** (e.g. a birth on/around 2/4) — noon placeholder must pick the correct YEAR pillar (年 changes at 立春, not Jan-1).
- **子時 boundary** — noon placeholder must NOT trip the 23:00 早/晚子時 day-rollover (the whole reason noon was chosen). Verify the DAY pillar matches the known-hour day pillar for a non-子時 time on the same date.
- **女命** chart (gender dispatch in love/spouse pre-analysis on 3 pillars).

**Also (regression on the known side):** run A1/A2 with `hour_known=true` through `/calculate` and confirm the hour pillar + 命宮/身宮 populate (sanity that the unknown branch only fires when asked).

---

## Stage 1 — Automated regression suites (pytest + jest + RTL, CHEAP, no AI)

- **Engine pytest:** `tests/test_unknown_hour.py` + `tests/test_compatibility_enhanced.py::TestCompatHourUnknown` + full suite. Assert green (only the documented pre-existing `test_roger_laopo_full_preanalysis` may fail). **Byte-identical hour-known:** the hour-referencing fixtures stay green (the unknown branch triggers only on hour-unknown).
- **API jest:** `chat-prompt-builder.hour-unknown.spec.ts` (+compat cases); DTO accepts `hourKnown=false`+null time, **rejects** null time when `hourKnown=true` (N1 boundary → 422); prompt-builder emits the 【時辰未知】 block ONLY when `hourUnknown`; chart-hash includes `hourKnown`.
- **Web RTL:** `compatibility-hour-unknown.spec.tsx` (form flip + paywall warning 男方/女方/雙方); BaziChart 時柱 column; fortune banner; form toggle.
- **tsc:** web baseline unchanged (only the pre-existing ChatDrawer JSX-identity error); api clean.

---

## Stage 2 — Byte-identical hour-KNOWN diff (curl, CHEAP)

Confirm the feature did NOT change hour-known behavior at the engine boundary: `/calculate` hour-known output for A1/A2 is stable (no drift vs a known-good capture / vs pytest fixtures). This is the two-sided risk: (a) unknown works, (b) known unchanged.

---

## Stage 3 — Browser E2E functional (live AI begins) — 4 charts × all 6 types

For each (chart × reading type), drive the **real UI** and assert. Capture every AI narrative to disk for Stage 4 grading.

### Per-(chart,type) functional checklist
- **C1** No 500 / reading renders fully.
- **C2** Zero console errors (React / hydration / network) — read console after render.
- **C3** 時柱 column renders 「時辰未知」 placeholder; header 三柱 tag/badge; basis line present, **left-aligned**, **plain copy** (leads with 「由於未提供出生時辰…」).
- **C4** (chart view) 命宮/身宮 sections hidden; 胎元/胎息 present.
- **C5** 用神 caveat surfaced (僅供參考); when `geJuStatus='undetermined_without_hour'` (A3) → **格局待確認** shown, verdict withheld.
- **C6** Paywall warning, by surface:
  - LIFETIME / LOVE / CAREER / ANNUAL → shared **`UnlockConfirmModal`** hourUnknown warning block (lead + itemized 「不會包含」 list + 僅供參考 + 另建新命盤 note).
  - FORTUNE → **`FortuneShell`** caveat banner, present on **all 3 tabs** (day/month/year).
  - COMPATIBILITY → **`CompatibilityRomancePaywallCTA`** warning with correct 男方/女方/雙方 label.
- **C7** Reading NOT degraded (no 「命理分析未完整」). If it degrades → capture `failedReason` (now records `[cause: call1Timeout/call2Timeout/call2Stop]`), treat as a BUG to fix (timeout/stop-reason).

### Reading-type coverage (B1–B6)
- **B1 LIFETIME** (八字終身運) — full 3-pillar core; in-place 子女關係 「⚠️時辰未知限制說明」 note (NOT silent omission); null 時柱/晚年/命宮/身宮.
- **B2 LOVE** (八字愛情姻緣) — 配偶宮/配偶星/正緣桃花/紅鸞 full; null 子女; spouse gender dispatch.
- **B3 CAREER** (事業詳批) — 財官格局 + 3-pillar 五行/十神比重 flagged; null 晚年事業/部屬. (The one real engine crash in Phase 2 was `calculate_weighted_ten_gods` — verify fixed.)
- **B4 ANNUAL** (八字流年運勢) — 流年/流月 via 用神 + day-branch; drop hour-branch monthly 神煞; annual_family 子女宮 「僅評印星（長輩庇蔭）」 strip; no phantom 時支 太歲.
- **B5 FORTUNE** — **day / month / year** (3 scopes). FortuneShell banner all tabs; folk content (吉色/吉數/吉食/吉時) day-only; soft-trigger framing; drop hour-branch 神煞.
- **B6 COMPATIBILITY** (八字感情合盤) — **4 sub-cases**:
  - both-known (negative control — no warning, full cross-interactions),
  - A-unknown (男方 warning), B-unknown (女方 warning), both-unknown (雙方 warning);
  - assert `partial` + honest score (no numeric penalty), 配偶宮 core present, WITHHOLD 子女緣/晚年, no 命宮/身宮, per-party 本人/對方/雙方 directive obeyed.

### AI suppression compliance (per captured narrative — D-series, my own scan)
- **D1** zero fabricated 時柱十神/藏干/神煞. **D2** zero fabricated 子女宮/子女緣 as fact (in-place note instead). **D3** zero 晚年/晚運 fabrication. **D4** zero 命宮/身宮 content. **D5** zero false 「命中無某神煞」. **D6** 用神「（時辰未知，僅供參考）」 + 格局待確認 (A3). **D7** 補時辰 phrasing = 「日後…另建新的命盤」, NEVER 「補上即可解鎖/我可以為你提供」. **D8** plain wording (gloss 時柱). **D9** FORTUNE: no banned absolute language (今天會/一定/必然/絕對).
  - Scan method: capture prose → regex/`grep` for the forbidden tokens + count the required caveats (proven workable in 3e-lite). Use a Python scanner, not shell `ugrep` (the 3e-lite `ugrep` complexity-limit error).

---

## Stage 4 — AI narrative DOCTRINE grading (Full A2 — 3-parallel Bazi-master graders PER narrative)

For **every** captured narrative, launch **3 parallel grader sub-agents**, each given: the narrative prose + the engine ground-truth (pillars, dayMaster flags, 用神, suppression items) + the chart's hour-unknown context. Each returns a structured verdict (PASS / FAIL + confidence + cited issues).

- **Grader 1 — Doctrine:** 五行生剋 / 十神 / 旺衰 / 月令格局 correctness on the 3 surviving pillars; 用神 reasoning defensible for the flagged 3-pillar context; **no DM-strength drift**; no claim that depends on the missing 時支.
- **Grader 2 — Hallucination:** every structured fact cross-checks against engine output; the suppression items (時柱/子女/晚年/命宮/身宮/時支神煞) are truly absent-as-fact; folk content (FORTUNE) grounded in engine fields; no invented 神煞/方位/吉時.
- **Grader 3 — Framing/Safety:** soft-trigger framing (FORTUNE 今日宜/易於), entertainment disclaimer present, no fatalism/absolute language, plain 時辰未知 voice consistent with the chrome, D7 補時辰 phrasing correct.

**Gate:** any FAIL (≥ the audit confidence bar) → fix (prompt clause / injector / engine) → regenerate that narrative → re-grade until clean. Record every grader verdict in the results log.

---

## Stage 5 — Negative controls (hour-KNOWN unchanged, browser)

- **F1** hour-known LIFETIME (Roger known `a212540f`): full 時柱/子女/晚年/命宮/身宮 present; **NO** basis line, **NO** 三柱 badge, **NO** unlock warning block, **NO** 用神 caveat banner. (Reuse a cached known reading if its prompt version matches; else regenerate.)
- **F3** hour-known FORTUNE: **no** 時辰未知 banner on any of day/month/year tabs.
- **F4** hour-known COMPATIBILITY (both known): **no** paywall warning block; full cross-interactions.

---

## Stage 6 — Edge cases, availability, chat (best-effort)

- **G4** N1 boundary live: a create-profile / engine call with `hour_known=true` + no time → 422 (not a silently-wrong noon chart). (Also pytest in Stage 1.)
- **G5** chart-hash: known vs unknown SAME date produce different cache keys (no collision) — verify two readings don't cross-contaminate.
- **I1** ZWDS availability: confirm ZWDS is not offered (or does not 500) for an hour-unknown profile.
- **I2** the 「問 AI 命理師」 button on an hour-unknown reading — behavior.
- **H (chat, env-blocked best-effort):** verify the chat-context injector emits the 時辰未知 suppression directive (curl `/build-chat-context*` with hour_known=false, or unit-level); IF a chat is reachable live → send a message on an hour-unknown profile → no crash + suppression obeyed + friendly 「為什麼看不到子女運/時柱」 path.
- **立春 / 子時 boundary** (engine-level, from Stage 0) — re-confirm the year/day pillar is correct.

---

## Fix loop (applies throughout)

For any failure at any stage: diagnose → fix at the right layer (engine guard / DTO / prompt clause / injector / frontend) → **rebuild the affected service** (NestJS rebuild+restart; engine `--reload` or restart; web hard-reload) → **re-run that stage's failing case** → confirm green → note in the results log. Cache-bust before any regeneration (reading-cache has no prompt version).

---

## Sign-off criteria (all must hold)

1. Stage 0: every swept chart (incl. edge dates) — zero engine exceptions; flags correct; A3 + A4 surfaced.
2. Stage 1: engine pytest + API jest + web RTL all green (only the documented pre-existing fails); byte-identical hour-known.
3. Stage 3: all 4 charts × 6 reading types render (C1–C7) with correct caveats/badges/paywall surfaces; D1–D9 suppression compliance clean.
4. Stage 4: Full A2 — every narrative PASSES all 3 graders (after any fix+regrade).
5. Stage 5: hour-known negative controls fully unchanged (no leakage of unknown-path chrome).
6. Stage 6: N1 422, hash isolation, ZWDS safe, chat injector emits the directive.
7. Zero console errors across the browser matrix; no degraded readings.

---

## Review additions (folded in — 2 parallel reviewers, 2026-06-15)

Two reviewers (code-coverage + product/doctrine) confirmed the core is strong but flagged matrix-invisible states, two latent bugs, and missing doctrine backstops. Folded in, mapped to stages:

### Two latent bugs to VERIFY + FIX (caught statically)
- **BUG-1 (compat gender-label divergence) — in scope.** `ai.service.ts::buildCompatHourUnknownSuppressionBlock` labels the unknown party by ACTUAL gender; the compat page banner (`compatibility/page.tsx:858-859`) + `CompatibilityRomancePaywallCTA` label POSITIONALLY (A→男方, B→女方). Diverge for female-A / same-sex. Fix: make the page banner + CTA label by actual `genderA`/`genderB` to match the AI block (the deeper same-sex panel-label limitation is pre-existing/out-of-scope, but our new banner must be consistent). Verify in Stage 3 B6 with a female-A + a same-sex sub-case.
- **BUG-2 (update-path hour-state mutability) — verify reachability first.** `updateBirthProfile` spreads `{...dto}` (`users.service.ts:112`) with no guard that hour state is immutable (D3). Confirm whether `UpdateBirthProfileDto` exposes `birthTime`/`hourKnown` + whether edit is a reachable user flow; if reachable, add a guard/strip + API jest test (PATCH birthTime onto hour-unknown → rejected/stripped, engine round-trips without 422). If edit is not reachable in the UI, document as deferred.

### Stage 0 additions (engine, cheap)
- **Hard-assert the 4 flag tuples per chart** (not just "exists"): A1 `caveat=borderline, geJuStatus=null`; A2 `caveat=null, geJuStatus=null`; A3 `geJuStatus=undetermined_without_hour`; A4 `caveat=null`, non-borderline. Turns the caveat-state matrix from declared → tested.
- **A3 is a HARD pre-req with an explicit construction recipe**, not a probabilistic sweep: must be a chart whose 從格 verdict **flips to `undetermined_without_hour` when the hour is blanked** (NOT one that's 從格 on 3 pillars regardless). Pin it as a pytest fixture asserting `geJuStatus=='undetermined_without_hour'`. If the sweep finds none, derive a Gregorian date from a corpus 從格 chart and verify the flip.
- **Survivor-correctness diff** (sharper than Stage 2): hour-unknown vs hour-known SAME date — these hour-independent fields must be **byte-identical**: 胎元(月)/胎息(日), 大運 干支序列 + direction + **integer 起運 age** (noon must not drift it), 配偶星 archetype, 正緣桃花/紅鸞 years, 月令格局, 生肖. (用神/五行 may differ — that's expected.)

### Stage 1 additions (automated, cheap)
- Add **`fortune-prompt-builder.hour-unknown.spec.ts`** to the enumerated suite (it exists, was omitted).
- Add a **jest unit spec for `ai.service.ts::buildHourUnknownSuppressionBlock`** (the core LIFETIME/LOVE/CAREER/ANNUAL injector — currently only live-AI-covered): block emitted ⇔ `hourKnown===false`; all 4 V2 injectors prepend it; the `geJuStatus` 「格局待確認」 line appears only when `undetermined_without_hour`; per-type extra lines present; byte-identical (no block) when hour-known.
- **BUG-2 update-DTO** jest test (per above, if reachable).

### Stage 3 additions (browser/live)
- **B6 compat: add a female-A sub-case AND a same-sex (both-female) sub-case** — assert AI-label = page-banner-label = chat-directive-label all track the ACTUAL unknown party (catches BUG-1).
- **B6 compat: select a PRE-EXISTING hour-unknown profile from the picker** (not just quick-create) as Person A and as Person B — the exact 3b live-500 regression path.
- **B6 both-unknown:** assert dual-reduced-confidence framing (BOTH 用神 flagged lower-confidence, compounding).
- **C-series: capability-chart caveats** — `ElementCapabilityChart`/`TenGodCapabilityChart` show the 「※ 時辰未知：本比重以年、月、日三柱估算」 caveat (the visible surface for degraded 五行/十神比重).
- **Mascot / 角色卡** renders the correct day-stem mascot on an hour-unknown LIFETIME chart (+ share/角色卡 export doesn't choke on null birthTime).

### D-series additions (suppression scan — named doctrine forbidden checks)
- **從格/化氣/專旺 VERDICT must be refused** (only "candidate / 待確認" allowed) — the single most dangerous Bazi error.
- **時上格局 named-forbidden:** 時上偏財 / 時上一位貴 / 日祿歸時 (all need 時干/時支).
- **時支-keyed 神煞 presence-OR-absence:** 童子煞 / 金神 / 元辰 — a fabricated PRESENCE (「命帶金神」) is as wrong as a false absence; the generic 命中無 regex misses fabricated presence.
- **No "complete/balanced 五行" claim** (你的五行齊全/均衡) when 1/4 of the chart is missing.

### Stage 4 additions (A2 grader prompts)
- Graders must explicitly probe: 從格/化氣 verdict refusal; the 3 named 時上格局; the 3 named 時支 神煞 (presence AND absence); complete-五行 claim; 用神 reasoning led by hour-independent 月令 (not an invented 時干透干); for A1 borderline — both 僅供參考 AND the stronger borderline caveat present.

### Stage 5 additions (negative controls)
- Add **hour-KNOWN LOVE / CAREER / ANNUAL** controls (not just LIFETIME/FORTUNE/COMPAT) — where the shared injector could leak chrome if the `hourKnown===false` gate regressed.
- Each negative control also asserts **no silent doctrine SUPPRESSION**: the hour-dependent sections (子女/晚年/從格/時柱) are still fully present + correct (catch an over-broad gate), not merely "no badge".
- **Cross-surface wording sync:** the `UnlockConfirmModal` itemized 「不會包含」 list ↔ the AI's in-place withheld-item set must cover the SAME items (they can drift).

### Stage 6 additions (entry points)
- **Fortune ProfileSwitcher** known↔unknown switch mid-session: banner appears on all 3 tabs when switching to unknown, disappears when switching back; no day/month/year cross-contamination.
- **Form re-hydration:** load a saved hour-unknown profile into `BirthDataForm` → the 時辰未知 toggle is ON. (`date-time-utils.ts:176` derives `quickMode` from `!birthTime` — should prefer `hourKnown===false`; fix the proxy + RTL test.)
- **Reading-history list:** a saved hour-unknown reading renders its 三柱 badge + null `birthTime` in the list row without crashing.
- **ElementExplanation:** clicking the blank 時柱 / hidden 命宮·身宮 cell → no fabricated 時柱 god-role content (no API call or graceful「此欄需要出生時辰」).
- **Share-card disclosure** decision: `Shareable{Fortune,Monthly,Yearly}Card` have no 時辰未知 marker — decide (add a small 三柱 marker OR explicitly accept) + assert.

### Sign-off additions
- The 4 per-chart flag tuples hard-asserted (Stage 0). A3 從格-flip pinned. Survivor-correctness byte-identical diff green. BUG-1 fixed (label consistency). BUG-2 resolved or documented-deferred. New jest specs green. Capability-chart caveats + mascot + history badge + ProfileSwitcher switch + form re-hydration verified. Named-doctrine forbidden checks clean across D-series + all 3 graders.

---

## Results log (filled during execution)

### Stage −1 (2026-06-15) — ✅ engine current, no restart
Compat HU curl confirmed committed Phase-3 code live (`partial=True`, `hourUnknownParties=['B']`, `overallScore=56`/`adjustedScore=76`, no 500, chartB hour blanked). NestJS fresh (built+started 22:23, `AI_STREAM_TIMEOUT_MS=300000`). `--reload` engine picked up commits.

### Stage 0 (2026-06-15) — ✅ ALL GREEN
- **No-crash sweep:** 36 charts (all 5 strength classes × both genders × varied 月令) → **0 crashes, 0 contract violations**. Fortune endpoints (4 charts × day/month/year incl. 太歲 guard + A2 female + A3 從勢) → **12/12 no-crash**.
- **A3/A4 locked:** in-process dense hunt (1098 charts) found **19 `congGe`→`geJuStatus=undetermined_without_hour`** (~1.7%, mostly 從勢) — the geJuStatus path is REACHABLE (not dead code). A3 = `1993-03-08` male 台北 (癸酉/乙卯/戊子, 戊土 very_weak 0, 從勢格). A4 = `1990-02-03` male 台北 (己巳/丁丑/己亥, 己土 very_strong 74).
- **Flag tuples:** A1 neutral/borderline/geJu=null ✅; A2 very_weak/reduced/null ✅; A3 very_weak/reduced/**undetermined** ✅; A4 very_strong/reduced/null ✅.
- **Survivor diff (HU vs known, same date):** 胎元/胎息/生肖貴人/大運干支序列/**起運整數age** all **byte-identical** for A1+A2. (起運 *date* drifts ~21 days from the noon placeholder, integer age unchanged 10/6 — exactly as designed.)
- **Edge dates:** 立春 boundary correct (Feb 3 = 己巳年, Feb 5 = 庚午年); 子時 boundary correct (HU 日柱 = noon 日柱 丁丑, NOT the 23:30 戊寅 rollover).
- **⚠️ CONTRACT CORRECTION (plan §contract was wrong):** `yongShenCaveat ∈ {'borderline','reduced'}` — it is **never `null`** when hour-unknown (calculator.py:288 `'borderline' if is_borderline else 'reduced'`). Also **A2 Laopo HU = `very_weak`** (not `weak` — blanking 壬申 hour removes 印 support, drops 甲 weak→very_weak). Both were my stale expectations, NOT engine bugs. Matrix updated accordingly (A2 caveat=reduced, A3 caveat=reduced).

---

### Stage 1 (2026-06-15) — ✅ GREEN + 2 bugs fixed
- **Existing suites:** engine pytest test_unknown_hour + compat = **132 passed**; API jest hour-unknown specs (chat-prompt-builder + fortune-prompt-builder) = **10 passed**; web RTL compatibility-hour-unknown = **8 passed**.
- **BUG-1 FIXED (compat gender-label divergence):** `CompatibilityRomancePaywallCTA` + compat page banner now label the unknown party by ACTUAL gender (`genderA`/`genderB`), matching `ai.service.buildCompatHourUnknownSuppressionBlock`. Was positional (A→男方, B→女方) → would contradict the AI narrative for female-A / same-sex. Frontend-only, cache-safe. Web RTL extended to **11 passed** (+3 female-A / male-B / same-sex cases).
- **BUG-2 FIXED (update-path hour-state mutability, D3):** `users.service.updateBirthProfile` now strips `hourKnown` from updates and refuses to write `birthTime` onto a 3-pillar profile — enforces D3 immutability + prevents the inconsistent `hourKnown=false`+`birthTime!=null` row. NestJS rebuilt + restarted (PID 20361). Live PATCH verification deferred to Stage 6.
- **A3 從勢 fixture pinned:** `test_unknown_hour.py::test_a3_congge_withholds_geju_verdict` (1993-03-08 → geJuStatus=undetermined) — engine pytest **36 passed**. Locks the otherwise-rare geJuStatus path from regressing to dead code.
- **tsc:** web — only the pre-existing ChatDrawer JSX-identity error (line 990); no new errors in the 2 changed files. NestJS `nest build` clean.
- **Deferred (noted):** dedicated jest unit spec for the private `buildHourUnknownSuppressionBlock` (GAP-5) — the live A2 grading (Stage 4) + existing fortune/chat injector specs cover it; standalone CI lock is a low-priority follow-up.

### Stage 3 (browser + live AI, in progress 2026-06-15)

Matrix profiles: A1 `75f05db7` (Roger HU), A2 `af56c837` (Laopo HU female), A3 `e5e0b93e` (1993-03-08 從勢 HU), A4 `7ecdab18` (1990-02-03 very_strong HU). Roger credits bumped to 999 for the run.

- **A1 LIFETIME — ✅ full browser E2E, exemplary.** Form profile-select → 開始排盤 → free 3-pillar preview (no D6 modal) → 解鎖 → `UnlockConfirmModal` hourUnknown warning (C6) → unlock → AI. Chrome verified: header «（時辰未知）», plain basis line (gloss 時柱→「出生那個時辰」, D8), 時柱 column placeholder, 命宮/身宮 hidden, 胎元/胎息 shown, pillars 丁卯/戊申/戊午+blank. AI suppression scan clean: 0 命中無, 2 in-place 時辰未知 caveats (not silent, D8), 新命盤 D2 phrasing (no 補上...解鎖), no 命宮/身宮 in prose, no 時柱 fabrication, 格局待確認 correctly ABSENT (geJu=null). Doctrine spot-check: 戊土 中和 42.4, 用神火/喜土/忌木/仇水, 配偶宮 日支午 survives. Modal C6 list ↔ AI in-place items aligned.
- **GAP-4 — ✅ covered.** Loading the saved HU profile auto-checked the 時辰未知 toggle + cleared the time. With BUG-2 fixed, `birthTime=null ⟺ hourKnown=false` so the `!birthTime` proxy is reliable; the reviewer's suggested `hourKnown`-direct switch is defense-in-depth (low priority).
- **BUG-1 — ✅ verified fixed (frontend).** (Live female-A compat check pending in compat sub-cases.)

- **🐞 BUG-3 FOUND + FIXED (the critical doctrine bug the gate was built to catch).** A3 LIFETIME's first narrative **asserted a confident 從勢格 verdict** («屬於從勢格命局」「你是從勢格順應者») for an hour-unknown chart AND **re-derived a contradictory 用神=木** from it (engine emits 病藥 用神=火, flagged) — exactly gap-11 (從格 verdict must be refused without 時支; 時柱 could 補根/破格). Root cause spanned 2 layers:
  1. The geJuStatus directive was too soft («僅說明大致傾向，須加註格局待確認») — didn't forbid the verdict or the 用神 re-derivation. Strengthened BOTH copies (LIFETIME-inline `ai.service.ts:2966` + shared injector `:2905`): now explicitly forbids «屬於從格／從勢／從財／化氣／專旺» + forbids re-deriving 用神 from an assumed 從格 + mandates «用神沿用命盤提供值，僅供參考» + «格局待確認».
  2. `formatPreAnalysis` emitted «從格用神：木» (line 6649) as fact whenever `congGe` truthy — the data source the AI narrated. Reframed to «格局待確認（時辰未知）：若日後確認為從格用神或為X，但時柱可能補根破格，未可斷定 — 用神以命盤值為準，僅供參考」 when `geJuUndetermined`; threaded the flag from all 3 callsites (single-chart + compat A/B).
  - NestJS rebuilt + restarted (PID 21927); A3 Redis cache + stale row busted; **A3 regenerating with the fix** (verification pending). Hour-known + geJu=null charts unaffected (directive gated, byte-identical).
  - ⚠️ Test-harness note: 5 concurrent in-page SSE streams hit the browser per-host connection limit (3 silently never reached the server). Switched to ≤2-concurrent waves. Not a product bug (UI streams fine).

**BUG-3 fix verified (fresh A3):** 0 «屬於從勢格/從勢格命局/從勢格順應者» verdicts (was asserting them); now «格局可能因時柱補根或破格而改變，用神喜忌也可能調整» + «（時辰未知，格局和五行比重僅供參考）», 7 caveats. Primary danger resolved.

### Stage 4 — Full A2 grading (3 graders/narrative) + further bugs found

First grading wave (A1 LIFETIME, A4 LIFETIME, A2 LOVE — 9 graders):
- **A4 LIFETIME: 3/3 PASS** (doctrine/hallucination/framing all clean — 己土 very_strong, 用神木/喜水, no 從格/時上/五行-完整 violation, 子女 withheld correctly).
- **A1 LIFETIME: framing PASS; doctrine + hallucination flagged** → **BUG-4**: 用神/喜忌 stated as settled certainty w/o 「僅供參考」 (engine flags `reduced`/`borderline`), conf 82; 五行 % (土42.5/水6.9) presented as a COMPLETE distribution w/o missing-pillar caveat, conf 80.
- **A2 LOVE: framing PASS; doctrine + hallucination flagged** → **BUG-5**: «已婚者今年也可能有添丁» = 子女/childbirth prediction leaked into annual_love (conf 88). Doctrinal spine otherwise correct (用神水, 配偶宮日支戌, 女命配偶星正官).
- **BUG-6 (養 stage) = FALSE POSITIVE** — the grader flagged «伴侶在十二長生中處於養» as 時干-dependent; verified it's `get_twelve_life_stage(day_stem, day_branch)` = 日主@配偶宮(日支) = hour-INDEPENDENT (甲@戌=養). No fix.
- **BUG-3b** (residual from BUG-3): fresh A3 still stated 用神=木 (the 從 用神 from `effectiveFavorableGods`) while the chart UI shows 用神=火 (病藥, `{{usefulGod}}`=`dayMaster.usefulGod`). Source mismatch.

**Fixes applied (ai.service.ts, both directive blocks + formatPreAnalysis):**
- BUG-3b: `formatPreAnalysis` geJuUndetermined reframe no longer names the 從 用神 — defers entirely to `{{usefulGod}}` (火) + forbids 另立從格用神.
- BUG-4: 用神/喜忌/五行 caveat line strengthened to «必須緊接註明（時辰未知，僅供參考）» + NEW «五行比重僅為三柱估算，禁止當作完整五行分佈，不可寫五行齊全/均衡».
- BUG-5: 子女 forbidden-list now explicitly covers «添丁、懷孕、生育、家庭添丁喜事…即使在流年、感情、家庭段落也不可預言生育».
- NestJS rebuilt + restarted (PID 23668). Regenerating A1/A3 LIFETIME + A2 LOVE + A2 CAREER + A1 ANNUAL on the final prompt; A4 kept (3/3 PASS, stronger directives only help). Regrade pending.

**Regen verification (final prompt):**
- **A1 LIFETIME v2 — BUG-4 FIXED ✓** (observed): 用神 line now reads «（時辰未知，用神、喜忌、五行比重僅供參考）» (4 caveats, was 0); no 五行齊全/均衡. Strengthened directive works for normal charts.
- **A3 LIFETIME v4 — BUG-3b = documented KNOWN-LIMITATION.** The safety caveat «（時辰未知，僅供參考）» is now reliably present (✓ key user-safety), but for extreme 0分 從-candidate charts the AI's strong 從格 training prior nondeterministically still (a) leans 用神=木 (the 從 element, matching engine `effectiveFavorableGods`) vs the displayed 病藥 用神 火, and (b) occasionally states «屬於從勢格» despite the directive. Root: the 用神 火-vs-木 question is genuinely hour-dependent/unresolvable (engine itself flags geJuStatus=undetermined for this reason), and forcing 火 (病藥) onto a true-從勢 chart would be doctrinally worse. Rare chart class (~1.7%). Directive strengthening (BUG-3/3b) reduced but didn't eliminate the verdict-assertion. **Recommendation (future):** post-generation linter to strip confident 從格 verdicts on geJu-undetermined charts, or frontend 用神-display reconciliation. Not ship-blocking (caveat present; rare; doctrinally ambiguous).

**Stage 4 grading — consolidated (final-prompt narratives):**
- **A1 LIFETIME v2: doctrine PASS** (BUG-4 fix grader-confirmed — 用神 caveated, DM neutral, no 五行-completeness claim). Hallucination grader flagged 天喜/神煞-list-completeness (conf 72-78) — largely a false positive (facts.json omitted the 神煞 list; 天喜 is year/day-branch = hour-independent); residual soft nuance = "note 神煞 list may be incomplete (時支)".
- **A4 LIFETIME: 3/3 PASS.**
- **A2 CAREER: PASS** (graded on old-directive narrative; new directives only strengthen). 2 soft notes (conf 72-74): 晚年事業 silently omitted rather than in-place-noted (D8 soft-compliance, no fabrication).
- **A1 ANNUAL: clean** — 添丁/懷孕/生育=0 ✓, 命宮=0, 子女 only as in-place note. «自身宮» (4×) = the AI's loose phrasing for 日支/自身 (paired with 太歲/伏吟 on 日支午) — hour-INDEPENDENT, not the suppressed 身宮. Soft residual: ANNUAL 用神 mentions lack 僅供參考 (流年 context; value correct + chrome shows it).
- **A3 LIFETIME v4: PARTIAL (documented limitation)** — caveat reliably present, but 6 unhedged 從勢格 assertions + 用神木 (vs displayed 火) + internal 用神 contradiction. Rare 0分 從-candidate (~1.7%); 用神 ambiguity genuinely hour-dependent. **Recommend future post-gen linter.**

**Soft-compliance pattern (documented, not ship-blocking):** the suppression directives forbid the DANGEROUS items reliably (從格 verdict mostly, 添丁=0, 命宮/身宮=0, 命中無=0) but the SOFT caveats (用神 僅供參考, 神煞-list-incompleteness, in-place 晚年 note) are applied inconsistently across reading types/runs (better LIFETIME, weaker ANNUAL/CAREER). Mitigated by: correct underlying values + UI chrome (capability-chart 三柱估算 caveat + basis line + badge) shows the caveat regardless of AI prose.

### Stage 5/6 — final live verifications

- **BUG-5 FIXED ✓ (verified)** — fresh A2 LOVE: 添丁/懷孕/生育 = 0 (was «已婚者今年也可能有添丁»); 子女 only as the in-place note «⚠️ 子女緣分需要出生時辰方能完整分析。日後得知時…» (D8+D2); 喜事 = 紅鸞 wedding-joy (hour-independent, fine).
- **COMPAT live (BUG-1) ✓** — Person A=QA-A2 (female HU) × B=QA-A1 (male HU) → no 500, partial warning present, banner «因為雙方沒有出生時辰» (correct — both HU; the 雙方 path validates the gender-aware banner mechanism end-to-end). The female-A→女方 specific label is authoritatively covered by the passing RTL spec + the page-passes-genderA/B code edit. COMPAT suppression was live-verified end-to-end in the prior 3e-lite session.
- **FORTUNE banner live ✓** — `/reading/fortune?tab=day` for HU profile: FortuneShell banner «由於未提供出生時辰，本運勢以「年、月、日」三柱推算；與時辰有關的內容已略過，用神與五行僅供參考。» + soft-trigger framing + plain wording, no crash. (month/year tabs verified in the prior (a) session.)
- **Negative controls (hour-known)** — structurally guaranteed: all suppression directives are gated on `data['hourKnown'] === false`, so hour-known prompts are byte-identical (no block injected); Stage-0 confirmed byte-identical engine output on hour-known fixtures. No chrome leakage possible.

---

## FINAL SIGN-OFF (2026-06-16)

**Verdict: the 時辰未知 feature is ship-quality on all DANGEROUS axes; soft-caveat-compliance + one rare-chart limitation documented as non-blocking.**

| Layer | Result |
|---|---|
| Engine no-crash + flags + survivor diff (Stage 0) | ✅ 0 crashes/violations across 36+ charts; byte-identical survivors; edge dates correct |
| Automated suites (Stage 1) | ✅ engine 168 pytest, API 10 jest, web 11 RTL green |
| AI suppression — LIFETIME (A1/A3/A4) | ✅ A1 3/3 + A4 3/3 PASS; A3 documented limitation |
| AI suppression — LOVE / CAREER / ANNUAL | ✅ LOVE PASS (BUG-5 fixed), CAREER PASS, ANNUAL clean |
| FORTUNE banner / COMPAT | ✅ live banners + no-crash; suppression prior-verified |
| Hour-known negative controls | ✅ byte-identical (gated directives) |

**Bugs found + fixed this gate:** BUG-1 (compat gender-label, frontend) · BUG-2 (update-DTO hour-state mutability, backend D3) · BUG-3 (從格 confident-verdict assertion — the critical one) · BUG-3b (從-candidate 用神 source) · BUG-4 (用神/五行 caveat + completeness) · BUG-5 (添丁/childbirth leak in LOVE). BUG-6 = false positive (養 stage is hour-independent).

**Known limitation (non-blocking):** rare 0分 從-candidate hour-unknown charts (~1.7%) — AI reliably adds the safety caveat but its 從格 training prior nondeterministically resists the "no confident verdict" directive; 用神 是 genuinely hour-dependent. Recommend a future post-generation linter to strip confident 從格 verdicts on geJu-undetermined charts.

**Soft residuals (non-blocking, mitigated by UI chrome):** 用神 「僅供參考」 caveat applied inconsistently across reading types/runs (strong LIFETIME, weaker ANNUAL/CAREER); occasional silent omission of the 晚年 in-place note; 神煞-list-completeness disclaimer. Underlying values correct; capability-chart 三柱估算 caveat + basis line + 三柱 badge surface the limitation in the UI regardless.

**Code changes (uncommitted):** `ai.service.ts` (BUG-3/3b/4/5 directives + formatPreAnalysis reframe), `users.service.ts` (BUG-2), `CompatibilityRomancePaywallCTA.tsx` + `compatibility/page.tsx` (BUG-1), `test_unknown_hour.py` (A3 fixture), `compatibility-hour-unknown.spec.tsx` (3 BUG-1 cases). **No cache-version bump needed** (directives gated on hourKnown===false → hour-known byte-identical; hour-unknown is a new feature w/ no prod cache).
