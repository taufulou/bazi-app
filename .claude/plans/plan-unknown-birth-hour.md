# Implementation Plan — 八字時辰未知 (Unknown Birth Hour) Support

**Scope:** All **Bazi** features. ZWDS is explicitly **out of scope / being dropped** (no work, no gating — ignore entirely).
**Research basis:** `.claude/plans/research-unknown-birth-hour.md` (gold-standard + competitor + engine-impact memo).
**Status:** Decisions locked with product owner (2026-06-09). Ready to build.

---

## 0. Locked decisions (from sync)

| # | Decision |
|---|---|
| D1 | 時辰未知 is a **first-class input option**. When chosen → an honest **三柱 (年/月/日) reading**. Never silently default to a guessed hour. |
| D2 | **No in-place unlock.** Hour-dependent sections are simply *unavailable*; the only way to see them is a **new reading with the 時辰**. No "補上時辰即可解鎖" CTA. |
| D3 | Hour state is **immutable per profile** — set at creation only. To add/remove an hour → create a new profile. |
| D4 | Input = keep the **exact HH:MM picker** (auto-maps to the correct 時辰, handles boundary cases) **+ a 「時辰未知」 toggle**. (Optionally show the derived 時辰 label as confirmation.) |
| D5 | **No 定盤 / time-rectification feature**, no tiers. 時辰未知 → plain 3-pillar reading. |
| D6 | **Confirmation modal** on (時辰未知 + 開始排盤): lists what will be unavailable; requires explicit acknowledgement before proceeding. |
| D7 | **用神 handling = "A + auto-detect tail"** (classical: 旺衰 led by 月令, hedge only when the hour is decisive). Show 用神 from 3 pillars, flagged 「僅供參考」. Engine escalates: borderline-中和 → stronger caveat; suspected hour-decided special 格局 (從格/化氣/時上格) → **withhold** the definitive 格局 verdict with 「因缺時辰，格局待確認」. |
| D8 | **Locked sections** show a short neutral 「此項需要出生時辰」 note in place (no CTA) + one global hint near the top. Reading feels complete & honest. |
| D9 | **合盤 (compatibility) = allow partial** when one or both lack the hour (day-branch 配偶宮 core survives); flag hour-dependent cross-interactions. |
| D10 | **日/月/年運 fortune = available** for hour-unknown profiles, inheriting the 用神 caveat; drop hour-branch 神煞; day-branch romance/沖日支 logic unaffected. |
| D11 | **ZWDS = ignored entirely** (being dropped; no implementation, no gating). |
| D12 | Reading framing = **header basis line** (「本次以年月日三柱推算，時辰未知」) **+ a subtle 「三柱」 badge** on the reading card. |

---

## 1. Build on the existing pattern (don't reinvent)

The engine already has partial support in the romance/compat path — **generalize it**:

- `packages/bazi-engine/app/compatibility_romance_preanalysis.py`
  - `_hour_is_unknown(chart)` → returns `True` when the hour pillar's **stem is empty** (`stem == ''`). **This is the canonical convention: an empty hour pillar signals "unknown."**
  - Already skips the hour pillar (`if pname == 'hour' and hour_unknown`, `if hour_unknown and i == 3`) and emits `'hourUnknown': hour_unknown` in 3 output blocks.
- `apps/web/app/reading/compatibility/page.tsx` already renders 「（男方時辰未知）」/「（女方時辰未知）」 + 「部分時辰相關分析受限」 from `lovePersonality{A,B}.hourUnknown`.

**Action:** promote `_hour_is_unknown` to a shared util (e.g. `four_pillars.py` or a new `chart_utils.py`) and reuse it everywhere. Keep the **empty-hour-pillar = unknown** convention end-to-end.

---

## 2. Hour-dependent vs hour-independent matrix (engine-grounded)

Verified against actual functions in `packages/bazi-engine/app/four_pillars.py`:

### ✅ SURVIVE (hour-independent)
- 日主 (day stem) + 年/月/日 三柱: 十神, 藏干, 納音, 十二運, 旺相休囚死, 空亡
- 月令格局 (旺衰 anchor — 得令/失令)
- **配偶宮 = 日支** + 配偶星 + 正緣桃花 + 紅鸞 / 沖日支 (all DAY-branch keyed) — **our structural advantage**
- **胎元** — `calculate_tai_yuan(month_stem, month_branch)` → month only ✓
- **胎息** — `calculate_tai_xi(day_stem, day_branch)` → **day pillar only ✓** (resolves the research open-question: 胎息 survives)
- 大運 干支序列 + 順/逆 direction (year-stem yin/yang + gender + month)
- 生肖

### ❌ LOST (null with reason)
- 時柱 stem/branch + 時柱十神/藏干/納音/十二運/空亡
- 子女宮 / 子女運 (= the 時柱)
- 晚年 / 晚運 (~48歲+)
- **命宮** — `calculate_ming_gong(month_branch, hour_branch, year_stem)` needs `hour_branch` ❌
- **身宮** — `calculate_shen_gong(month_branch, hour_branch, year_stem)` needs `hour_branch` ❌
- 時支-keyed 神煞 (金神, 童子煞, 元辰; + 時上格局 時上偏財/時上一位貴/日祿歸時)

### ⚠️ DEGRADED (compute, but flag)
- **用神 / 喜忌 / 五行比重** — recompute on 3 pillars; flag 「僅供參考」; borderline/special detection (D7)
- **大運 起運年齡** — compute from day-to-節氣 using a **noon midpoint** for the missing hour → ≤ ±2 months wobble; sequence is exact. Narratively negligible; no caveat needed beyond the global one.
- **神煞 completeness** — 桃花/驛馬/文昌/天乙貴人 etc. get **false-negatives** when the real hit sits on the missing 時支. Don't assert "命中無桃花"; frame as "就現有三柱而言".

**Net:** ~70–80% of a lifetime reading survives; the lost ~20–30% concentrates in 子女/晚年/命宮·身宮/時柱.

---

## 3. Data model (Prisma)

`apps/api/prisma/schema.prisma` — `BirthProfile`:

```prisma
birthTime   String?  @map("birth_time")   // was: String (HH:MM). Now nullable — NULL when hour unknown.
hourKnown   Boolean  @default(true) @map("hour_known")
```

- New migration `add_hour_known_to_birth_profiles`. Backfill: all existing rows `hour_known = true` (they have a time) — zero behavior change for existing profiles.
- When `hourKnown = false` → `birthTime = NULL`.
- **Null-safety sweep:** every consumer that reads `birthTime` non-null must handle null:
  - `apps/web/app/reading/[type]/page.tsx`, `reading/fortune/page.tsx` (passes `profileBirthTime` to BaziChart/FortuneShell) → render 「時辰未知」 instead of a time string.
  - `BaziChart.tsx` header (`公曆：{birthDate} {time}`) → show 「時辰未知」.
  - NestJS bazi/fortune/chat services that forward birth data to the engine.

---

## 4. Input UX + confirmation modal

**Birth-profile form** (locate the create-profile form under `apps/web/app/dashboard/profiles/` or the profile modal):
- Add a **「時辰未知」 toggle/checkbox** beside the time picker. When ON → disable + clear the time picker; set `hourKnown=false`.
- When a time IS entered, optionally show the **derived 時辰 label** for confirmation (e.g. 「16:11 → 申時 (15–17時)」). Helps boundary cases.
- Validation: time required **unless** `時辰未知` is on.
- Copy near the toggle: 「不確定出生時辰？可先以年、月、日三柱推算。注意：時辰於建立後無法更改。」 (D3 immutability disclosure).

**Confirmation modal** (D6) — fires on submit when `時辰未知` is on:
> **以「時辰未知」建立命盤？**
> 將以 **年、月、日 三柱** 為您推算（約可掌握命局七成）。
> 以下項目因缺少時辰**暫不提供**：
> ・時柱與其十神／神煞　・子女宮與子女運　・晚年運勢　・命宮／身宮
> ・部分與時支相關的神煞　・用神／五行比重將標註「僅供參考」
> 出生時辰於建立後**無法更改**；若日後得知，請另建新的命盤。
>
> 〔取消〕　〔我了解，繼續排盤〕

---

## 5. Engine changes

### 5.1 `four_pillars.calculate_four_pillars`
- Accept `birth_time: Optional[str]` (None ⇒ unknown).
- When None: compute 年/月/日 normally; **emit the hour pillar with empty stem/branch** (`{'stem': '', 'branch': '', ...}`) so the canonical `_hour_is_unknown` convention fires downstream.
- 命宮/身宮: when hour unknown → return `None`/structured-null (don't call `calculate_ming_gong`/`calculate_shen_gong` with an empty branch). 胎元/胎息: compute normally (survive).
- 大運 起運: pass `hour=12:00` midpoint internally for the day-to-節氣 count when unknown (≤±2mo); keep 干支 sequence exact.

### 5.2 Shared helper
- Promote `_hour_is_unknown(chart)` → `four_pillars.is_hour_unknown(chart)` (or `chart_utils`). Refactor the 3 existing callsites to import it. Use it in every pre-analysis module.

### 5.3 五行比重 / DM strength / 用神 (D7)
- `five_elements.py` (`calculate_weighted_five_elements`, `determine_favorable_gods`) + strength tally: **sum 年/月/日 pillars only** when hour unknown (skip hour stem/branch/hidden mass).
- Emit `confidence: 'reduced'` + `hourUnknown: true` on the 五行/用神 output.
- **Borderline detection:** if 3-pillar V2 strength score lands within a margin (e.g. ±5) of a 中和 band boundary → set `yongShenCaveat: 'borderline'` (stronger wording; optionally surface both 「若偏強…/若偏弱…」 用神 candidates).
- **Special-structure detection:** run the existing 從格 detector (`check_cong_ge` / Pattern 3a `check_cong_qiang_or_wang`) + 化氣 check on the 3 pillars. If it fires **or is near-firing** AND the hour could plausibly supply/remove the deciding 根 → set `geJuStatus: 'undetermined_without_hour'`. Downstream: **withhold** the definitive 格局/用神 verdict, show 「因缺時辰，格局待確認」 + the dominant tendency only.

### 5.4 神煞
- Skip 時支 in hour-branch-keyed lookups (金神/童子/元辰). For multi-pillar scans (桃花/驛馬/文昌/貴人), scan 年月日 only and mark the result `partial: true` (so AI says 「就現有三柱」, never 「命中無」).

### 5.5 Pre-analysis pipelines (all 6 reading types)
Thread `hourUnknown` (via the shared helper) into each pipeline and **null/flag** the hour-dependent fields:
- `lifetime_enhanced.py` — null 時柱/子女/晚年 anchors, 命宮/身宮; romance candidates already day-branch (keep); 用神 flag.
- `love_enhanced.py` — 配偶宮/配偶星/婚姻 survive; null 子女 (時柱); spouse-palace friction already day-branch.
- `career_enhanced.py` — 財官/格局 career survive; null 晚年事業/部屬 (時柱); recompute 五行比重/十神比重 on 3 pillars, flag.
- `annual_enhanced.py` — 流年/流月 keyed on 用神 + day-branch survive; drop hour-branch monthly 神煞; inherit 用神 flag.
- `compatibility_*` — already partial; extend to all dimensions (see §7).
- `daily_enhanced.py` / fortune — inherit 用神 flag; drop hour-branch 神煞; day-branch 沖日支/紅鸞 survive.

---

## 6. AI prompt suppression (deterministic, no mass cache bust)

**Critical:** inject the 時辰未知 instructions via the **deterministic injector** (mirror `interpolate{Love,Annual,Fortune}V2Fields`), **NOT** by editing the static prompt templates — so hour-**known** readings keep byte-identical prompts and their caches stay valid (no version bump, no regen spend).

- In each reading's prompt builder: when `hourUnknown` → append a 【時辰未知 — 嚴格限制】 block:
  - 「本命盤時辰未知，僅有年月日三柱。**絕對禁止**描述時柱、時柱十神/藏干/神煞、子女宮、子女運、晚年運勢、命宮、身宮。」
  - 「禁止虛構任何時辰相關內容。用神/五行比重僅供參考，須註明『時辰未知，僅供參考』。」
  - If `geJuStatus == 'undetermined_without_hour'` → 「格局因缺時辰未能確定，僅說明大致傾向，須加註『格局待確認』。」
- Because hour-dependent fields are already structured-null at the pre-analysis layer, the AI has **no data** to narrate them (defense in depth — suppression is enforced, not hoped for, consistent with the existing anti-hallucination discipline).
- **AI Chat:** the chat context is built from the slimmed reading; null hour fields ⇒ chat can't reference them. Add the same suppression line to the chat system block when `hourUnknown`, and a friendly canned answer path for 「為什麼看不到子女運/時柱？」 → explain it needs the 時辰 + suggest a new profile.

---

## 7. Per-reading-type behavior summary

| Reading | Shows (free, valid) | Unavailable (「需要出生時辰」 note) |
|---|---|---|
| **八字終身運** LIFETIME | 三柱命盤, 日主+旺衰, 月令格局, 性格, 財官事業, 大運(序列), 配偶緣(日支), 胎元/胎息, 用神(flagged) | 時柱列, 時柱十神/神煞, 子女宮, 晚年運, 命宮, 身宮 |
| **八字愛情姻緣** LOVE | **配偶宮(日支)+配偶星+正緣桃花+紅鸞/沖日支 — full core**, 性格, 婚姻傾向 | 子女(時柱), 部分晚年婚姻 |
| **事業詳批** CAREER | 財官格局, 事業方向, 五行/十神比重(3-pillar, flagged), 大運事業 | 晚年事業/部屬(時柱), 子女宮 career-late |
| **八字流年運勢** ANNUAL | 流年/流月(用神+day-branch), 大運context, 沖日支 | hour-branch monthly 神煞 (dropped silently) |
| **八字合盤** COMPATIBILITY | partial — see §8 | hour-dependent cross (子女緣/晚年互動) |
| **八字日/月/年運** FORTUNE | day/month/year 用神-driven, 沖日支/紅鸞 (day) | hour-branch 神煞 |

All readings get the **header basis line + 三柱 badge** (D12). 用神 everywhere carries 「時辰未知，僅供參考」 (+ stronger caveat / 格局待確認 per D7).

---

## 8. Compatibility partial (D9)

- Both parties carry independent `hourUnknown` flags (already in `lovePersonality{A,B}.hourUnknown`).
- Day-branch cross logic (配偶宮 互動, 三刑/半刑/子卯刑/六沖/六害 on day branches, 用神 element compat) **survives** for whichever party lacks the hour.
- Per-party caveat already rendered (「（男方/女方時辰未知）」 + 「部分時辰相關分析受限」). Extend that flag-skip to any compat dimension that touches the hour pillar (reuse the `i == 3` skip pattern).
- Compat chat-context + cache key: include each party's `hourUnknown` (order-sensitive key already exists).

---

## 9. Shared UI

- **BaziChart.tsx** — 時柱 column renders a greyed 「時辰未知」 placeholder; 命宮/身宮 cells show the short note. Header time → 「時辰未知」. Use existing `hideSections`/`visibleSections` props to hide hour-dependent sub-blocks.
- **Element Encyclopedia** (`ElementExplanation.tsx`) — clicking a 時柱 / 命宮 / 身宮 cell on an hour-unknown chart shows a friendly 「此欄需要出生時辰」 sheet instead of a normal explanation (no API call). Day/month/year cells unchanged.
- **Day Master Mascot / 角色卡** — needs **only the day stem** → fully works. Surface it prominently; it's a complete, shareable artifact even for hour-unknown users (nice retention win).
- **Reading card / history** — 三柱 badge visible in lists.

---

## 10. Cache / versioning / deploy

- Hour-known readings: **no change** (deterministic injection keeps prompts byte-identical) → existing caches valid, **no regen spend**.
- Bump **pre-analysis versions** for the affected pipelines (LIFETIME/LOVE/CAREER/ANNUAL/COMPATIBILITY/FORTUNE day·month·year) because engine output gains the `hourUnknown`/flag fields — but since hour-unknown is a *new* input state (new chart hash), the practical invalidation footprint is near-zero for existing users.
- Migration: `prisma migrate deploy` for `hour_known` + nullable `birth_time`.
- No new env vars. ZWDS untouched.

---

## 11. Phasing

- **Phase 1 (MVP):** data model + input toggle + confirmation modal + `calculate_four_pillars` hour-unknown path + shared `is_hour_unknown` + 五行/用神 3-pillar + borderline/special detection + BaziChart display + **LIFETIME** reading suppression (engine + deterministic prompt injection) + mascot. → A user can create a 時辰未知 profile and get an honest 八字終身運.
- **Phase 2:** LOVE + CAREER + ANNUAL + FORTUNE suppression + AI chat guard + Element Encyclopedia handling.
- **Phase 3:** COMPATIBILITY partial (generalize the existing flag across all dimensions) + polish + the 神煞 partial-scan refinements.

---

## 12. Risks / open items

1. **用神 wrong-not-just-imprecise on edge charts** — mitigated by D7 borderline + special-structure detection + 「格局待確認」 withholding. Tune the borderline margin against a few known special-structure charts (從格/化氣) before ship.
2. **Null `birthTime` sweep** — audit every consumer (web display, NestJS forwarders, chat context, share cards) for null-safety; a missed one renders 「undefined」 or crashes.
3. **早子時/晚子時 day boundary** is moot here (we never guess 子時 for unknown) — but the *known*-hour path still uses wall-clock (True Solar Time DISABLED); unchanged by this work.
4. **神煞 false-negatives** — never let the AI say 「命中無X」 for hour-scannable 神煞; enforce 「就現有三柱」 framing via the `partial` flag + prompt clause.
5. **起運年齡 ±2mo** — acceptable; if a future feature needs exact decade-turnover dates, revisit.
6. **Test corpus** — add hour-unknown fixtures (Roger & Laopo with `birthTime=None`) asserting: empty hour pillar, 命宮/身宮 null, 胎元/胎息 present, 用神 flagged, romance/配偶宮 intact, no absolute-language leakage, AI never narrates 時柱.

---

## 13. Key files

- Engine: `four_pillars.py` (calculate_four_pillars, ming/shen gong, tai_yuan/tai_xi), `five_elements.py` (用神/五行 + cong detector), `compatibility_romance_preanalysis.py` (`_hour_is_unknown` → promote), `lifetime_enhanced.py`, `love_enhanced.py`, `career_enhanced.py`, `annual_enhanced.py`, `daily_enhanced.py`, `shen_sha.py`.
- API: `apps/api/prisma/schema.prisma` (BirthProfile), bazi/fortune/chat services + prompt builders (deterministic `hourUnknown` injection), `prompts.ts` (injector clauses, not static templates).
- Web: birth-profile form + confirmation modal, `BaziChart.tsx`, `ElementExplanation.tsx`, `reading/[type]/page.tsx`, `reading/fortune/page.tsx`, `reading/compatibility/page.tsx` (already partial), reading cards/badges, mascot card.
