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

## Total Tests: ~1337
- Bazi Engine: 759 (758 pass, 1 skip) | NestJS API: 157 | Frontend: 132 | ZWDS: 289

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
