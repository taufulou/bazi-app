# Bazi SaaS Platform — Project Context

## What is this?
AI-powered Bazi (八字) + ZWDS (紫微斗數) fortune-telling SaaS platform inspired by 先知命局 (SeerOnNet). Two-layer architecture: Python deterministic Bazi calculation + iztro ZWDS calculation + Claude AI interpretation with structured JSON output supporting preview/full per section for paywall.

## Tech Stack
- **Monorepo**: Turborepo + npm workspaces
- **Web**: Next.js 16 (App Router, port 3000)
- **Mobile**: React Native Expo (expo-router)
- **API**: NestJS 11 (TypeScript, port 4000)
- **Bazi Engine**: FastAPI Python (port 5001) — fully implemented
- **Database**: PostgreSQL 16 + Prisma v6 ORM
- **Cache**: Redis 7
- **Auth**: Clerk (Email OTP, Phone OTP, Google, Apple, Facebook, LINE — no WeChat in V1)
- **Node**: v22 LTS (keg-only at `/opt/homebrew/opt/node@22/bin`, must prepend to PATH)

## Project Structure
```
apps/
  web/          — Next.js 16 web app (ClerkProvider, dark theme, zh-TW, Turbopack)
  api/          — NestJS 11 API (28+ endpoints, Clerk JWT guard, rate limiting, Swagger)
  mobile/       — Expo React Native app (Clerk auth, SecureStore token cache)
packages/
  shared/       — TypeScript types + constants (Bazi types, reading types, rate limits)
  bazi-engine/  — Python FastAPI Bazi calculation engine (fully implemented)
    app/
      main.py         — FastAPI endpoints (/health, /calculate, /compatibility)
      calculator.py   — Main orchestrator for all calculations
      constants.py    — All Bazi lookup tables (stems, branches, elements, Na Yin, etc.)
      solar_time.py   — True Solar Time (真太陽時) with longitude + EoT + DST correction
      four_pillars.py — Four Pillars with 立春-based year correction (overrides cnlunar)
      ten_gods.py     — Ten Gods (十神) derivation from Day Master
      five_elements.py — Five Elements balance, Day Master strength, favorable gods
      shen_sha.py     — Shen Sha (神煞) special stars
      life_stages.py  — Twelve Life Stages (十二長生)
      luck_periods.py — 大運 (10-year cycles), 流年, 流月
      compatibility.py — Two-person chart comparison (六合/六沖/天干合)
    tests/            — 121 tests, all passing
  ui/           — Shared React UI components
  eslint-config/ — Shared ESLint config
  typescript-config/ — Shared TS configs
docker/         — Dockerfile.api, Dockerfile.bazi, docker-compose.yml
```

## Key Commands
```bash
# IMPORTANT: Always prepend Node 22 to PATH first
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

npm run dev               # Start all apps (turbo)
npm run dev:web           # Web only (localhost:3000)
npm run dev:api           # API only (localhost:4000)
npm run build             # Build all
npm run db:migrate        # Prisma migrate dev
npm run db:seed           # Seed database
npm run db:studio         # Prisma Studio GUI

# Bazi Engine (Python)
cd packages/bazi-engine
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 5001 --reload  # Start engine
python -m pytest tests/ -v                                  # Run 121 tests
```

## Bazi Engine Details
- **Port**: 5001 (port 5000 is used by macOS AirPlay)
- **Performance**: ~3ms per chart calculation (target was <50ms)
- **True Solar Time**: Longitude correction + Equation of Time (Spencer's formula) + DST detection for historical dates (e.g., China DST 1986-1991)
- **立春 Year Boundary**: Overrides cnlunar's Lunar New Year boundary with astronomically-computed 立春 using ephem library. Critical for accuracy.
- **Month Stem Recalculation**: After year correction, month stem is recalculated via 五虎遁月 rule for consistency
- **City Coordinates**: 60+ pre-coded cities (Taiwan, HK, Malaysia, China, Singapore, etc.) with fallback to user-provided lat/lng
- **API Endpoints**: POST /calculate (single chart), POST /compatibility (two-person comparison), GET /health
- **Python venv**: `packages/bazi-engine/.venv` (Python 3.12, cnlunar, ephem, fastapi, uvicorn, pydantic, pytest)

## Database
- 14 models, 11 enums in `apps/api/prisma/schema.prisma`
- Key models: User, BirthProfile, BaziReading, BaziComparison, Subscription, Transaction, Service, Plan, PromptTemplate
- Seed data: 6 services, 3 plans, 7 payment gateways, 18 prompt templates, 1 promo code (LAUNCH2026)
- PostgreSQL user: `bazi_user` / database: `bazi_platform`

## API Architecture (apps/api/src/)
- `auth/` — Clerk JWT guard (global APP_GUARD), @Public() decorator, @CurrentUser() decorator
- `users/` — Profile CRUD, birth profiles CRUD, reading history
- `bazi/` — Reading creation, comparison, services/plans catalog (public). Calls Bazi Engine + AI Service
- `zwds/` — ZWDS reading creation, chart preview, horoscope, compatibility, cross-system, deep-stars. Uses iztro library
  - `zwds.service.ts` — iztro chart generation, palace/star transformation, reading CRUD with credits
  - `zwds.controller.ts` — 6 endpoints: chart-preview, readings, horoscope, cross-system, deep-stars, comparisons
  - `zwds.types.ts` — ZwdsChartData, ZwdsPalace, ZwdsStar interfaces
  - `zwds-prompts.ts` — 10 ZWDS reading prompts + CROSS_SYSTEM_PROMPT + DEEP_STAR_PROMPT
- `ai/` — AI interpretation service with provider abstraction, failover chain, caching
  - `ai.service.ts` — Provider calls (Claude/GPT/Gemini), prompt building, response parsing, cache
  - `ai.module.ts` — NestJS module (exported, imported by BaziModule + ZwdsModule)
  - `prompts.ts` — System prompts for all reading types, output format, template interpolation
- `payments/` — Subscription status, transaction history, payment gateways (public)
- `admin/` — Dashboard stats, services/plans/promo/prompts management, audit log
- `webhooks/` — Clerk user.created/updated/deleted → sync to PostgreSQL
- `prisma/` — Global PrismaService
- `redis/` — Global RedisService with caching, rate limit helpers
- Rate limiting: @nestjs/throttler (100 req/min default), helmet security headers

## Auth Flow
- Web: Clerk middleware protects all routes except `/`, `/sign-in`, `/sign-up`, `/api/webhooks`, `/api/zwds-calculate`, `/api/bazi-calculate`, `/reading`, `/pricing`
- API: ClerkAuthGuard verifies JWT on all routes except @Public() decorated ones
- Mobile: ClerkProvider with SecureStore token cache, (authenticated) route group
- Webhook: Clerk → ngrok → /api/webhooks/clerk → syncs user to DB

## Design Theme
- Background: `#1a1a2e` (dark navy)
- Accent/Gold: `#e8d5b7`
- Card BG: `#16213e`
- Text: `#e0e0e0` (primary), `#a0a0a0` (secondary)

## Target Markets
- Taiwan, Hong Kong, Malaysia
- Languages: Traditional Chinese (primary, zh-TW), Simplified Chinese (zh-CN)

## Reading Types
### Bazi (八字)
1. 八字終身運 (Lifetime) — 2 credits
2. 八字流年運勢 (Annual) — 2 credits
3. 事業財運 (Career) — 2 credits
4. 愛情姻緣 (Love) — 2 credits
5. 先天健康分析 (Health) — 2 credits
6. 合盤比較 (Compatibility) — 3 credits

### ZWDS (紫微斗數)
7. 紫微終身命盤 (Lifetime) — 2 credits
8. 紫微流年運 (Annual) — 2 credits
9. 紫微事業運 (Career) — 2 credits
10. 紫微愛情運 (Love) — 2 credits
11. 紫微健康運 (Health) — 2 credits
12. 紫微合盤 (Compatibility) — 3 credits
13. 紫微流月運 (Monthly) — 1 credit (Phase 8B)
14. 紫微每日運勢 (Daily) — 1 credit (Phase 8B)
15. 紫微大限分析 (Major Period) — 2 credits (Phase 8B)
16. 紫微問事 (Q&A) — 2 credits (Phase 8B)

### Special (Phase 8B)
17. 八字+紫微綜合分析 (Cross-System) — 3 credits
18. 深度星曜分析 (Deep Stars, Master-tier only) — 2 credits

## Competitive Strategy & Monetization
- **Key differentiator**: Combined Bazi + ZWDS in one platform (most competitors offer only one system)
- **Competitors**: 科技紫微網 (Click108, 10M+ members), 靈機 (Linghit, 100M+ users), CHANI (~$14M/yr), Co-Star (~$5-10M/yr)
- **ZWDS school**: Default to 全書派 (Chen Xi-Yi) system — most widely recognized (~60% of apps)
- **Pricing tiers** (planned):
  | Plan | Price | Credits |
  |------|-------|---------|
  | Free | $0 | 1 free reading + chart display |
  | Basic | $5.99/mo | 5 Bazi + 3 ZWDS/month |
  | Pro | $12.99/mo | 15 Bazi + 10 ZWDS/month + monthly/compatibility/大限 |
  | Master | $24.99/mo | Unlimited + daily/Q&A/cross-system/deep-stars |
- **Retention flywheel**: Free chart (hook) → chart preview → subscribe → monthly notifications → annual renewal → share compatibility → friend joins

## Frontend Data Flow Architecture
The frontend currently calls calculation engines directly (no NestJS for reading flow):
```
Bazi Reading:
  Browser → POST localhost:5001/calculate (Python engine directly)
  → BaziChart component renders Four Pillars
  → AI interpretation uses mock data (until API keys configured)

ZWDS Reading:
  Browser → POST /api/zwds-calculate (Next.js API route)
  → route.ts calls iztro server-side → returns ZwdsChartData JSON
  → ZwdsChart component renders 12 palaces
  → AI interpretation uses mock data (until API keys configured)

Birth Profile CRUD (Phase 9):
  Browser → GET/POST/PATCH/DELETE localhost:4000/api/users/me/birth-profiles
  → NestJS API with Clerk JWT auth → PostgreSQL via Prisma

Future (not yet wired):
  Browser → NestJS API → credit check → calculation engine → AI provider → DB save → return
```

## Important Notes
- Docker is NOT available on this machine — use Homebrew services (PostgreSQL, Redis) instead
- Prisma v6 (not v7) — v7 has breaking constructor changes incompatible with traditional server setup
- Entertainment disclaimer required: 「本服務僅供參考與娛樂用途，不構成任何專業建議」
- AI fallback chain: Claude Sonnet 4.5 → GPT-4o → Gemini 2.0 Flash
- PostgreSQL@15 is running (not @16 — @16 has startup errors on this machine)
- Next.js 16 uses Turbopack by default — first page visit triggers on-demand compilation (shows "Compiling..." briefly)
- `npm run dev:api` may fail if NestJS is already running — kill old processes first

## AI Interpretation Layer
- **Provider chain**: Claude Sonnet 4.5 (primary) → GPT-4o (fallback) → Gemini 2.0 Flash (fallback)
- **Prompt system**: 6 Bazi + 10 ZWDS + 2 special reading-specific system prompts with template interpolation
- **Output format**: Structured JSON with `sections[key].preview` (free users) / `.full` (subscribers)
- **Caching**: SHA-256 hash of (birthDate + birthTime + city + gender + readingType + targetYear + targetMonth + targetDay + questionText) → Redis (24h) + DB (30d)
- **Cost tracking**: Every AI call logged to `ai_usage_log` table (tokens, cost, latency, provider)
- **Admin override**: PromptTemplate DB table allows editing prompts per reading type + provider without deploy
- **Admin AI costs page**: `/admin/ai-costs` shows 30-day aggregates, provider breakdown, daily chart
- **Graceful degradation**: If all AI providers fail, reading is saved with calculationData only (no AI text)
- **Current status**: AI keys empty in `.env` — chart calculation works, AI interpretation uses mock data
- **Tests**: 48 tests for prompts, response parsing, caching, hash generation, provider initialization

## Environment Files
- `apps/web/.env.local` — NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, routing vars
- `apps/api/.env` — DATABASE_URL, REDIS_URL, CLERK keys, CLERK_WEBHOOK_SECRET, BAZI_ENGINE_URL, AI API keys
- `apps/mobile/.env` — EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
- `.env.example` — Template with all env vars (safe to commit)

## Frontend UI (apps/web/)
- **Landing Page** (`/`): Hero with CTA button ("免費開始" → sign-in or dashboard), 6 Bazi feature cards + 6 ZWDS feature cards (purple-themed). All cards are clickable links. Server component with `auth()` to detect signed-in state.
- **BirthDataForm**: Client component with name (custom dropdown for saved profiles), gender toggle, date/time pickers, city datalist, timezone select. Validates all required fields before enabling submit. Phase 8B: extra inputs for monthly (month picker), daily (date picker), Q&A (textarea). Save checkbox with relationship tag (本人/家人/朋友). Selecting a saved profile auto-fills all fields.
- **BaziChart**: Full Four Pillars table (stems/branches colored by element, hidden stems, ten gods, na yin, shen sha, life stages), Five Elements energy circles, Day Master analysis panel (strength bar, pattern, five gods), Luck Periods horizontal scrollable timeline, Shen Sha tags, Kong Wang display.
- **ZwdsChart**: 12-palace grid with real iztro data — major/minor/adjective stars, brightness levels, mutagens, changsheng12, decadal ranges, age lists. Central info panel (solarDate, lunarDate, chineseDate, gender, fiveElementsClass). Purple-themed styling.
- **AIReadingDisplay**: Section-by-section AI reading with themed backgrounds (personality=gold, career=blue, love=pink, finance=orange, health=green). Subscribers see full content; free users see preview + blurred paywall overlay with subscribe CTA. Includes streaming cursor, loading skeletons, entertainment disclaimer, cross-sell grid linking to other reading types.
- **Reading Page** (`/reading/[type]`): Two-step flow (input → result) with step indicator and tab bar (chart/reading). Supports all 16 reading types (6 Bazi + 10 ZWDS). Bazi calls Python engine directly; ZWDS calls `/api/zwds-calculate` (iztro). AI interpretation uses mock data until API keys configured.
- **Dashboard** (`/dashboard`): Authenticated page (Clerk) with two sections — 八字命理分析 (Bazi cards) + 紫微斗數分析 (ZWDS cards, purple-themed). Subscription CTA banner. Link to profile management. User avatar via Clerk `<UserButton>`.
- **Profile Management** (`/dashboard/profiles`): Full CRUD for birth profiles with ProfileCard component. Create/edit/delete profiles, set primary. Inline delete confirmation (not window.confirm). Optimistic delete with revert on API failure.
- **ProfileCard**: Reusable card showing name, birth date/time, city, gender, relationship tag badge (gold=本人, blue=家人, green=朋友). Edit/delete buttons. Used in profile management page.
- **ZWDS Direct API Route** (`/api/zwds-calculate`): Next.js API route that calls iztro server-side for chart calculation. No auth required. Returns ZwdsChartData JSON. Used by frontend for direct chart preview without NestJS backend.
- **Bazi Direct API Route** (`/api/bazi-calculate`): Next.js API route that proxies to Python engine. Used as fallback when browser can't reach localhost:5001 directly.
- **Birth Profiles API Client** (`app/lib/birth-profiles-api.ts`): CRUD functions (fetch/create/update/delete), gender enum conversion (male↔MALE), `profileToFormValues()` and `formValuesToPayload()` helpers.
- **Styling**: CSS Modules (no Tailwind). Dark theme matching design system.
- **Tests**: 71 tests (BirthDataForm: 16, BaziChart: 30, AIReadingDisplay: 25). Jest + React Testing Library + jsdom.

## ZWDS Engine (iztro)
- **Library**: iztro v2.5.7 (Node.js, installed at monorepo root)
- **Backend**: `apps/api/src/zwds/` — NestJS module with full CRUD, credit system, AI integration
- **Frontend Direct**: `apps/web/app/api/zwds-calculate/route.ts` — Next.js API route for chart-only calculation (no auth/credits)
- **Chart Data**: Standardized `ZwdsChartData` with 12 palaces, major/minor/adjective stars, brightness, mutagens, horoscope (decadal/yearly/monthly/daily)
- **Time Index**: HH:MM → iztro time index (0=early zi, 1=chou, ... 12=late zi)
- **Solar Date Format**: Non-zero-padded `YYYY-M-D` (e.g., `1987-9-6`)
- **Tests**: 209 ZWDS-specific tests + 80 Phase 8B tests = 289 ZWDS tests

## Phase Status
- ✅ Phase 1: Foundation (monorepo, DB, auth, API)
- ✅ Phase 2: Bazi Engine (calculation engine, luck periods, compatibility, 121 tests)
- ✅ Phase 3: AI Interpretation (provider abstraction, 6 reading prompts, failover chain, 48 tests)
- ✅ Phase 4: Frontend UI (birth data form, Bazi chart, AI reading display with paywall, 71 tests)
- ✅ Phase 6: Admin Dashboard (9 admin pages, 157 API tests)
- ✅ Phase 7A: Production Hardening (env validation, exception filter, security headers, Sentry, PostHog)
- ✅ Phase 8: ZWDS Engine + Frontend (iztro integration, 6 ZWDS reading types, chart component, 209 ZWDS tests)
- ✅ Phase 8B: ZWDS Features (Monthly/Daily/MajorPeriod/QA + cross-system + deep-stars, 80 new tests)
- ✅ Phase 9: User Birth Profile Management (profile CRUD, custom dropdown on name field, auto-fill, profile manager page, relationship tags)
- ✅ Phase 10: Wire Frontend to NestJS API (readings-api.ts, reading page calls NestJS for signed-in users, chart-only fallback for free users, reading history page, subscription management page)
- ✅ Phase 5: Monetization & Payment (5 revenue streams: Stripe subscriptions, per-reading credits, per-section unlock, rewarded video ads, credit packages. 4 new DB models, 15 payment endpoints, store page, admin monetization dashboard, 33 new test files)

### Phase 10 Details (Wire Frontend to NestJS API)
- **`readings-api.ts`**: API client with `createBaziReading()`, `createZwdsReading()`, `getReading()`, `getReadingHistory()`, `transformAIResponse()`, slug→enum mapping, 40+ section title zh-TW labels
- **`reading/[type]/page.tsx`**: Signed-in users → NestJS API (credit deduction, AI interpretation, DB save); unsigned users → direct engine (chart-only, mock AI paywall); `loadSavedReading(id)` for deep-links; `refreshUserProfile()` on tab visibility
- **`dashboard/readings/page.tsx`**: Reading history with type, credits used, date, birth profile; enum→slug reverse mapping for navigation
- **`dashboard/subscription/page.tsx`**: Current plan display, cancel/reactivate with inline confirmation dialogs, billing period display (月繳/年繳), Stripe Customer Portal link for billing management
- **`pricing/page.tsx`**: Tier-aware CTA buttons (current plan → "管理訂閱", upgrade → confirmation modal, downgrade → confirmation modal, new subscription → Stripe checkout). Unified `handlePlanChange()` for both upgrade and downgrade via `POST /api/payments/upgrade`. Monthly/annual toggle; success/cancel toast notifications
- **`store/page.tsx`**: Credit package cards from API, best-value badge, `createCreditCheckout()` → Stripe; balance display

### Phase 5 Details (Monetization — 5 Revenue Streams)
**New DB Models** (migration `20260215092104_add_monetization_models`):
- `CreditPackage` — slug, nameZhTw/ZhCn, creditAmount, priceUsd, isActive, sortOrder
- `AdRewardLog` — userId, rewardType (CREDIT/SECTION_UNLOCK/DAILY_HOROSCOPE), creditsGranted
- `SectionUnlock` — userId, readingId, sectionKey, unlockMethod (CREDIT/AD_REWARD/SUBSCRIPTION), unique constraint
- `MonthlyCreditsLog` — userId, creditAmount, periodStart/End, unique constraint on [userId, periodStart]
- Updated: Plan.monthlyCredits (Basic:5, Pro:15, Master:-1), Service.sectionUnlockCreditCost

**Backend (15 payment endpoints + 3 ads endpoints):**
- `GET /api/payments/credit-packages` (@Public) — active credit packages
- `POST /api/payments/checkout/credits` — Stripe credit package checkout
- `POST /api/payments/checkout/subscription` — Stripe subscription checkout
- `POST /api/payments/portal` — Stripe customer portal
- `POST /api/payments/cancel` / `POST /api/payments/reactivate` — subscription management
- `POST /api/payments/upgrade` — upgrade or downgrade subscription plan (Stripe `subscriptions.update` with `price_data` + proration)
- `GET /api/payments/monthly-credits` — monthly credit grant status
- `POST /api/readings/:id/unlock-section` / `GET /api/readings/:id/unlocked-sections` — section unlock
- `GET /api/ads/config` / `GET /api/ads/status` / `POST /api/ads/claim` — rewarded video ads (5/day limit, Redis atomic counter)
- `apps/api/src/ads/` — ads module, controller, service
- `apps/api/src/payments/section-unlock.service.ts` — per-section unlock with credit/$transaction

**Frontend:**
- `store/page.tsx` + `store.module.css` — credit package purchase with Stripe
- `admin/credit-packages/page.tsx` — admin CRUD for credit packages
- `admin/monetization/page.tsx` — revenue analytics dashboard (30-day breakdown, subscriber tiers, ad rewards, section unlocks)
- `InsufficientCreditsModal.tsx` — paywall with buy credits / watch ad / subscribe CTAs
- Updated `AdminSidebar.tsx` with monetization nav items

**Seed Data:** 4 credit packages (starter-5/$4.99, value-12/$9.99, popular-30/$19.99, mega-60/$34.99)

**Not Yet Implemented (deferred to mobile phase):**
- Apple IAP + Google Play billing
- Real AdMob SDK integration (currently mock ad button on web, labeled "行動裝置限定")
- AdMob Server-Side Verification (V2)

### Upcoming Work (Priority Order)

#### 1. Mobile App
React Native Expo app (skeleton exists in `apps/mobile/`, needs reading flow, real AdMob integration)

#### 2. Playwright E2E Tests
Comprehensive end-to-end tests for payment flows, reading creation, section unlock, credit purchase

#### 3. Production Deployment
Docker setup, CI/CD, environment configuration, domain setup

## Total Tests: ~530+ (462 original + 33 new Phase 5/10 test files) — in worktree

## Worktree Development Guide
When working in a git worktree (`.claude/worktrees/`), these steps are REQUIRED before starting servers:

### 1. Copy environment files (gitignored, not shared across worktrees)
```bash
MAIN="/Users/roger/Documents/Python/Bazi_Plotting"
cp "$MAIN/apps/web/.env.local" apps/web/.env.local    # Clerk keys for Next.js
cp "$MAIN/apps/api/.env" apps/api/.env                  # DB, Redis, Clerk, AI keys for NestJS
```
**Without `.env.local`**, Clerk enters "keyless mode" — a separate user pool where admin roles and user data don't exist.

### 2. Generate Prisma client & run migrations
```bash
cd apps/api
npx prisma@6 generate       # MUST use prisma@6 (global is v7, incompatible)
npx prisma@6 migrate deploy  # Apply pending migrations
```

### 3. Start NestJS API (solving @repo/shared ESM issue)
The `@repo/shared` package exports raw TypeScript (`"main": "./src/index.ts"`) with extensionless imports (`export * from './types'`). NestJS compiles to CommonJS but at runtime Node ESM can't resolve `.ts` files without extensions.

**Working solution — build then run with tsx loader:**
```bash
cd apps/api
../../node_modules/.bin/nest build          # Compile TS → dist/
node --import tsx dist/main.js              # Run with tsx for @repo/shared resolution
```
The `tsx` loader resolves the extensionless `.ts` imports in `@repo/shared` at runtime. This is the **recommended approach** for both main repo and worktree.

**Why other approaches fail:**
- `nest start --watch` → compiles fine but crashes at runtime: `ERR_MODULE_NOT_FOUND: Cannot find module '.../shared/src/types'`
- `npx tsx src/main.ts` → resolves imports but `ConfigService` DI fails (constructor runs before module init)
- `node dist/main.js` (without tsx) → same `ERR_MODULE_NOT_FOUND` on `@repo/shared`
- Adding `.ts` extensions to shared imports → TypeScript rejects unless `allowImportingTsExtensions` is enabled, which breaks `nest build`
- **Next.js frontend** handles `@repo/shared` fine (Turbopack resolves TS natively)

### 4. Start Next.js from worktree directly
```bash
cd apps/web
npx next dev --port 3000    # NOT via turbo (may pick up main repo code)
```

### 5. Admin role setup
Admin access requires `publicMetadata.role === "admin"` on the Clerk user. Set via Clerk API:
```bash
CLERK_KEY=$(grep CLERK_SECRET_KEY apps/api/.env | cut -d= -f2)
# Find user: curl -H "Authorization: Bearer $CLERK_KEY" "https://api.clerk.com/v1/users?email_address=EMAIL"
# Set admin: curl -X PATCH -H "Authorization: Bearer $CLERK_KEY" -H "Content-Type: application/json" -d '{"public_metadata":{"role":"admin"}}' "https://api.clerk.com/v1/users/USER_ID"
```
Admin check is in `apps/web/app/admin/layout.tsx` (uses `currentUser().publicMetadata`). Middleware only checks authentication, not admin role.

### 6. PostgreSQL CLI
```bash
/opt/homebrew/opt/postgresql@15/bin/psql -U bazi_user -d bazi_platform
```

## Server Startup & Troubleshooting

### Quick Start (all 3 servers)
```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

# Terminal 1: Bazi Engine
cd packages/bazi-engine && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 5001 --reload

# Terminal 2: NestJS API (build first, then run with tsx)
cd apps/api
../../node_modules/.bin/nest build
node --import tsx dist/main.js

# Terminal 3: Next.js (from worktree or main)
cd apps/web
npx next dev --port 3000
```

### Health Checks
```bash
curl -s http://localhost:5001/health   # Bazi Engine
curl -s http://localhost:4000/health   # NestJS API
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/  # Next.js (expect 200)
```

### Common Issues

> **⚠️ IMPORTANT: When ANYTHING seems wrong (page stuck, loading forever, blank screen, 404 on known routes), ALWAYS check Next.js first!**
> The Turbopack dev server crashes frequently (every 15-30 min under active development). This is a dev-mode-only issue — production builds are unaffected.
> Quick check: `curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/` — if it returns `000` (timeout) or hangs, Next.js is dead.
> Quick fix: `kill -9 $(lsof -ti:3000) 2>/dev/null; sleep 2; cd apps/web && npx next dev --port 3000`
> This does NOT affect production — `next build` + `next start` serves pre-compiled files with no file watcher or HMR.

**Next.js stuck on "載入中..." / unresponsive:**
- **Symptom**: Page shows loading spinner forever, `curl http://localhost:3000/` hangs or times out, browser tab keeps loading
- **Cause**: Turbopack hot-reload loop — process runs at >100% CPU and stops serving requests. Happens frequently (every 15-30 min) during active code editing. More likely with rapid file changes or long-running sessions.
- **Diagnosis**: `ps -p $(lsof -ti:3000) -o %cpu,etime` — if CPU >60% and uptime >15min, it's likely stuck
- **Fix**: Force kill and restart:
  ```bash
  kill -9 $(lsof -ti:3000) 2>/dev/null   # Force kill (regular kill may not work)
  sleep 2
  cd apps/web && npx next dev --port 3000  # Restart fresh
  ```
- **Note**: This is purely a dev-mode issue. Production (`next build` + `next start`) has no file watcher, no HMR, no Turbopack — so this never happens in production.

**NestJS `ERR_MODULE_NOT_FOUND` on @repo/shared:**
- **Symptom**: `Cannot find module '.../shared/src/types'` at startup
- **Cause**: `@repo/shared` uses extensionless TS imports that Node ESM can't resolve
- **Fix**: Build first, then run with `tsx` loader (see Worktree Guide section 3)

**NestJS `ConfigService` undefined (TypeError: Cannot read properties of undefined):**
- **Symptom**: `new RedisService` crashes because `configService.get()` is undefined
- **Cause**: Running `npx tsx src/main.ts` directly — tsx resolves imports but NestJS DI doesn't initialize `ConfigModule` before constructors run
- **Fix**: Use `nest build` + `node --import tsx dist/main.js` instead of `npx tsx src/main.ts`

**Port already in use:**
- **Diagnosis**: `lsof -iTCP:PORT -sTCP:LISTEN -P` to find the process
- **Fix**: `kill $(lsof -ti:PORT)` then restart

**Multiple stale NestJS processes:**
- **Diagnosis**: `ps aux | grep -E "nest|node.*dist/main"` — look for multiple entries
- **Fix**: Kill all and restart only one:
  ```bash
  kill $(lsof -ti:4000) 2>/dev/null
  ps aux | grep "nest start" | grep -v grep | awk '{print $2}' | xargs kill 2>/dev/null
  ```

**npx fails with `spawn sh ENOENT` in worktree:**
- **Symptom**: `npm error enoent spawn sh ENOENT` when running `npx jest` or similar
- **Fix**: Use direct binary paths instead: `node_modules/.bin/jest`, `node_modules/.bin/playwright`
- **Also ensure PATH includes**: `export PATH="/opt/homebrew/opt/node@22/bin:/usr/bin:/bin:$PATH"`

**Jest config not found:**
- **Config file**: `apps/api/jest.config.js` (NOT `.ts`)
- **Direct run**: `node_modules/.bin/jest --config apps/api/jest.config.js`

**ANTHROPIC_API_KEY not picked up from .env (AI provider warning despite key in .env):**
- **Symptom**: NestJS logs `No AI providers configured!` even though `ANTHROPIC_API_KEY=sk-ant-...` is in `.env`
- **Cause**: Claude Code sets `ANTHROPIC_API_KEY=` (empty) and `ANTHROPIC_BASE_URL=...` in the shell environment. dotenv v17 does NOT override existing env vars by default — the empty shell var wins over `.env`.
- **Diagnosis**: `env | grep ANTHROPIC` — if you see `ANTHROPIC_API_KEY=` (empty), that's the problem
- **Fix**: Explicitly export the key before starting NestJS:
  ```bash
  export ANTHROPIC_API_KEY="$(grep ANTHROPIC_API_KEY apps/api/.env | cut -d= -f2)"
  node --import tsx dist/main.js
  ```
- **Verify**: Look for `Claude provider initialized` in the startup log (instead of `No AI providers configured!`)

## Known Issues / Notes
- **TODO: First-time user welcome message**: New users receive 2 free credits on signup. We should show a welcome toast/modal on first login that says something like "歡迎！您已獲得 2 點免費額度，立即開始您的命理分析之旅！" (Welcome! You've received 2 free credits. Start your fortune analysis journey now!). This could be triggered by checking if `user.credits === 2 && user.baziReadings.length === 0` or via a `welcomeShown` flag.
- **TODO: Deferred cleanup — remove `freeReadingUsed` column**: The `freeReadingUsed` column in the User model is deprecated (always `true` for all users). It should be removed in a future PR along with: Prisma schema field, `payments.service.ts` response field, `UserProfile`/`AdminUser`/`AdminUserDetail` TypeScript interfaces, CSS classes (`.freeBadge`, `.freeTrialBar`), and related test assertions. The column is harmless to keep.
- **Stripe inactive product workaround**: Stripe checkout creates ad-hoc products via `product_data` which can become inactive. The `upgradeSubscription()` method in `stripe.service.ts` checks if the current product is active; if inactive, it creates a new Stripe product via `stripe.products.create()` before calling `subscriptions.update()`. Note: `product_data` is only available in Checkout Sessions, NOT in `subscriptions.update()` — must create product separately.
- **Stripe plan change uses inline `price_data`**: Since prices are admin-configurable (not stored as Stripe Price IDs), both upgrade and downgrade use `subscriptions.update()` with `items[0].price_data` + `proration_behavior: 'create_prorations'`. This is the Stripe-recommended approach for dynamic pricing.
- **Clerk deprecated props**: `afterSignInUrl`/`afterSignUpUrl` env vars should be migrated to `fallbackRedirectUrl`/`forceRedirectUrl`
- **Clerk phone requirement**: Phone number is set to "required" in Clerk Dashboard — blocks Google sign-in flow. Should be changed to "optional" in Clerk Dashboard → Configure → Email, Phone, Username
- **Next.js 16 middleware deprecation**: "middleware" file convention is deprecated, should use "proxy" instead
- **Joi validation fix**: API env vars use `.allow('')` for optional keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) to allow empty strings in `.env`
- **AI mock data**: Both Bazi and ZWDS AI readings use mock data on frontend. Chart calculations are real. AI interpretation requires API keys in `apps/api/.env`
- **Sentry**: `@sentry/nextjs` is in next.config.js but runs silently when no SENTRY_AUTH_TOKEN is set
- **@repo/shared runtime issue**: NestJS files must NOT import from `@repo/shared` at runtime — inline constants instead. See "Worktree Development Guide" above.
- **ZWDS missing True Solar Time**: The ZWDS engine (iztro via `/api/zwds-calculate`) does NOT use city/longitude for True Solar Time correction — it takes wall clock time directly as the 時辰. The Bazi engine correctly applies TST via `solar_time.py`. Future task: before calling iztro, convert user's birth time to True Solar Time using the city longitude, then derive the iztro time index from the corrected time. Without this fix, ZWDS charts for western China (e.g., 烏魯木齊, 拉薩) may use the wrong 時辰.
