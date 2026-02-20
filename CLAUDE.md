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
      interpretation_rules.py — Pre-analysis orchestrator + Ten God position rules + 從格 + Day Master V2
      stem_combinations.py — 天干合化 (5 pairs) + 天干七沖 (4 opposition pairs)
      branch_relationships.py — 地支關係 (六合/六沖/三合/三會/三刑/六害/六破 + 自刑 + 半合)
      timing_analysis.py — 歲運並臨/伏吟/反吟/天剋地沖 + 大運×natal + 流年×natal interactions
    tests/            — 451 tests (121 original + 210 Phase 11B + 107 Phase 11D + 12 Shen Sha fixes + 1 skip), all passing
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
- **True Solar Time**: Code exists for longitude correction + Equation of Time (Spencer's formula) + DST detection, but is **DISABLED by default** — pillar calculations use wall clock time to match all major platforms (科技紫微網, 先知命局, 靈機八字). TST data is still computed and returned in output for informational purposes. Can be re-enabled in `four_pillars.py` for future opt-in.
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
- **ZWDS school**: Default to 全書派 (Chen Xi-Yi) system — most widely recognized (~60% of apps)
- **Retention flywheel**: Free chart (hook) → chart preview → watch ad or subscribe → monthly notifications → annual renewal → share compatibility → friend joins

### Competitor Pricing Research (Feb 2025)

#### 科技紫微網 (Click108) — Taiwan #1, 10M+ members
- 白金會員 經典造命版: **NT$3,600/yr** (~US$110/yr, ~US$9.17/mo)
- 白金會員 親友無限版: **NT$8,800/yr** (~US$269/yr, ~US$22.42/mo)
- App 白金會員一年期 (iOS): **US$99.99/yr** (~US$8.33/mo)
- Live master consultation (30 min): **NT$800** (~US$24)
- New user promotion: 150元 活動幣 free
- Model: Annual subscription + per-reading purchases + virtual coins + web ads + LINE notifications

#### 先知命局 (SeerOnNet) — HK-based, 10M+ users (our inspiration)
- Weekly subscription: **HK$88/wk** (~US$11.28/wk)
- Monthly subscription: **HK$148/mo** (~US$19/mo)
- Annual subscription: **HK$288/yr** (~US$37/yr, ~US$3.08/mo!)
- iOS Monthly membership: **US$19.99/mo**
- iOS Annual membership: **US$39.90/yr**
- Point packages: HK$58 (6pt) → HK$7,888 (800pt), bulk discount for larger packages
- Monthly member benefits: 30 AI calculations, 30 八字 reports, 3 unlocked forecast reports, 5 talismans, 30 prayers
- Model: Subscription (weekly/monthly/yearly) + point/credit system + live master marketplace + spiritual products

#### 桃桃喜 (TaoTaoXi) — Taiwan, founded by 簡少年
- 2026 全年運勢詳批: **NT$498** (~US$15.24)
- 真愛太歲合盤 / 職場合盤 / 真命天子何時出現: **NT$349** each (~US$10.68)
- 面相AI運勢分析: **NT$349** (~US$10.68)
- Online courses: Feng Shui, ZWDS, numerology (various prices)
- Model: Per-reading one-time purchases + online courses, no refund policy

#### 靈機八字 (Linghit Bazi) — HK-based, 100M+ total users across apps
- 福幣 (Fortune Coins) packages: NT$30 (600幣) → NT$3,990 (88,800幣)
- Premium wish tokens: **NT$150** each
- 合婚 Compatibility: **NT$390**
- Model: Virtual currency (福幣) system + per-feature purchases + spiritual products

#### 紫薇斗數 App (Independent ZWDS App)
- Per-section unlock: 宮位運勢解析 **NT$120**, 運勢宮位解析 **NT$190**
- 必知必懂問題: **NT$320 – NT$490**
- 健康報告: **NT$320**, 流年/姻緣: **NT$990** each
- 宮位運勢全開卡 (full unlock): **NT$2,990**
- Model: Freemium + per-section unlock + full bundle unlock

### Our Monetization Model (5 Revenue Streams)

#### Stream 1: Subscription Plans
| Plan | Monthly (USD) | Annual (USD) | TWD Monthly | TWD Annual |
|------|--------------|-------------|------------|-----------|
| Free | $0 | $0 | $0 | $0 |
| Basic | $4.99 | $39.99 (~$3.33/mo) | NT$160 | NT$1,290 |
| Pro | $9.99 | $79.99 (~$6.67/mo) | NT$330 | NT$2,590 |
| Master | $19.99 | $159.99 (~$13.33/mo) | NT$650 | NT$5,190 |

Positioning: Below Click108 (NT$3,600/yr) at our Pro level, competitive with SeerOnNet monthly

#### Stream 2: Per-Reading Credit Purchase (à la carte, non-subscribers)
- Credits purchased via credit packages (see Stream 5)
- Credit costs per reading type defined in `Service.creditCost` (admin-configurable)
- e.g., Basic Bazi = 2 credits, Compatibility = 3 credits, Cross-system = 4 credits

#### Stream 3: Per-Section Unlock (granular)
- Unlock just 財運, 愛情, or 健康 section from a reading
- 3 unlock methods: 1 credit, watch 1 rewarded ad, or pay NT$60 (~US$1.99) cash
- Validates: ZWDS apps charge NT$120-990 per section

#### Stream 4: Rewarded Video Ads (blue ocean — no competitor does this well)
- Watch ad → unlock 1 section of AI reading
- Watch ad → earn 1 free credit
- Watch ad → view daily ZWDS horoscope
- Watch 3 ads → unlock 1 full basic reading
- Limit: 5 rewarded ad views per day (prevent abuse, maintain premium feel)
- Non-subscribers only (subscribers see no ads)
- Target: Google AdMob (best TW/HK/MY coverage)
- Taiwan eCPM: ~US$11-16 (iOS), ~US$11 (Android)

#### Stream 5: Credit/Coin Packages (bulk purchase)
- Virtual currency with bulk discount to encourage larger purchases
- e.g., 5 credits = $4.99, 12 credits = $9.99, 30 credits = $19.99
- All prices admin-configurable from backend (no redeploy needed)

### Content Access Matrix
```
Ways to ACCESS content:
├── Subscriber (Basic/Pro/Master) → included readings based on tier, no ads
├── Credits (à la carte)
│   ├── Buy credit packages with cash (bulk discount)
│   ├── Earn 1 free credit by watching an ad
│   └── Spend credits on full readings (2-4 credits each)
├── Per-section unlock (granular)
│   ├── 1 credit for one section
│   ├── Watch 1 ad to unlock one section (free)
│   └── Pay NT$60 cash for one section
└── Free tier
    └── Chart display only (no AI interpretation)
```

### Ads Revenue Data (Target Markets)
| Market | Rewarded Video eCPM (iOS) | Rewarded Video eCPM (Android) |
|--------|---------------------------|-------------------------------|
| Taiwan | ~US$15.62 | ~US$11.00 |
| Hong Kong | ~US$8-12 (est.) | ~US$6-9 (est.) |
| Malaysia | ~US$4-6 (est.) | ~US$2-4 (est.) |
- Rewarded video completion rates: >95% (vs 60-70% for pre-roll)
- Subscription ARPU ~4.6× higher than ad-only ARPU

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
- **Three-layer architecture**: (1) Python Bazi Engine → raw chart data, (2) Python Pre-Analysis Layer → deterministic rule-based interpretation, (3) AI Narration → Claude/GPT writes compelling narrative from pre-analyzed results
- **Core principle**: Don't rely on AI to "know" Bazi rules. Compute interpretive insights deterministically, then let AI narrate them. This eliminates hallucination and ensures consistency.
- **Provider chain**: Claude Sonnet 4 (primary) → GPT-4o (fallback) → Gemini 2.0 Flash (fallback)
- **Prompt system**: 6 Bazi + 10 ZWDS + 2 special reading-specific system prompts with template interpolation
- **Pre-analysis output**: `preAnalysis` JSON with keyFindings, pillarRelationships, tenGodPositionAnalysis, careerInsights, loveInsights, healthInsights, timingInsights
- **Output format**: Structured JSON with `sections[key].preview` (free users) / `.full` (subscribers)
- **max_tokens**: 8192 (increased from 4096 to allow full-length readings ~3500-4000 chars across 5 sections)
- **Caching**: SHA-256 hash of (birthDate + birthTime + city + gender + readingType + targetYear + targetMonth + targetDay + questionText) → Redis (24h) + DB (30d)
- **Cost tracking**: Every AI call logged to `ai_usage_log` table (tokens, cost, latency, provider)
- **Admin override**: PromptTemplate DB table allows editing prompts per reading type + provider without deploy. **⚠️ CRITICAL: DB templates were deactivated (all 48 rows set `is_active=false`) because they used wrong placeholders (`{{calculation_data}}`) that `interpolateTemplate()` doesn't recognize. If re-activating DB templates, they MUST use the correct placeholders (see "Prompt Placeholder Reference" below).**
- **Admin AI costs page**: `/admin/ai-costs` shows 30-day aggregates, provider breakdown, daily chart
- **Graceful degradation**: If all AI providers fail, reading is saved with calculationData only (no AI text)
- **Current status**: AI interpretation fully working with Claude Sonnet 4. Validated 100% accuracy on real readings.
- **Tests**: 48 tests for prompts, response parsing, caching, hash generation, provider initialization

### AI Prompt Engineering — Lessons Learned & Rules

These hard-won findings from debugging real AI readings (Roger5-Roger8) must be preserved for future prompt work.

#### Critical Bug History
| Reading | Bug | Root Cause | Fix |
|---|---|---|---|
| Roger5 | AI fabricated wrong pillars (甲 as month stem, 丙 as hour stem) | No anti-hallucination rules in prompt; AI "computed" its own pillars | Added "絕對禁止" + "天干與藏干的區別" sections to BASE_SYSTEM_PROMPT |
| Roger6 | "please provide data" — empty AI output | DB `prompt_templates` (48 rows) overrode hardcoded prompts with wrong placeholders | Deactivated all 48 DB templates (`is_active=false`) |
| Roger7 | Used "偏強" instead of correct "中和" | Two conflicting strength fields: legacy `strength=strong` vs V2 `classification=neutral`; AI picked legacy | Reordered V2 first with ⚠️ marker; added "日主強弱判定規則" constraint |
| Roger8 | ✅ 100% accuracy (58/58 checks) | All fixes applied | — |

#### Anti-Hallucination Rules (in `prompts.ts` BASE_SYSTEM_PROMPT)
The AI WILL fabricate Bazi data if not explicitly constrained. These rules are MANDATORY:

1. **"絕對禁止" section** — 5 absolute prohibitions:
   - Never compute/modify Four Pillars (must use provided data verbatim)
   - Never promote hidden stems (藏干) to manifest stems (天干)
   - Never fabricate stem+branch combinations

2. **"天干與藏干的區別" section** — Prevents the #1 hallucination pattern:
   - Only 4 manifest stems exist (年干/月干/日干/時干)
   - Hidden stems must be labeled "藏於X支"
   - 格局 is defined by month branch hidden stem (e.g., 申中藏庚→食神格), but 庚 is NOT the month stem
   - "透干" status must match the preAnalysis `touganAnalysis` list exactly

3. **"日主強弱判定規則" section** — Prevents strength misclassification:
   - V2 strength (marked with ⚠️) takes absolute priority over legacy strength
   - AI must use the exact V2 classification term (極弱/偏弱/中和/偏強/極旺)
   - AI must NEVER override or "reinterpret" the system's strength assessment

4. **"驗證規則" section** — Cross-check rule:
   - Every pillar reference must match 【四柱排盤】 data exactly
   - Year/month/day/hour pillar references are individually constrained

#### Prompt Placeholder Reference
`interpolateTemplate()` in `ai.service.ts` recognizes these placeholders (and ONLY these):
```
{{gender}}, {{birthDate}}, {{birthTime}}, {{lunarDate}}, {{trueSolarTime}}
{{yearPillar}}, {{monthPillar}}, {{dayPillar}}, {{hourPillar}}
{{yearTenGod}}, {{monthTenGod}}, {{hourTenGod}}
{{yearHidden}}, {{monthHidden}}, {{dayHidden}}, {{hourHidden}}
{{pillarElements}}, {{lifeStages}}, {{kongWang}}
{{dayMaster}}, {{dayMasterElement}}, {{dayMasterYinYang}}
{{strength}}, {{strengthScore}}, {{strengthV2}}
{{pattern}}, {{sameParty}}, {{oppositeParty}}
{{favorableGod}}, {{usefulGod}}, {{tabooGod}}, {{enemyGod}}
{{wood}}, {{fire}}, {{earth}}, {{metal}}, {{water}}
{{luckPeriods}}, {{shenSha}}, {{yearNaYin}}, {{dayNaYin}}
{{preAnalysis}}
```
**⚠️ NEVER use `{{calculation_data}}`, `{{name}}`, `{{birth_date}}` — these are NOT recognized and will pass through as literal text, causing the AI to receive no data.**

#### DB Prompt Template Override Behavior
`buildPrompt()` in `ai.service.ts` (line ~520-531) checks `prompt_templates` DB table FIRST. If an active template exists for the reading type + provider, it COMPLETELY OVERRIDES the hardcoded prompt in `prompts.ts`. This means:
- DB templates must use the exact same `{{placeholder}}` names as listed above
- If DB templates have wrong placeholders, AI receives literal `{{calculation_data}}` text instead of actual data
- Current state: all 48 DB templates are `is_active=false` — system uses hardcoded `prompts.ts` (which is correct and validated)
- If re-enabling DB templates: copy placeholder format from `prompts.ts` LIFETIME template as reference

#### Output Quality Factors
These settings collectively ensure high-quality, detailed AI readings (~3500-4000 chars total):
| Factor | Setting | Location |
|---|---|---|
| Token budget | `max_tokens: 8192` | `ai.service.ts` |
| Per-section length | "full 約500-800字" | `prompts.ts` OUTPUT_FORMAT_INSTRUCTIONS |
| Minimum length | "至少 300 字 per section" | `prompts.ts` OUTPUT_FORMAT_INSTRUCTIONS |
| Rich input data | preAnalysis JSON (~200-300 tokens) | `interpretation_rules.py` → `ai.service.ts` `formatPreAnalysis()` |
| Specificity | Anti-hallucination rules force data citation | `prompts.ts` BASE_SYSTEM_PROMPT |

#### Validation Methodology
When testing AI reading accuracy, run a comprehensive check covering:
1. **Structure**: JSON has all expected sections with preview/full, each full ≥300 chars
2. **Four Pillars**: All 4 correct pillars present, no fabricated pillars
3. **Stem attribution**: Month/hour stems match data, hidden stems not promoted
4. **Strength classification**: Uses V2 term (中和/偏強/etc.), no legacy override
5. **Ten Gods & Pattern**: Correct 格局, correct Ten God per pillar
6. **Luck periods**: Referenced from data, not fabricated
7. **透干 handling**: Matches preAnalysis touganAnalysis list
8. **Anti-hallucination**: No "please provide", no English, no markdown fences
See `/tmp/validate_roger8.mjs` for a full 58-check validation script template.

#### Cache Clearing After Prompt Changes
After ANY prompt modification, you MUST clear both cache layers or users will get stale readings:
```bash
redis-cli FLUSHALL
/opt/homebrew/opt/postgresql@15/bin/psql -U bazi_user -d bazi_platform -c "DELETE FROM reading_cache;"
```
Then rebuild NestJS: `cd apps/api && ../../node_modules/.bin/nest build`

## Bazi Interpretation Enhancement Strategy (Phase 11)

### Review Status
- 3× Staff Engineer reviews (approved)
- 3× Bazi Domain Expert reviews (3 agents each round, approved)
- 1× Web Research Validation against Chinese-language Bazi textbook sources (百度百科, 三命通會, 國易堂, 滴天髓)
- Full plan with complete rule databases: `/Users/roger/.claude/plans/optimized-wandering-knuth.md`

### Architecture: Three Layers
```
User Birth Data
    ↓
Layer 1: Python Bazi Engine (existing)
    ├── Four Pillars, Ten Gods, Five Elements, Shen Sha, etc.
    ↓
Layer 2: Python Pre-Analysis (NEW — deterministic rules)
    ├── interpretation_rules.py — main orchestrator + Ten God position rules + 從格 + conflict resolution
    ├── stem_combinations.py — 天干合化 (5 pairs) + 天干七沖 (4 opposition pairs)
    ├── branch_relationships.py — 地支關係 (六合/六沖/三合/三會/三刑/六害/六破 + 自刑 + 半合)
    ├── timing_analysis.py — 歲運並臨/伏吟/反吟/天剋地沖 + 大運×natal + 流年×natal interactions
    └── Output: preAnalysis JSON (keyFindings, careerInsights, loveInsights, etc.)
    ↓
Layer 3: AI Narration (enhanced prompts)
    ├── Receives: raw data + preAnalysis + constraints
    ├── Task: narrate, DON'T compute rules
    └── Output: structured JSON (preview/full per section)
```

### Engine Bugs Fixed (Phase 11B)
1. **FIXED** `constants.py` TIANYI_GUIREN['庚'] = ['丑','未'] → ['寅','午'] (modern practice school; 《三命通會》 orthodox uses 丑未 — two valid schools exist, we follow modern for consistency with majority of Bazi software)
2. **FIXED** `constants.py` SEASON_STRENGTH — full audit of ALL 5 element rows against canonical 旺相休囚死 table (旺=5, 相=4, 休=3, 囚=2, 死=1). Every column now sums to exactly 15. Verified: each element uses all 5 scores across 12 branches.
3. **FIXED** `ten_gods.py` get_prominent_ten_god(): Added 透干 priority check — month branch hidden stems that appear as manifest stems in year/month/hour now take priority over 本氣 (Source: 《子平真詮》)
4. **FIXED** `interpretation_rules.py` 得令 scoring: Changed from stem-specific Life Stage to element-wide SEASON_STRENGTH (旺相休囚死). Life Stage gives wrong results for Yin stems (e.g., 丁's Life Stage in 寅 = 死, but Fire is 相 in Spring because Wood produces Fire). Professional masters use 旺相休囚死 for 得令 assessment. Validated against 4 historical charts.

### Data Gap (Currently NOT Fed to AI)
1. 十二長生 (Life Stages) — per pillar, calculated but never sent
2. 空亡 (Kong Wang) — calculated but never sent
3. Individual pillar elements + yinyang — available but not sent
4. Pillar-position significance — no context about what each pillar represents
5. Season/月令 context — engine calculates season score but doesn't tell AI
6. Na Yin — only sent for Lifetime readings, not Career/Love/Health

### New Calculations to Add to Engine

#### Tier 1 (Fundamental Accuracy)
- **天干合化** (5 stem combinations): 甲己→土, 乙庚→金, 丙辛→水, 丁壬→木, 戊癸→火. Check adjacent pairs, default to **合而不化** (combining without transforming — true transformation is rare and controversial). Do NOT recalculate Day Master. Flag when Day Master is involved (critical for love readings).
- **天干七沖** (Stem Clashes): 4 opposition pairs (甲庚, 乙辛, 丙壬, 丁癸) across 6 stem-pair combinations. Track independently from branch clashes.
- **地支關係** within single chart: Check all 6 branch pairs for 六合/六沖/三合/三會/三刑/六害/六破. Score hierarchy (confirmed by web research): 三會(100) > 三合(90) > 六合(80) > 前半合(70) > 後半合(60). Pillar-specific clash effects (年日沖=命運不穩定, 月日沖=內在矛盾, etc.)
- **Refined Day Master 3-factor scoring** (0-100 scale, `strengthScoreV2`):
  - 得令 (50%): Uses `SEASON_STRENGTH` (旺相休囚死) mapped via `SEASON_DELING_SCORE` (旺=50, 相=40, 休=25, 囚=12, 死=0). This is element-wide seasonal support, NOT stem-specific Life Stage. **Critical fix:** Life Stage gives wrong results for Yin stems (e.g., 丁 in 寅月 Life Stage=死, but Fire is 相 in Spring). Validated against 4 historical charts. Source: 《子平真詮·論旺相休囚死》.
  - 得地 (30%): 通根 root depth in all branch hidden stems. Pillar weights (per 《子平真詮》, confirmed by web research): **month=35%, day=30%, hour=20%, year=15%** (traditional 月支 > 日支 > 時支 > 年支 primacy; month slightly reduced from ~40% as moderate compromise since 得令 already captures seasonal resonance).
  - 得勢 (20%): Count supporting elements across ALL stems AND branch main qi (本氣), not stems only. 7-8 data points instead of 4.
  - **Known limitation:** 3-factor score does NOT capture 三合/三會 element boosts or 生化鏈 (element flow chains). Charts with powerful triple harmonies may score lower than professional consensus. See Phase 12 for planned enhancements.
- **從格 (Following Pattern) detection** — CRITICAL, inverts entire 喜忌 system for ~3-8% of charts:
  - 從財格: 財 becomes 用神 (not 忌神)
  - 從官格: 官殺 becomes 用神
  - 從兒格: 食傷 becomes 用神 (special: allows minimal Day Master root)
  - 從勢格: No single element dominates >55%, but 食傷+財+官殺 all compete while Day Master has no root
  - Yang/Yin distinction (《滴天髓》): Yang Day Masters cannot 從 with ANY 印/比劫; Yin Day Masters may form 假從 with one isolated 印/比劫
  - Must check ENTIRE chart (stems AND branch hidden stems), not just manifest stems
  - Runs BEFORE determine_favorable_gods()

#### Tier 2 (Significant Depth)
- **Shen Sha expansion** (8 → 27 types): Add 紅鸞, 天喜, 天德貴人, 月德貴人, 太極貴人, 國印貴人, 金輿, 天醫, 學堂, 孤辰, 寡宿, 災煞, 劫煞, 亡神, 天羅/地網, 魁罡日, 陰陽差錯日, 十惡大敗日, 福星貴人. All have exact lookup tables. 文昌 and 學堂 now check both Day Stem and Year Stem (dual-lookup per mainstream practice, matching 元亨利貞網). This is an enhancement to align with the broader school — the Day-Stem-only school is also valid but less common in modern software. 國印貴人 Year Stem dual-lookup deferred pending 《三命通會》verification.
- **Special day pillar detection**: 魁罡日 (庚辰/庚戌/壬辰/戊戌), 陰陽差錯日 (12 days), 十惡大敗日 (10 days — 己丑 not 乙丑, confirmed by mathematical proof and 《三命通會》).
- **Timing analysis with natal chart interaction**: 歲運並臨, 天剋地沖, 伏吟/反吟 + 大運 branch × natal branches (六沖/六合/三合/六害) + 流年 stem × natal stems (天干合/天干沖) + 大運 × 流年 interaction.
- **Gender-aware Ten God position rules**: Split 40-rule table into male/female versions. Key: Female 正官=husband, 七殺=romance (opposite of male). 官殺混雜 (female only) = severe marriage warning.
- **透干 (Tou Gan) analysis**: Check if hidden stem Ten Gods appear as manifest stems — 透干=full power, 藏而不透=latent.
- **用神 合絆 (locking) detection**: When stem carrying 用神 combines with another stem, 用神 is "tied up".
- **墓庫 analysis**: 辰/戌/丑/未 store specific elements. 沖開墓庫 detection.
- **Conflict resolution layer**: Priority hierarchy — 從格 > 合絆 > 三合/三會 > 格局 > 官殺混雜(female only)

#### Tier 3 (Deferred to Phase 12)
- **三合/三會 element boost in strength scoring**: Add 4th factor to `strengthScoreV2`. See Phase 12 specs below.
- **從格 detection with 三合 transformation**: Enhance `check_cong_ge()` to consider triple harmony element conversion. See Phase 12 specs below.
- **生化鏈 (element flow chain) analysis**: Detect and score unblocked production chains. See Phase 12 specs below.
- **Na Yin deep interpretation**: Quality grades per Na Yin type, personality mapping — not enough textbook consensus.
- **用神 pattern-based selection for neutral charts** (~30-40% of charts): 中和 Day Master → 用神 follows 格局 not binary strong/weak.
- **得令 finer granularity**: Use solar term position within month (e.g., Fire in 寅 early Spring vs 卯 mid Spring).

### Ten Gods Position Rules (40 rules: 10 gods × 4 positions)
Each of the 10 Ten Gods has different meanings depending on which pillar (年柱/月柱/日支/時柱) it appears in. Key examples:
- 正官 in 月柱 = most auspicious position for career/authority
- 食神 in 月柱 = talent recognized early, one of most auspicious placements
- 傷官 in 日支 = spouse argumentative, marriage requires tolerance
- 偏印 in 日支 = late marriage, spouse complications
- 正財 in 日支 = capable/virtuous spouse, excellent marriage
Complete 40-rule database documented in `/Users/roger/.claude/plans/optimized-wandering-knuth.md`.

### Life Domain Mapping Rules
- **Career by 用神 Five Element**: 木=教育/醫療/出版, 火=科技/能源/媒體, 土=房地產/建築, 金=金融/法律, 水=貿易/旅遊/IT
- **Health by Five Elements**: 木→肝膽, 火→心小腸, 土→脾胃, 金→肺大腸, 水→腎膀胱 (excess/deficiency symptoms)
- **Love indicators**: Male: 正財=wife, 偏財=romance; Female: 正官=husband, 偏官=romance; 日支=spouse palace

### AI Prompt Constraints (updated per Phase 11C + prompt engineering fixes)
**System prompt rules (BASE_SYSTEM_PROMPT in prompts.ts):**
1. "絕對不可以自行推算四柱天干地支" — must use provided data verbatim
2. "絕對不可以將藏干當作天干使用" — hidden stems ≠ manifest stems
3. "數據中標有⚠️的日主強弱欄位是最終結論" — V2 strength takes absolute priority
4. "只有在透干清單中被標為透干的才算透干" — no guessing transparency
5. "驗證規則：提到任何天干地支必須確認與四柱排盤完全一致"

**Content rules:**
6. "所有分析必須完全基於提供的預分析結果和原始數據"
7. "重點分析段落必須引用命主具體天干地支，概要段落可適當概括"
8. "趨勢預測而非絕對事件"
9. "full 每section約500-800字，至少300字"
10. "預分析提供基礎框架，但請根據整體命局靈活調整，避免機械套用單一規則"

### Implementation Priority
| Phase | What | Impact | Effort |
|---|---|---|---|
| A | Send ALL existing data to AI + pillar context | +15% | 1-2 days |
| B | Pre-analysis layer — stem/branch/ten god/從格/conflict resolution/domain mapping | +40% | 5-7 days |
| C | Enhanced prompts with pre-analysis + constraints | +25% | 2-3 days |
| D | Additional Shen Sha (27 types), timing analysis with natal interactions | +15% | 3-5 days |
| E | Refined Day Master scoring (3-factor `strengthScoreV2`) | +5% | 1-2 days |

### New Files (Phase 11)
```
packages/bazi-engine/app/
  interpretation_rules.py  — Main pre-analysis orchestrator + Ten God position rules + 從格 + conflict resolution
  branch_relationships.py  — 地支關係 analysis (7 relationship types + 自刑 + 半合)
  stem_combinations.py     — 天干合化 (5 pairs) + 天干七沖 (4 opposition pairs)
  timing_analysis.py       — 歲運並臨/伏吟/反吟 + 大運×natal + 流年×natal interactions
```

### Detailed Research Reference
Full plan with complete rule databases (26 Shen Sha lookup tables, branch relationship tables, stem combination rules, 40 Ten God position rules, pattern classification, 從格 conditions, Day Master V2 formula, timing analysis, conflict resolution), review history (3 staff + 3 domain expert + 1 web research rounds), and implementation details:
`/Users/roger/.claude/plans/optimized-wandering-knuth.md`

---

## Phase 12 Specs: Bazi Accuracy Enhancements

These three enhancements address known accuracy gaps discovered during real-world validation against 4 historical charts (毛澤東, 蔣介石, 鄧小平, 周恩來). Each gap was confirmed by comparing our engine output against published professional Bazi analyses.

### 12A. 三合/三會 Element Boost in Strength Scoring

**Problem:** The current 3-factor `strengthScoreV2` (得令/得地/得勢) doesn't account for 三合/三會 formations that massively amplify element energy. Example: Zhou Enlai has 寅午戌三合火局 (full Fire triple harmony) which should make his Fire Day Master extremely strong, but scores 61.3 vs Chiang's 70.3 because the triple harmony boost isn't captured.

**Real-world impact:** ~15-20% of charts have 三合 or 三會 formations. Without this factor, strength scores for charts with powerful triple harmonies are systematically underestimated.

**Implementation:**

Add a 4th factor `得合` (alliance boost) to `calculate_strength_score_v2()` in `interpretation_rules.py`. Rebalance weights: 得令(40%) + 得地(25%) + 得勢(15%) + 得合(20%).

```python
# New factor: 得合 (20% weight) — 三合/三會 element boost
#
# When branches form a 三合 or 三會, the resulting element is massively amplified.
# If that element equals or produces the Day Master element, it's a huge boost.
# If it opposes the Day Master element, it's a suppression factor.
#
# Scoring:
#   三會 forming DM element:          +20 (full boost)
#   三會 forming element that produces DM: +14
#   三合 forming DM element:          +18
#   三合 forming element that produces DM: +12
#   前半合/後半合 forming DM element:    +10/+8
#   三會/三合 forming element that drains/克 DM: -10 to -15
#   No relevant 三合/三會:              +0 (neutral)
#
# Cap at 20 (max boost) or floor at 0 (no negative — suppression is handled by 得令).
```

**Data source:** Reuse `branch_relationships.py` output — `analyze_branch_relationships()` already detects all 三合/三會/半合 with `resultElement`. Just need to cross-reference the result element against the Day Master element.

**Files to modify:**
- `interpretation_rules.py` — add `_calculate_deye()` helper, update `calculate_strength_score_v2()` weight split and add 4th factor
- `test_interpretation_rules.py` — add tests for charts with/without 三合/三會
- `test_real_world_validation.py` — update expected scores and remove "known limitation" notes

**Validation:** Zhou Enlai should score higher than Chiang after this fix (寅午戌三合火 directly strengthens his 丁 Fire DM). Deng Xiaoping's score should drop further (申子辰三合水 opposes his 戊 Earth DM).

---

### 12B. 從格 Detection with 三合 Transformation

**Problem:** The current `check_cong_ge()` in `interpretation_rules.py` follows a strict rule from 《滴天髓》: Yang Day Masters cannot form 從格 if ANY 印/比劫 exists anywhere in the chart (including branch hidden stems). This fails for cases where 三合 transformation overwhelms residual roots.

**Real-world impact:** Deng Xiaoping (戊 Earth DM) has 申子辰三合水局 which is so powerful it effectively neutralizes the hidden 戊 root in 辰's tomb. Professional consensus considers him 從財格, but our engine misses it because 辰's hidden stems include 戊 (same element as DM).

**Implementation:**

Enhance `check_cong_ge()` to check whether 三合/三會 transformations "consume" residual roots before applying the strict Yang DM rule:

```python
# Enhanced 從格 detection algorithm:
#
# Step 1: Run existing check — Day Master extremely weak (V2 < 25)?
# Step 2: Identify all 三合/三會 formations from branch_relationships output
# Step 3: For each formation that successfully transforms:
#   - The transformation element REPLACES the original element of participating branches
#   - Hidden stems of participating branches are "consumed" by the transformation
#   - E.g., 申子辰三合水 → 辰's hidden [戊,乙,癸] are effectively overridden by Water
# Step 4: AFTER removing consumed roots, re-check the strict Yang DM rule:
#   - If the remaining (non-consumed) roots have 印/比劫 → NOT 從格
#   - If all roots were consumed by 三合/三會 → eligible for 從格
#
# Transformation consumption rules:
#   - Full 三合 (3 branches present): ALL hidden stems of participating branches consumed
#   - Full 三會 (3 branches present): ALL hidden stems of participating branches consumed
#   - 半合 (2 of 3 branches): partial consumption — only the 帝旺 branch hidden stems
#     are consumed (e.g., in 申子辰, only 子's hidden stems). This is weaker and may
#     NOT be sufficient for 從格.
#   - Consumption ONLY applies when the 三合/三會 result element opposes the DM element
#     (i.e., it's draining/克 the DM). If the result element helps the DM, it's not
#     relevant to 從格 detection.
#
# Special case: 從兒格 still allows minimal DM root (strengthScoreV2 < 35) even without
# 三合 consumption — this existing exception remains unchanged.
```

**Files to modify:**
- `interpretation_rules.py` — enhance `check_cong_ge()` to accept branch_relationships output, add `_get_consumed_branches()` helper
- `test_interpretation_rules.py` — add tests for 從格 with 三合 consumption (Deng Xiaoping case)
- `test_real_world_validation.py` — unskip the Deng 從格 test, add expected 從財格 assertions

**Validation criteria:**
- Deng Xiaoping (戊 Earth, 申子辰三合水): Should detect 從財格. The 三合水 consumes 辰's hidden 戊 root.
- Charts with 三合 that HELPS the DM (e.g., 寅午戌三合火 for Fire DM): Should NOT trigger 從格. The 三合 strengthens, not weakens.
- Charts with partial 半合 (only 2 of 3 branches): Should NOT consume roots (too weak for 從格 override).

---

### 12C. 生化鏈 (Element Flow Chain) Analysis

**Problem:** The current scoring evaluates each factor independently, but professional Bazi analysis considers **element production chains** — whether supporting elements form an unblocked flow into the Day Master. An unblocked chain (e.g., 木→火 in Zhou Enlai's chart where 甲 Wood directly feeds 丁 Fire) is much more effective than scattered support.

**Real-world impact:** Two charts with identical element counts can have vastly different effective strength if one has a clean production chain and the other has fragmented support. This is the "quality vs quantity" distinction that professionals make intuitively.

**Implementation:**

Add a new module `element_flow.py` that analyzes production chains in the chart:

```python
# Element flow chain analysis
#
# Core concept: Five Elements production cycle 木→火→土→金→水→木
# A "chain" exists when elements in adjacent cycle positions are both present
# and connected (i.e., stem or main qi of one pillar feeds into an adjacent pillar).
#
# Analysis outputs:
# 1. flow_chains: List of detected chains, e.g. [('木','火'), ('火','土')]
# 2. chain_to_dm: Whether any chain flows INTO the Day Master element
# 3. chain_from_dm: Whether the DM element flows OUT (drains DM)
# 4. blocked_chains: Chains where an 克 element interrupts the flow
# 5. chain_quality: Score from 0-100 measuring how clean/unblocked the flow is
#
# Scoring rules:
#   - Unblocked chain into DM (2+ elements): +15 bonus to DM strength
#   - Unblocked chain into DM (3+ elements, 通關用神): +25 bonus
#   - Unblocked drain chain from DM (2+ elements): -10 penalty
#   - Blocked chain (克 element present): 50% reduction in chain bonus
#   - 通關用神 detection: When two clashing elements both exist but a bridging
#     element (that one produces and the other is produced by) resolves the conflict
#     Example: 木 and 土 clash, but 火 bridges (木→火→土) — 火 is 通關用神
#
# Implementation approach:
#   1. Build element adjacency graph from all 8 stem+branch positions
#   2. Walk the production cycle (木→火→土→金→水) tracking which links are active
#   3. For each active link, check if the receiving element is the DM element
#   4. Check for 克 interruptions (e.g., 金 between 木 and 火)
#   5. Return chain analysis with bonus/penalty scores
#
# Integration with strengthScoreV2:
#   Option A: Add as 5th factor (rebalance to 得令35%+得地20%+得勢10%+得合20%+得流15%)
#   Option B: Apply as post-hoc adjustment (multiply final score by chain quality factor)
#   Recommendation: Option B — simpler, avoids cascading rebalance, chain is a modifier
#   not a primary factor. Multiplier range: 0.85 (blocked/draining) to 1.15 (clean flow in).
```

**Pillar adjacency matters for chain analysis:**
```python
# Production chain is strongest when adjacent pillars form the flow:
#   年→月→日→時 (temporal flow)
# A chain where 年干=甲(木) → 月干=丙(火) is stronger than 年干=甲(木) → 時干=丙(火)
# because the temporal proximity reinforces the energy transfer.
#
# Pillar adjacency weight for chains:
#   Adjacent pillars (年月, 月日, 日時): full chain strength (1.0×)
#   One-gap pillars (年日, 月時): reduced chain (0.7×)
#   Opposite pillars (年時): weakest chain (0.4×)
```

**Files to create/modify:**
- `element_flow.py` (NEW) — chain detection, 通關用神 detection, chain quality scoring
- `interpretation_rules.py` — integrate chain analysis into `generate_pre_analysis()`, apply as V2 score modifier
- `test_element_flow.py` (NEW) — chain detection tests, 通關用神 tests, blocked chain tests
- `test_real_world_validation.py` — update with chain analysis assertions for the 4 historical charts

**Validation cases:**
- Zhou Enlai: 甲(木)→丁(火) unblocked chain, 寅卯(木)→午(火) branch chain → high chain quality, score boost
- Mao Zedong: 甲(木) present but 丁 Fire DM is in 子 month (Water season) — chain exists but DM is seasonally dead, chain quality is moderate (chain alone can't overcome dead season)
- Deng Xiaoping: 壬(水)→甲(木) chain exists but AWAY from 戊 Earth DM — drain chain, score penalty

---

### Phase 12 Implementation Order

| Sub-phase | What | Impact | Effort | Dependencies |
|---|---|---|---|---|
| 12A | 三合/三會 element boost (4th factor) | HIGH | 1-2 days | None — standalone |
| 12B | 從格 + 三合 consumption | HIGH | 2-3 days | 12A (needs updated scores for validation) |
| 12C | 生化鏈 flow chain analysis | MEDIUM | 2-3 days | 12A (chain quality modifies score after 4th factor) |

**Total Phase 12 effort: 5-8 days**

**Prerequisite:** Phase 11 must be complete (especially 11D timing analysis, which also uses branch_relationships output). Phase 12 builds on the same `branch_relationships.py` and `interpretation_rules.py` infrastructure.

---

## Future Enhancement: Deep Pre-Analysis for AI Consistency

### Problem
The current `preAnalysis` JSON provides **structural findings** (what relationships exist, what Ten Gods are where, what the strength score is). But AI readings still have inconsistency issues:

1. **Interpretation depth varies** — same 正財在日支 finding could produce a 2-sentence or 10-sentence interpretation depending on AI mood
2. **Cross-section contradictions** — career section says "適合穩定工作" but personality section says "冒險精神強" without reconciling
3. **Missing causal chains** — AI states "事業順利" without explaining WHY (which specific combination of Ten God + element + timing leads to this)
4. **Inconsistent severity grading** — one reading treats 月日沖 as minor, another as catastrophic
5. **Lost context across sections** — love section doesn't reference the career Ten God insight that affects relationship timing

### Vision: Narrative-Ready Pre-Analysis

Instead of just structural data, pre-analysis should output **narrative building blocks** — pre-written interpretive fragments that the AI assembles into a coherent reading. This shifts AI's job from "interpret data → write" to "arrange + connect pre-written insights → write transitions".

### Proposed Data Structure (Phase 13+)

```python
# Current preAnalysis output (Phase 11):
{
    "summary": "食神格，火旺木相",
    "keyFindings": [
        {"category": "pattern", "finding": "食神格", "significance": "high"}
    ],
    "strengthV2": {"score": 61.3, "classification": "strong"},
    "pillarRelationships": {...},
    "tenGodPositions": [...],
    "careerInsights": {"suitableIndustries": [...]},
    ...
}

# Enhanced preAnalysis output (future):
{
    # Layer A: Everything from current Phase 11 (unchanged)
    ...

    # Layer B: Interpretive fragments — pre-written Chinese text blocks
    "interpretiveFragments": {
        # Each fragment has: text, confidence, source rule, applicable sections
        "personality": [
            {
                "text": "日主丁火生於寅月，木火相生，性格溫和而有內在熱情。丁火如燭光，照亮他人但不灼傷。",
                "confidence": 0.95,
                "sourceRule": "day_master_element_character",
                "appliesTo": ["personality", "love"],
                "priority": 1,
            },
            {
                "text": "食神在月柱透干，才華早顯，善於表達，適合以創意為生。食神為日主所生之物，代表輸出能力極強。",
                "confidence": 0.90,
                "sourceRule": "ten_god_position_month_食神",
                "appliesTo": ["personality", "career"],
                "priority": 2,
            },
        ],
        "career": [...],
        "love": [...],
        "health": [...],
        "timing": [...],
    },

    # Layer C: Cross-section consistency constraints
    "consistencyConstraints": [
        {
            "rule": "if_career_says_stable_then_personality_must_not_say_adventurous",
            "resolution": "career takes priority from 正官格, personality should say '外表穩重但內心有創意衝動'",
            "affectedSections": ["personality", "career"],
        },
        {
            "rule": "severity_grading",
            "月日沖": "medium_high",  # standardized severity, not left to AI
            "年時沖": "low",
            "日支空亡": "high_for_love",
        },
    ],

    # Layer D: Causal chains — explain WHY, not just WHAT
    "causalChains": [
        {
            "chain": "食神格 → 食傷生財 → 才華轉化為收入 → 適合自由職業或創意產業",
            "sections": ["career", "finance"],
            "keyStems": ["食神", "正財"],
        },
        {
            "chain": "正財在日支 → 配偶能幹 → BUT 月日沖 → 婚姻初期磨合 → 沖後反合 → 中年後穩定",
            "sections": ["love"],
            "keyStems": ["正財"],
            "timing": "early_turbulence_late_stability",
        },
    ],

    # Layer E: Section-specific word count targets + tone
    "sectionGuidance": {
        "personality": {
            "wordCount": {"min": 300, "max": 500},
            "tone": "warm_insightful",
            "mustInclude": ["日主特質", "格局影響", "核心性格矛盾"],
            "mustNotInclude": ["具體年份預測"],  # personality section shouldn't have timing
        },
        "career": {
            "wordCount": {"min": 400, "max": 600},
            "tone": "practical_advisory",
            "mustInclude": ["適合行業", "用神方向", "大運時機"],
            "mustReference": ["personality.食神 insight"],  # cross-reference
        },
    },
}
```

### Why This Matters for Consistency

| Current Issue | How Deep Pre-Analysis Fixes It |
|---|---|
| AI writes different depth each time | `sectionGuidance.wordCount` + `mustInclude` list ensures coverage |
| Cross-section contradictions | `consistencyConstraints` explicitly resolve conflicts before AI sees them |
| Missing "why" explanations | `causalChains` give AI the logical reasoning to narrate |
| Severity grading varies | Standardized severity scores (not left to AI judgment) |
| Sections feel disconnected | `appliesTo` tags + `mustReference` create explicit cross-links |
| Same chart → different readings each call | Pre-written `interpretiveFragments` ensure core insights are deterministic; AI only adds transitions and flow |

### Implementation Approach

1. **Phase 13A**: Add `interpretiveFragments` — pre-written text blocks for each Ten God position, element combination, and branch relationship. ~200 template strings in Chinese, parameterized with the specific stems/branches from the chart. This is the highest-value addition.

2. **Phase 13B**: Add `consistencyConstraints` and `causalChains` — conflict resolution and reasoning chains. Requires analyzing which findings interact with each other (e.g., 正官格 + 傷官見官 = conflict that needs explicit resolution).

3. **Phase 13C**: Add `sectionGuidance` — per-section tone/length/coverage constraints. This is the easiest to implement but relies on 13A/13B for the content it references.

### Token Budget Consideration

Current preAnalysis: ~200-300 tokens (compressed Chinese format)
With Layer B-E: ~800-1200 tokens estimated
Total prompt with preAnalysis: ~2000-2500 tokens (within Claude's context easily)

The extra tokens pay for themselves: fewer AI retries, more consistent output, less need for post-processing quality checks. Each token of pre-analysis replaces 3-5 tokens of AI "thinking" that might go wrong.

### Storage Consideration

The enhanced preAnalysis JSON will be larger (~5-10KB vs current ~2KB). Options:
- **Store in `calculationData` JSONB column** (current approach) — works fine up to ~50KB
- **Separate `preAnalysisData` column** — cleaner, allows independent versioning
- **Redis cache only** (don't persist) — save DB space, regenerate on demand since it's deterministic from birth data

Recommendation: Store in `calculationData` for now (simplest), split to separate column if it exceeds 20KB.

---

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
- ✅ Phase 11: Bazi Interpretation Enhancement (3-layer architecture: Engine → Pre-Analysis → AI Narration. 5 sub-phases: 11A data exposure, 11B pre-analysis layer, 11C AI prompt wiring, 11D Shen Sha 8→27 + timing analysis, 11E Day Master V2 scoring. 330 new tests, 451 engine total — 450 pass, 1 skip)

### Phase 11 Details (Bazi Interpretation Enhancement — COMPLETE)

**Phase 11A — Data Exposure:** Added `lifeStagesSummary`, `kongWangSummary`, `pillarElements` top-level fields to calculator output. All existing engine data now available for AI consumption.

**Phase 11B — Pre-Analysis Layer (core rules engine):**
New modules:
- `stem_combinations.py` — 天干合化 (5 pairs with adjacency check, transformation defaults, Day Master involvement) + 天干七沖 (4 opposition pairs) + combo-clash interaction detection
- `branch_relationships.py` — 7 relationship types (六合/六沖/三合/三會/三刑/六害/六破) + 自刑 + 半合 (前半合/後半合) + triple checks. Score hierarchy: 三會(100) > 三合(90) > 六合(80) > 前半合(70) > 後半合(60)
- `interpretation_rules.py` — Main orchestrator: Day Master V2 3-factor scoring (得令/得地/得勢), Ten God position rules (40 rules, male/female aware), 從格 detection (從財/從官/從兒/從勢, Yang/Yin distinction), 用神 合絆 detection, 透干 analysis, 月令 analysis, 墓庫 analysis, health/career/love domain mapping, conflict resolution layer (5-level priority), reading-type-filtered output
- Bug fixes: TIANYI_GUIREN 庚, SEASON_STRENGTH full 5-element audit, get_prominent_ten_god 透干 priority, 得令 scoring (Life Stage → SEASON_STRENGTH)
- Tests: 210 (stem_combinations: 34, branch_relationships: 53, interpretation_rules: 49, existing_bugs: 20, real_world_validation: 54)

**Phase 11C — AI Prompt Wiring + Anti-Hallucination:** `formatPreAnalysis()` in `ai.service.ts` converts preAnalysis JSON to compressed Chinese-language format (~200-300 tokens). Added `{{preAnalysis}}` to all 6 Bazi prompts. Graceful degradation when preAnalysis absent. **Prompt engineering fixes:** Added "絕對禁止" (5 absolute prohibitions), "天干與藏干的區別" (hidden vs manifest stem rules), "日主強弱判定規則" (V2 strength priority with ⚠️ marker), "驗證規則" (cross-check every pillar reference). Deactivated 48 stale DB prompt templates. Increased `max_tokens` from 4096 to 8192. Added `repairTruncatedJSON()` and markdown fence stripping in `parseAIResponse()`. Validated 100% accuracy (58/58 checks) on real readings.

**Phase 11D — Shen Sha Expansion + Timing Analysis:**
- Shen Sha expanded from 8 → 27 types across 4 groups: Major Auspicious (天乙貴人/紅鸞/天喜/文昌/將星/祿神/華蓋/驛馬/桃花/羊刃/福星貴人), Second-Tier Auspicious (天德貴人/月德貴人/太極貴人/國印貴人/金輿/天醫/學堂), Malefic (孤辰/寡宿/災煞/劫煞/亡神/天羅/地網), Special Day Pillars (魁罡日/陰陽差錯日/十惡大敗日). 文昌 and 學堂 now use dual Day+Year Stem lookup (cross-validated against 元亨利貞網).
- `timing_analysis.py` — 歲運並臨/天剋地沖/伏吟/反吟 detection + 大運×natal branch/stem interactions + 流年×natal interactions + 大運×流年 cross-interactions + `generate_timing_insights()` summary
- Tests: 107 (test_shen_sha_expanded: 71, test_timing_analysis: 37, minus 1 shared)

**Phase 11E — Day Master V2 Scoring:** Already implemented in 11B. `strengthScoreV2` exposed in calculator output via `preAnalysis['strengthV2']`. 3-factor formula (得令 50% / 得地 30% / 得勢 20%) validated against 4 historical charts.

**Real-world validation (4 historical charts):**
| Chart | Day Master | Professional | Engine Score | Status |
|---|---|---|---|---|
| 毛澤東 (癸巳甲子丁酉甲辰) | 丁 Fire | Weak | 12.3 (very_weak) | Pass |
| 蔣介石 (丁亥庚戌己巳庚午) | 己 Earth | Strong | 70.3 (very_strong) | Pass |
| 鄧小平 (甲辰壬申戊子壬子) | 戊 Earth | Very Weak | 32.0 (weak) | Pass |
| 周恩來 (戊戌甲寅丁卯丙午) | 丁 Fire | Strong | 61.3 (strong) | Pass |

**Known skip:** Deng Xiaoping 從格 detection — Yang Earth has hidden roots in 辰 that trigger strict "Yang DM cannot 從" rule, but professional consensus considers it 從財格 due to 申子辰三合水. Deferred to Phase 12.

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

#### 1. Bazi Accuracy Enhancement (Phase 12)
三合/三會 element boost scoring, 從格 detection with 三合 transformation, 生化鏈 analysis. See "Phase 12 Specs" section below for detailed implementation plans.

#### 2. Mobile App
React Native Expo app (skeleton exists in `apps/mobile/`, needs reading flow, real AdMob integration)

#### 3. Playwright E2E Tests
Comprehensive end-to-end tests for payment flows, reading creation, section unlock, credit purchase

#### 4. Production Deployment
Docker setup, CI/CD, environment configuration, domain setup

## Total Tests: ~968
- Bazi Engine: 451 tests (121 original + 210 Phase 11B + 107 Phase 11D + 12 Shen Sha fixes + 1 skip) — 450 pass, 1 skip
- NestJS API: 157 tests
- Frontend: 71 tests
- ZWDS: 289 tests (209 + 80 Phase 8B)

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

> **⚠️ ALSO CHECK NestJS + Next.js TOGETHER: When restarting or checking ANY server, always check BOTH NestJS AND Next.js!**
> They frequently go down around the same time. If a user reports "can't access", check both ports:
> ```bash
> curl -s http://localhost:4000/health && curl -s -o /dev/null -w "HTTP %{http_code}" --max-time 5 http://localhost:3000/
> ```
> If NestJS is dead: `cd apps/api && ../../node_modules/.bin/nest build && export ANTHROPIC_API_KEY="$(grep ANTHROPIC_API_KEY .env | cut -d= -f2)" && node --import tsx dist/main.js`
> If Next.js is dead: `kill -9 $(lsof -ti:3000) 2>/dev/null; sleep 2; cd apps/web && npx next dev --port 3000`

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
- **AI readings**: Bazi AI interpretation is fully working (Claude Sonnet 4, validated 100% accuracy). ZWDS AI readings still use mock data on frontend until ZWDS prompts receive the same anti-hallucination treatment. AI interpretation requires API keys in `apps/api/.env`
- **Sentry**: `@sentry/nextjs` is in next.config.js but runs silently when no SENTRY_AUTH_TOKEN is set
- **@repo/shared runtime issue**: NestJS files must NOT import from `@repo/shared` at runtime — inline constants instead. See "Worktree Development Guide" above.
- **True Solar Time disabled**: Both Bazi and ZWDS engines currently use **wall clock time** (standard timezone time) for pillar calculations, matching all major platforms. TST code is preserved in `solar_time.py` and still computed for informational output, but not used for pillar determination. If TST is re-enabled in the future as an opt-in feature, the ZWDS engine (iztro) would also need TST integration — currently iztro takes wall clock time directly as the 時辰.
