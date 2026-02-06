# Bazi SaaS Platform — Project Context

## What is this?
AI-powered Bazi (八字) fortune-telling SaaS platform inspired by 先知命局 (SeerOnNet). Two-layer architecture: Python deterministic Bazi calculation + Claude AI interpretation with structured JSON output supporting preview/full per section for paywall.

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
  web/          — Next.js 16 web app (ClerkProvider, dark theme, zh-TW)
  api/          — NestJS 11 API (28 endpoints, Clerk JWT guard, rate limiting, Swagger)
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
- `ai/` — AI interpretation service with provider abstraction, failover chain, caching
  - `ai.service.ts` — Provider calls (Claude/GPT/Gemini), prompt building, response parsing, cache
  - `ai.module.ts` — NestJS module (exported, imported by BaziModule)
  - `prompts.ts` — System prompts for all 6 reading types, output format, template interpolation
- `payments/` — Subscription status, transaction history, payment gateways (public)
- `admin/` — Dashboard stats, services/plans/promo/prompts management, audit log
- `webhooks/` — Clerk user.created/updated/deleted → sync to PostgreSQL
- `prisma/` — Global PrismaService
- `redis/` — Global RedisService with caching, rate limit helpers
- Rate limiting: @nestjs/throttler (100 req/min default), helmet security headers

## Auth Flow
- Web: Clerk middleware protects all routes except `/`, `/sign-in`, `/sign-up`, `/api/webhooks`
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

## V1 Reading Types
1. 八字終身運 (Lifetime) — 2 credits
2. 八字流年運勢 (Annual) — 2 credits
3. 事業財運 (Career) — 2 credits
4. 愛情姻緣 (Love) — 2 credits
5. 先天健康分析 (Health) — 2 credits
6. 合盤比較 (Compatibility) — 3 credits

## Important Notes
- Docker is NOT available on this machine — use Homebrew services (PostgreSQL, Redis) instead
- Prisma v6 (not v7) — v7 has breaking constructor changes incompatible with traditional server setup
- The full implementation plan is at `~/.claude/plans/magical-dancing-moonbeam.md`
- Entertainment disclaimer required: 「本服務僅供參考與娛樂用途，不構成任何專業建議」
- AI fallback chain: Claude Sonnet 4.5 → GPT-5.2 → Gemini 3

## AI Interpretation Layer
- **Provider chain**: Claude Sonnet 4.5 (primary) → GPT-4o (fallback) → Gemini 2.0 Flash (fallback)
- **Prompt system**: 6 reading-specific system prompts with template interpolation from Bazi data
- **Output format**: Structured JSON with `sections[key].preview` (free users) / `.full` (subscribers)
- **Caching**: SHA-256 hash of (birthDate + birthTime + city + gender + readingType + targetYear) → Redis (24h) + DB (30d)
- **Cost tracking**: Every AI call logged to `ai_usage_log` table (tokens, cost, latency, provider)
- **Admin override**: PromptTemplate DB table allows editing prompts per reading type + provider without deploy
- **Graceful degradation**: If all AI providers fail, reading is saved with calculationData only (no AI text)
- **Tests**: 48 tests for prompts, response parsing, caching, hash generation, provider initialization

## Environment Files
- `apps/web/.env.local` — NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, routing vars
- `apps/api/.env` — DATABASE_URL, REDIS_URL, CLERK keys, CLERK_WEBHOOK_SECRET, BAZI_ENGINE_URL, AI API keys
- `apps/mobile/.env` — EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
- `.env.example` — Template with all env vars (safe to commit)

## Phase Status
- ✅ Phase 1: Foundation (Steps 1-4 complete — monorepo, DB, auth, API)
- ✅ Phase 2: Bazi Engine (Steps 5-6 complete — calculation engine, luck periods, compatibility, 121 tests passing)
- ✅ Phase 3: AI Interpretation (Steps 7-8 complete — provider abstraction, 6 reading prompts, failover chain, reading cache, 48 tests passing)
- ⏳ Phase 4: Frontend UI (Steps 9-11 — birth data input, Bazi chart display, AI reading display with paywall)
- ⏳ Phase 5-7: See implementation plan
