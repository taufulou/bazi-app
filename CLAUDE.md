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
- Next: Phase 12 (Bazi accuracy: 三合/三會 scoring, 從格+三合, 生化鏈) — see `docs/phase-12-specs.md`

## Test suite sizes
- Bazi Engine: 1771 (1770 pass, 1 skip) | NestJS API: 165 | Frontend: 143 | ZWDS: 289

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

### Files Reference (Calculation Accuracy)
- God role assignment: `packages/bazi-engine/app/five_elements.py` → `determine_favorable_gods()`, `_detect_dominant_imbalance()`
- Luck period scoring: `packages/bazi-engine/app/lifetime_enhanced.py` → `enrich_luck_periods()`, `GAITOU_SET`, `JIEJIAO_SET`, `STEM_ROLE_PRIORITY`
- 三刑 shared helper: `packages/bazi-engine/app/branch_relationships.py` → `check_sanxing_with_pool()`
- Romance scoring: `packages/bazi-engine/app/lifetime_enhanced.py` → `_compute_romance_candidates()`, `ROMANCE_SIGNAL_SCORES`
- Stem combination lookup: `packages/bazi-engine/app/stem_combinations.py` → `STEM_COMBINATION_LOOKUP`
- Ten god categories: `packages/bazi-engine/app/constants.py` → `TEN_GOD_CATEGORIES`

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

Default ON in dev/staging; **prod default OFF until measured-flip gate**:

```bash
BAZI_USE_WEIGHTED_IMBALANCE=1      # Phase 12 Fix 1a
PHASE_12B_FIX_A=1
PHASE_12B_FIX_B=1
PHASE_12B_FIX_C_ENABLED=1
PHASE_12B_FIX_D_TRUE_TRANSFORMATION_ENABLED=1
PHASE_12C_FIX_E_ENABLED=1
PHASE_12C_FIX_F_ENABLED=1
```

CI matrix runs at minimum: all-on, Phase 12 off, Fix C+F isolated. Per-rule
flags can disable any single rule without revert PR.

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
