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
apps/web/     — Next.js 16 (ClerkProvider, dark theme, zh-TW)
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

## Design Theme
- Background: `#1a1a2e`, Accent: `#e8d5b7`, Card BG: `#16213e`
- Text: `#e0e0e0` (primary), `#a0a0a0` (secondary)
- Target: Taiwan, Hong Kong, Malaysia. Primary language: zh-TW

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

## Total Tests: ~968
- Bazi Engine: 451 (450 pass, 1 skip) | NestJS API: 157 | Frontend: 71 | ZWDS: 289

## Reading Types
18 total: 6 Bazi + 10 ZWDS + 2 Special. Credits: 1-3 per reading. See `docs/monetization.md` for pricing.

## Worktree Development Guide
When working in a git worktree (`.claude/worktrees/`):

### 1. Copy environment files
```bash
MAIN="/Users/roger/Documents/Python/Bazi_Plotting"
cp "$MAIN/apps/web/.env.local" apps/web/.env.local
cp "$MAIN/apps/api/.env" apps/api/.env
```

### 2. Generate Prisma client
```bash
cd apps/api
npx prisma@6 generate && npx prisma@6 migrate deploy
```

### 3. Start NestJS API
```bash
cd apps/api
../../node_modules/.bin/nest build
node --import tsx dist/main.js
```
The `tsx` loader resolves extensionless `.ts` imports in `@repo/shared`. Other approaches fail — see `docs/phase-details.md` for details.

### 4. Start Next.js
```bash
cd apps/web && npx next dev --port 3000
```

### 5. PostgreSQL CLI
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
- `docs/ai-prompt-engineering.md` — Anti-hallucination rules, prompt placeholders, validation, cache clearing
- `docs/monetization.md` — Competitor pricing, 5 revenue streams, subscription plans, content access matrix
- `docs/phase-11-bazi-interpretation.md` — Three-layer architecture, engine bugs fixed, pre-analysis rules, domain mapping
- `docs/phase-12-specs.md` — 三合/三會 scoring, 從格+三合 detection, 生化鏈 analysis
- `docs/future-enhancements.md` — Phase 13 deep pre-analysis for AI consistency
- `docs/phase-details.md` — Phase 5/10 implementation details, frontend UI components, ZWDS engine
