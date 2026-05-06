# Bazi SaaS Platform — Project Context

## What is this?
AI-powered Bazi (八字) + ZWDS (紫微斗數) fortune-telling SaaS platform. Two-layer architecture: Python deterministic Bazi calculation + iztro ZWDS calculation + Claude AI interpretation with structured JSON output supporting preview/full per section for paywall.

## Tech Stack
- **Monorepo**: Turborepo + npm workspaces
- **Web**: Next.js 16 (App Router, port 3000)
- **Mobile**: React Native Expo (expo-router)
- **API**: NestJS 11 (TypeScript, port 4000)
- **Bazi Engine**: FastAPI Python (port 5001)
- **Database**: PostgreSQL 16 + Prisma v6 ORM
- **Cache**: Redis 7
- **Auth**: Clerk
- **Node**: v22 LTS (`/opt/homebrew/opt/node@22/bin`, must prepend to PATH)

## Project Structure
```
apps/web/     — Next.js 16 (ClerkProvider, warm light theme, zh-TW)
apps/api/     — NestJS 11 (28+ endpoints, Clerk JWT guard, Swagger)
apps/mobile/  — Expo React Native
packages/shared/      — TypeScript types + constants
packages/bazi-engine/  — Python FastAPI (calculator, pre-analysis, 451 tests)
packages/ui/          — Shared React UI components
docker/               — Dockerfiles + docker-compose
```

## Key Commands
```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run dev               # Start all apps (turbo)
npm run dev:web           # Web only (localhost:3000)
npm run dev:api           # API only (localhost:4000)
npm run build             # Build all
npm run db:migrate        # Prisma migrate dev
npm run db:seed           # Seed database

# Bazi Engine
cd packages/bazi-engine && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 5001 --reload
python -m pytest tests/ -v
```

## Database
- 14 models, 11 enums in `apps/api/prisma/schema.prisma`
- PostgreSQL user: `bazi_user` / database: `bazi_platform`
- PostgreSQL@15 (not @16 — @16 has startup errors on this machine)

## Design Theme & Visual Direction

### Design Philosophy
**Premium, Elegant, Modern with Traditional Chinese Elements** — The platform targets a discerning Chinese-speaking audience (Taiwan, Hong Kong, Malaysia). The design conveys trustworthiness, cultural authenticity, and sophistication. Primary language: zh-TW.

- **Premium**: Clean layouts, generous whitespace, subtle shadows, high-quality typography
- **Elegant**: Warm color palette (reds, golds, ambers), refined borders, smooth animations
- **Modern**: Rounded corners (16px cards), CSS Modules, responsive mobile-first design
- **Traditional touch**: Noto Serif TC for headings/CJK characters, red-gold gradient accents inspired by Chinese fortune-telling aesthetics, decorative diamond (◆) ornaments

### Design Reference
- **`docs/design-preview.html`** — The canonical design system reference. All new UI components and pages should visually align with this file's patterns, spacing, colors, and component styles. Open it in a browser to see the full design system.
- **Styling**: CSS Modules only (no Tailwind). All variables defined in `apps/web/app/globals.css`.

### Color System (Warm & Inviting Theme)
Migrated from dark theme (`#1a1a2e`) to warm light theme. All CSS variables in `apps/web/app/globals.css`.

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#FFF3E0` | Page background (warm cream) |
| `--bg-secondary` | `#FFFBF5` | Subtle alternate background |
| `--bg-card` | `#FFFFFF` | Card/section backgrounds |
| `--color-red` | `#E23D28` | Primary accent, CTAs, hero gradients |
| `--color-gold` | `#D4A017` | Decorative accents only (NOT text on light bg — fails WCAG) |
| `--color-orange` | `#F5A623` | Gradient endpoint, warm accents |
| `--text-primary` | `#3C2415` | Main body text (dark brown) |
| `--text-secondary` | `#6B5940` | Secondary/muted text |
| `--text-accent` | `#C41E3A` | Section titles, emphasis (crimson) |
| `--text-muted` | `#8B7355` | Tertiary text, captions |
| `--border-light` | `rgba(212,160,23,0.15)` | Subtle card/table borders |
| `--shadow-warm` | `0 4px 20px rgba(226,61,40,0.08)` | Card elevation |

### Five Element Colors (Bazi Chart)
Darker, richer colors optimized for light backgrounds (defined in `BaziChart.tsx` as `CHART_ELEMENT_COLORS`):

| Element | Color | Hex |
|---------|-------|-----|
| 木 Wood | Dark green | `#2E7D32` |
| 火 Fire | Dark red | `#D32F2F` |
| 土 Earth | Brown | `#8D6E63` |
| 金 Metal | Dark gold | `#B8860B` |
| 水 Water | Dark blue | `#1565C0` |

These colors are used consistently across the Bazi table, Five Elements rings, Day Master analysis, and Luck Periods sections.

### Typography
- **Headings / CJK characters**: `Noto Serif TC` (serif) — conveys traditional authority
- **Body text**: System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- **Section titles**: `--text-accent` (#C41E3A) with left red border accent

### Key UI Patterns
- **Cards**: White bg, 16px border-radius, warm shadow, gold-tinted borders
- **Gradient headers**: Red→orange linear gradients for hero banners and section headers (e.g., ◆八字命格◆)
- **Pill tags**: Small rounded tags with subtle background tint + border (e.g., 生肖 zodiac labels, 神煞 tags)
- **Tables**: Edge-to-edge within cards (no padding gap), warm cream header row (#FFF8F0)
- **God tags**: Color-coded pills — green (喜神), blue (用神), grey (閒神), red (忌神), purple (仇神)
- **SVG ring charts**: Animated progress rings for Five Elements with subtle grey background track
- **Staged reveal**: Sequential section loading animation with contextual Chinese loading messages

### ZWDS Visual Distinction
ZWDS (紫微斗數) sections use a purple accent to differentiate from Bazi's red-gold theme:
- `--color-zwds`: `#8B5CF6` (purple)
- `--color-zwds-bg`: `rgba(139,92,246,0.08)`

## Important Notes
- Docker NOT available — use Homebrew services (PostgreSQL, Redis)
- Prisma v6 (not v7) — v7 has breaking constructor changes
- Entertainment disclaimer required: 「本服務僅供參考與娛樂用途，不構成任何專業建議」
- AI fallback chain: Claude Sonnet 4.5 → GPT-4o → Gemini 2.0 Flash
- True Solar Time DISABLED — wall clock time used for all pillar calculations
- Styling: CSS Modules (no Tailwind)

## AI Interpretation Layer (Critical Rules)
- **Three-layer architecture**: Python Engine → Python Pre-Analysis → AI Narration
- **Core principle**: Compute interpretive insights deterministically, then let AI narrate. Never rely on AI to "know" Bazi rules.
- **DB templates deactivated**: All 48 rows `is_active=false` — uses hardcoded `prompts.ts`
- **After ANY prompt change**: Clear Redis (`redis-cli FLUSHALL`) + DB cache + rebuild NestJS
- See `docs/ai-prompt-engineering.md` for full rules, placeholders, anti-hallucination constraints, and validation methodology

## Phase Status
- ✅ Phases 1-11 complete (Foundation → Bazi Engine → AI → Frontend → Admin → ZWDS → Profiles → Wiring → Monetization → Bazi Interpretation Enhancement)
- ✅ Phase 12 / 12b / 12c complete (用神 cascade, monthly forecast refinements)
- ✅ Phase 12d complete (用神 validation gate fixes — 6 patterns; 5 default ON, 1 flag-OFF default)
- ✅ Phase 12e complete (Pattern 12e-B — non-month 比劫祿/羊刃 V2 boost; noble3 + shishang_strong reclassified as doctrinal splits — 用神 agreement 96% → 98% under `--accept-doctrinal-splits`)
- ✅ Phase 12f complete (BAZI_USE_WEIGHTED_IMBALANCE flag flip default ON)
- ✅ Phase 12g complete (Love reading doctrine fixes — 6 fixes covering 官殺混雜 cross-module canonical helper, 傷官見官 layered+favorability, 流年配偶星 archetype labels, 沖宮 bidirectional valence, polarity-aware ten-god personality library, structured spouse output)
- ✅ Phase 12g.6 complete (Love reading polish — Gap 1: `personalityDimensions` reaches AI prompt via `interpolateLoveV2Fields` injector; Gap 2: deterministic 傷官見官 「現行大運(YYYY-YYYY 干支)期間…」 sentence injection (replaces prompt-rule strengthening theater); Gap 3: `check_branch_friction` helper extension to 半刑/六破 detection on 配偶宮 + new `meta.natalFrictions` field with legacy `natalHarm` alias)
- ✅ Phase 12g.7 complete (Code-review polish, 4 issues + 1 missed bug — Issue 1: `PROTECTED_HIGH_PRIORITY` typo `'偏緣年'`→`'偏緣動年'` (5 locations); Issue 2: removed legacy 六害 prompt-side double-injection at `ai.service.ts:3849`; Issue 4: split prompts.ts:2634 rule (比劫奪財 + 傷官見官-defer-to-Gap-2); Issue 5: rephrased `informational_notes` rule to match actual injected Chinese label; Issue F (NEW from review): gated legacy `⚠️ 傷官見官：` directive emission on `transientActivations.dayun` presence — fixes contradiction with Gap 2 rule for latent-only charts)
- ✅ Phase 12h.A complete (Palace cleanup + 三刑 transit — Item 4: removed `meta.natalHarm` legacy alias (top-level + meta); Item 5: removed `palace['kongWang']` fallback at ai.service.ts:3848 (engine emits `isKongWang` only); Item 6: full 三刑 transit upgrade on spouse palace via `check_sanxing_with_pool` reuse — when day_branch ∈ {寅,巳,申,丑,戌,未} AND a natal pillar branch is part of a 三刑 group AND LP/LY supplies the 3rd branch, escalate `half_punishment` → `three_punishment_via_transit` (severity 80 vs 60) with window markers)
- ✅ Phase 12h.B complete (Doctrine framing parity — Item 2: 傷官見官 favorability propagation across `annual_enhanced.py:759` (4-arm dispatch) + 3 sites in `compatibility_romance_preanalysis.py` (763, 1248, 1430) — when 正官 is 忌神/仇神, 傷官 制官 reverses to beneficial per 三命通會 「如官為忌，傷官見官反以吉論」; Item 8: 比劫奪財 deterministic framing parity — 3-state valence (harmful/beneficial/neutral) + DM-weak suppression (valence='not_applicable') + gender dispatch (男命 妻緣 + 財產; 女命 財產/姊妹 only, NOT 損夫) + transient framing block in `interpolateLoveV2Fields`)
- Phase 12i candidates (deferred from 12h): centralized `chart_doctrine.py` extraction; deprecate `love_enhanced.py` legacy `challenges[].guanCount`/`shaCount` fields after frontend migration; fix `palace.kongWang` legacy reads in any remaining frontend consumers; add post-generation narrative linter for AI compliance signal; inject machine-readable `[doctrine: <type>]` markers alongside Chinese labels for stable prompt-rule matching (Phase 12g.7 review Issue B); annual_enhanced harmonize 傷官見官 detection from presence-based to transparency-weighted (Phase 12h V1 review Issue #10); calibrate `total_yin_weight >= 3.0` threshold against 10-chart corpus (Phase 12h V2.1 NEW-3); Phase 12d Pattern 3a flag flip after Bazi-master audit (categorical breakers + threshold tightening before flag-on); make `compute_spouse_star_analysis` / `compute_marriage_palace_analysis` call `_normalize_effective_gods` defensively at entry (currently normalization happens only in `compute_full_love_analysis` wrapper at love_enhanced.py:2840 — direct callers passing raw `{idleGod, ...}` dicts get every element resolved to '閒神' default, masking 傷官見官 favorability dispatch — discovered Phase 12h post-deploy verification 2026-05-06)

## Test suite sizes
- Bazi Engine: ~2173 (Phase 12h.A + 12h.B additions: 6 PR-A Item 6 三刑 transit regressions + 5 PR-B Item 8 比劫奪財 valence/gender + 3 PR-B Item 2 傷官見官 valence dispatch + 2 natalHarm canonical migration regressions + retained 12g.7 baseline, 5 xfail, 1 skip, 1 pre-existing fail unrelated) | NestJS API: 692 | Frontend: 143 | ZWDS: 289
  - 5 xfailed: 4 Phase 12d Pattern 1 doctrinal regressions + 1 Phase 12f BAZI flag flip cascade (`test_bigs_wang_palace_clashes_severe`) in `test_compatibility_gold_standard.py`. All same doctrinal-regression class — Pattern 1 / Fix 1a 用神 reclassification cascading into compat scoring.

## Reading Types
18 total: 6 Bazi + 10 ZWDS + 2 Special. Credits: 1-3 per reading. See `docs/monetization.md` for pricing.

## Worktree Development Guide
When working in a git worktree (`.claude/worktrees/`):

**IMPORTANT**: `npm install` fails in worktrees due to Clerk postinstall ESM errors. Use symlinks instead.
**IMPORTANT**: `npx` often fails with `spawn sh ENOENT` in Claude Code shell. Always use direct binary paths.

### 1. Setup worktree (symlinks + env files)
Run all of these before starting any server. `$WT` = worktree root, `$MAIN` = main repo root.
```bash
MAIN="/Users/roger/Documents/Python/Bazi_Plotting"
WT="$MAIN/.claude/worktrees/<worktree-name>"

# Copy env files
cp "$MAIN/apps/web/.env.local" "$WT/apps/web/.env.local"
cp "$MAIN/apps/api/.env" "$WT/apps/api/.env"

# Symlink node_modules (DO NOT run npm install — it fails on Clerk postinstall)
ln -sf "$MAIN/node_modules" "$WT/node_modules"
ln -sf "$MAIN/apps/api/node_modules" "$WT/apps/api/node_modules"
ln -sf "$MAIN/apps/web/node_modules" "$WT/apps/web/node_modules"

# Symlink Python venv
ln -sf "$MAIN/packages/bazi-engine/.venv" "$WT/packages/bazi-engine/.venv"
```

### 2. Generate Prisma client
Must use direct binary path (npx fails). Run from `apps/api/`:
```bash
cd $WT/apps/api
../../node_modules/.bin/prisma generate
```
`npx prisma@6 generate` will NOT work — use the binary path above.

### 3. Start Bazi Engine (port 5001)
```bash
cd $WT/packages/bazi-engine && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 5001 --reload
```

### 4. Start NestJS API (port 4000)
Must build first, then run with tsx loader. Always export ANTHROPIC_API_KEY from .env (Claude Code sets it empty in shell).
```bash
cd $WT/apps/api
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
export ANTHROPIC_API_KEY="$(grep ANTHROPIC_API_KEY .env | cut -d= -f2)"
../../node_modules/.bin/nest build
node --import tsx dist/main.js
```
The `tsx` loader resolves extensionless `.ts` imports in `@repo/shared`. Other approaches fail — see `docs/phase-details.md` for details.

### 5. Start Next.js (port 3000)
```bash
cd $WT/apps/web
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx next dev --port 3000
```

### 6. Verify all servers
```bash
lsof -iTCP:3000 -iTCP:4000 -iTCP:5001 -sTCP:LISTEN -P
```

### 7. Kill all servers
```bash
kill $(lsof -ti:3000) $(lsof -ti:4000) $(lsof -ti:5001) 2>/dev/null
```

### 8. PostgreSQL CLI
```bash
/opt/homebrew/opt/postgresql@15/bin/psql -U bazi_user -d bazi_platform
```

## Server Troubleshooting

**Next.js stuck/unresponsive (most common issue):**
Turbopack crashes every 15-30 min under active dev. Quick fix:
```bash
kill -9 $(lsof -ti:3000) 2>/dev/null; sleep 2; cd apps/web && npx next dev --port 3000
```

**ANTHROPIC_API_KEY not picked up from .env:**
Claude Code sets empty `ANTHROPIC_API_KEY=` in shell env. Fix:
```bash
export ANTHROPIC_API_KEY="$(grep ANTHROPIC_API_KEY apps/api/.env | cut -d= -f2)"
node --import tsx dist/main.js
```

**Port already in use:** `lsof -iTCP:PORT -sTCP:LISTEN -P` then `kill $(lsof -ti:PORT)`

**npx fails with `spawn sh ENOENT`:** Use direct binary paths: `node_modules/.bin/jest`

**`@repo/shared` exports missing at runtime (e.g. "Export X doesn't exist in target module"):**
The `node_modules/@repo/shared` symlink can drift to point at a stale worktree's `packages/shared` (instead of main's), masking newly-added exports. After adding a new export to `packages/shared/src/constants.ts`, if the dev server reports it missing, repoint the symlink:
```bash
ln -sfn ../../packages/shared /Users/roger/Documents/Python/Bazi_Plotting/node_modules/@repo/shared
```
Then restart Next.js. Caused by past worktree-symlink workarounds; check with `ls -la node_modules/@repo/shared`.

**Header credit badge / `/api/users/me` calls silently fail (no badge in DOM, no error in console):**
CORS hostname mismatch. If the browser is on `http://127.0.0.1:3000` (used to dodge HSTS HTTPS-upgrade) but `CORS_ORIGINS` in `apps/api/.env` only lists `http://localhost:3000`, the cross-origin fetch is blocked by the browser. CreditBadge swallows the error in its catch block and returns `null` — no visible failure. Fix: ensure both origins are allowed in `apps/api/.env`:
```
CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000,http://localhost:8081"
```
Then restart Nest. Verify with: `curl -X OPTIONS http://localhost:4000/api/users/me -H "Origin: http://127.0.0.1:3000" -H "Access-Control-Request-Method: GET" -i | grep -i access-control` — should echo back the 127.0.0.1 origin.

## E2E Testing with Clerk Auth
Clerk cannot be mocked at the API level in Playwright because the SDK validates JWT signatures internally. The workaround is a **cookie-based E2E auth bypass**:

1. **Compatibility page** (`apps/web/app/reading/compatibility/page.tsx`) checks for `__e2e_auth=1` cookie and bypasses `useAuth()` when set
2. **Playwright tests** set this cookie via `page.context().addCookies()` before navigation
3. **API mocks** use route interception — actual NestJS URLs:
   - User profile: `/api/users/me`
   - Birth profiles: `/api/users/me/birth-profiles`
   - Comparisons: `/api/bazi/comparisons`
   - Recalculate: `/api/bazi/comparisons/:id/recalculate`
4. **Playwright config**: Use `playwright-minimal.config.ts` (no `webServer` block) when servers are already running. The default `playwright.config.ts` tries to auto-start `npm run dev:web` which may hang due to `spawn sh ENOENT`.
5. **Run E2E tests**: Start servers first, then:
   ```bash
   ./node_modules/.bin/playwright test e2e/compatibility.spec.ts --config=playwright-minimal.config.ts --reporter=line
   ```

## Known Issues
- Clerk deprecated props: migrate `afterSignInUrl`/`afterSignUpUrl` to `fallbackRedirectUrl`/`forceRedirectUrl`
- Clerk phone set to "required" — blocks Google sign-in. Change to "optional" in Clerk Dashboard
- Next.js 16 middleware convention deprecated, should use "proxy"
- ZWDS AI readings still use mock data until ZWDS prompts get anti-hallucination treatment
- `@repo/shared` runtime issue: NestJS files must NOT import from `@repo/shared` at runtime

## Detailed Documentation (read on demand)
- `docs/design-preview.html` — **Canonical design system reference** (open in browser). All UI components should match this file's visual patterns, colors, spacing, and component styles
- `docs/ai-prompt-engineering.md` — Anti-hallucination rules, prompt placeholders, validation, cache clearing
- `docs/monetization.md` — Competitor pricing, 5 revenue streams, subscription plans, content access matrix
- `docs/phase-11-bazi-interpretation.md` — Three-layer architecture, engine bugs fixed, pre-analysis rules, domain mapping
- `docs/phase-12-specs.md` — 三合/三會 scoring, 從格+三合 detection, 生化鏈 analysis
- `docs/future-enhancements.md` — Phase 13 deep pre-analysis for AI consistency
- `docs/phase-details.md` — Phase 5/10 implementation details, frontend UI components, ZWDS engine
- `docs/career-reading-research.md` — **事業詳批 research findings, calculation strategy & decisions** (weight systems, 格局-conditional scoring, 大運+流年 matrix, 財庫逢沖開庫, career shensha, classical source validation). Implementation plan: `.claude/plans/radiant-petting-frost.md`

---

## 事業詳批 Calculation Strategy — Differences from 八字終身運

The career reading (事業詳批) introduced several calculation refinements that differ from the original 八字終身運 (lifetime reading). These are documented here so future sessions can evaluate whether to backport them to 八字終身運.

### Shared Constants (affect BOTH readings)

These constants in `constants.py` are shared across all reading types. Changes here affect 八字終身運 too:

| Constant | Old Value | New Value (R5) | Rationale |
|----------|-----------|----------------|-----------|
| `HIDDEN_STEM_WEIGHTS` (藏干比重) | 60/20/20 (本氣/中氣/餘氣) for 3-stem branches | **60/30/10** | Mainstream 子平 standard (邵偉華, 易子力量計分法). Old 60/20/20 incorrectly equalized 中氣 and 餘氣. |
| `SEASON_MULTIPLIER` (旺相休囚死) | 旺=1.8, 相=1.4, 休=1.0, 囚=0.7, 死=0.5 (ratio 3.6×) | **旺=1.5, 相=1.3, 休=1.0, 囚=0.8, 死=0.6 (ratio 2.5×)** | Old 3.6× spread over-distorted ten god distribution (e.g., 食神 inflated to 50.1% vs expected ~38%). Calibrated against Seer app and 易子力量計分法. |
| Fallback weight (`else 0.2`) | 0.2 in 5 locations | **0.1** | Defensive alignment with 餘氣=0.1 standard. Locations: `five_elements.py` (3×), `ten_gods.py` (1×), `interpretation_rules.py` (1×). |

**Impact on 八字終身運**: Roger's DM strength dropped from 40.6 (中和) → 39.0 (偏弱) after R5. This is because 戊(DM) as 餘氣 in 申 branches lost weight (0.2→0.1). The classification change cascades into personality anchors and finance pattern archetypes. All affected tests were updated.

### Career-Specific Calculations (NOT in 八字終身運)

| Feature | Career (事業詳批) | Lifetime (八字終身運) | Consider Backporting? |
|---------|------------------|---------------------|----------------------|
| **Weighted Five Elements (五行比重)** | `calculate_weighted_five_elements()` — 4 pillars + extra pillars at 0.5× + seasonal multiplier + 地支合沖 adjustment. Displayed as bar chart with seasonal subtitle. | `calculate_five_elements_balance_seasonal()` — 4 pillars only with seasonal multiplier. Displayed as ring chart. | Maybe — the extra pillar inclusion and 地支合沖 adjustment could improve lifetime's ring chart accuracy |
| **Weighted Ten Gods (十神比重)** | `calculate_weighted_ten_gods()` — **4 pillars only** (no extra pillars, conservative/traditional) + seasonal multiplier + 地支合沖 adjustment. | Not computed — lifetime uses raw `get_ten_god_distribution()` count only. | Maybe — could add as a new deterministic section |
| **Career Scoring Functions** | Use **raw ten god count** (presence + position) for classical analysis — NOT weighted percentages. Seasonal influence enters indirectly through 用神/忌神 system and sub-score seasonal lookups. | Similar approach via narrative anchors — presence-based, not percentage-based. | N/A — same philosophy |
| **Monthly Forecasts** | **Independent assessment** per month (R4-5). Each month's auspiciousness is self-contained based on its ten god + branch interactions (伏吟/六合/六沖). Annual context shown as reference only. | N/A — lifetime doesn't have monthly forecasts. | N/A |
| **Annual Forecasts** | **大運+流年 combined matrix** with nuanced labels (大吉/吉/吉中有凶/平/小凶/凶中有吉/凶中帶機/凶/大凶). Uses element role (用神 vs 喜神) for finer grading within 凶中有吉. | Lifetime has annual stars but simpler auspiciousness. | Yes — the nuanced matrix and 大運+流年 combined analysis could improve lifetime's timing section |
| **身宮 (Body Palace)** | Added `calculate_shen_gong()` — shown alongside 命宮/胎元/胎息 in BaziChart. | Not shown (though function exists). | Yes — easy to add to lifetime chart display |

### Key Architecture Decisions

1. **Display (weighted %) vs Analysis (raw count)**: The percentage bar charts (五行比重, 十神比重) are **deterministic display only** — the AI never writes these sections. The AI career analysis functions use raw ten god presence/position, which is the correct classical methodology. This separation is intentional.

2. **Seasonal multiplier scope**: Applied to display charts and 用神/忌神 determination. NOT applied to career scoring functions like positions/entrepreneurship/partnership which use raw counts. This mirrors how traditional masters assess charts — they check "is 七殺 present?" not "what's 七殺's weighted percentage?"

3. **Ten god weights: 4 pillars only**: After competitor analysis (Seer), we confirmed mainstream practice uses 4 pillars only for ten god weights (no 胎元/命宮/身宮). Five element weights DO include extra pillars at 0.5× because element balance assessment traditionally considers the broader chart.

4. **Seer comparison gap**: Our 食神 lands at ~43.8% vs Seer's 38.15% for Roger's chart. The ~5.6pp gap exists because Seer appears to drop 餘氣 entirely (70/30 model for 3-stem branches), while we use the mainstream 60/30/10. Our approach is more defensible but won't exactly match Seer.

### Files Reference
- Shared constants: `packages/bazi-engine/app/constants.py` (HIDDEN_STEM_WEIGHTS, SEASON_MULTIPLIER)
- Career pre-analysis: `packages/bazi-engine/app/career_enhanced.py`
- Career weighted elements: `packages/bazi-engine/app/five_elements.py` → `calculate_weighted_five_elements()`
- Career weighted ten gods: `packages/bazi-engine/app/ten_gods.py` → `calculate_weighted_ten_gods()`
- Full implementation plan: `.claude/plans/radiant-petting-frost.md` (R5 section at ~line 3942)

---

## 八字終身運 Calculation Accuracy — Classical Methodology & Fixes

This section documents the 八字終身運 (lifetime reading) calculation accuracy improvements, validated by comparing engine output against the Seer app and classical Bazi sources (子平真詮, 滴天髓, 窮通寶鑑, AI命理量化推演系统). Reference charts: Roger (丁卯/戊申/戊午/庚申 male) and Laopo (丙寅/辛丑/甲戌/壬申 female).

### 1. 喜用神 — Context-Dependent Assignment (病藥取用法)

**File**: `packages/bazi-engine/app/five_elements.py` → `determine_favorable_gods()`

The engine uses 病藥取用法 (illness-medicine method from 《滴天髓》) for context-dependent 用神/喜神 assignment. Instead of a simple binary rule (weak→用神=比劫), the assignment depends on **what ten god category is causing the imbalance**.

**Decision table — Weak DM:**
| Cause | 用神 | 喜神 | Rationale |
|-------|------|------|-----------|
| 食傷旺 | 印星 (produces_me) | 比劫 (dm_element) | 印 strengthens DM AND restrains 食傷 (印克食傷) |
| 官殺旺 | 印星 (produces_me) | 比劫 (dm_element) | 印 is 通關: converts 官殺→印→DM |
| 財旺 | 比劫 (dm_element) | 印星 (produces_me) | 比劫 directly 克財; 印 cannot restrain 財 |
| General | 比劫 (dm_element) | 印星 (produces_me) | Default rule |

**Decision table — Strong DM:**
| Cause | 用神 | 喜神 | Rationale |
|-------|------|------|-----------|
| 比劫旺 | 官殺 (overcomes_me) | 財 (i_overcome) | 官殺 directly 克比劫 |
| 官殺旺 | 食傷 (i_produce) | 財 (i_overcome) | 食神制殺 |
| 印旺 | 財 (i_overcome) | 食傷 (i_produce) | 財 directly 克印 |
| General | 財 (i_overcome) | 食傷 (i_produce) | Default rule |

Detection uses `_detect_dominant_imbalance()` which sums ten gods by category (`TEN_GOD_CATEGORIES` in constants.py) and picks the highest count. 從格 charts are unaffected (overridden downstream in `generate_pre_analysis()`).

### 2. 有利方位 — 土=南方 (Not 中央)

**File**: `packages/bazi-engine/app/lifetime_enhanced.py` → `ELEMENT_DIRECTION`

Classical rule: 「四柱喜土，有利方位是南方」(火生土). The abstract "中央" is impractical advice. 後天八卦 secondary: 西南(坤) + 東北(艮). All other elements use standard mapping (木=東, 火=南, 金=西, 水=北).

### 3. 大運評分 — Scoring Methodology

**File**: `packages/bazi-engine/app/lifetime_enhanced.py` → `enrich_luck_periods()`

Base 50, with stem/branch/interaction scoring. Key design decisions:

**Branch weighting (35/65 ratio)**: Stem ±12, Branch ±22. Classical consensus: 「大運重地支」(渊海子平, 玉井奧訣, 三命通會).

**三刑 validation**: 3-branch groups (寅巳申, 丑戌未) require ALL 3 branches present across natal + period branches. 巳申 alone is 六合, NOT 半刑. 「巳申單獨出現則論合，寅巳申俱全才論三刑」. Shared helper: `check_sanxing_with_pool()` in `branch_relationships.py` — used by 6 files.

**蓋頭截腳 moderation**: When stem and branch have conflicting god roles AND elements have a 克 relationship (24 of 60 甲子), the total deviation from 50 is moderated:
- Strong conflict (positive vs negative): 60% pull-back toward 50 (`score = 50 + deviation * 0.4`)
- Weak conflict (閒神 involved): 40% pull-back (`score = 50 + deviation * 0.6`)
- Classical: 「逢吉不見其吉，逢凶不見其凶」(《滴天髓》)
- Constants: `GAITOU_SET` (12 stem克branch combos), `JIEJIAO_SET` (12 branch克stem combos)

**天干合 neutralization**: When LP stem forms 五合 with a natal stem:
- 忌/仇 stem neutralized: +8 (pure) / +6 (mixed, natal 喜/用 tied up)
- 用/喜 stem tied up: -8 (pure) / -6 (mixed, natal 忌/仇 also bound)
- 閒神 stem: score based on 合化 produced element's role (+6 for 用/喜, -4 for 忌/仇)
- Uses `STEM_COMBINATION_LOOKUP` from `stem_combinations.py` for produced element

**Other scoring features**:
- Hidden stem scoring: 中氣 ±3, 餘氣 ±1
- Stem-branch internal conversion: +5 (忌生喜轉化) / -5 (喜洩忌仇)
- 自刑 context-aware: +3 (喜用 element amplified) / -8 (忌仇 amplified)
- 半合 detection: ±5 based on formed element's god role

**Best period tiebreaker**: When scores tie, prefer stem=用神 > 喜神 > 閒神 > 仇神 > 忌神 (`STEM_ROLE_PRIORITY` constant).

### 4. 正緣桃花 — Accumulative Signal Scoring

**File**: `packages/bazi-engine/app/lifetime_enhanced.py` → `_compute_romance_candidates()`

Replaced exclusive tier system with **accumulative signal scoring**. Each year accumulates points from ALL matching signals:

| Signal | Points | Classical basis |
|--------|--------|----------------|
| 正財/正官天干透出 | 5 | Spouse star appears — #1 marriage indicator |
| 偏財/偏官天干透出 | 4 | General spouse star |
| 六合日支 | 3 | Spouse palace combined |
| 六沖日支+配偶星 | 3 | 沖開夫妻宮 + spouse star |
| 紅鸞星動 | 2 | Marriage-specific star |
| DM五合 | 2 | Someone coming to join DM |
| 六沖日支 alone | 2 | 沖開夫妻宮 (positive for unmarried) |
| 三合/桃花/天喜 | 1 | General romance signals |
| 配偶星藏干 | 0.5-1 | Hidden spouse star |

**空亡 handling**: Branch signals get ×0.7 multiplier. Stem signals (配偶星天干, DM五合) are NOT reduced — 空亡 only weakens branch qi, not stem energy.

**Backward compatibility**: `tier` key preserved in output via score→tier mapping (score≥4→primary, ≥2→secondary, else supplementary) for `tag_romance_years_with_dayun()`.

### 5. AI Anti-Hallucination Guards

**Spouse star labeling**: Narrative anchor includes explicit rule:
「⚠️ 配偶星=「正財」(男)/「正官」(女)。即使命局中正財/正官為0個，仍須稱配偶星為正財/正官。偏財/偏官只能稱為「情緣星」。」

**五行比例**: AI sometimes fabricates specific percentages (e.g., says 31.2% when actual is 29.3%). The data is provided in the prompt — directionally correct but exact numbers may be hallucinated.

### 6. Validated Against Seer App — Known Differences

Items where **Seer is wrong** (confirmed via classical sources):
- Roger: Seer says "傷官主導" — wrong, chart has zero 辛金(傷官). Correctly 食神格.
- Roger: Seer says "命格五行屬火" — mixes 納音(天上火) with 正五行(戊土).
- Laopo: Seer says "偏財主導" — wrong, 辛(正官)透干 from 丑. Correctly 正官格.
- Laopo: Seer says 2026 is "傷官主運" — wrong, 丙→甲=食神, not 傷官.

Items where **we are more complete** than Seer:
- 事業貴人/配偶生肖: We include 六合 partner + day branch 三合. Seer uses year 三合 only.
- 大運全局: We score all 8 periods. Seer shows current+next only.
- 正緣年數: We show top 5 (scored). Seer shows top 3.

Items where **gap remains** (algorithmic, not conceptual error):
- 大運 scoring gap of ~16 points on certain periods (e.g., Seer 丁酉=53, ours=37). Due to Seer's proprietary algorithm. Our methodology is classically defensible.

### Phase 12d — 用神 validation gate fixes

After the n=50 chart validation harness identified 10 engine bugs in 3 patterns + 11 doctrinal splits, Phase 12d landed 6 commits (Pattern 2c → 2a → 2b → 1 → 3b → 3a). Net 用神 agreement: **58% → 66%** (default flags). Pattern 3a's flag-OFF reserves another +1pp pending Bazi-master review of 4 false-positives.

**Commit-by-commit impact**:

| Pattern | Source | Change | Default | Harness lift |
|---|---|---|---|---|
| 2c | 《滴天髓·地支》| 三合/半合 DM-element credit in V2 dedi | ON | +0pp (building block) |
| 2a/2a' | 《滴天髓·體用》「身強印旺則愈壯」| 比劫 透干 boost when month=印 OR 比劫祿 | ON | +2pp (ma_canzheng) |
| 2b | 《淵海子平·論建祿格》| 月令祿 surround dampener (得令 cut + flat -15) | ON | +2pp (yao_pinwo) |
| 1 | 《子平真詮·論食神》| neutral DM 食傷洩秀 / 食神生財 chain | ON | +4pp (4 named 真詮 cases) |
| 3b | 《滴天髓·化象》| 真化 stem suppression in 從格 (5-cond gate) | ON | +0pp* (anchor flips with new harness flow) |
| 3a | 《滴天髓·順反》| 從強/從旺/一行得氣 detector | **OFF** | -2pp net (ship-blocked) |

*Pattern 3b enables the `anchor_cong_cai_yiwuming` flip; the harness flow update (call `check_cong_ge` first) is part of this commit.

**Doctrinal splits (16 charts after Phase 12e) — accepted ambiguities ("accept either")**:

The following 16 charts in the 50-chart validation corpus produce different 用神 verdicts depending on which classical school is consulted. Engine emits its own school's verdict. Both engine output and corpus label are classically defensible — neither is "wrong." When evaluating future engine accuracy, these charts should NOT count as failures.

Use the `--accept-doctrinal-splits` flag with the validation harness to score correctly:
```bash
python tests/validation/run_imbalance_validation.py --accept-doctrinal-splits
```

Doctrinal-split categories (5 named patterns) and the charts in each:

**Category 1 — 印旺身強 (印 strong + DM strong)**
真詮: 食傷洩秀 (drain via output) | 滴天髓 / engine: 財制印 (財 controls 印)
- `ziping_li_zhuangyuan` (戊戌 乙卯 丙午 乙亥): corpus expects 用=土 (食傷), engine emits 用=金 (財)
- `ziping_niu_jianbo`: corpus expects 用=木 (印), engine emits 用=火

**Category 2 — 財旺弱身 (財 strong + DM weak)**
真詮: 印 priority (財格佩印 — 印 mediates 財-DM conflict) | engine: 比劫 priority (比劫敵財 — 比劫 directly counters 財)
- `ziping_zeng_canzheng` (乙未 甲申 丙申 庚寅) — the 1 (b) regression: corpus expects 用=木 (印), engine emits 用=火 (比劫). Sole "was-right-now-wrong" case.
- `ziping_jin_zhuangyuan`: corpus 用=土 (財), engine 用=木 (印)
- `ziping_wu_bangyan`: corpus 用=金 (食傷), engine 用=土 (比劫)

**Category 3 — 食神生財 / 並用財印**
真詮: 食傷 or 財 (chain rule) | engine: 比劫 (default-weak-general)
- `ziping_yang_dailang`: corpus 用=水 (食傷), engine 用=金 (比劫)
- `dts_hezhi_long2`: corpus 用=火, engine 用=水

**Category 4 — 比劫旺極 (very_strong DM with 比劫 dominant)**
滴天髓 「強者宜洩」: 食傷 outlet | 真詮 「比劫旺取官殺」: engine output
- `dts_hezhi_rich1`: corpus 用=火 (食傷), engine 用=木 (比劫旺)
- `edge_cong_sha_boundary` (辛酉 丁酉 辛酉 戊戌): corpus 用=水 (洩), engine 用=火 (官殺)
- `edge_bijie_strong_jia`: corpus 用=金 (官殺洩 alternate), engine 用=木
- `edge_shishang_strong_jia` (丙寅 甲午 甲寅 丁卯): Phase 12e addition. Pattern 12e-B correctly lifts V2 to strong; Pattern 1 emits 用=食傷洩秀 (滴天髓 doctrine); corpus expects 用=財 (chain when 食傷 saturates 比劫). Both classically defensible.

**Category 5 — 調候 vs 病藥 (seasonal correction vs illness-medicine)**
窮通寶鑑 「夏壬用庚辛」 / 「春甲用丙」 / 「冬丙用甲」: 調候 (warm/cool seasonal need) | engine: 病藥 (structural balance)
Engine surfaces 調候 as advisory only (Phase 12 Fix 2). Promotion to 用神 is future candidate.
- `dts_hezhi_poor1`: corpus 用=火 (調候), engine 用=金 (病藥)
- `qiongtong_ren_summer_needs_geng` (丙午 甲午 壬午 辛丑): corpus 用=金 (夏壬用庚), engine 用=水 (比劫敵財)
- `qiongtong_jia_xiaomu_one_qi` (甲辰 甲戌 甲辰 甲戌, 天元一氣): corpus 用=火 (洩秀), engine 用=木 (比劫)
- `qiongtong_jia_chunmu_jinshi`: corpus 用=金, engine 用=火

**Category 6 (Phase 12e) — 弱身遇官殺: 食神制殺 vs 印化煞**
任鐵樵 prescribes 食傷 (制殺 — drain attacking 官殺 into 食傷) | engine encodes 印化煞 (印 mediates 官殺→印→DM)
- `dts_hezhi_noble3` (甲午 丙寅 辛酉 己丑): corpus 用=水 (癸食傷 制官), engine 用=土 (己印 化殺). Both classically valid for weak DM with 官殺 attacking. Phase A noted corpus's 中和 tag was "not unambiguously supported" by 任's commentary.

These doctrinal splits are NOT bugs. Future engine improvements should not aim to make ALL 16 flip — that would require encoding all 5+ schools' decision trees and toggling between them, which is out of scope. Instead, document them as "accept either" via the `--accept-doctrinal-splits` harness flag and revisit in Phase 12f when school-conditional toggles are designed.

The remaining **1 disagreement that IS an engine bug** (NOT doctrinal, after Phase 12e):
- `ziping_wu_xianggong_qu_zhi` — Pattern 3a fixes this; flag-OFF default pending Bazi-master review of 4 false-positives

(Previously the list had 3 entries; Phase 12e resolved 2 — `noble3` reclassified as Category 6 doctrinal split, `edge_shishang_strong_jia` reclassified as Category 4 doctrinal split. Pattern 12e-B's V2 strength fix is structurally correct for both but Pattern 1's downstream 用神 doctrine paths reveal that these are doctrinal-school disagreements, not pure bugs.)

Per-chart references: `.claude/plans/validation_triage_report.md` (with classical citations) and `.claude/plans/validation_phase_12d_runs.md` (final harness output).

**Pattern 3a default flag-flip blocked on**:
- Bazi-master review of 4 false-positive charts (li_zhifu, edge_cong_sha_boundary, edge_yin_heavy_strong_yi, edge_bijie_strong_jia) where corpus picks non-從格 doctrine despite 比劫+印 dominance
- Threshold re-tuning (V2≥70 + 比劫+印≥70% may need refinement)
- ≥6 months production observation period

**Per-rule env flags**: see consolidated rollback table in the
"Per-rule env flags (rollback path)" section below (covers all phases —
Fix 1a, 12b, 12c, 12d, 12e).

> ⚠️ **DO NOT flip `PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR` to `1`
> without completing all three Phase 12f gates**:
> 1. Bazi-master audit of 4 false-positive charts: `li_zhifu`,
>    `edge_cong_sha_boundary`, `edge_yin_heavy_strong_yi`,
>    `edge_bijie_strong_jia` (where corpus picks non-從格 doctrine despite
>    比劫+印 dominance)
> 2. Threshold re-tuning if false-positives confirmed (V2≥70 + 比劫+印≥70%
>    may need refinement)
> 3. ≥6 months production observation period without complaints
>
> When flag is enabled with current thresholds, harness shows -2pp net
> agreement (1 chart fixed, 4 charts break). The flag is opt-in for a
> reason. Verified at PR #38 / Phase 12d Pattern 3a ship. See
> `.claude/plans/phase_12d_review_v2.md` for the audit context.

**Cache invalidation post-deploy** (preAnalysisVersion bumps required by Phase 12d/12e/12f/12g):
- LIFETIME: v2.4.0 → v2.5.0 (Phase 12d) → v2.6.0 (Phase 12e) → v2.7.0 (Phase 12f) → v2.9.0 (Phase 12g romance archetype + 月令格 personality cascade)
- CAREER: v2.2.0 → v2.3.0 (Phase 12d) → v2.4.0 (Phase 12e) → v2.5.0 (Phase 12f, unchanged in 12g)
- ANNUAL: v2.0.0 → v2.1.0 (Phase 12d) → v2.2.0 (Phase 12e) → v2.3.0 (Phase 12f, unchanged in 12g)
- LOVE: (was using fallback v1.1.0 — Phase 12g.1 added explicit entry) → v1.7.0 (Phase 12g.1-12g.4 cumulative) → v1.8.0 (Phase 12g.6: personalityDimensions + 傷官見官 deterministic framing + natalFrictions injection) → v1.9.0 (Phase 12g.7: PROTECTED_HIGH_PRIORITY 偏緣動年 typo fix + 六害 double-injection removal + 傷官見官 latent gating + prompt rule cleanup) → v1.10.0 (Phase 12h.A: natalHarm removal + kongWang fallback removal + 三刑 transit upgrade) → v1.11.0 (Phase 12h.B Item 8: 比劫奪財 framing parity)
- ANNUAL: v2.3.0 → v2.4.0 (Phase 12h.B Item 2: 傷官見官 favorability propagation in annual_enhanced.py)
- COMPATIBILITY: v1.6.0 → v1.7.0 (Phase 12h.B Item 2: 傷官見官 favorability propagation in compatibility_romance_preanalysis.py 3 sites)
- COMPATIBILITY: v1.5.0 → v1.6.0 (Phase 12g.1 cross-chart 官殺混雜 natal-doctrine suppression)
- Operator runs `redis-cli FLUSHALL` post-deploy
- ⚠️ **Phase 12g deploy cost note**: Bumping LOVE + COMPATIBILITY invalidates ALL cached love/compat readings. For paid-tier readings, regen = real Claude API spend. Operator MUST: (1) confirm with product owner that cache bust is acceptable, (2) stage deploy outside peak read traffic, (3) monitor Anthropic API spend dashboard for 48h post-deploy, (4) document expected regen volume in deploy ticket.

**Local dev environment warning (Phase 12f flag flip)**: If you previously
set `BAZI_USE_WEIGHTED_IMBALANCE=0` in your local `apps/api/.env` to
reproduce flag-off behavior, REMOVE that line OR change to
`BAZI_USE_WEIGHTED_IMBALANCE=1` to match the new code default. Stale `=0`
overrides will silently revert your local install to pre-Fix-1a engine
output despite the code change. Verify with:
`grep BAZI_USE_WEIGHTED_IMBALANCE apps/api/.env || echo "Not set in .env (will use code default '1')"`.

### Phase 12e — close the validation gate

Phase 12e addresses the 3 engine bugs Phase 12d left unfixed. Strategic decision after staff-engineer review of v1 plan: drop the proposed Pattern 12e-A entirely (multiplier nudge + Pattern 1 weak-band extension) because (a) Phase A's verdict on noble3 was already "⚠ partially confirmed" with explicit doubts about the 中和 tag, (b) review found the proposed heaviness gate would prevent the fix from firing on the target chart anyway, (c) the multiplier change had no clean rollback path. Only Pattern 12e-B shipped + 2 doctrinal-split reclassifications.

**Net impact**: 用神 agreement under `--accept-doctrinal-splits`: **94% → 98%** (clears the 95% gate). Strict default unchanged at 66% (Pattern 12e-B's V2 lift doesn't directly flip 用神 because Phase 12d Pattern 1 intercepts strong-DM charts, but the V2 strength accuracy improvement IS user-facing for cascading interpretations like 大運/personality narratives).

**Pattern 12e-B impact**:

| Change | Source | Default | Effect |
|---|---|---|---|
| Pattern 2a'' (non-month 比劫祿/羊刃) | 任鐵樵《滴天髓·天干》「日支寅而時支卯，謂之專祿坐刃，身固強矣」 | ON | V2 strength lift for charts with ≥2 non-month 臨官/帝旺 branches; preserves Roger via ≥2 guard |
| `dts_hezhi_noble3` reclassified | 食神制殺 vs 印化煞 doctrinal split (Category 6) | N/A | +1 chart in `--accept-doctrinal-splits` agreement |
| `edge_shishang_strong_jia` reclassified | 比劫旺極 chain doctrine (Category 4 extension) | N/A | +1 chart; engine now correctly classifies as `strong` but Pattern 1 doctrine choice is the genuine school disagreement |

**Pattern 2a'' trigger** (Phase A verified, Phase C v2 refined):
- `effective_transparent ≥ 2` (rooted 比劫 透干 + 1 implicit DM count)
- `≥ 2 qualifying non-month branches` at 臨官/帝旺 (任's 「日支祿+時支羊刃」 dual-condition doctrine)
- Pattern 2a/2a' month-bound paths don't fire
- Boost: +5 per qualifying branch, capped at PATTERN_2A_BOOST_CAP (20)

The `≥ 2 qualifying branches` guard is critical: Roger's 戊午 day (戊's 帝旺) qualifies as 1 branch, below threshold. Without this guard, Roger's V2 would lift 39→44 (weak→neutral), breaking a calibrated anchor. The classical doctrine alignment is exact — 任 specifies BOTH 日支祿 AND 時支羊刃 are needed for the strength-amplifying combination; single 帝旺 alone is just 日刃.

**Notable Phase 12e-B behaviors**:
- **Roger** (V2=39.0 weak): unchanged — only 1 qualifying branch
- **Laopo** (V2=20.6 very_weak): unchanged — `effective_transparent` fails before branch counting
- **shishang_strong** (V2 49.5 → 64.5 strong): correct strength classification, but Pattern 1 (Phase 12d) hijacks 用神 to 食傷洩秀 (滴天髓 doctrine); reclassified as Category 4 doctrinal split since corpus prescribes the alternate 真詮 chain doctrine
- **Angelababy** compat-couple cascade: V2 22.8 → 32.8 (very_weak → weak). Pinned in `test_angelababy_v2_classification_under_12e`. The 4 existing Phase 12d xfailed compat tests may shift status (already `strict=False`, no test breakage either way).

**Per-rule env flag** (Phase 12e):
```bash
PHASE_12E_PATTERN_2A_PP_NON_MONTH=1   # ON by default
```

This flag composes with Phase 12d's `PHASE_12D_PATTERN_2A_BIJIE_BOOST` — same family. Setting either OFF reverts to corresponding earlier-phase behavior.

**Engine bug status after Phase 12e**:

| Bug | Status |
|---|---|
| `ziping_wu_xianggong_qu_zhi` | Pattern 3a code shipped (Phase 12d), flag-OFF default. Awaits Bazi-master audit of 4 false-positives → flag-flip in Phase 12f. |
| `dts_hezhi_noble3` | RECLASSIFIED — Category 6 doctrinal split (食神制殺 vs 印化煞). Engine emits 印化煞 (defensible per 病藥取用法). |
| `edge_shishang_strong_jia` | RECLASSIFIED — Category 4 extension (比劫旺極 chain). Engine emits 食傷洩秀 (defensible per 滴天髓 「強者宜洩」). V2 strength correctly classified by Phase 12e-B. |

Only 1 chart (wu_xianggong) remains as a known engine bug, and its fix already exists (Pattern 3a) — just gated.

### Files Reference (Calculation Accuracy)
- God role assignment: `packages/bazi-engine/app/five_elements.py` → `determine_favorable_gods()`, `_detect_dominant_imbalance()`
- Luck period scoring: `packages/bazi-engine/app/lifetime_enhanced.py` → `enrich_luck_periods()`, `GAITOU_SET`, `JIEJIAO_SET`, `STEM_ROLE_PRIORITY`
- 三刑 shared helper: `packages/bazi-engine/app/branch_relationships.py` → `check_sanxing_with_pool()`
- Romance scoring: `packages/bazi-engine/app/lifetime_enhanced.py` → `_compute_romance_candidates()`, `ROMANCE_SIGNAL_SCORES`
- Stem combination lookup: `packages/bazi-engine/app/stem_combinations.py` → `STEM_COMBINATION_LOOKUP`
- Ten god categories: `packages/bazi-engine/app/constants.py` → `TEN_GOD_CATEGORIES`
- **Phase 12d helpers**: `branch_relationships.py::compute_sanhe_dm_credit()` (Pattern 2c), `interpretation_rules.py::_pattern_2a_bijie_boost()` (2a/2a'), `interpretation_rules.py::_pattern_2b_surround_penalty()` (2b), `ten_gods.py::detect_neutral_shishang_outlet()` (Pattern 1), `stem_combinations.py::detect_true_transformed_stems()` (Pattern 3b — Phase 12f Issue F fix tightened condition v breaker check; see note below), `interpretation_rules.py::check_cong_qiang_or_wang()` (Pattern 3a)

> **Strict vs loose 通根 stance** (Phase 12f Issue F fix): Pattern 3b
> (chart-level 從格 detection) uses STRICT same-stem-in-hidden semantics
> for breaker checks — `stem in hidden[:2]` requires the SPECIFIC breaker
> stem to be in 本氣 OR 中氣 of some branch. Phase 12b Fix D (transient
> flow-year 六合) doesn't have a breaker check at all — its threshold is
> permissive of 假化 by design. Both stances are doctrinally valid; the
> strict view is more conservative for 從格 stakes (per 滴天髓·假化
> 「克化神之神，或克者被制」).
- **Phase 12e helpers**: `interpretation_rules.py::_pattern_2a_bijie_boost()` (extended — non-month 比劫祿/羊刃 fallback path with `effective_transparent` semantics + `qualifying_branches` ≥2 guard). Constants: `PATTERN_2A_PP_PER_BRANCH_BOOST=5.0`, `PATTERN_2A_PP_DM_AS_TRANSPARENT=True`, `PATTERN_2A_PP_MIN_QUALIFYING_BRANCHES=2` in `constants.py`.
- **Validation harness**: `packages/bazi-engine/tests/validation/run_imbalance_validation.py` (50-chart corpus + 3-gate evaluator with `--accept-doctrinal-splits` flag), `expert_labeled_charts.csv` (corpus), `triage_diagnostic.py` (per-chart engine reasoning dump). `DOCTRINAL_SPLIT_CHART_IDS` list (16 entries after Phase 12e) — charts where engine emits one classical school's verdict and corpus labels another; both defensible.

---

## 八字流年運勢 Calculation — Phase 12 / 12b / 12c Fixes

This section documents the engine's flow-year + monthly scoring pipeline,
calibrated across 5 rounds of Seer-comparison + classical research. All
month-level scoring lives in `packages/bazi-engine/app/annual_enhanced.py::
_compute_single_month`. Plans saved at:

- `.claude/plans/bazi-accuracy-laopo-fixes.md` (Phase 12)
- `.claude/plans/bazi-phase-12b-monthly-refinements.md` (Phase 12b)
- `.claude/plans/bazi-phase-12c-six-harms-and-tomb-release.md` (Phase 12c)

### Output shape (per month)

Each `monthlyForecasts[i]` entry carries:

- `auspiciousness` — final 7-level label `{大吉, 吉, 吉中有凶, 平, 凶中有吉, 凶, 大凶}`
- `baseAuspiciousness` — post-C-override + post-A-halving (pre-F/B/E/D)
- `stemBase` / `branchBase` — element-role labels per stem/branch independently
- `ruleTrace: List[str]` — execution log, capped at 10 entries
- Optional structured fields (only present when triggered):
  - `officerSealActivation` (Fix C)
  - `fuYinInteractions` (Fix B)
  - `boundInteractions` / `trueTransformation` (Fix D)
  - `liuHaiInteractions` (Fix E)
  - `chongKuRelease` (Fix F)

TypeScript counterparts in `packages/shared/src/types.ts::Phase12bMonthlyExtras`
(extended in-place by Phase 12c — never renamed).

### Execution order (locked, snapshot-tested)

**C → A → F → B → E → D** — pinned by composition test
`tests/test_phase_12c_monthly.py::TestRuleTraceSnapshot`. Any reordering must
update the snapshot explicitly.

| Step | Rule | Type | Phase |
|------|------|------|-------|
| C | 殺印/官印相生 transient | upgrade override | 12b |
| A | 蓋頭/截腳 halving | shape modifier (skipped when C fired) | 12b |
| F | 沖庫釋放方向性 | structural release (downgrade only v1) | 12c |
| B | 伏吟 multi-pillar role-conditional | shape modifier | 12b |
| E | 六害 role-aware penalty + 子卯刑 | shape modifier | 12c |
| D | 六合 strict 化氣 (else bound_only) | shape modifier | 12b |

### LOAD-BEARING DOCTRINE (do not relax without classical review)

> **Stem rescue (用/喜 stem 透干) can mitigate SHAPE MODIFIERS (蓋頭, 伏吟)
> but CANNOT cancel STRUCTURAL RELEASES (沖庫釋放, 三刑成立).**
>
> Source: 《滴天髓·論墓庫》「庫沖則開, 開則藏干釋放, 不論天干能否化」.

This is enforced via Fix F always carrying `stemRescueApplied: false` and
asserted in `test_phase_12c_monthly.py::test_laopo_renchen_net_minus_066_triggers_downgrade`.

### Phase 12 — chart-level fixes (cascade into Annual via 用神/etc.)

| Fix | Rule | Source | Behind flag? |
|-----|------|--------|--------------|
| 1a | 透干/藏干 weighted dominance for 用神 | 子平真詮·論用神「透出干頭則顯其用」 | `BAZI_USE_WEIGHTED_IMBALANCE=1` |
| 1b | 官殺混雜 threshold (≥2.0 weight + ratio ≥0.5) | 淵海子平 露殺藏官口訣 | unflagged |
| 2 | 調候 advisory (寒暖燥濕需求) | 窮通寶鑑 (12 DM × 12 month table) | unflagged, output structured-only |
| 3 | 桃花方位 (8-direction) | 三合組桃花支 + 24山方位 | unflagged |
| 4 | 生肖貴人 + 文昌方位 (provenance flag for folk content) | 三合/六合 partner + 文昌口訣 | unflagged |

Critical: Fix 1a's transparency weighting (透干=3.0, 本氣藏干=2.0×司令1.5=3.0,
中氣=1.0, 餘氣=0.5, 透干 rootless=1.5) is what flips Laopo's 用神 from 木→水.

### Phase 12b — monthly scoring refinements

**Fix A — 蓋頭/截腳 halving** via flow stem 十二長生:

```python
def _fix_a_gaitou_halving_applies(stem, branch):
    return get_life_stage(stem, branch) in {'絕', '死', '墓'}
```

When stem 忌/仇 sits on branch 喜/用 AND stem is 絕/死/墓 on the flow branch,
upgrade base by 1 step. Symmetric for 截腳 path. Source: 任鐵樵《滴天髓闡微·
蓋頭截腳》「金絕寅卯，雖有十分之凶，而減其半」.

**Fix B — 伏吟 role-conditional, multi-pillar:** When flow branch == any
natal branch:
- Role 喜/用 + pillar weight ≥1.0 (day/hour/month) → upgrade 1 step
- Role 忌/仇 + same → downgrade 1 step
- Year pillar weight 0.5 → narrative only
- Concurrent 沖 → cap to narrative-only (動蕩 doctrine)

Source: modern 子平 consensus 「用神伏吟應吉，忌神伏吟應凶」.

**Fix C — 殺印/官印相生 transient activation:** All conditions must hold:
1. DM strength ∈ {weak, very_weak} AND not 從格
2. month_ten_god ∈ {七殺, 正官}
3. Month branch 本氣 OR 中氣 = 正印 / 偏印
4. Structural support: 印 self-roots in 本氣 OR transparent in natal stem
5. Not blocked by adjacent 食傷 (month/day/hour stems) or by same-branch
   internal 財壞印 (中氣印 + 本氣財)

When fired: override base to 大吉 (本氣印) or 吉 (中氣印). Skips Fix A.
Source: 子平真詮·論用神成敗救應「印輕逢煞，或官印雙全者」.

**Fix D — 六合 strict 化氣:** 真化 path requires (a) adjacency, (b) weaker
branch rootless elsewhere, (c) 化神 transparent in flow-year/month/natal stem,
(d) `SEASON_MULTIPLIER[化神][month_branch] >= 1.5` (strict 旺), (e) no 沖/刑.
Default `bound_only` (narrative). Real 化 ungated by `PHASE_12B_FIX_D_TRUE_TRANSFORMATION_ENABLED`.

Source: 滴天髓·論化象 4 化氣 conditions; mainstream 「地支六合只是加強所合
之物的力量, 仍保持各自原來的特性」.

### Phase 12c — additional monthly refinements

**Fix E — 六害 role-aware + 子卯刑 piggyback:**

6 害 pairs (verbatim from `branch_relationships.SIX_HARMS`):
```
子-未 (妒嫉之害), 丑-午 (官鬼之害), 寅-巳 (無恩之害),
卯-辰 (凌長之害), 申-亥 (爭進之害), 酉-戌 (嫉妬之害)
```
Plus 1 piggybacked 六刑: `子-卯` (無禮之刑, kind=`liuxing_ziwei`).

When 害 hits 喜/用 branch:
- effective_score = `wuEn_modifier × dampening`
  - `wuEn_modifier = 1.2` for 寅巳 (無恩之害); else `1.0`
  - `dampening = 0.5` if 六合 binds the harmed branch; else `1.0`
- If Σ effective_score (across pillars) ≥ **0.6 threshold** → -1 step
- **Cap doctrine**: 害 is 暗箭 (silent friction), not cumulative — max -1
  step per month total

Suppression: 沖 on same flow branch suppresses 害. **三刑 suppression NOT yet
applied** (no 三刑 penalty exists in 12c → keeping suppression would silently
drop the only signal; gets re-added when Phase 12d ships 三刑 penalty).

Source: 三命通會·論六害「以吉害凶, 未必能去凶；以凶害吉, 亦能損吉」;
163.com modern doctrine「命中喜用之神不能害；忌神反而喜害」.

**Fix F — 沖庫釋放方向性 (downgrade-only v1):**

Activation requires: not 從格 AND `flow_month_branch ∈ {辰戌丑未}` AND a natal
pillar branch ∈ {辰戌丑未} forming 沖 (辰戌沖 / 丑未沖).

Net role score:
```
net = 0.6 × role(本氣) + 0.3 × role(中氣) + 0.1 × role(餘氣)
```
Role values: `{用神=+1.0, 喜神=+0.6, 閒神=0, 仇神=-0.6, 忌神=-1.0}`.

v1 ladder (downgrade-only):
- `net ≤ -0.5` → downgrade 1 step, `stemRescueApplied=False` (per doctrine)
- `net ≥ +0.5` → **NOT IMPLEMENTED** (Phase 12d scope)
- else → narrative only

Source: 子平真詮·論墓庫刑沖「至於財官為水, 沖則反為累」.

### Per-rule env flags (rollback path)

Consolidated table covering all phases. Default ON in dev/staging unless noted; **prod default OFF until measured-flip gate** for the explicitly-marked flags.

```bash
# Phase 12 Fix 1a (chart-level 用神 cascade)
BAZI_USE_WEIGHTED_IMBALANCE=1   # Phase 12 Fix 1a (see Note below — code default is '0')

# Phase 12b monthly forecasts
PHASE_12B_FIX_A=1                              # 蓋頭/截腳 halving
PHASE_12B_FIX_B=1                              # 伏吟 multi-pillar role-conditional
PHASE_12B_FIX_C_ENABLED=1                      # 殺印/官印相生 transient
PHASE_12B_FIX_D_TRUE_TRANSFORMATION_ENABLED=1  # 六合 真化

# Phase 12c monthly forecasts
PHASE_12C_FIX_E_ENABLED=1                      # 六害 role-aware
PHASE_12C_FIX_F_ENABLED=1                      # 沖庫釋放方向性

# Phase 12d 用神 validation gate fixes
PHASE_12D_PATTERN_2C_SANHE_CREDIT=1            # 三合/半合 V2 dedi credit
PHASE_12D_PATTERN_2A_BIJIE_BOOST=1             # 比劫 透干 boost
PHASE_12D_PATTERN_2B_SURROUND_DAMPENER=1       # 月令祿 surround dampener
PHASE_12D_PATTERN_1_NEUTRAL_BRANCH=1           # neutral DM 食傷洩秀
PHASE_12D_PATTERN_3B_HUAQI_SUPPRESSION=1       # 真化 stem suppression
PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR=0     # ⚠️ DO NOT FLIP — see Pattern 3a guard rail above

# Phase 12e
PHASE_12E_PATTERN_2A_PP_NON_MONTH=1            # non-month 比劫祿/羊刃 boost

# Phase 12g — Love reading doctrine fixes (all default ON; behavior-changing — see Phase 12g section below)
# Note: Phase 12g doesn't gate via env flags individually (clean rollback via revert PR)
# Cache invalidation in apps/api/src/ai/ai.service.ts::PRE_ANALYSIS_VERSIONS handles version routing.

# Phase 12h.B — Doctrine framing rules (default ON; doctrinal corrections, not experimental)
PHASE_12H_SHANGGUAN_FAVORABILITY_PROPAGATION=1  # Item 2: 傷官見官 favorability dispatch (annual + 3 compat sites)
PHASE_12H_BIJIE_DUOCAI_VALENCE=1                # Item 8: 比劫奪財 3-state valence + gender dispatch + transient framing
```

CI matrix runs at minimum: all-on, Phase 12 off, Fix C+F isolated. Per-rule
flags can disable any single rule without revert PR.

> **Note on `BAZI_USE_WEIGHTED_IMBALANCE` default (post-Phase-12f)**: code
> default is now `'1'` (ON) in `packages/bazi-engine/app/five_elements.py`.
> Phase 12 Fix 1a is active by default. Flag-flip preconditions cleared:
> 1. ✅ n=50 expert-labeled chart CSV at
>    `packages/bazi-engine/tests/validation/expert_labeled_charts.csv` (PR #38)
> 2. ✅ Product-owner waiver of Bazi-master sign-off (user explicit, Phase 12f).
>    The 4 known compat regressions in `test_compatibility_gold_standard.py`
>    are already documented as `@pytest.mark.xfail(strict=False)` per Phase 12d
>    Pattern 1 doctrinal-split categorization.
> 3. ✅ Validation harness ≥95% agreement (98% under
>    `--accept-doctrinal-splits` post-Phase-12d/e)
>
> Rollback: set `BAZI_USE_WEIGHTED_IMBALANCE=0` in env to revert to pre-Fix-1a
> raw-count dominance detection.

### Anti-hallucination prompt rules

`apps/api/src/ai/prompts.ts::ANNUAL_V2_PROMPTS.userTemplateCall2` includes
explicit clauses:
- 若某月行內未列出「六害」 → 禁止提及 害/穿/沖害
- 若某月未列出「沖庫釋放」 → 禁止提及 沖開庫藏/藏干釋放
- 禁止虛構未提供的 pair/pillar/role/released_stems
- 若有「⚠️觸發」標記 → 月運敘述應點出該因素

The deterministic injector at `ai.service.ts::buildAnnualV2Prompts` only emits
六害/沖庫 lines when structured fields are non-empty, enforcing the contract.

### Out of scope (Phase 12d candidates)

- 三刑 role-aware penalty (寅巳申, 丑戌未) — currently detected but no label penalty
- 六破 role-aware penalty
- Fix F upgrade path (when net ≥ +0.5)
- Pillar weighting for Fix E (deferred until empirical data)
- Numeric-score scoring (replacing label-step) — bigger refactor

### Files reference

- Engine entry: `packages/bazi-engine/app/annual_enhanced.py` →
  - `_compute_single_month` (orchestration)
  - `_fix_a_gaitou_halving_applies`, `_fix_c_detect_officer_seal_transient`,
    `_fix_b_fuyin_role_amplification`, `_fix_d_check_liu_he`,
    `_fix_e_detect_six_harms_penalty`, `_fix_f_chong_ku_release`
  - `PHASE_12B_RULES_ENABLED`, `PHASE_12C_RULES_ENABLED`
  - `_LIU_HAI_DOWNGRADE_THRESHOLD`, `_TOMB_RELEASE_DOWNGRADE_THRESHOLD`,
    `_LIU_HAI_WU_EN_PAIRS`, `_LIU_XING_ZIWEI_PAIR`, `_FOUR_TOMB_BRANCHES`,
    `_TOMB_CHONG_PAIRS`, `_ROLE_TO_SCORE`
- Tests:
  - `tests/test_phase_12b_monthly.py` (24 tests)
  - `tests/test_phase_12c_monthly.py` (24 tests)
- TS types: `packages/shared/src/types.ts::Phase12bMonthlyExtras`,
  `LiuHaiInteraction`, `ChongKuRelease`
- AI: `apps/api/src/ai/prompts.ts::ANNUAL_V2_PROMPTS`,
  `apps/api/src/ai/ai.service.ts::buildAnnualV2Prompts`

### Calibration anchor — Laopo (丙寅/辛丑/甲戌/壬申 female, 2026 丙午年)

Use this chart to verify any future engine change:

| Month | Pre-12 | Post-12 | Post-12b | Post-12c | Mechanism |
|-------|--------|---------|----------|----------|-----------|
| 庚寅 | 吉中有凶 | unchanged | **吉** | unchanged | Fix A 庚絕寅 |
| 辛卯 | 吉中有凶 | unchanged | **吉** | unchanged | Fix A 辛絕卯 |
| 壬辰 | 凶中有吉 | unchanged | unchanged | **凶** | Fix F 戌釋放 net=-0.66 |
| 癸巳 | 吉 | unchanged | 大吉 | **吉** | Fix E 寅巳 wuEn 害 喜神 |
| 庚子 | 吉中有凶 | unchanged | **大吉** | unchanged | Fix C 殺印相生 (本氣印) |
| 辛丑 | 大凶 | unchanged | unchanged | unchanged | 伏吟月柱 + 仇神 |
| Other 6 months | unchanged across all phases (regression guard) |

Plus chart-level: 用神 木→水, 喜神 水→木, 官殺混雜 → 露官藏殺只論官,
桃花方位 emitted as 卯/正東 (Seer's 正南 wrong), 文昌 巳/東南, 生肖貴人
亥豬+午馬+戌狗 with `provenance: 'folk_tradition'` flag, 調候 advisory
`cold_wood_needs_fire`, status=`present_weak`.

---

## 八字愛情姻緣 Calculation — Phase 12g Doctrine Fixes

This section documents Phase 12g (2026-05) — 6 doctrinal accuracy fixes for the
love reading (八字愛情姻緣) module, derived from a comparison between our engine
and Seer (a competitor app) using Laopo's chart as anchor. The fixes address
cross-module rule inconsistency, layered detection, polarity-aware personality
output, and 流年 label completeness. Plan saved at
`.claude/plans/phase_12g_love_doctrine_fixes.md`.

### The 6 fixes

| Fix | Location | Doctrine source | Net effect |
|-----|----------|-----------------|------------|
| **Fix 2 — 官殺混雜 canonical helper** | `love_enhanced.py::compute_spouse_star_analysis`, `compatibility_romance_preanalysis.py` (3 sites), `compatibility_enhanced.py::_detect_cross_guan_sha_hun_za` | 子平真詮·論偏官「藏官露殺...勿使官混；藏殺露官...不可使殺混」 | All 5 sites now consume `interpretation_rules::check_guan_sha_hunza` (Phase 12 Fix 1b weighted). 露官藏殺/露殺藏官 → narrative-only; only 真雙透 → high-severity challenge. Suppresses cross-chart 官殺混雜 when natal already non-混雜. |
| **Fix 3 — 傷官見官 layered + favorability** | `love_enhanced.py::compute_spouse_star_analysis` line 614+ | 三命通會「如官為忌，傷官見官反以吉論」 / 大紀元 / `career_enhanced.py:2249` reference pattern | 3-layer detection: natalSeverity (latent/moderate/high/critical) + transientActivations[] (LP+LY scan) + valence (beneficial when 正官=忌神). |
| **Fix 5 — 正緣桃花年 archetype label** | `lifetime_enhanced.py::_compute_romance_candidates` + `love_enhanced.py::compute_romance_good_years` | 八字应用阐微·婚姻篇「女命遇流年正官透干，主正缘桃花」 | New `romance_archetype` field (zheng_yuan / pian_yuan); promotes 正緣桃花年/偏緣年/紅鸞正緣年 labels above 紅鸞/天喜 in priority. |
| **Fix 6 — 沖配偶宮 valence** | `lifetime_enhanced.py::_compute_romance_candidates` (chong_label/chong_valence/bidirectional fields) | 滴天髓·夫妻論 + 三命通會·論妻妾 (沖宮=動, bidirectional) | Single-entry emission: 沖+配偶星透→正緣動年, 沖+紅鸞/天喜→喜事動年, 沖 alone→婚動年 (bidirectional=true), 沖+比劫→婚變年. Year never duplicated across good/change lists. |
| **Fix 1 — Polarity-aware ten god personality** | `personality_library.py` (NEW) + `data/personality/ten_god_personality.json` (NEW) + `love_enhanced.py::compute_love_personality` | 子平真詮·論十神, 滴天髓·六親論, 三命通會·卷六 | 10 ten gods × 3 polarities × 4 fields data file. 月令格主導 + 月干透副主導 layers in `personalityDimensions` field. |
| **Fix 4 — Structured spouse output** | `love_enhanced.py::compute_marriage_palace_analysis` | 滴天髓·夫妻論 + 盲派秘典·第5章 (form vs personality 分層) | New structured `appearance` / `personality` / `meta` blocks; ten god `archetype` polarity-aware via Fix 1 library; legacy flat fields preserved (DEPRECATED in Phase 12h). |

### Output shape additions

`compute_spouse_star_analysis` (`spouseStar` block):
- `informationalNotes: List[Dict]` — 露官藏殺/露殺藏官 narrative entries
- `challenges[].doctrineType`, `challenges[].doctrineDetail`, `challenges[].weights` (官殺混雜 only)
- `challenges[].natalSeverity`, `transientActivations`, `valence`, `officerRole`, `permanentRisk`, `natalDetail`, `natalWeights` (傷官見官 only)

`compute_marriage_palace_analysis` (`marriagePalace` block):
- `appearance: {primarySource, grade, note, elementHint}` — branch-driven 形貌 layer
- `personality: {primarySource, tenGod, role, archetype, caveat}` — ten-god-driven 性格 layer (polarity-aware)
- `meta: {twelveStage, isKongWang, natalHarm}` — meta layer

`compute_love_personality` (`lovePersonality` block):
- `personalityDimensions: List[{layer, tenGod, role, keywords, secondary, citation}]` — 月令格 + 月干透 layered + polarity-aware

`_compute_romance_candidates` (per candidate):
- `romance_archetype: 'zheng_yuan' | 'pian_yuan' | None`
- `chong_label: '正緣動年' | '偏緣動年' | '喜事動年' | '婚動年' | None`
- `chong_valence: 'positive' | 'negative' | 'mixed' | None`
- `bidirectional: bool`
- `signal_names: List[str]`

`compute_annual_love_forecast` annual entries:
- `romanceArchetype: str`
- `bidirectional: bool`

### Calibration anchor — Laopo (丙寅/辛丑/甲戌/壬申 female)

Use this as regression anchor for any future engine change touching Phase 12g code:

| Year | Pre-12g engine | Post-12g engine | Mechanism |
|------|----------------|-----------------|-----------|
| 2026 丙午 | 紅艷桃花年(danger) | unchanged | Phase 12g.5 corpus row |
| 2027 丁未 | 天喜桃花年 (post-process inversion) | 天喜桃花年 / 天喜年 | doctrinal split — protected high-priority labels preserved |
| 2030 庚戌 | 偏官桃花年 | unchanged | 庚=偏官透 archetype=pian_yuan |
| **2031 辛亥** | 天喜桃花年 (BUG — 正緣 trampled by 天喜 post-process) | **正緣桃花年** | Fix 5 archetype promotion |
| 2033 癸丑 | 紅鸞年 | unchanged | 丑=紅鸞 of 寅 |
| 2035 乙卯 | 合婚年 | unchanged | 卯戌六合配偶宮 |
| **2036 丙辰** | 合婚年 (BUG — single-direction misleading) | **婚動年 (bidirectional=true)** | Fix 6 沖宮 valence |

Plus chart-level deterministic changes:
- `spouseStar.challenges`: 官殺混雜 entry REMOVED (露官藏殺), 傷官見官 entry has new `valence='beneficial'` + `transientActivations: ['丁酉(2023-2032)']` + `natalSeverity='latent'` (Phase 12g.1 + 12g.3)
- `spouseStar.informationalNotes`: NEW `[{doctrineType: 'lu_guan_cang_sha', doctrineDetail: '露官藏殺只論官', ...}]`
- `marriagePalace.personality`: `{tenGod: '偏財', role: '仇神', archetype: '漫不經心、花錢大手大腳、不顧家、事業不求上進、易有外遇', caveat: '日支偏財為仇神...'}`  (Phase 12g.4 Fix 4 polarity)
- `lovePersonality.personalityDimensions`: 月令格 + 月干透 layers with role-aware keywords (Phase 12g.4 Fix 1)
- `compatibilityEnhanced.guanShaHunZa`: cross-chart detection now suppressed when natal is 露官藏殺/露殺藏官 (Phase 12g.1)

### Files Reference (Phase 12g)

- New: `packages/bazi-engine/data/personality/ten_god_personality.json` — 10 ten gods × 3 polarities × 4 fields
- New: `packages/bazi-engine/app/personality_library.py` — `load_personality_by_role`, `role_to_polarity`, schema constants
- Modified: `love_enhanced.py` — `compute_spouse_star_analysis`, `compute_marriage_palace_analysis`, `compute_love_personality`, `compute_annual_love_forecast`, deterministic builder
- Modified: `lifetime_enhanced.py` — `_compute_romance_candidates`, `tag_romance_years_with_dayun` (romance_archetype + chong_valence propagation)
- Modified: `compatibility_romance_preanalysis.py` — 3 sites canonicalized to `check_guan_sha_hunza`
- Modified: `compatibility_enhanced.py::_detect_cross_guan_sha_hun_za` — natal-doctrine suppression
- Modified: `apps/api/src/ai/prompts.ts::LOVE_V2_PROMPTS` — anti-hallucination clauses + polarity guidance
- Modified: `apps/api/src/ai/ai.service.ts::PRE_ANALYSIS_VERSIONS` — added LOVE/COMPATIBILITY entries (was missing — bug)
- New: `packages/bazi-engine/tests/validation/romance_label_corpus.csv` — 15 fixtures across Laopo + Roger
- New: `packages/bazi-engine/tests/validation/run_romance_label_validation.py` — strict 0-regression gate

### Phase 12h candidates (deferred from 12g)

- Centralized `chart_doctrine.py` module (傷官見官/比劫奪財/財星混雜 across all readings)
- **career/annual/compat 傷官見官 favorability propagation** (Phase 12g.7 review confirmed compat scope — 3 modules, not just career/annual)
- Deprecate `love_enhanced.py` legacy `challenges[].guanCount`/`shaCount` fields after frontend migration
- Deprecate `marriage_palace.meta.natalHarm` legacy alias (Phase 12g.6 introduced `natalFrictions` as canonical; Phase 12g.7 removed prompt-side injection but field still emitted by engine)
- Fix `palace.kongWang` vs `isKongWang` camelCase mismatch (separate bug found during Phase 12g.6 V1 review)
- Full 三刑 (3-branch group) detection on spouse palace (Phase 12g.6 only does 2-branch partials)
- Post-generation narrative linter for AI compliance signal (deferred from Phase 12g.6 Gap 2 alternative)
- **比劫奪財 deterministic framing parity** (Phase 12g.7 review Issue D — analogous to Phase 12g.6 Gap 2 傷官見官 framing, currently only 傷官見官 has the deterministic block)
- **Inject machine-readable `[doctrine: <type>]` markers alongside Chinese labels for stable prompt-rule matching** (Phase 12g.7 review Issue B — addresses doctrineDetail Chinese-label string-coupling fragility)
- Phase 12d Pattern 3a `PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR` flag-flip (independent of 12g)

### Phase 12g.6 — Love reading polish (deltas to Phase 12g.4 wiring)

3 follow-up gaps from Laopo27 post-deploy comparison vs Seer:

| Gap | Issue | Fix |
|-----|-------|-----|
| Gap 1 | Phase 12g.4 `personalityDimensions` engine field never read by `ai.service.ts` (no-op for AI) | Added explicit injector at `interpolateLoveV2Fields` line ~3795-3835: emits 「性格維度 (polarity-aware,必須優先引用,出處:...)」 block with 月令格主導 + 月干透副主導 + keywords. Empty-array fallback to legacy archetype/elementStyle with sentinel for debuggability. Updated `love_personality 寫作規則` at prompts.ts:2608 to require AI consume the new block as PRIMARY. |
| Gap 2 | 傷官見官 narrative didn't say 「現行大運(2023-2032)」 framing — prompt rule existed but was statistically ignored | **Deterministic injection** (NOT prompt strengthening — earlier rule text was identical). Pre-formats sentence in `interpolateLoveV2Fields`: 「傷官見官時間框架 (必須以下列文字為主敘述,不可省略): 命局層次:... / 大運觸發:現行大運(YYYY-YYYY 干支)期間... / 性質判定:... / 化解條件:...」 with valence dispatch (beneficial/harmful/neutral + null fallback). Replaced 12g.3 prompt rule. Mirrors `partner_matching` 生肖 injection pattern. |
| Gap 3 | `marriage_palace.meta.natalHarm` only caught 六害, missed 戌+丑 半刑 (Seer correctly flagged it) | New `check_branch_friction` helper in `branch_relationships.py` reuses `THREE_PUNISHMENTS[].partials` + `SIX_HARMS` + `SIX_BREAKS` + `SIX_CLASHES`. Priority order: 沖>刑>害>破. New `meta.natalFrictions` canonical field with type discriminator; legacy `meta.natalHarm` preserved as filtered alias (six_harm only). Self-pair returns None (not friction — that's 伏吟). |

**Calibration anchor — Laopo (post-Phase-12g.6)**:
- `marriage_palace.meta.natalFrictions[]` includes `{branch:'丑', pillar:'month', type:'half_punishment', description:'丑戌半刑（持勢之刑局之半），month柱配偶宮）'}` (Gap 3)
- `interpolateLoveV2Fields` emits 「傷官見官時間框架」 block with 大運觸發 = `現行大運(2023-2032 丁酉)期間` + 性質判定 = `正官在你命中為忌神，傷官制官反為調節壓力，並非為禍` (Gap 2)
- `interpolateLoveV2Fields` emits 「性格維度」 block with 月令格主導=正財(仇神)→吝嗇貪小/刻板乏味, 月干透副主導=正官(忌神)→拘謹/缺乏變通 (Gap 1)
- Calendar drift coverage: with `current_year=2035` (post-丁酉 LP), 傷官見官 transient activations correctly point to 2033-2042 丙申 LP (NOT stale 丁酉)

**Files Reference (Phase 12g.6)**:
- `packages/bazi-engine/app/branch_relationships.py::check_branch_friction` (NEW helper)
- `packages/bazi-engine/app/love_enhanced.py::compute_marriage_palace_analysis` (extended with `natalFrictions`)
- `apps/api/src/ai/ai.service.ts::interpolateLoveV2Fields` (Gap 1 + Gap 2 injectors)
- `apps/api/src/ai/prompts.ts:2608` (love_personality rule), `:2629` (傷官見官 rule), `:2665` (spouse_appearance natalFrictions rule)
- Tests: `tests/test_branch_relationships.py::TestCheckBranchFriction` (31 tests), `tests/test_love_enhanced.py` (Gap 3 regression + 4-chart polarity matrix + calendar drift)

---

### Phase 12g.7 — Code review polish (5 issues from PR #42 review)

5 issues surfaced from PR #42 staff-engineer code review (1 confirmed real bug score=92, 3 score=72-75, 1 score=40 nice-to-fix):

| Issue | Source | Fix | Net effect |
|---|---|---|---|
| **Issue 1** (score 92) — `PROTECTED_HIGH_PRIORITY` typo | `love_enhanced.py:1657` listed `'偏緣年'` instead of `'偏緣動年'` | Replace in tuple (love_enhanced.py:1657) + update comment (1654) + remove from 3 test fixtures (test_love_enhanced.py:1248/1255/2713) + clean lifetime_enhanced.py:1138 comment | 偏緣動年 + day-branch 天喜 charts now correctly emit subNote `天喜同年，喜上加喜`; pre-fix bug silently dropped this annotation (no functional downgrade since label was preserved by elif fallthrough, but cosmetic info lost) |
| **Issue 2** (score 75) — Double-injection of 六害 | Pre-existing line `ai.service.ts:3849` `if (palace['natalHarm']) lines.push(\`六害：...\`)` co-existed with new Phase 12g.6 Gap 3 `配偶宮自然互動 (沖刑害破)：...` block; both fired for charts with 六害 | Remove the legacy line. Engine `meta.natalHarm` field still emitted (Phase 12h-tracked deprecation; frontend has no consumers per grep). | AI prompt no longer receives 六害 info twice for affected charts. Annual-prompt 六害 injection at `ai.service.ts:2283` is unrelated and OUT OF SCOPE. |
| **Issue F** (score 75, NEW from V1 review) — Latent 傷官見官 legacy line still firing | `ai.service.ts:3762-3764` unconditionally emitted `⚠️ 傷官見官：${severity}，${buffer}` for any chart with 傷官見官 challenge, even latent-only (no `transientActivations.dayun`). Contradicted Phase 12g.6 Gap 2 prompt rule «若 prompt 中無「傷官見官時間框架」區塊 → 完全不應提及» | Gate the legacy line on `transientActivations.some(t => t.level === 'dayun')`. Pre-impl grep verified field shape at `love_enhanced.py:745` (level='dayun') / `:764` (level='liunian'). | Latent-only charts no longer get the contradictory `⚠️ 傷官見官` directive. Active-LP charts (Laopo etc.) preserve current behavior. |
| **Issue 4** (score 75) — prompts.ts contradictory rules | Pre-existing line 2634 `如有傷官見官/比劫奪財，必須說明嚴重程度和化解因素` conflicted with Gap 2 latent-suppression rule | Split into 比劫奪財 rule + 傷官見官-defer-to-Gap-2 cross-reference (prompts.ts:2634) | Rule contradiction eliminated. Issue F's gate fixes the actual injection-side root cause; this is the prompt-side cleanup. |
| **Issue 5** (score 40) — `informational_notes` rule field-name mismatch | prompts.ts:2637-2638 referenced `informational_notes` field with structured `doctrineType`, but injector emits plain text Chinese label `露官藏殺只論官：...` | Rephrase rule to match actual injected label: `若 prompt 中含「露官藏殺只論官」標籤 → 主述「正官格清純，配偶星明朗」` | AI rule now keys off the actual emitted text. Issue B (machine-readable doctrine markers) deferred to Phase 12h as noted. |

**Cache invalidation**: LOVE v1.8.0 → v1.9.0. Operator runs `redis-cli FLUSHALL` post-deploy.

**Deferred to Phase 12h** (noted as candidates above):
- Issue 3 (compat 傷官見官 raw-count) — pre-existing, included in 「career/annual/compat 傷官見官 favorability propagation」 candidate (clarified to 3 modules, not just career/annual)
- Issue B (machine-readable doctrine markers) — string-coupling fragility, new Phase 12h candidate
- Issue D (比劫奪財 deterministic framing parity) — new Phase 12h candidate

**Files Reference (Phase 12g.7)**:
- `packages/bazi-engine/app/love_enhanced.py:1657` (PROTECTED_HIGH_PRIORITY typo fix)
- `packages/bazi-engine/app/lifetime_enhanced.py:1138` (comment cleanup)
- `apps/api/src/ai/ai.service.ts:3762-3779` (Issue F gate), `:3849` (Issue 2 removal), `:7105` (cache bump)
- `apps/api/src/ai/prompts.ts:2634` (Issue 4 split), `:2637-2638` (Issue 5 rephrase)
- Tests: `tests/test_love_enhanced.py::test_pian_yuan_dong_year_protected_from_tianxi_overlay` (Issue 1) + `::test_natal_six_harm_engine_field_still_emitted` (Issue 2 engine field regression)

---

## Day Master Mascot Design Bible — 日主角色卡吉祥物設計規範

**Purpose**: 10 (×2 genders = 20) iconic humanoid mascots for "你的角色卡". Each represents a day master's 本質 in Chinese ink wash style. Goal: maximize shareability.

### Core Style
- **Art style**: Chinese ink wash sumi-e (水墨畫風), semi-realistic
- **Core concept**: Body CONSTRUCTED FROM the element — "element became human form", NOT "human wearing element clothes"
- **Body ratio**: ~60% element / 40% human — like a wire sculpture made of the element's material
- **Tone**: 令人覺得厲害的 (awe-inspiring), premium collectible card feel

### Universal Template Rules
- ONE single full-body character per image (never multiple views)
- Half-robe/sash with waist belt, ink-wash rendered
- Gold kintsugi-style foil lines along major body seams
- Eyes = bright element-colored, most vivid color point
- Hair = element-specific growth detail (unique per day master)
- Face = clearly defined with sharp ink lines
- Background = plain white xuan paper (BG done separately)
- Ink splatter dots around the figure
- Full body head-to-feet visible
- **NO** weapons or armor
- **NO** neon/glow effects (keep organic watercolor)
- **NO** seal stamp
- **NO** chest watercolor wash
- 本質 must be visually prominent

### Gender Strategy
- 20 total: 10 male + 10 female. Show matching gender to each user.
- Phase 1: All 10 male first → Phase 2: Female versions

### Yang vs Yin Contrast
| | Yang (甲丙戊庚壬) | Yin (乙丁己辛癸) |
|--|--|--|
| Energy | Outward, grounded | Inward, floating/rising |
| Build | Athletic, broader | Lean, slender |
| Pose | Grounded, stable | Lighter, dynamic, may float |
| Lines | Bold, thick strokes | Thinner, delicate strokes |

### All 10 Male Versions — ✅ LOCKED
Full prompts saved in: `.claude/plans/soft-crafting-fiddle.md`

| # | Day Master | Unique Silhouette | Key Visual |
|---|-----------|-------------------|------------|
| 甲木 | 參天大樹 | Tall straight trunk, top-knot with leaves | Bark body, roots gripping ground |
| 乙木 | 藤蔓花草 | Lean floating, one foot lifted | Vine wire-sculpture body, pink cherry blossoms |
| 丙火 | 太陽烈火 | Wide radiating, hands on hips | Flame body, solar corona hair, **cheerful smile** |
| 丁火 | 燈燭星火 | Thin smoke wisp | Smoke body, only 2 flame points (hand + head) |
| 戊土 | 高山土壤 | **Widest/heaviest**, blocky boulder | Stone body, serene Buddha calm, prominent gold kintsugi |
| 己土 | 田園沃土 | **Shortest/roundest, bald** | Soil body, stone garden statue form, cupping green seedling |
| 庚金 | 精鋼利刃 | Blade-fin shoulders, **only one in motion** | Forged iron body, decisive stride, open hand forward |
| 辛金 | 珠寶首飾 | Ornate jewelry crown | Jade+gem mosaic body, gold filigree, **most beautiful face** |
| 壬水 | 江河大海 | Shoulder waves + vortex cape | Water body, hands behind back, calm strategist |
| 癸水 | 雨露甘霖 | **Rain drop halo** orbiting body | Water body, gentle knowing smile, floating, dew in palm |

### Prompt Engineering Lessons
- Say "body CONSTRUCTED FROM" not "wearing robe with texture"
- Say "like wire sculpture made of real [element]" to avoid decorative tattoo patterns
- Limit colored accents to 2-3 organic placements (少而精)
- Always specify exact build type per day master
- Emphasize "BOLD confident brush strokes" to avoid manga/sketch look
- Each day master pair must have UNIQUE differentiators (e.g., 甲=roots DOWN vs 乙=tendrils UP)
- "metal plates" always looks like armor → use "one continuous forged piece"
- "raw crystals" looks like minerals → say "POLISHED CUT gems in GOLD FILIGREE settings"
- "mist/vapor/ethereal/translucent" makes body invisible → use solid body + ethereal surroundings
- For metal/gem subjects lacking 水墨: add 皴法, "Song dynasty painting style", NOT comic/manga/Western/digital
- Always say "NO red seal stamp" and "ONE single character never multiple views"

### Element Eye Colors (from app design system)
| Element | Hex | Day Masters |
|---------|-----|-------------|
| 木 Wood | `#2E7D32` | 甲乙 |
| 火 Fire | `#D32F2F` | 丙丁 |
| 土 Earth | `#8D6E63` | 戊己 |
| 金 Metal | `#B8860B` | 庚辛 |
| 水 Water | `#1565C0` | 壬癸 |

### Mascot Implementation Status
- **40 images** (10 stems x 2 genders x 2 views) stored in `apps/web/public/mascots/` (~32 MB, optimized)
- **File naming**: `{pinyin}-{gender}-{view}.png` (e.g., `jia-male-full.png`, `gui-female-half.png`)
- **MascotViewer component**: `apps/web/app/components/MascotViewer.tsx` — swipeable full/half body viewer
- **Utility**: `apps/web/app/lib/mascot-utils.ts` — stem-to-pinyin mapping, image path helper, validation
- **Integration**: Wired into `CharacterCard` in `AIReadingDisplay.tsx`, gender extracted from `chartData.gender`
- **Share button**: Placeholder with "即將推出" — full implementation deferred to sharing session

### Sharing Foundation — Requirements for Future Session (分享我的角色卡)

The sharing feature allows users to export their character card as a shareable PNG image (LINE, Facebook, WhatsApp, Instagram, WeChat). Full design details in `.claude/plans/soft-crafting-fiddle.md` Section 13.

**Components to build:**
1. **`ShareableCharacterCard`** component (1200x1600, 3:4 ratio) — mascot zone (top 60%) + info zone (bottom 40%) + brand footer with QR code
2. **Image export pipeline** — `html2canvas` or `dom-to-image-more` to render as PNG at 1200x1600
3. **Share flow** — `navigator.share({ files: [pngBlob] })` for mobile, download for desktop
4. **Share card data** — mascot image (from `MascotViewer.activeView`), personality layers, stats, shensha tags, branding

**Key files to create:**
- `apps/web/app/components/ShareableCharacterCard.tsx` + `.module.css`
- `apps/web/app/lib/share-utils.ts` (export + share logic)
- Replace share button placeholder in `AIReadingDisplay.tsx` with real button

**Technical notes:**
- `MascotViewer` already exposes `onViewChange` callback for tracking active view
- Gender is from `chartData.gender` (already wired)
- QR code: use `qrcode` npm package or pre-generated static image
- Deep link: `baziapp.com/share?stem=甲&ref=card`

---

## Bazi Element Encyclopedia — 八字命格互動解讀

### What is it?
Click-to-explain feature for the 八字命格 table. When users click any element (十神, 天干, 地支, 藏干, 十二運, 納音, 神煞, 旺相休囚死, 空亡), a bottom sheet shows a layered explanation with free + paid personalized tiers.

### Architecture
- **No AI involved** — all content is pre-computed JSON templates, zero latency, zero API cost
- **4-layer template system**: Layer A (free generic) + Layer B (pillar-specific) + Layer C (god role analysis with DM strength reasoning) + Layer D (gender-specific 六親)
- **Engine always returns ALL layers** — frontend gates paid content via `isSubscriber` prop (no server-side subscription check)
- **Minimal API payload** (~200 bytes): only `GodRolesInput` (7 fields: dayMasterElement, strengthClassification, 5 god role elements) — NOT the full chart data
- **Templates use `{strengthLabel}` and `{dmElement}` placeholders** — engine substitutes at assembly time via `_substitute_placeholders()`
- **Bottom sheet rendered via React Portal** at `document.body` to avoid z-index/overflow clipping

### Key Files
```
packages/bazi-engine/data/explanations/   — JSON template files (one per element type)
packages/bazi-engine/app/explanations.py  — Template loader + assembly + god role mapping + get_day_pillar_detailed() for 八字終身運
packages/bazi-engine/data/explanations/day_pillar_detailed.json — 60 甲子 detailed explanations (flat 5-field JSON, NOT Layer A/B/C/D)
packages/bazi-engine/app/main.py          — POST /explain-element endpoint
apps/web/app/components/ElementExplanation.tsx   — Bottom sheet component (Portal)
apps/web/app/components/ElementExplanation.module.css
apps/web/app/lib/element-explanation-api.ts      — Frontend API client + session cache
```

### Template Writing Tone
**專業溫暖型** — like an experienced 命理老師 explaining one-on-one. 中學 reading level. Confident ("代表" not "可能代表"), with one relatable analogy per explanation. Occasional classical reference for credibility.

### God Role Mapping Chain
Ten god → element (via DM stem + relationship) → match against effective god roles (post-從格 override):
- `TEN_GOD_TO_RELATIONSHIP`: 比肩/劫財=same, 食神/傷官=i_produce, 偏財/正財=i_overcome, 偏官/正官=overcomes_me, 偏印/正印=produces_me
- `STRENGTH_LABEL_MAP`: very_strong+strong→偏強, very_weak+weak→偏弱, neutral→中和
- `KONG_WANG_ROLE_MAP`: 喜神/用神→favorable, 忌神/仇神→unfavorable, 閒神→neutral

### Layer C Content Rules
- Must include `{strengthLabel}` placeholder for DM strength reasoning
- Must include convention disclaimer: "本分析基於旺衰取用法。不同命理流派對喜用神的判定可能有所差異。"
- 忌神 variants must include 合化 note: "若此十神的天干與其他天干相合，其實際效果可能因合化而改變。"
- Uses EFFECTIVE god roles from engine (post-從格 override) — correct for all chart types

### Layer A Content Rules (for all element types)
- **十神**: Include core象意, 正/偏 distinction, key cross-interaction partner (食神制殺, 傷官見官, 梟印奪食, etc.), complete 六親 chain
- **地支** (Phase 2A): Include static 六合/六沖/三合/三會 reference info per branch
- **藏干** (Phase 2B): Include 透干/通根 concept explanation (透出 = power amplified, 藏而不透 = latent only)
- **納音** (Phase 2B): Include 正五行 vs 納音五行 contrast + cross-pillar interaction mention

### 六親 Reference Table (verified)
| 十神 | 男命 | 女命 |
|------|------|------|
| 比肩 | 兄弟/朋友 | 姐妹/朋友 |
| 劫財 | 姐妹/情敵 | 兄弟/情敵 |
| 食神 | 孫子、女婿/晚輩 | 女兒/才華表現 |
| 傷官 | 祖母/外祖母 | 兒子/情人(部分流派) |
| 偏財 | 父親/情人、偏妻 | 婆婆(夫之母)/偏財運 |
| 正財 | 妻子/正當財運 | 正當財運/繼父(部分流派) |
| 偏官(七殺) | 兒子/小人、壓力 | 情人、偏夫/非正式伴侶 |
| 正官 | 女兒/上司 | 丈夫/正式伴侶 |
| 偏印 | 繼母、偏母/宗教導師 | 繼母、偏母/非傳統mentor |
| 正印 | 母親/長輩庇護 | 母親/長輩庇護 |

### Phasing Strategy
- **Phase 1** (DONE): Infrastructure + 十神 (~120 entries). ALL 9 cell types clickable with "coming soon" fallback for unimplemented types. BaziChart.tsx fully wired — never needs revisiting.
- **Phase 2A** (DONE): Simple types — 天干(110), 地支(130), 十二運(120), 空亡(8), 旺相休囚死(35). Standard pattern, mostly content writing.
- **Phase 2B** (DONE): Complex types — 藏干(100), 納音(210), 神煞(273). Collapsed god role mapping for nayin (favorable/unfavorable) and shensha (favorable/neutral/unfavorable). Gender Layer D for 桃花/紅鸞/天喜/孤辰/寡宿/勾絞煞.
- **Bonus Phase**: Cross-pillar interaction checks — 十神 cross-interactions (食神制殺 etc.), 地支 六合/六沖/三合/三刑 live detection, 藏干 透干 live detection.

### Implementation Plan
Full plan with 11 review rounds (staff engineer + Bazi master + accuracy gap analysis): `.claude/plans/bazi-element-encyclopedia.md`

### Tests: 75 (all passing)
- Template loading, god role mapping chain, placeholder substitution, full assembly, error cases
- Phase 2A: stems, branches, life stages, kong wang, seasonal states
- Phase 2B: hidden stems, nayins, shenshas (collapsed god role mapping, gender Layer D)
