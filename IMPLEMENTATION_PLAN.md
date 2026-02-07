# Bazi SaaS Platform - Full Implementation Plan

## 1. Competitor Analysis: 先知命局 (SeerOnNet)

### All Features
| Category | Features |
|----------|----------|
| **Bazi (八字)** | 八字終身運 (Lifetime), 八字流年運勢 (Annual), 事業財運 (Career/Finance), 愛情姻緣 (Love/Marriage), 子女緣 (Children) |
| **Other Divination** | 紫微斗數 (Ziwei Doushu), 塔羅占卜 (Tarot), 輪迴書 (Past Life), 周易 (I Ching) |
| **Specialized** | 姓名配對 (Name Matching), 受生債 (Debt-of-Life), 童子命 (Child's Fate), 五行靈願手串 (Five-Element Bracelets) |
| **Platform** | AI personality quizzes, Master ranking/rating system, 先知廣場 (Community Forum), Live master consultation, Daily fortune, Electronic talismans (大德靈符) |

### Their Monetization
- **Weekly:** ~$49.90/week | **Monthly:** ~$19.99/month | **Annual:** ~$39.90/year
- **Member perks:** 30 Bazi reports/month, 30 Master.S calculations/month, 3 unlocked reports, 5 spiritual blessings
- **Points system:** $29.90 (6pts) → $4,999.90 (800pts) for premium consultations
- **Physical products:** Spiritual bracelets, talismans
- **Payments:** Visa, PayPal, Octopus, PayMe, Alipay, WeChat Pay, Line Pay, FPX, Shopee, Grab, Dana

### Their Tech Stack (Observed)
- Frontend: **Nuxt.js** (Vue-based SSR)
- iOS app: 126.2 MB, iOS 15.6+
- Rating: 4.4/5 (147 reviews)
- Company: Faith Onnet Limited (Hong Kong)

---

## 2. Our V1 Scope — What to Build First

### V1 Core Features (MVP)
1. **Bazi Plotting Engine** (核心命盤排盤)
   - 八字終身運 — Lifetime destiny analysis
   - 八字流年運勢 — Annual fortune forecast
   - 事業財運 — Career & financial guidance
   - 愛情姻緣 — Love & marriage compatibility
2. **Bazi Compatibility Comparison** (合盤比較) — Compare two people's Bazi for relationship or business compatibility (MUST HAVE in V1)
3. **User Authentication** — Email/Phone OTP, Google, Apple, Facebook, LINE, Guest login, Invite code
4. **Subscription & Payment** — Freemium model with paid tiers
5. **Admin Dashboard** — Manage all services, products, and pricing dynamically (change anytime)
6. **User Dashboard** — View saved readings, purchase history
7. **Multi-language** — Traditional Chinese (primary), Simplified Chinese

### What We Can Do BETTER Than SeerOnNet
- **Faster AI-powered analysis** — sub-3-second plot generation vs their slower process
- **More detailed free tier** — give users a taste of quality to drive conversion
- **Better mobile UX** — native-feel animations, haptic feedback, smooth transitions
- **Transparent pricing** — clearer value proposition per tier
- **Modern UI design** — clean, premium aesthetic vs their cluttered interface
- **Shareable results** — beautiful card-format results users can share on social media (free viral marketing)
- **Comparison feature** — compare two people's Bazi for compatibility (relationship/business)

---

## 3. Recommended Tech Stack (2026 Review ✅)

### Tech Stack Validation (Feb 2026 Audit)

Every choice below has been validated against 2026 alternatives:

| Our Choice | 2026 Alternative | Why We Keep Ours | Scalability |
|-----------|-----------------|-----------------|-------------|
| **React Native (Expo)** | Flutter | Expo is now default for RN in 2026. New Architecture (default since 2025) gives 40% faster startup. Flutter has slight edge in raw perf (350ms vs 700ms cold start) but RN shares code with Next.js web. For our app (text-heavy, not graphics-intensive), RN is ideal. | ✅ Scales well — OTA updates via EAS, no app store review needed for fixes |
| **Next.js 15** | Remix, Nuxt 4, Astro | Next.js is #1 full-stack React framework in 2026. SSR + App Router for SEO. Largest ecosystem, strongest hiring pool. Remix has 30% faster TTFB on edge, but we're Railway-hosted, not edge. Nuxt is Vue (not our stack). | ✅ SSR scales horizontally, Turbopack for fast dev builds |
| **NestJS** | Hono, Elysia, Encore.ts | NestJS: best for large structured apps with modules, guards, interceptors. Hono/Elysia are faster (14KB vs NestJS) but designed for edge/serverless. We need WebSocket support, module architecture, and Prisma integration — NestJS is battle-tested. | ✅ Modular architecture scales to 100+ endpoints cleanly |
| **Prisma** | Drizzle ORM | Prisma: better DX, auto-generated types, migration tooling, NestJS integration. Drizzle: 14x lower latency on complex queries. For our use case (simple CRUD + reads, not complex joins), Prisma's DX wins. Can migrate to Drizzle later if perf bottleneck. | ✅ Prisma scales to millions of rows, connection pooling built-in |
| **PostgreSQL** | — | Still the gold standard for relational data in 2026. No change needed. | ✅ Read replicas, connection pooling, sharding when needed |
| **Redis** | — | Still the fastest in-memory cache. No change needed. | ✅ Cluster mode for >10K users |
| **Clerk** | Supabase Auth, Auth.js | Validated earlier — Clerk's Expo SDK, LINE support, and pre-built UI saves 40-80hrs. | ✅ Scales to 100K+ MAU with Pro plan |
| **Turborepo** | Nx | Turborepo: simpler config, Vercel-backed, good monorepo caching. Nx is more powerful but more complex. For our 3-app monorepo, Turbo is sufficient. | ✅ Remote caching for CI speedup |
| **Railway** | Fly.io, Render, Vercel | Railway: best DX for containers, supports Python sidecar, managed Postgres/Redis. Fly.io is closer to metal but more devops. Railway is perfect for start → scale later to AWS. | ✅ Auto-scaling, easy migration path to AWS/GCP |

**Verdict:** All tech choices are current and sensible for Feb 2026. No changes needed.

### Frontend — React Native (Expo) + Next.js

| Layer | Technology | Why |
|-------|-----------|-----|
| **Mobile App** | React Native with Expo | Single codebase for iOS + Android, near-native performance, rich animation support via Reanimated |
| **Web App** | Next.js 15 (React) | SSR for SEO, shared React component logic with mobile, App Router |
| **Shared Logic** | TypeScript packages (monorepo) | Share Bazi calculation logic, API types, validation between web and mobile |
| **UI Framework** | Tamagui or NativeWind | Cross-platform UI components that work on both web and native |
| **State Management** | Zustand + TanStack Query | Lightweight, performant, great for caching API responses |
| **Animations** | React Native Reanimated + Moti | 60fps native animations for premium feel |

### Backend — Node.js (NestJS) + Python (Bazi Engine)

| Layer | Technology | Why |
|-------|-----------|-----|
| **API Server** | NestJS (Node.js/TypeScript) | Type-safe, modular, excellent for REST + WebSocket, shared types with frontend |
| **Bazi Engine** | Python microservice | Rich ecosystem for Chinese calendar/astrology libraries (lunarcalendar, bazi libs), easy AI integration |
| **AI Layer** | Claude API (Anthropic) | Best for nuanced Chinese cultural interpretation, strong multilingual support |
| **Database** | PostgreSQL + Redis | PostgreSQL for relational data, Redis for caching & session management |
| **ORM** | Prisma | Type-safe database access, auto-generated types |
| **Auth** | Clerk | Pre-built UI components, native Expo SDK, supports Google/Apple/Facebook/LINE/Phone OTP/Email OTP/Guest. 10K MAU free, $25/mo Pro. Saves 40-80hrs vs custom auth. |
| **File Storage** | Cloudflare R2 or AWS S3 | User avatars, generated report PDFs |

### Infrastructure

| Layer | Technology | Why |
|-------|-----------|-----|
| **Hosting** | Railway (start) → AWS/GCP (scale) | Easy start, pay-as-you-go, great DX, scale when needed |
| **CDN** | Cloudflare | Global edge caching, especially important for Asia-Pacific markets |
| **Payment** | Stripe + local gateways | Stripe for international, integrate local gateways for TW/CN/HK/MY later |
| **Monitoring** | Sentry + Posthog | Error tracking + product analytics |
| **CI/CD** | GitHub Actions | Automated testing and deployment |

### Monorepo Structure
```
bazi-platform/
├── apps/
│   ├── mobile/          # React Native (Expo) app
│   ├── web/             # Next.js web app
│   └── api/             # NestJS API server
├── packages/
│   ├── bazi-engine/     # Python Bazi calculation microservice
│   ├── shared/          # Shared TypeScript types, constants, validation
│   ├── ui/              # Shared UI components (Tamagui)
│   └── config/          # Shared configs (ESLint, TypeScript, etc.)
├── docker/
│   ├── Dockerfile.api
│   ├── Dockerfile.bazi
│   └── docker-compose.yml
├── turbo.json           # Turborepo config
└── package.json
```

---

## 4. Bazi Plotting Engine — Architecture & Design

### Two-Layer Architecture: Deterministic Calculation + AI Interpretation

```
User Input (birth date/time/gender)
        │
        ▼
┌─────────────────────────┐
│  Layer 1: CALCULATION    │  ← Deterministic, 100% accurate
│  (Python Microservice)   │
│                          │
│  • Solar → Lunar convert │
│  • Four Pillars (四柱)    │
│  • Heavenly Stems (天干)  │
│  • Earthly Branches (地支)│
│  • Five Elements (五行)   │
│  • Ten Gods (十神)        │
│  • Day Master (日主)      │
│  • Luck Periods (大運)    │
│  • Annual Stars (流年)    │
│  • Na Yin (納音)          │
│  • Shen Sha (神煞)       │
└──────────┬──────────────┘
           │ Structured JSON
           ▼
┌─────────────────────────┐
│  Layer 2: INTERPRETATION │  ← AI-powered, nuanced analysis
│  (Claude API)            │
│                          │
│  • Lifetime analysis     │
│  • Annual forecast       │
│  • Career/finance reading│
│  • Love/marriage reading │
│  • Actionable advice     │
│  • Cultural context      │
└──────────┬──────────────┘
           │ Rich text report
           ▼
      User receives result
```

### Layer 1: Deterministic Bazi Calculator (Python)

**Core Algorithms:**
1. **True Solar Time Adjustment (真太陽時)** ⚠️ CRITICAL — Standard clock time ≠ solar time. Must adjust for birth location's longitude vs standard timezone meridian, plus Equation of Time correction. Without this, Hour Pillar can be WRONG by 1-2 hours, making the entire chart inaccurate. This is the #1 accuracy differentiator for professional-grade Bazi apps.
   - **Longitude offset:** Compare birth city longitude to timezone standard meridian (e.g., Taiwan CST uses 120°E, but Taipei is 121.5°E → +6min correction)
   - **Equation of Time:** Earth's orbital eccentricity causes up to ±16 minutes variation by date (pre-computed table or formula)
   - **Implementation:** Require birth city (not just timezone) → geocode to lat/lng → compute true solar time → use for Hour Pillar
   - **Library:** `ephem` or `skyfield` for precise solar calculations, or pre-computed lookup table by city
2. **Solar-to-Lunar Calendar Conversion** — Use `lunardate` or `cnlunar` library
3. **Four Pillars Calculation** — Year/Month/Day/Hour pillars using Heavenly Stems & Earthly Branches cycles
4. **Five Elements Analysis** — Wood, Fire, Earth, Metal, Water balance from all 8 characters
5. **Ten Gods Derivation** — Relationships between Day Master and other stems
6. **Luck Periods (大運)** — 10-year cycles based on month pillar and gender
7. **Annual Forecast (流年)** — Current year's Heavenly Stem & Earthly Branch interactions
8. **Shen Sha (神煞)** — Special stars and their influences

**Key Python Libraries:**
- `lunarcalendar` / `cnlunar` — Lunar calendar conversion
- `ephem` or `skyfield` — True solar time calculation (真太陽時)
- `bazi` / custom implementation — Four Pillars calculation
- Pre-computed lookup tables for stems, branches, elements, gods
- City coordinates database for birth location → longitude mapping

**Speed Target:** Layer 1 calculation < 50ms (all deterministic lookups)

### Layer 2: AI Interpretation — Provider Comparison (Feb 2026)

| Model | Input/Output Cost (per 1M tokens) | Chinese Cultural Quality | Best For |
|-------|-----------------------------------|--------------------------|----------|
| **Claude Sonnet 4.5** | $3 / $15 | ★★★★★ Best cultural nuance, contextual understanding beyond literal translation, strongest for idiomatic expressions | Primary — paid & free readings |
| **Gemini 3 Pro** | $2 / $12 (preview pricing, may drop to ~$1.50/$10) | ★★★☆☆ 140+ languages, but cultural analysis found "insufficiently comprehensive" vs Claude/GPT | Fallback #1 |
| **GPT-5.2** | ~$2.50 / $10 (estimated, o3 at $10/1M) | ★★★★☆ Strong general capability, 3 variants (Instant/Thinking/Pro) | Fallback #2 |
| **DeepSeek V3.2** | $0.028 / $0.28 (cache hit) | ★★★★★ Native Chinese, #1 on Chinese SimpleQA benchmark, beats GPT-4o & Claude on Chinese tasks | Cost backup (but censorship risk) |
| **Claude Haiku 4.5** | $1 / $5 | ★★★★☆ Fast, good quality, same Anthropic safety | Daily fortune snippets |

**Key Findings:**
- **Claude Sonnet 4.5** excels at cultural understanding beyond literal translation — critical for Bazi interpretation where nuance matters
- **DeepSeek V3.2** scored #1 on Chinese SimpleQA (surpassing GPT-4o and Claude on Chinese-language tasks), but has **6.83% propaganda detection rate** in Simplified Chinese queries and censors sensitive topics — risky for a platform serving Taiwan/HK users
- **Gemini 3** was found to have less comprehensive cultural analysis compared to Claude and GPT in independent tests
- **GPT-5.2** is strong but more expensive, and Chinese cultural context is not its primary strength

**Recommended Strategy: Claude Primary + Failover Chain (All Tiers Get Best Quality)**

```
User requests reading
        │
        ▼
┌──────────────────┐     fail/timeout     ┌──────────────┐     fail     ┌──────────────┐
│ Claude Sonnet 4.5│ ──────────────────▶  │  GPT-5.2     │ ──────────▶ │  Gemini 3    │
│ (Primary)        │                      │ (Fallback 1) │             │ (Fallback 2) │
└──────────────────┘                      └──────────────┘             └──────────────┘
```

- **All tiers (free + paid) use Claude Sonnet 4.5** — show users best quality upfront, limit free tier by usage count (not quality)
- **GPT-5.2 as Fallback #1** — if Claude API is down or slow (>10s timeout)
- **Gemini 3 as Fallback #2** — last resort if both Claude and GPT are unavailable
- **DeepSeek excluded from main chain** — censorship risk is unacceptable for TW/HK market
- **Claude Haiku 4.5** — used specifically for lightweight features (daily fortune snippet, push notification text)
- **Estimated cost per reading:** ~$0.02–0.05 (Claude Sonnet, ~2,000 output tokens)

**Prompt Engineering Strategy:**
- Create expert-level system prompts with deep Bazi knowledge
- Include the "persona" of a seasoned Bazi master (命理大師)
- Feed structured calculation data from Layer 1 as context
- Request specific analysis categories (career, love, health, etc.)
- Use few-shot examples of gold-standard interpretations
- Include formatting instructions for beautiful output
- **Structured JSON output format** — AI must return JSON with `preview` (first paragraph) and `full` (complete text) per section, enabling clean paywall split without post-processing

**Cross-Provider Prompt Compatibility ⚠️:**
- **Provider abstraction layer** — Create a unified AI service interface that handles prompt format differences between Claude, GPT, and Gemini
- **Prompt templates stored in DB** — Admin-editable per reading type AND per provider (same reading may need slightly different prompts for Claude vs GPT vs Gemini)
- **Output format enforcement** — Each provider adapter validates the response matches expected JSON structure. If response doesn't parse, retry with explicit format reminder (1 retry max)
- **Provider-specific tuning:** Claude uses XML-style structured prompts, GPT uses JSON-mode, Gemini uses function calling for structured output
- **Test suite:** Run same 10 birth charts through all 3 providers monthly to ensure quality parity

**Speed Optimization:**
- **On-demand only** — AI generation starts ONLY when user clicks a specific reading type (no parallel pre-generation)
- **Streaming responses** — Show results progressively as AI generates them
- **Caching** — Cache identical birth chart interpretations (same birth data = same base reading)
- **Pre-computation** — Pre-generate popular annual forecasts for common birth years
- **Target:** Full reading delivered in < 5 seconds (streaming starts in < 1 second)

**Accuracy Validation:**
- Consult with professional Bazi masters to validate interpretation quality
- Create a test suite of known birth charts with expected analysis
- A/B test different prompt strategies
- Internal quality review (NO user-facing thumbs up/down — we project confidence in our readings)

### Entertainment Disclaimer (Required for All Readings)
> ⚠️ All AI-generated readings MUST include the following disclaimer at the bottom:
> **繁體中文:** "本服務僅供參考與娛樂用途，不構成任何專業建議。重要決定請諮詢相關專業人士。"
> **简体中文:** "本服务仅供参考与娱乐用途，不构成任何专业建议。重要决定请咨询相关专业人士。"
> (English: "This service is for reference and entertainment purposes only. It does not constitute professional advice. Please consult relevant professionals for important decisions.")
> This is required for Apple App Store compliance (Guideline 5.6) and general legal protection.

### The 6 Core V1 Reading Types

| Reading | Input | Layer 1 Output | Layer 2 AI Focus |
|---------|-------|----------------|-----------------|
| **八字終身運** | Birth datetime + gender | Full Four Pillars, Five Elements balance, Ten Gods, Day Master strength | Personality, life trajectory, strengths/weaknesses, major life themes |
| **八字流年運勢** | Birth datetime + target year | Annual pillar interactions, Luck Period phase, clashing/combining elements | Year-specific predictions, opportunities, risks, monthly breakdown |
| **事業財運** | Birth datetime + gender | Career-related Gods (正官/偏官/正財/偏財), element strengths | Career path, financial opportunities, favorable/unfavorable industries, timing |
| **愛情姻緣** | Birth datetime + gender | Romance-related Gods (正財/偏財 for men, 正官/偏官 for women), Day Branch | Relationship patterns, ideal partner traits, marriage timing |
| **先天健康分析** | Birth datetime + gender | Five Elements balance, weak/excess elements mapped to body organs | Health tendencies, vulnerable body systems, wellness advice |
| **合盤比較** (V1 MUST HAVE) | Two people's birth datetime + gender + relationship type (romance/business) | Both charts' Four Pillars, Five Elements interaction, Day Master compatibility, clashing/combining analysis | Compatibility score, strengths/weaknesses of the pair, advice for harmony, areas of conflict |

---

## 4B. SeerOnNet Bazi Plotting UX Flow (Analyzed from Screenshots)

### Step 1: Input Form (添加資料)
- Fields: 用戶昵稱 (Nickname), 性別 (Gender), 出生日期 (Birth Date), 出生地區 (Birth Region), 時區 (Timezone)
- Relationship tag: 我的 (Me) / 親人 (Family) / 朋友 (Friend)
- 確認 (Confirm) button at bottom

### Step 2: Bazi Chart Display (八字排盤) — FREE section
A single long scrollable page with color-coded sections:

**2a. Profile Header (Yellow)**
- User avatar + name + 切換 (Switch profile) button
- 農歷 date + 公歷 date display
- 查看詳情 ▼ (View details) expandable

**2b. Four Pillars Table (Yellow) — FREE**
| Row | 年柱 | 月柱 | 日柱 | 時柱 |
|-----|------|------|------|------|
| 主星 (Main Star) | Ten God labels |
| 天干 (Heavenly Stems) | Colored characters |
| 地支 (Earthly Branches) | Colored characters |
| 藏干 (Hidden Stems) | Multiple small colored chars |
| 副星 (Secondary Stars) | Ten God labels |
| 星運 (Star Luck) | Life stage labels |
| 自坐 (Self Seat) | Life stage labels |
| 空亡 (Void) | Branch pairs |
| 納音 (Na Yin) | Element descriptions |
| 神煞 (Shen Sha) | Multiple special star names |

**2c. Luck Periods (大運) — FREE**
- Horizontal scrollable row showing 10-year periods
- Each period: Year range + age + Stem/Branch + Ten God
- Current period highlighted with border

**2d. Annual Stars (流年) — FREE**
- Horizontal scrollable row showing years
- Each year: Stem/Branch + Ten God

**2e. Monthly Stars (流月) — FREE**
- Horizontal scrollable row showing solar months
- Each month: Date + Stem/Branch + Ten God

**2f. Analysis Tabs — FREE**
- 五行能量 (Five Elements Energy) — percentage circles with element icons
- 五行個數 (Five Elements Count)
- 含藏干數 (Hidden Stems Count)

**2g. Day Master Analysis — FREE**
- 命主屬性 (Day Master Element)
- 陰陽參考 (Yin/Yang reference)
- 旺衰參考 (Strength: 偏弱/neutral/偏強)
- 格局參考 (Pattern type, e.g., 食神格)
- 同黨/異黨 bar (39% vs 61%)
- 喜神/用神/閒神/忌神/仇神 (Favorable/Useful/Idle/Taboo/Enemy elements)

**2h. Ten Gods Interpretation (命格主要十神) — FREE**
- Each prominent Ten God with description paragraph

### Step 3: Personality Section (命格性格分析) — MIXED
- 八字格局分析 with 格局高低 rating (1-10 scale) — **FREE preview**
- 性格特點分析 — **Partial free, rest PAYWALLED** 🔒解鎖內容

### Step 4: Love & Marriage (感情婚姻分析) — MIXED (Pink theme)
- 恋爱性格分析 (Dating Personality) — **FREE**
- 先天姻緣運 (Innate Marriage Fate) — **PAYWALLED** 🔒
- 感情婚姻情況 (Marriage Situation) — **PAYWALLED** 🔒

### Step 5: Finance (一生財運分析) — MIXED (Orange theme)
- 財運分析 (Financial Analysis) — **FREE**
- 求財生財之道 (Wealth Generation Methods) — **PAYWALLED** 🔒

### Step 6: Career (事業發展分析) — MIXED (Blue theme)
- 職業能力分析 with Ten God bar charts (0-38%) — **FREE**
- Career interpretation text — **FREE**
- 利于發展的行業 (Favorable Industries) — **PAYWALLED** 🔒
- 不利于發展的行業 (Unfavorable Industries) — **PAYWALLED** 🔒
- 事業貴人小人 (Career Benefactors/Antagonists) — **PAYWALLED** 🔒

### Step 7: Health (先天健康分析) — MIXED (Green theme)
- 先天健康情況 (Health Condition) — **FREE**
- 保健養生建議 (Health Advice) — **PAYWALLED** 🔒

### Step 8: Cross-Sell Grid (更多運程信息)
- 2x4 grid of related services with illustrations
- 今日運勢, 麦玲玲運程, 事業詳批, 八字姻緣, 姓名打分, 八字終身運, 一生財運, 正緣畫像

### Step 9: Ask a Master (找老師問問)
- List of masters with avatar, name, years of experience, brief bio
- 找TA問問 (Ask them) button per master

### Key UX/Monetization Patterns We Should Clone
1. **Single long scrollable page** — all analysis on one page, not separate tabs
2. **Color-coded sections** — Yellow (chart), Pink (love), Orange (finance), Blue (career), Green (health)
3. **Free preview + paywall** — Show first paragraph free, blur the rest
4. **Subscription unlocks ALL** — Unlike SeerOnNet's per-section unlock, our model is simpler: subscribe = see everything. Non-subscribers get free preview only. No per-section credits.
5. **Cross-sell at bottom** — Related services grid drives discovery
6. **Visual data** — Bar charts, percentage circles, colored elements (not just text)

### What We'll Do DIFFERENTLY / BETTER
1. **AI-generated interpretations** — More personalized than their template-based text
2. **Animated Five Elements wheel** — Interactive instead of static percentage circles
3. **Streaming text reveal** — Text appears progressively (feels premium + fast)
4. **Shareable card** — Generate beautiful social media card from chart data
5. **Compatibility view** — Side-by-side two-person chart (they don't have this in their chart page)
6. **No master marketplace in V1** — Focus on AI quality instead

---

## 5. Monetization Strategy

### Free Tier (Hook Users)
- Basic Bazi chart display (Four Pillars, Five Elements, Day Master analysis) — FREE for all users
- First paragraph of each analysis section visible — rest blurred with subscribe CTA
- **1 free FULL reading per account** (any category, all sections unlocked) — shows quality, forces conversion
- Daily fortune snippet (2-3 sentences)
- Shareable Bazi card (social viral loop)

**Free Tier Abuse Prevention ⚠️:**
- **Guest accounts:** Do NOT get free full reading. Must register (email or phone verified) to claim free reading. This prevents unlimited free readings via throwaway guest accounts.
- **Device fingerprinting:** Track device ID (Expo `Application.androidId` / iOS `identifierForVendor`) to detect same device creating multiple accounts
- **Rate limiting:** Maximum 1 free reading per verified email/phone number
- **IP-based throttling:** Flag unusual patterns (>3 signups from same IP in 24h)
- **Clerk metadata:** Store `free_reading_used: true` in Clerk user metadata for fast checks

### Paywall Model: Subscription Unlocks ALL
- **Subscribers:** See ALL sections of ALL reading types, no restrictions
- **Non-subscribers:** See chart data + first paragraph preview per section, rest blurred
- **No per-section credits** — simpler than SeerOnNet, less friction, cleaner UX

### Premium Tier — Monthly Subscription
| Plan | Price (USD) | Includes |
|------|------------|---------|
| **Basic** | $4.99/month | 5 detailed readings/month, full 八字終身運, basic 流年運勢 |
| **Pro** | $9.99/month | 15 readings/month, all 4 reading types, PDF export, priority AI |
| **Master** | $19.99/month | Unlimited readings, partner compatibility, advanced analysis, early access features |

### One-Time Purchases (Credits/Points)
- Single detailed reading: $1.99–$3.99
- Compatibility report (two people): $4.99
- Premium annual forecast with monthly breakdown: $6.99
- Bundle packs: 5 readings for $7.99, 10 for $14.99

### Annual Discounts
- Basic Annual: $39.99/year (save 33%)
- Pro Annual: $79.99/year (save 33%)
- Master Annual: $159.99/year (save 33%)

### Payment Gateways (by Market)
| Market | Primary | Secondary |
|--------|---------|-----------|
| **Taiwan** | Stripe, LINE Pay | Credit card |
| **Hong Kong** | Stripe, PayMe, Octopus | Alipay HK |
| **Malaysia** | Stripe, GrabPay, FPX | Touch 'n Go |
| **China (V2)** | Alipay, WeChat Pay | UnionPay |
| **International** | Stripe, PayPal | Apple Pay, Google Pay |

*V1 Launch Payment Gateways:*
- **Stripe** — Credit cards, Apple Pay, Google Pay (all markets)
- **LINE Pay** — Taiwan primary
- **PayPal** — International
- **Touch 'n Go eWallet** — Malaysia (via Stripe or Adyen integration)
- **Alipay / Alipay HK** — Hong Kong + China (Stripe supports natively)
- **WeChat Pay** — China + HK (Stripe supports natively)

Note: Stripe natively supports Alipay and WeChat Pay. Touch 'n Go can be integrated via Adyen or 2C2P SDK. All gateways included from V1 launch.

### SeerOnNet Payment Page Analysis (from screenshots bazi15-17)

**VIP Subscription Modal (bazi15-16):**
- Two tabs: VIP訂閱 | 單獨購買
- VIP includes: 5 reports/month, 30 Master-S readings/month, 30 八字排盤/month, coupons, talismans
- Pricing: 3-day free trial → RM99.90/month (~USD$22) | RM199.90/year (~USD$44)
- Free trial explanation: "Single purchase costs at least USD$98, trial gives access to everything"
- Processed via Apple IAP (App Store subscription management)

**Individual Purchase Modal (bazi17):**
- Product name + points cost (八字排盤 ⊙1.99)
- Coupon/discount field
- **Region selector** (全球/香港澳門/馬來西亞/更多) — payment methods change per region
- Payment methods by region:
  - Global: Credit card (Stripe), PayPal
  - HK/Macau: Local credit card, WeChat Pay, Alipay
  - Taiwan: 藍新支付 (NewebPay — convenience store, barcode, e-wallet), MyCard
  - In-app: Points/wallet balance
- 確認支付 button with total amount

**What We Should Clone for Our Payment UX:**
1. ✅ Two-tab modal: Subscription | One-time purchase
2. ✅ Region selector that shows relevant payment methods
3. ✅ Free trial with clear explanation of what happens after
4. ✅ Coupon/promo code field
5. ❌ Skip their points/wallet system in V1 — too complex, use simple credits instead
6. ✅ Show "value comparison" (e.g., "buying individually costs $XX, subscription saves you $YY")
7. ❌ No free trial — users get 1 free full reading per account, then must subscribe or buy individually. Simpler, no abuse risk.

---

## 6. Security Design

### Authentication & Authorization (Clerk)
- **Session tokens** via Clerk — long-lived sessions (90 days / 3 months) so users stay logged in
- **Clerk handles all auth complexity** — JWT management, token refresh, session persistence
- **Login methods (matching SeerOnNet):**
  - 手机号/手機號登入 (Phone SMS OTP)
  - 邮箱/郵箱登入 (Email OTP / verification code)
  - Google登录
  - Apple登录
  - Facebook登录
  - LINE登录 (Clerk native support)
  - 游客登录 (Guest login — Clerk anonymous users)
  - 邀请码 (Invite code — Clerk invitation system)
- **Language switcher** — 中文简体 / 中文繁體 toggle on login screen
- **Rate limiting** — Per-user and per-IP limits on API calls:
  - General API: 100 req/min per user
  - Bazi calculation: 10 req/min per user (computational cost)
  - AI reading generation: 3 req/min per user (expensive AI API calls)
  - Login attempts: 5 req/min per IP (brute force protection)
  - Guest endpoints: 20 req/min per IP (prevent scraping)
- **Role-based access** — User, Premium User, Admin

### Data Protection & Regional Compliance ⚠️
- **Encryption at rest** — AES-256 for sensitive user data (birth dates are PII)
- **Encryption in transit** — TLS 1.3 everywhere
- **Data residency** — Railway Singapore datacenter (closest to TW/HK/MY users, ~30-60ms latency to TW/HK)
  - Railway currently offers: US-West, US-East, EU-West, Asia-Southeast (Singapore)
  - Singapore is adequate for V1 launch (TW: ~50ms, HK: ~35ms, MY: ~10ms)
  - If latency is an issue for Taiwan, consider Cloudflare CDN for static content + consider Fly.io (has Tokyo datacenter) as Phase 3 migration option
- **Malaysia PDPA compliance:**
  - Privacy policy in Bahasa Malaysia + Chinese
  - User consent before data collection (explicit opt-in checkbox)
  - Data access/correction/deletion requests handled within 21 days
  - Appoint a data protection officer (can be the founder initially)
  - Cross-border data transfer disclosure (data stored in Singapore)
  - Annual compliance review
- **Taiwan PDPA (個人資料保護法):**
  - Privacy policy in Traditional Chinese
  - Purpose limitation — collect only for Bazi readings
  - User right to access, correct, delete personal data
  - Must notify users before cross-border data transfer
- **Hong Kong PDPO (個人資料（私隱）條例):**
  - Privacy policy in Traditional Chinese
  - Data Protection Principles (DPPs) compliance
  - Right of data access and correction
- **Minimal data collection** — Only collect what's needed for readings (name, birth date/time/location, gender, email/phone)
- **Privacy policy** — Must be available in zh-TW, zh-CN, and English before launch
- **Cookie consent** — Implement for web app (required for PDPA)

### Payment Security
- **Never store card data** — Stripe handles all payment processing (PCI compliant)
- **Webhook signature verification** — Validate Stripe webhook authenticity
- **Idempotency keys** — Prevent duplicate charges

### API Security
- **API key rotation** — Regular rotation of AI service keys
- **Input validation** — Strict validation on all date/time inputs (prevent injection)
- **CORS restrictions** — Whitelist only our domains
- **Request signing** — HMAC signatures for mobile API calls
- **DDoS protection** — Cloudflare in front of all services

### Disaster Recovery & Backup Strategy ⚠️
- **Database backups:** Railway automated daily backups + weekly manual pg_dump to Cloudflare R2/S3
- **Point-in-time recovery:** Railway PostgreSQL supports PITR (last 7 days on Pro plan)
- **Backup testing:** Monthly restore drill — verify backup integrity by restoring to a staging instance
- **Redis:** Treat as ephemeral cache only — all critical data in PostgreSQL, Redis loss = cold cache rebuild only
- **AI API key management:** Store all API keys in environment variables (Railway secrets), never in code. Keep backup keys for Claude/GPT/Gemini in a secure vault (1Password or similar)
- **Code & config:** All code in GitHub (remote backup inherent). Environment configs documented in README (not committed)
- **User data export:** Build admin endpoint to export user data (PDPA/GDPR compliance)
- **RTO (Recovery Time Objective):** < 1 hour for full service restore from backup
- **RPO (Recovery Point Objective):** < 24 hours data loss (daily backups)

---

## 7. Cross-Platform Strategy (Premium Mobile Feel)

### React Native (Expo) for Mobile
- **Native modules** — Camera, haptics, biometrics, push notifications
- **60fps animations** — Reanimated 3 for gesture-driven, smooth transitions
- **Offline support** — Cache recent readings locally with WatermelonDB or MMKV
- **App Store optimized** — Proper native splash screens, app icons, deep links
- **OTA updates** — Expo EAS Update for instant fixes without app store review

### Premium UX Tactics
- **Skeleton loading** — Show content shapes while data loads
- **Haptic feedback** — Subtle vibrations on key interactions
- **Gesture navigation** — Swipe between reading sections
- **Dark mode** — Important for nighttime reading (fortune-telling users often check at night)
- **Animated charts** — Five Elements wheel, luck period timeline with smooth animations
- **Progressive disclosure** — Reveal reading sections one by one with elegant transitions

### Next.js for Web
- **Server-side rendering** — Fast initial load, good SEO for Chinese search engines (Baidu, Google)
- **Responsive design** — Mobile-first web layout
- **PWA support** — Installable web app as fallback
- **Shared components** — Use Tamagui to share 70%+ of UI code between web and mobile

---

## 8. Scalability Path (Architecture Review ✅)

### Scalability By Design — What's Built In From Day 1

| Component | Scalability Pattern | Why It Matters |
|-----------|-------------------|----------------|
| **API (NestJS)** | Stateless — no in-memory state, sessions via Clerk, cache via Redis | Can spin up multiple instances behind load balancer instantly |
| **Bazi Engine (Python)** | Stateless microservice — pure calculation, no state | Can scale independently from main API, add more instances |
| **AI Layer** | External API calls (Claude/GPT/Gemini) — no local GPU needed | Scales infinitely via provider's infrastructure |
| **Database (PostgreSQL)** | Prisma connection pooling, read replicas ready | Add read replicas when reads outpace writes |
| **Cache (Redis)** | Reading cache by birth-data hash — high cache hit rate | Same birth date = same chart, dramatically reduces AI API calls |
| **Auth (Clerk)** | Managed service — scales to 100K+ MAU | Zero infrastructure to manage |
| **Payments (Stripe)** | Managed service — handles millions of transactions | Zero infrastructure to manage |
| **Static Assets** | Cloudflare CDN — edge-cached globally | Asia-Pacific PoPs for TW/HK/MY users |
| **Mobile Updates** | Expo EAS OTA — update without app store review | Ship fixes in minutes, not days |
| **Admin Config** | DB-driven (not hardcoded) — all pricing/services from DB | Change anything without deploy |

### Key Scalability Bottlenecks & Solutions

| Bottleneck | When It Hits | Solution |
|-----------|-------------|----------|
| **AI API rate limits** | ~100 concurrent readings | Reading cache (same birth data = cached), queue system (BullMQ) |
| **Database connections** | ~500 concurrent users | Prisma connection pooling, PgBouncer, read replicas |
| **Single Railway instance** | ~1,000 concurrent users | Horizontal scaling (multiple instances) |
| **Bazi calculation load** | ~10,000 calculations/min | Scale Python service independently, add instances |
| **Redis memory** | ~100K cached readings | Cache TTL (expire after 30 days), Redis cluster |

### Phase 1: Start Small (0–1,000 users)
- **Single Railway instance** for API
- **Single PostgreSQL database** (Railway managed)
- **Redis** for caching (Railway add-on)
- **Python Bazi service** as sidecar container
- **Clerk** for auth (free tier: 10K MAU)
- **Estimated infrastructure cost:** $30–80/month
- **AI API cost (Claude Sonnet 4.5):** ~$0.02–0.05/reading × estimated 500–3,000 readings/month = $10–$150/month
- **Total estimated cost:** $50–250/month

### Phase 2: Growing (1,000–10,000 users)
- **Horizontal scaling** — Multiple API instances behind load balancer
- **Read replicas** for database
- **CDN caching** for static assets and common readings
- **Queue system** (BullMQ) for AI generation jobs
- **Estimated infrastructure cost:** $200–500/month
- **AI API cost:** $150–$1,500/month (with caching reducing ~40% of calls)
- **Clerk Pro:** $25/month (if >10K MAU)
- **Total estimated cost:** $400–$2,000/month

### Phase 3: Scale (10,000+ users)
- **Migrate to AWS/GCP** — ECS/Cloud Run for containers
- **Database sharding** or move to managed PostgreSQL (RDS/Cloud SQL)
- **Dedicated Redis cluster**
- **AI response caching layer** — Save and serve repeated readings
- **Multi-region deployment** — Asia-Pacific primary
- **Estimated infrastructure cost:** $500–$2,000/month
- **AI API cost:** $1,500–$10,000/month (heavy caching essential)
- **Total estimated cost:** $2,000–$12,000/month

### Unit Economics Validation ⚠️

**Cost per reading (Claude Sonnet 4.5):**
- Input: ~1,500 tokens (system prompt + chart data) × $3/1M = $0.0045
- Output: ~2,000 tokens × $15/1M = $0.03
- **Total per reading: ~$0.035**

**Revenue per paying user (monthly avg):**
- Basic ($4.99) → After Apple 30% cut: $3.49 → 5 readings = $0.175 AI cost → **margin: $3.32 (95%)**
- Pro ($9.99) → After Apple 30% cut: $6.99 → 15 readings = $0.525 AI cost → **margin: $6.47 (93%)**
- Master ($19.99) → After Apple 30% cut: $13.99 → ~30 readings avg = $1.05 AI cost → **margin: $12.94 (92%)**
- One-time reading ($1.99) → After Apple 30% cut: $1.39 → 1 reading = $0.035 → **margin: $1.36 (98%)**

**Free tier cost (1 reading/account):** $0.035/user — acceptable customer acquisition cost

**Break-even analysis (Phase 1):**
- Fixed costs: ~$100/month (infrastructure)
- Need ~30 Basic subscribers OR ~10 Pro subscribers to cover costs
- Viable for a bootstrapped start

**Key insight:** AI costs are manageable. The real cost concern is Apple/Google's 30% cut on in-app purchases, which is why web subscriptions should be promoted where possible (Stripe only takes 2.9% + $0.30).

---

## 9. Development Phases — Detailed Step-by-Step

### How I Will Develop This With You

Since this is a complex full-stack project built with Claude Code AI, I will develop it in **small, testable increments**. Each step produces something you can see and test before we move on. We won't try to build everything at once.

---

### PHASE 1: Foundation & Infrastructure (Steps 1-4)
*Goal: Project skeleton that runs, with auth working*

**Step 1: Monorepo Setup**
- Create Turborepo monorepo structure
- Initialize all apps: `apps/web` (Next.js), `apps/mobile` (Expo), `apps/api` (NestJS)
- Initialize packages: `packages/shared` (types), `packages/ui` (Tamagui components)
- Configure TypeScript, ESLint, Prettier across all packages
- Docker setup for local development
- 📍 **You can test:** Run `turbo dev` and see all apps start

**Step 2: Database & ORM**
- Set up PostgreSQL (local Docker + Railway config)
- Create Prisma schema with ALL tables (users, birth_profiles, bazi_readings, bazi_comparisons, subscriptions, transactions, services, plans, promo_codes, payment_gateways, prompt_templates, reading_cache)
- Run migrations, generate Prisma client
- Seed script with default services, plans, prompt templates
- Redis setup for caching
- 📍 **You can test:** Connect to DB, see tables, run seed

**Step 3: Authentication (Clerk)**
- Integrate Clerk SDK in Next.js web app
- Integrate Clerk Expo SDK in mobile app
- Configure all login methods: Email OTP, Phone OTP, Google, Apple, Facebook, LINE, Guest
- Invite code system setup
- Configure 90-day session expiry
- Create Clerk webhook to sync user data to our DB
- Language switcher (中文繁體/中文简体) on login screen
- 📍 **You can test:** Sign up/login on web AND mobile with all methods

**Step 4: API Server Core**
- NestJS API with module structure (auth, users, bazi, payments, admin)
- Clerk middleware for JWT verification
- Rate limiting (per-user, per-IP)
- CORS, helmet, validation pipes
- Health check endpoints
- API documentation (Swagger)
- 📍 **You can test:** Hit API endpoints with Postman, see auth working

**🧪 PHASE 1 AUTOMATED TESTS:**
```
tests/phase1/
├── monorepo.test.ts          — All apps build successfully, shared packages resolve
├── database.test.ts          — All tables exist, migrations run, seed data correct
├── auth-clerk.test.ts        — Signup/login flow, session creation, 90-day expiry verified
├── auth-providers.test.ts    — Each OAuth provider redirects correctly (Google, Apple, Facebook, LINE)
├── auth-otp.test.ts          — Email OTP send/verify, Phone OTP send/verify
├── auth-guest.test.ts        — Guest login creates anonymous user, can upgrade later
├── auth-invite.test.ts       — Invite code generates, new user joins via code
├── clerk-webhook.test.ts     — User created in Clerk → user record synced to our DB
├── api-health.test.ts        — All API endpoints return correct status codes
├── api-rate-limit.test.ts    — Rate limiter blocks after threshold (100 req/min per user)
├── api-cors.test.ts          — Only whitelisted origins allowed
├── api-validation.test.ts    — Invalid inputs rejected with proper error messages
└── language-switch.test.ts   — zh-TW and zh-CN toggle works, persists in user prefs
```
**Run:** `turbo test --filter=phase1` — all must pass before moving to Phase 2

---

### PHASE 2: Bazi Calculation Engine (Steps 5-6)
*Goal: Accurate Bazi chart calculation from birth data*

**Step 5: Python Bazi Calculator (Layer 1)**
- Python microservice with FastAPI
- **True Solar Time (真太陽時) adjustment** — Convert clock time to true solar time using birth city coordinates + Equation of Time. This is CRITICAL for accurate Hour Pillar calculation. Without it, charts can be wrong by 1-2 hours.
- Solar-to-Lunar calendar conversion (cnlunar library)
- Four Pillars calculation (年柱/月柱/日柱/時柱) — using true solar time for Hour Pillar
- Heavenly Stems & Earthly Branches for all pillars
- Hidden Stems (藏干) calculation
- Ten Gods (十神) derivation from Day Master
- Five Elements balance analysis with percentages
- Na Yin (納音) lookup
- Shen Sha (神煞) calculation
- Day Master strength analysis (旺衰)
- Pattern type detection (格局: 食神格, 正官格, etc.)
- 喜神/用神/閒神/忌神/仇神 derivation
- REST API endpoint: POST /calculate with birth data → structured JSON
- 📍 **You can test:** Send birth data, get full chart JSON back in <50ms

**Step 6: Luck Periods & Annual Stars**
- 大運 (Major Luck Periods) — 10-year cycles calculation
- 流年 (Annual Stars) — yearly Stem/Branch interactions
- 流月 (Monthly Stars) — monthly breakdowns
- Compatibility calculation — two charts' interaction analysis
- Comprehensive test suite: 50+ known birth charts validated against 萬年曆
- 📍 **You can test:** Verify calculations against online Bazi calculators, check accuracy

**🧪 PHASE 2 AUTOMATED TESTS:**
```
tests/phase2/
├── true-solar-time.test.ts       — Verify true solar time adjustment for 20+ cities (Taipei, HK, KL, Beijing, etc.)
│                                   Compare clock time vs true solar time, verify Hour Pillar changes correctly
├── calendar-conversion.test.ts   — 100+ dates: solar→lunar conversion accuracy (validate against cnlunar)
├── four-pillars.test.ts          — 50+ known birth charts: verify 年柱/月柱/日柱/時柱 match expected
├── heavenly-stems.test.ts        — All 10 stems cycle correctly for any date
├── earthly-branches.test.ts      — All 12 branches cycle correctly for any date
├── hidden-stems.test.ts          — 藏干 lookup correct for all 12 branches
├── ten-gods.test.ts              — Ten Gods derived correctly from Day Master relationship
├── five-elements.test.ts         — Element percentages sum to 100%, correct element mapping
├── day-master-strength.test.ts   — 旺衰 analysis matches known charts (偏弱/中/偏強)
├── pattern-type.test.ts          — 格局 detection (食神格, 正官格, etc.) matches references
├── favorable-gods.test.ts        — 喜神/用神/忌神/仇神 derivation correct per Day Master
├── na-yin.test.ts                — 納音 lookup matches standard 60-pair table
├── shen-sha.test.ts              — 神煞 calculation matches for known charts
├── luck-periods.test.ts          — 大運 10-year cycles: start age, direction, stems/branches correct
├── annual-stars.test.ts          — 流年 interactions with natal chart correct
├── monthly-stars.test.ts         — 流月 monthly stem/branch correct per solar terms
├── compatibility.test.ts         — Two-chart comparison: element interactions, Day Master compatibility
├── edge-cases.test.ts            — Midnight births, leap months, year boundaries (Feb 3-5)
├── performance.test.ts           — Single calculation <50ms, 100 concurrent <200ms each
└── golden-charts.test.ts         — 50 "golden reference" charts from 萬年曆, ALL fields validated
```
**Run:** `turbo test --filter=phase2` — all must pass before moving to Phase 3
**Critical:** golden-charts.test.ts is the most important — if ANY of 50 known charts don't match, we fix before proceeding

---

### PHASE 3: AI Interpretation (Steps 7-8)
*Goal: AI generates high-quality Bazi readings from chart data*

**Step 7: Claude AI Integration**
- Claude Sonnet 4.5 API integration with streaming
- Design system prompts for each reading type:
  - 八字終身運 (personality, life trajectory, strengths/weaknesses)
  - 八字流年運勢 (year-specific predictions, monthly breakdown)
  - 事業財運 (career path, favorable/unfavorable industries, financial timing)
  - 愛情姻緣 (relationship patterns, partner traits, marriage timing)
  - 先天健康分析 (health tendencies, wellness advice)
  - 合盤比較 (compatibility score, pair strengths/weaknesses)
- Prompt engineering with few-shot examples of gold-standard interpretations
- Streaming response delivery to frontend
- 📍 **You can test:** Input birth data → see AI-generated reading stream in real-time

**Step 8: Failover & Caching**
- GPT-5.2 failover (10s timeout on Claude → switch to GPT)
- Gemini 3 Pro failover (if GPT also fails)
- Reading cache: same birth data hash → return cached result
- Cache invalidation for annual readings (refresh each year)
- Error handling and retry logic
- 📍 **You can test:** Simulate Claude downtime, verify failover works seamlessly

**🧪 PHASE 3 AUTOMATED TESTS:**
```
tests/phase3/
├── claude-integration.test.ts    — Claude API connects, sends prompt, receives streaming response
├── claude-prompt-quality.test.ts — 10 sample charts: verify response contains expected sections
│                                   (personality, career, love, etc.), is in correct language (zh-TW)
├── claude-streaming.test.ts      — Streaming starts within 1s, full response within 10s
├── failover-gpt.test.ts         — Mock Claude timeout → GPT-5.2 receives request within 10s
├── failover-gemini.test.ts      — Mock Claude+GPT timeout → Gemini 3 receives request
├── failover-chain.test.ts       — Full chain: Claude fail → GPT fail → Gemini succeeds
├── reading-cache.test.ts        — Same birth data returns cached result (no API call)
├── cache-invalidation.test.ts   — Annual readings invalidate on year change
├── reading-types.test.ts        — All 6 types generate valid responses:
│                                   終身運, 流年, 事業財運, 愛情姻緣, 健康, 合盤比較
├── interpretation-format.test.ts — AI output has correct section headers, no gibberish, proper Chinese
├── compatibility-reading.test.ts — Two-person input generates comparison with score and advice
├── error-handling.test.ts       — Network errors, rate limits, invalid input all handled gracefully
└── cost-tracking.test.ts        — Token usage logged per request for cost monitoring
```
**Run:** `turbo test --filter=phase3` — all must pass before moving to Phase 4

---

### PHASE 4: Frontend — Bazi Chart UI (Steps 9-11)
*Goal: Beautiful chart display matching/exceeding SeerOnNet quality*

**Step 9: Birth Data Input**
- Input form: nickname, gender, birth date/time picker (with Chinese calendar overlay), birth region, timezone
- Relationship tag: 我的/親人/朋友
- Save multiple birth profiles
- Profile switcher (切換)
- Shared component working on both web and mobile
- 📍 **You can test:** Enter birth data on web and mobile, see profile saved

**Step 10: Bazi Chart Display (Free Section)**
- Color-coded single-page layout (Yellow/Pink/Orange/Blue/Green sections)
- Four Pillars table with colored Heavenly Stems & Earthly Branches
- Hidden Stems, Secondary Stars, Star Luck, Na Yin, Shen Sha rows
- 大運 horizontal scrollable timeline (current period highlighted)
- 流年 horizontal scrollable row
- 流月 horizontal scrollable row
- Five Elements analysis tabs (能量/個數/藏干數)
- Day Master analysis panel (命主屬性, 陰陽, 旺衰, 格局, 同黨/異黨 bar)
- 喜用神 display
- Ten Gods interpretation section
- Animated Five Elements wheel
- 📍 **You can test:** Full chart display with real data, scroll through all sections

**Step 11: AI Reading Display (Paywall Sections)**
- Streaming text display with progressive reveal animation
- Section-by-section layout:
  - 命格性格分析 (Personality) — first paragraph free, rest blurred
  - 感情婚姻分析 (Love) — pink theme, partial free
  - 一生財運分析 (Finance) — orange theme, partial free
  - 事業發展分析 (Career) — blue theme, with bar charts + partial free
  - 先天健康分析 (Health) — green theme, partial free
- Blurred text with "訂閱解鎖" (Subscribe to unlock) CTA overlay
- Subscribers see everything, non-subscribers see preview
- Cross-sell grid at bottom (related reading types)
- Compatibility view — side-by-side two-person charts
- 📍 **You can test:** See full reading as subscriber, see blurred preview as free user

**🧪 PHASE 4 AUTOMATED TESTS:**
```
tests/phase4/
├── input-form.test.tsx           — All fields render, date picker works, validation errors show
├── input-form-chinese-cal.test.tsx — Chinese calendar overlay shows correct lunar dates
├── profile-crud.test.tsx         — Create, read, update, delete birth profiles
├── profile-switch.test.tsx       — Switch between multiple saved profiles
├── chart-four-pillars.test.tsx   — Table renders with correct stems/branches/colors
├── chart-hidden-stems.test.tsx   — 藏干 row shows correct colored characters
├── chart-luck-periods.test.tsx   — 大運 timeline scrolls, current period highlighted
├── chart-annual-stars.test.tsx   — 流年 row renders, scrollable
├── chart-monthly-stars.test.tsx  — 流月 row renders, scrollable
├── chart-five-elements.test.tsx  — Percentage circles animate, tabs switch correctly
├── chart-day-master.test.tsx     — Day Master panel shows all analysis fields
├── reading-streaming.test.tsx    — Text appears progressively (not all at once)
├── reading-sections.test.tsx     — All 5 colored sections render in correct order
├── paywall-free-user.test.tsx    — Non-subscriber sees preview + blurred content + CTA
├── paywall-subscriber.test.tsx   — Subscriber sees ALL content, no blur, no CTA
├── free-reading.test.tsx         — New user gets 1 free full reading, 2nd reading shows paywall
├── compatibility-ui.test.tsx     — Side-by-side two-person chart renders correctly
├── cross-sell-grid.test.tsx      — Related services grid shows at bottom
├── responsive-web.test.tsx       — Layout correct at 375px, 768px, 1024px, 1440px widths
├── responsive-mobile.test.tsx    — Components render properly on iOS and Android simulators
└── accessibility.test.tsx        — Screen reader labels, contrast ratios, touch targets ≥44px
```
**Run:** `turbo test --filter=phase4` — all must pass before moving to Phase 5

---

### PHASE 5: Monetization & Payment (Steps 12-13)
*Goal: Users can subscribe and pay*

**Step 12: Payment Integration**
- **Dual payment system (MANDATORY):**
  - **Mobile (iOS/Android):** Apple IAP + Google Play Billing for ALL digital purchases (subscriptions AND one-time readings). Apple/Google require 30% commission on in-app digital goods — no way around this.
  - **Web:** Stripe for subscriptions + one-time purchases (only 2.9% + $0.30 fee). Promote web subscriptions where possible to maximize revenue.
- **Receipt validation server:** Server-side receipt verification for both Apple IAP and Google Play to prevent fraud
- **Subscription sync:** Unified subscription status across platforms — user subscribes on iOS, sees content on web and Android too (via server-side subscription record)
- Payment modal with two tabs: 訂閱 (Subscribe) | 單獨購買 (One-time)
- Region selector (全球/香港/台灣/馬來西亞) — shows relevant payment methods (web only; mobile uses Apple/Google native UI)
- Web payment methods: Credit card, LINE Pay, PayPal, Touch'n Go, Alipay (via Stripe)
- Coupon/promo code field in payment modal (web only — Apple IAP doesn't support external coupons)
- Value comparison message ("Individual purchase costs $XX, subscription saves $YY")
- No free trial — 1 free full reading per account only
- Stripe webhook handling (subscription created, cancelled, payment succeeded/failed)
- Apple IAP webhook (App Store Server Notifications V2) for subscription lifecycle events
- Google Play Real-time Developer Notifications (RTDN) via Cloud Pub/Sub
- 📍 **You can test:** Subscribe via Stripe test mode (web), Apple Sandbox (iOS), Google test (Android)

**Step 13: User Dashboard**
- Saved readings list with reading type, date, profile name
- Subscription status and management (upgrade/cancel)
- Purchase history
- Birth profiles management (add/edit/delete)
- Language preference
- 📍 **You can test:** View past readings, manage subscription, see payment history

**🧪 PHASE 5 AUTOMATED TESTS:**
```
tests/phase5/
├── stripe-subscription.test.ts      — Create subscription via Stripe test mode, verify DB updated
├── stripe-one-time.test.ts          — One-time credit purchase, verify credits added to user
├── stripe-webhook.test.ts           — Webhook events: subscription.created, payment_succeeded,
│                                      subscription.cancelled → correct DB state transitions
├── stripe-webhook-signature.test.ts — Reject webhooks with invalid signatures
├── payment-modal.test.tsx           — Two-tab modal renders (Subscribe | One-time)
├── payment-region.test.tsx          — Region selector shows correct payment methods per region
├── payment-coupon.test.tsx          — Valid promo code applies discount, invalid shows error
├── payment-value-compare.test.tsx   — "Save $XX with subscription" message shows correctly
├── apple-iap.test.ts               — Apple In-App Purchase flow (sandbox): subscribe, verify receipt
├── apple-iap-webhook.test.ts       — App Store Server Notifications V2: renewal, cancellation, refund
├── google-play.test.ts             — Google Play Billing flow (test): subscribe, verify token
├── google-play-rtdn.test.ts        — Google Real-time Developer Notifications: subscription events
├── cross-platform-sub.test.ts      — Subscribe on iOS → verify access on web and Android
├── subscription-unlock.test.ts     — After subscribing, paywalled content becomes visible immediately
├── subscription-cancel.test.ts     — After cancellation, access continues until period end, then locks
├── free-reading-limit.test.ts      — User gets exactly 1 free reading, 2nd triggers paywall
├── idempotency.test.ts             — Double-click payment → only 1 charge created
├── currency-display.test.tsx       — Correct currency shown per region (TWD, HKD, MYR, USD)
├── dashboard-readings.test.tsx     — Past readings list renders with correct data
├── dashboard-subscription.test.tsx — Subscription status, upgrade/cancel buttons work
├── dashboard-history.test.tsx      — Payment history shows all transactions
└── dashboard-profiles.test.tsx     — Birth profiles CRUD from dashboard
```
**Run:** `turbo test --filter=phase5` — all must pass before moving to Phase 6

---

### PHASE 6: Admin Dashboard (Step 14)
*Goal: You can manage everything without code changes*

**Step 14: Admin Panel**
- Protected route at `/admin/*` (Clerk admin role check)
- Service Management — enable/disable reading types, edit descriptions, set pricing
- Plan Management — edit subscription tiers, monthly/annual pricing
- Promo Codes — create/edit/disable discount codes
- Payment Gateway Config — enable/disable per region
- User Management — search users, view subscriptions, issue credits/refunds
- AI Prompt Templates — edit system prompts per reading type (live editor with preview)
- Reading Analytics — charts showing popular readings, revenue, conversion rates
- Free Tier Controls — adjust free usage limits
- 📍 **You can test:** Change a subscription price in admin, see it reflected on the payment page instantly

**🧪 PHASE 6 AUTOMATED TESTS:**
```
tests/phase6/
├── admin-access.test.ts          — Admin role can access /admin/*, regular users get 403
├── admin-services.test.ts        — CRUD services: create, enable/disable, change price, reorder
├── admin-plans.test.ts           — CRUD subscription plans: edit pricing, toggle active
├── admin-promo.test.ts           — Create promo code, apply it, check usage counter, expire it
├── admin-payment-gw.test.ts      — Toggle payment gateways on/off per region
├── admin-users.test.ts           — Search users, view details, issue credits, process refund
├── admin-prompts.test.ts         — Edit AI prompt template, verify new prompt used on next reading
├── admin-analytics.test.ts       — Analytics dashboard loads, shows correct aggregated data
├── admin-free-tier.test.ts       — Change free reading limit from 1→3, verify user gets 3 free
├── admin-realtime.test.tsx       — Price change in admin → payment page reflects new price immediately
│                                   (no deploy needed, reads from DB)
├── admin-audit-log.test.ts       — All admin actions logged with timestamp and admin user ID
└── admin-ai-cost-dashboard.test.ts — AI usage costs displayed correctly, alerts on budget thresholds
```
**Run:** `turbo test --filter=phase6` — all must pass before moving to Phase 7

---

### PHASE 7: Polish & Launch (Steps 15-16)
*Goal: Production-ready, submitted to app stores*

**Step 15: Performance & Security**
- Load testing (100 concurrent requests)
- Image optimization, lazy loading
- Skeleton loading states
- Haptic feedback on mobile interactions
- Dark mode support
- Security audit (OWASP top 10)
- Penetration testing on auth and payment flows
- 📍 **You can test:** App feels fast and premium on mobile

**Step 16: Launch**
- Traditional Chinese localization review (native speaker)
- **App Store compliance review ⚠️:**
  - Apple Guideline 5.6 — Apps with "Entertainment" fortune-telling are allowed, but must NOT promise real-world outcomes. Add disclaimer: "本服務僅供參考與娛樂用途" (This service is for reference and entertainment purposes only)
  - Guideline 3.1.1 — All digital content purchases MUST use Apple IAP (already addressed in Step 12)
  - Guideline 5.1.1 — Privacy policy URL required, data collection disclosure
  - Guideline 4.3 — Ensure app is sufficiently different from competitors (our AI + comparison feature differentiates us)
  - Age rating: 12+ (fortune-telling category, no mature content)
  - Prepare for potential reviewer questions about "fortune-telling" classification
- App Store submission (iOS) — app icon, screenshots, description, privacy nutrition labels
- Google Play submission (Android) — data safety section, content rating questionnaire
- Web deployment to Railway + Cloudflare CDN
- Domain setup + SSL
- Sentry error monitoring + PostHog analytics
- Beta testing with 10-20 target users
- 📍 **You can test:** Download from App Store/Play Store, use full flow end-to-end

**🧪 PHASE 7 AUTOMATED TESTS (End-to-End):**
```
tests/phase7/
├── e2e-full-flow.test.ts         — Complete user journey:
│                                   1. Open app → 2. Sign up (email) → 3. Enter birth data
│                                   → 4. See Bazi chart → 5. Use free reading → 6. Hit paywall
│                                   → 7. Subscribe → 8. See full content → 9. Save reading
│                                   → 10. View in dashboard
├── e2e-guest-upgrade.test.ts     — Guest login → use free reading → upgrade to full account
├── e2e-compatibility.test.ts     — Enter two profiles → generate compatibility → view results
├── e2e-mobile-ios.test.ts        — Full flow on iOS simulator (Detox)
├── e2e-mobile-android.test.ts    — Full flow on Android emulator (Detox)
├── e2e-web-responsive.test.ts    — Full flow on web at mobile/tablet/desktop sizes (Playwright)
├── load-test.test.ts             — 100 concurrent users: API response <5s, no 500 errors
├── load-test-bazi.test.ts        — 100 concurrent Bazi calculations: all <200ms
├── security-owasp.test.ts        — OWASP top 10 checks: XSS, CSRF, SQL injection, auth bypass
├── security-payment.test.ts      — Payment tampering attempts blocked, webhook signature verified
├── security-rate-limit.test.ts   — Brute force login blocked after 10 attempts
├── seo-meta.test.ts              — Correct meta tags, OG tags, structured data for Chinese SEO
├── localization-zh-tw.test.ts    — All UI strings present in Traditional Chinese, no missing keys
├── localization-zh-cn.test.ts    — All UI strings present in Simplified Chinese, no missing keys
├── performance-lighthouse.test.ts — Lighthouse scores: Performance >90, Accessibility >90
├── offline-cache.test.ts         — Recent readings available offline on mobile
├── error-recovery.test.ts        — Network disconnect during reading → reconnect → resume streaming
├── free-tier-abuse.test.ts       — Guest can't get free reading; same device multi-account detected
├── entertainment-disclaimer.test.ts — All readings contain required disclaimer text
├── privacy-policy.test.ts        — Privacy policy accessible in zh-TW, zh-CN, English
└── app-store-compliance.test.ts  — Verify all Apple/Google required metadata present
```
**Run:** `turbo test --filter=phase7` — ALL must pass before app store submission

**📊 TOTAL TEST COVERAGE TARGET:**
- Phase 1: ~15 test files (infrastructure)
- Phase 2: ~20 test files (Bazi accuracy — MOST CRITICAL, including true solar time)
- Phase 3: ~13 test files (AI integration)
- Phase 4: ~21 test files (UI components)
- Phase 5: ~22 test files (payments — expanded for Apple IAP/Google Play cross-platform)
- Phase 6: ~12 test files (admin + AI cost tracking)
- Phase 7: ~20 test files (E2E + security + compliance + abuse prevention)
- **Total: ~123 test files, targeting >85% code coverage**

---

### POST-LAUNCH: Phase 2 Features (Roadmap)
- Simplified Chinese full support
- 紫微斗數 (Ziwei Doushu) module
- Daily fortune push notifications
- Shareable social media cards
- WeChat login (requires WeChat Open Platform approval)
- User referral program
- Additional payment gateways if needed

### POST-LAUNCH: Phase 3 Features (6+ months)
- 塔羅占卜 (Tarot) module
- Live master consultation marketplace
- Community forum
- Physical product store (bracelets, talismans)
- AI chatbot for follow-up questions
- Enterprise/API access

---

## 10. Admin Dashboard (V1 MUST HAVE)

A full admin panel for managing all services, products, and pricing without code changes.

### Admin Features
- **Service Management** — Enable/disable reading types, set descriptions, change availability
- **Pricing Management** — Update subscription tiers, credit costs, bundle pricing anytime (changes reflect immediately)
- **Payment Gateway Config** — Enable/disable payment methods per region
- **User Management** — View users, manage subscriptions, issue credits/refunds
- **Reading Analytics** — Track which readings are popular, revenue per reading type, conversion rates
- **AI Cost Dashboard** — Real-time token usage tracking per provider, daily/monthly cost breakdown, budget alerts (e.g., alert when daily AI cost exceeds $X)
- **Content Management** — Edit AI prompt templates per reading type AND per provider, reading descriptions, marketing copy
- **Free Tier Controls** — Adjust free usage limits (e.g., change from 1 free reading to 3)
- **Coupon/Promo Codes** — Create discount codes for marketing campaigns
- **Audit Log** — All admin actions logged with timestamp, action details, old/new values

### Admin Tech
- Built as a protected route within the Next.js web app (`/admin/*`)
- Single admin user (you) — protected by Clerk `admin` role check
- All pricing/service data stored in database, NOT hardcoded — admin changes update DB directly
- Real-time preview before publishing changes

---

## 11. Database Schema (Core V1)

```sql
-- Users (Clerk handles auth, we store app-specific data)
users (id, clerk_user_id, name, avatar_url, subscription_tier, credits, language_pref, created_at, updated_at)

-- Birth Profiles (users can save multiple)
birth_profiles (id, user_id, name, birth_date, birth_time, birth_location, gender, is_primary, created_at)

-- Bazi Readings (generated reports — single person)
-- ai_interpretation stored as structured JSON with sections:
-- { "personality": { "preview": "first paragraph", "full": "complete text" },
--   "career": { "preview": "...", "full": "..." },
--   "love": { "preview": "...", "full": "..." },
--   "finance": { "preview": "...", "full": "..." },
--   "health": { "preview": "...", "full": "..." } }
-- This enables: (1) serving preview vs full per section for paywall,
-- (2) re-rendering individual sections without re-fetching entire reading,
-- (3) future per-section unlock if business model changes
bazi_readings (id, user_id, birth_profile_id, reading_type, calculation_data_json, ai_interpretation_json, ai_provider, ai_model, token_usage_json, credits_used, created_at)

-- Bazi Compatibility Readings (two-person comparison — V1 MUST HAVE)
bazi_comparisons (id, user_id, profile_a_id, profile_b_id, comparison_type, calculation_data_json, ai_interpretation_json, ai_provider, ai_model, token_usage_json, credits_used, created_at)

-- Subscriptions
subscriptions (id, user_id, stripe_subscription_id, plan_tier, status, current_period_start, current_period_end)

-- Transactions
transactions (id, user_id, stripe_payment_id, amount, currency, type, description, created_at)

-- Reading Cache (for performance)
-- birth_data_hash = SHA-256(birth_datetime_utc + birth_lng_lat + gender + reading_type)
-- This ensures unique cache per combination of birth data + reading type
reading_cache (id, birth_data_hash, reading_type, calculation_json, interpretation_json, created_at, expires_at)

-- AI Usage Tracking (cost monitoring — CRITICAL for budget control)
ai_usage_log (id, user_id, reading_id, ai_provider, ai_model, input_tokens, output_tokens, cost_usd, latency_ms, is_cache_hit, created_at)

-- ========== ADMIN-CONFIGURABLE TABLES ==========

-- Service/Product Catalog (admin can change pricing/availability anytime)
services (id, slug, name_zh_tw, name_zh_cn, description_zh_tw, description_zh_cn, type, credit_cost, is_active, sort_order, created_at, updated_at)

-- Subscription Plans (admin-managed pricing tiers)
plans (id, slug, name_zh_tw, name_zh_cn, price_monthly, price_annual, currency, features_json, readings_per_month, is_active, sort_order, created_at, updated_at)

-- Promo Codes (admin-created discounts)
promo_codes (id, code, discount_type, discount_value, max_uses, current_uses, valid_from, valid_until, is_active, created_at)

-- Payment Gateway Config (admin toggle per region)
payment_gateways (id, provider, region, is_active, config_json, created_at, updated_at)

-- AI Prompt Templates (admin-editable without code deploy, per-provider)
prompt_templates (id, reading_type, ai_provider, version, system_prompt, user_prompt_template, output_format_instructions, is_active, created_at, updated_at)
-- ai_provider: 'claude' | 'gpt' | 'gemini' — allows different prompts per provider for failover quality

-- Admin Audit Log (track all admin actions)
admin_audit_log (id, admin_user_id, action, entity_type, entity_id, old_value_json, new_value_json, created_at)
```

---

## 12. Why Clerk Over Supabase Auth / Auth.js

| Criteria | Clerk | Supabase Auth | Auth.js |
|----------|-------|--------------|---------|
| **Setup time** | 1–3 days | 2–5 days | 3–7 days |
| **Pre-built UI** | Yes (saves 40-80hrs) | No (build yourself) | No |
| **Expo/React Native** | Native SDK with dedicated Expo module | Basic, needs custom work | Community adapter |
| **LINE login** | Native support | Manual OAuth | Manual OAuth |
| **Phone OTP** | Built-in | Built-in | Plugin |
| **Guest/Anonymous** | Built-in | Built-in | Manual |
| **Invite codes** | Built-in invitation system | Manual | Manual |
| **WeChat** | Custom OAuth provider (V2) | Manual | Has a provider |
| **Session management** | Configurable (up to 90 days) | Configurable | Configurable |
| **Pricing** | Free 10K MAU, $25/mo Pro | Free 50K MAU | Free (self-hosted) |
| **User management UI** | Full dashboard included | Basic | None |

**Decision: Clerk** — Native Expo SDK for premium mobile feel, pre-built UI saves 40-80hrs, LINE login native support for Taiwan market, built-in invitation system matches SeerOnNet's 邀请码, 10K MAU free for Phase 1.

---

## 13. Verification & Testing Plan

1. **Bazi Calculation Accuracy** — Create test suite with 50+ known birth charts, validate Four Pillars, Five Elements, Ten Gods against established Bazi references (萬年曆)
2. **AI Interpretation Quality** — Expert review of 20+ generated readings by Bazi practitioners
3. **Performance** — Load test API with 100 concurrent reading requests, target < 5s response
4. **Payment Flow** — End-to-end test of subscription signup, reading generation, credit purchase using Stripe test mode
5. **Cross-Platform** — Test on iOS (iPhone 12+), Android (Pixel 5+), Web (Chrome, Safari, Firefox)
6. **Security** — OWASP top 10 audit, penetration testing on auth flows
7. **Localization** — Native Traditional Chinese speaker review of all UI text and AI outputs
