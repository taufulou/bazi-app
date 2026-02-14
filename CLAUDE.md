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

### Upcoming Work (Priority Order)

#### 1. Wire Frontend to NestJS API (Phase 10)
Currently the reading page (`apps/web/app/reading/[type]/page.tsx`) calls engines directly and uses mock AI data. The NestJS backend already has full endpoints ready — just need to connect them.

**What exists (backend — all built & tested):**
- `POST /api/bazi/readings` — Bazi reading (calls Python engine + AI provider, deducts credits, saves to DB)
- `GET /api/bazi/readings/:id` — Get saved Bazi reading
- `POST /api/bazi/comparisons` — Bazi compatibility
- `POST /api/zwds/readings` — ZWDS reading (calls iztro + AI provider, deducts credits, saves to DB)
- `GET /api/zwds/readings/:id` — Get saved ZWDS reading
- `POST /api/zwds/chart-preview` — Free ZWDS chart (no AI, no credits)
- `POST /api/zwds/horoscope` — ZWDS horoscope for date
- `POST /api/zwds/cross-system` — Combined Bazi+ZWDS reading
- `POST /api/zwds/deep-stars` — Deep star analysis
- `POST /api/zwds/comparisons` — ZWDS compatibility
- All endpoints require Clerk JWT (`Authorization: Bearer ${token}`) except @Public() ones

**What needs to change (frontend):**
1. **Create `apps/web/app/lib/readings-api.ts`** — API client functions for creating/fetching readings via NestJS
2. **Modify `apps/web/app/reading/[type]/page.tsx`** `handleFormSubmit()`:
   - Signed-in users: Call NestJS API (`POST /api/bazi/readings` or `POST /api/zwds/readings`) with Clerk JWT token
   - Not signed-in users: Keep current direct engine calls (free chart preview, no AI)
   - Parse response: NestJS returns `{ calculationData, aiInterpretation }` — feed `calculationData` to BaziChart/ZwdsChart, feed `aiInterpretation` to AIReadingDisplay
3. **Remove mock AI functions** — `generateMockReading()` and `generateMockZwdsReading()` at bottom of page.tsx (~130 lines of mock data)
4. **Handle errors**: Insufficient credits → show subscription CTA; AI provider failure → show chart-only (graceful degradation already built in backend)
5. **Add reading history page** — `GET /api/users/me/readings` endpoint already exists, need frontend page to display past readings
6. **Prerequisites**: AI API keys must be set in `apps/api/.env` (ANTHROPIC_API_KEY or OPENAI_API_KEY or GOOGLE_AI_API_KEY) — at least one provider needed

**Key implementation detail:** The NestJS reading endpoints return the same `calculationData` JSON structure that the frontend already parses for BaziChart/ZwdsChart. The `aiInterpretation` is structured JSON with `sections[key].preview` / `.full` matching what AIReadingDisplay expects. So the chart/reading components need NO changes — only the data-fetching layer in page.tsx changes.

#### 2. Phase 5: Monetization & Payment
Stripe integration, subscription plans (Free/Basic/Pro/Master), credit system, Apple IAP, Google Play billing. DB models (Subscription, Transaction, Plan) already exist.

#### 3. Mobile App
React Native Expo app (skeleton exists in `apps/mobile/`, needs reading flow)

## Total Tests: 462 (16 suites) — all passing

## Known Issues / Notes
- **Clerk deprecated props**: `afterSignInUrl`/`afterSignUpUrl` env vars should be migrated to `fallbackRedirectUrl`/`forceRedirectUrl`
- **Clerk phone requirement**: Phone number is set to "required" in Clerk Dashboard — blocks Google sign-in flow. Should be changed to "optional" in Clerk Dashboard → Configure → Email, Phone, Username
- **Next.js 16 middleware deprecation**: "middleware" file convention is deprecated, should use "proxy" instead
- **Joi validation fix**: API env vars use `.allow('')` for optional keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) to allow empty strings in `.env`
- **AI mock data**: Both Bazi and ZWDS AI readings use mock data on frontend. Chart calculations are real. AI interpretation requires API keys in `apps/api/.env`
- **Sentry**: `@sentry/nextjs` is in next.config.js but runs silently when no SENTRY_AUTH_TOKEN is set
- **ZWDS missing True Solar Time**: The ZWDS engine (iztro via `/api/zwds-calculate`) does NOT use city/longitude for True Solar Time correction — it takes wall clock time directly as the 時辰. The Bazi engine correctly applies TST via `solar_time.py`. Future task: before calling iztro, convert user's birth time to True Solar Time using the city longitude, then derive the iztro time index from the corrected time. Without this fix, ZWDS charts for western China (e.g., 烏魯木齊, 拉薩) may use the wrong 時辰.
