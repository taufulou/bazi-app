# AI Chat Feature — Closed Beta Launch Checklist

Phase 1.11 of the AI chat feature ships a 50-user closed beta over 7 days.
This document is the operational checklist for that launch — what must be
verified before flipping the feature on, what to watch during the beta, and
the kill-switch if things go wrong.

The plan source is
[`/Users/roger/.claude/plans/next-the-big-feature-proud-manatee.md`](../.claude/plans/next-the-big-feature-proud-manatee.md).

## Pre-launch verification

Run these checks 24 hours before flipping the feature on for beta users.

### 1. Backend health

```bash
# 1a. All backend tests green
cd apps/api && ../../node_modules/.bin/jest test/chat
# Expect: 101 passing (chat-service, chat-stream, chat-payment, chat-validators)

# 1b. Admin chat aggregate tests green (includes Phase 1.11 cost-bucket tests)
../../node_modules/.bin/jest test/admin-service.spec.ts -t "getChatAggregate"
# Expect: 6 passing
```

### 2. Engine health

```bash
# 2a. Doctrine eval corpus passes (single-turn)
cd packages/bazi-engine && source .venv/bin/activate
python -m pytest tests/test_chat_doctrine_eval.py -v
# Expect: all PASS, 95% threshold met for evaluable trials,
# 100% PASS on per-flag regression (shangguanJianGuan, biJieDuoCai,
# guanShaHunZa, chongPeiOuGong, spousePalaceFrictions)

# 2b. Multi-turn drift corpus passes (Phase 1.11)
python -m pytest tests/test_chat_doctrine_eval.py::TestDriftRunnerMockMode -v
# Expect: all PASS — 5-turn Laopo drift fixture must pass every turn
```

### 3. Cache invalidation

After any prompt or pre-analysis version bump:

```bash
redis-cli FLUSHALL
```

Verify `apps/api/src/ai/ai.service.ts::PRE_ANALYSIS_VERSIONS` and
`apps/api/src/chat/chat-context.service.ts::CHAT_PROMPT_VERSIONS` match
the deployed code.

### 4. Frontend mounts only on lifetime readings

Visual check (manual — no automated E2E in Phase 1):
- [ ] Open a Bazi LIFETIME reading. ChatFloatingButton appears bottom-right.
- [ ] Open a CAREER / ANNUAL / LOVE / COMPATIBILITY / HEALTH reading.
      ChatFloatingButton must NOT appear (Phase 1 scope: lifetime only).
- [ ] Open a ZWDS reading. ChatFloatingButton must NOT appear.

### 5. Quota / payment flow smoke test

With a test user on each tier:
- [ ] FREE tier: monthly quota 0. Sending a message opens `extend_standard`
      dialog immediately.
- [ ] BASIC tier: monthly quota 15. First 15 messages free, 16th opens
      `extend_standard`.
- [ ] After purchasing extension, next 10 messages free (paid allowance).
- [ ] At message 20, soft-warning dialog appears
      (`turn20_warning_zero_balance` or `turn20_warning_with_balance`).
- [ ] At message 30, hard-cap dialog appears, composer becomes read-only.
- [ ] Refused topics (lottery / medical / death prediction) trigger
      synthetic refusal without consuming credit.

### 6. Doctrine smoke check (manual)

Use Laopo's chart (丙寅/辛丑/甲戌/壬申 female):
- [ ] Ask: "我的傷官見官嚴重嗎?"
- [ ] AI response should contain "忌神" or "並非為禍" or "反為調節"
- [ ] AI response MUST NOT contain "恆凶", "必凶", or "必有官非"
- [ ] Across 5 follow-up turns ("為什麼?", "可以再具體一點嗎?", etc.), the
      framing must remain consistent — no drift toward folk doctrine.

If this fails, **DO NOT LAUNCH**. The doctrine accuracy promise is
load-bearing for the entire feature.

## Beta launch

### Cohort selection

50 users across the 4 paid tiers (rough split):
- 5 FREE
- 20 BASIC
- 15 PRO
- 10 MASTER

All must already have a Bazi LIFETIME reading (the only chat-eligible
reading type in Phase 1).

### Communication

- Beta-invite email/notification mentions:
  - "Reply with feedback to feedback@..."
  - The 30-message-per-session cap
  - Free quota count (per tier)
  - Disclaimer: "本服務僅供參考與娛樂用途，不構成任何專業建議"

## During-beta monitoring (daily)

### Admin dashboard

Visit `/admin/chat` daily and record:

| Metric | Threshold | What to do if breached |
|---|---|---|
| Refund rate | < 5% | Investigate AI failures (check Sentry for `AI_FAILED` errors) |
| LLM-judge fail rate | < 5% (sampled at 5%) | Inspect failed responses; consider prompt iteration |
| Cache hit rate | > 70% (validates the plan's 80% assumption) | Investigate session structure; long idle gaps reset cache |
| Avg cost per 1-10 msg session | < $0.50 | Cost watchdog alert per plan |
| Avg cost per 11-20 msg session | < $0.85 | Cost watchdog alert |
| Avg cost per 21-30 msg session | < $1.50 | Cost watchdog alert |
| Hard-cap hit rate | < 30% | If high, plan tier quota tuning post-beta |
| Sessions at hard cap | tracked | Indicates how often users want >30 messages — input for Phase 2 |

### Sentry alerts to wire

- Avg session cost in any bucket > 2× plan threshold over 24h rolling
- Anthropic API 5xx rate > 5%
- LLM-judge FAIL on any message containing 「必」「絕對」「肯定」 patterns
  in user-facing assistant content

### Logs to spot-check

- `[ChatStreamService] Stream aborted on client disconnect` — expected
  occasional; high rate suggests latency issues
- `[ChatService] Session {id} contextVersion drifted` — should be 0 in
  beta (no version bumps during beta)
- `[ChatStreamService] Refunded ... for message ...` — track refund volume

## Kill switch

If anything goes badly wrong:

```bash
# 1. Block new chat sessions at the API layer
# Set env on the API server:
export CHAT_FEATURE_DISABLED=1
# Restart NestJS
```

Wire `CHAT_FEATURE_DISABLED` env check at the top of
`apps/api/src/chat/chat.controller.ts` to throw 503 on all chat endpoints.
**This wiring is Phase 2** — Phase 1 has no kill switch in code; if needed
during beta, a manual deploy disabling the chat module is the fallback
(comment out `ChatModule` from `app.module.ts`, redeploy).

## Live recording verification (Phase 1.5 follow-up B)

Once `live_runner.py` has recorded fixtures for the previously
NEEDS_RECORDING trials (~49 of 53; 4 synthetic-chart trials are deferred
to Phase A), validate the corpus is now fully exercised:

```bash
cd packages/bazi-engine && source .venv/bin/activate

# 1. Mock mode — runs full corpus against recorded fixtures
python -m pytest tests/test_chat_doctrine_eval.py -v

# Expected:
#   - All 34 unit tests PASS (corpus structure, drift, safeguards)
#   - Mock-mode runner reports ≥95% PASS on full corpus
#   - 100% PASS on per-flag regression (shangguanJianGuan, biJieDuoCai,
#     guanShaHunZa, chongPeiOuGong, spousePalaceFrictions)

# 2. Spot-check 3 random doctrine fixtures by hand
ls tests/validation/chat_doctrine_eval_responses/*.json | shuf -n 3
# Open each and verify:
#   - response is in zh-TW
#   - cites engine flags (e.g., 「忌神」, 「丁酉」, 「並非為禍」 for Laopo)
#   - no banned absolute-language phrases (一定/絕對/必凶/必為禍)
#   - prompt_version matches CHAT_V1_PROMPT_VERSION_LOCAL
```

If the post-recording corpus run drops below 95% PASS, **DO NOT LAUNCH BETA**.
Investigate the failures via:

```bash
python tests/validation/run_chat_doctrine_eval.py
# Reads CHAT_DOCTRINE_EVAL_MODE=mock, prints per-trial PASS/FAIL with reasons
```

Common failure causes after fresh recording:
- `forbidden_all` patterns matching debunking text (e.g., AI says «民俗誤解認為傷官見官恆凶» — the substring «恆凶» appears).
  Fix: tighten `forbidden_all` to claim-form only (Phase 1.5 audit pattern).
- AI didn't follow the doctrineDirective format. May need prompt iteration
  (then re-record affected trials with `--force-rerecord`).
- Token-count edge case: response truncated at max_tokens=800.
  Inspect output_tokens in fixture; if 800, prompt may need tightening.

## Post-beta tuning (after 7 days)

### Tier quota tuning

Decide based on observed usage:
- If BASIC users typically use only 5-8 chats/month, consider reducing the
  free quota from 15 to 10.
- If PRO users hit the 30 quota, consider raising or adding a credit-bonus
  tier.
- If MASTER users barely use chat, consider repositioning the tier value.

### Cost-cap thresholds

Tighten the per-bucket cost watchdog thresholds based on `(avg + 1σ)` and
`(avg + 2σ)` from real beta data. Initial thresholds (Phase 1.11) are
conservative placeholders.

### Cache miss rate

The plan assumed 20% cache miss rate. Validate empirically from
`/admin/chat` cache hit rate metric. If actual miss rate is much higher
than 20%, revisit the cost projections; if much lower, tier margins are
better than projected.

## Phase 2 inputs from beta

Items to defer to Phase 2 based on beta observation:
- Mobile (Expo) chat UI
- Chat for non-lifetime reading types (career, annual, love, etc.)
- Admin message-content drill-down (with audit log + TOS update)
- 3 deferred follow-ups from Phase 1.5:
  - **A**: Engine dry-run validation of 4 synthetic doctrine fixtures
  - **B**: Live mode recording for 53 unrecorded eval trials (~$16 + 2h
    Anthropic spend)
  - **C**: LLM-as-judge in eval corpus runner
- Persisting `CONTEXT_VERSION_DRIFTED` events for the admin dashboard
  (Phase 1.10 audit deferral)

## Sign-off

- [ ] Backend tests green (101 chat + 6 admin chat aggregate)
- [ ] Engine tests green (34 chat doctrine eval — 13 single-turn + 12 drift + 9 live-runner safeguards)
- [ ] **Phase 1.5 follow-up B complete**: 49 live recordings + corpus passes ≥95% in mock mode
- [ ] Manual doctrine smoke check passed (Laopo 5-turn drift)
- [ ] Manual quota/payment flow smoke check passed
- [ ] ChatFloatingButton verified to mount only on lifetime readings
- [ ] Beta cohort selected and invited
- [ ] Sentry alerts wired
- [ ] Daily monitoring schedule set

When all sign-off items are checked, flip the feature on for the beta
cohort.

---

# Phase 2 + Phase 3 + Phase 3.1 ship-status update (2026-05-12)

## All 5 reading types now have working chat

| Reading type | Phase | Status | Versions |
|---|---|---|---|
| LIFETIME (八字終身運) | Phase 1 | Shipped + audited | prompt v1.2.2 / pre-analysis v2.9.0 |
| LOVE (八字愛情姻緣) | Phase 2 | Shipped + browser-tested | prompt v1.0.1 / pre-analysis v1.11.0 |
| CAREER (八字事業詳批) | Phase 2 | Shipped + browser-tested | prompt v1.0.1 / pre-analysis v2.5.0 |
| ANNUAL (八字流年運勢) | Phase 2 | Shipped + browser-tested | prompt v1.0.3 / pre-analysis v2.4.0 |
| COMPATIBILITY (八字合盤比較) | Phase 3 + 3.1 | Shipped + 14-test pass + 15-fix audit + Bazi-master review applied | prompt **v1.1.0** / pre-analysis **v1.8.2** |

## Phase 3.1 hardening completed (2026-05-12)

### 3.1a — Bazi-master review (sub-agent, batched 5 reading types)
- **HIGHEST finding fixed**: K-3 few-shot doctrinal correction — `marriagePalace.personality.archetype` describes B's IDEAL spouse (per `spouse_traits` schema in `ten_god_personality.json`), NOT B's own character. K-3 prompt rule + H4 engine slim both now exclude this field. Only `chartB.romance.lovePersonality.*` valid for «B 本人怎樣» questions.
- **HIGH findings fixed**: 配偶星 gender hint in COMPAT scope; 六合/半合 added to spouse-palace interaction list; partner cross-sell wording softened from administrative «使用對方生辰資料解鎖» to natural «另外輸入對方的生辰資料，解鎖».
- DB: COMPATIBILITY general sample questions updated («我們兩個命局上最大的挑戰是什麼？» / «感情中我最需要注意哪一點？»).

### 3.1b — Doctrine eval corpus extension (17 trials)
- New CSV: `packages/bazi-engine/tests/validation/chat_doctrine_eval_compat.csv` (17 hand-labeled trials covering compat_overview / wedding_timing / partner_personality / partner_appearance / love_on_self / interaction_dynamics / conflict_warning / compatibility_advice / cross_chart_findings / K-1/K-2/K-3/K-4 refuses / PII safety / locale_lock).
- New live recorder: `live_runner_compat.py` (Node-subprocess extracts production COMPAT prompt; no TS→Python re-port drift).
- New fixtures: 17 × `chat_doctrine_eval_compat_responses/compat_NNN.json` (Sonnet 4.6, **total spend $1.66**, under $5 cap).
- New CI runner: `run_chat_doctrine_eval_compat.py` — **17/17 PASS** on substring eval.

### 3.1c — LLM-as-judge for COMPAT (minimum-viable)
- New judge prompt builder: `judge_prompt_compat.py` — dual-chart context blocks (chartA + chartB), compat-specific evaluation criteria (K-3 opener, partner cross-sell wording, PII safety, locale lock).
- Wired via `--with-judge` flag in eval runner.
- **Known limitation**: judge has high false-positive rate (~50%) because compact chart-context summaries don't include all data the AI legitimately cites (timing year-干支 combos, doctrineInjectors Chinese narratives). **Phase 3.2 candidate**: iterate judge prompt with richer context blocks. Current substring eval (17/17 PASS) is the load-bearing CI gate.

### 3.1d — Production observability
- New service: `ChatMetricsService` — per-reading-type bucketed metrics (cost P50/P95/avg per session, refuseRate, session/message counts).
- New endpoint: `GET /api/admin/chat/metrics?days=7` (admin auth, throttled 30/min).
- Healthy refuseRate band: 5-25%. Watchdog cost thresholds (placeholders, tune after beta): P50 < $0.40-0.50/session, P95 < $0.80-1.00/session.
- **Click-through analytics** (partner cross-sell): not yet wired (requires analytics backend); deferred to Phase 3.2.

## Deferred to Phase 3.2

### Bazi-master findings on LOVE/CAREER/ANNUAL/LIFETIME prompts (never previously reviewed)

These are real prompt-polish opportunities but **not blocking** — current prompts are usable. Apply in next prompt-tuning sweep.

**LOVE** (READY WITH MINOR EDITS):
- HIGH: 配偶星 gender clarification (男命 正財/偏財; 女命 正官/七殺) — currently «視性別與命局而定» is too vague
- HIGH: 比劫奪財 scope boundary — clarify marriage-side only; financial-side defer to LIFETIME/CAREER
- MEDIUM: L-2 few-shot references «合盤比較» not in LOVE's cross-sell whitelist
- MEDIUM: Monthly love timing scope addition

**CAREER** (READY WITH MINOR EDITS):
- HIGH: Investment prohibition not carried into CAREER chat scope — `GUIDE_STYLE_RULES:93` prohibits specific investment recommendations but CAREER scope allows «投資傾向» with no caveat
- HIGH: 流年事業時機 scope clarification (year-granularity)
- MEDIUM: 殺刃格 / 食神格 / 傷官格 career patterns missing from scope
- MEDIUM: C-3 few-shot speculative wording «自然吸引{X類型對象}»

**ANNUAL** (READY WITH MINOR EDITS):
- HIGH: 犯太歲 vs 沖太歲 vs 合太歲 distinction missing from scope
- MEDIUM: 跨年模式 (2-3 year pattern questions) scope clarification
- MEDIUM: A-3 few-shot 大運 placeholder needs «luckPeriods auspiciousness» reference

**LIFETIME** (READY WITH MINOR EDITS):
- HIGH: Sample question «我適合做哪種投資？» (finance_pattern bucket) conflicts with `GUIDE_STYLE_RULES:93` investment prohibition — change DB seed
- MEDIUM: 父母 third-party PII boundary
- MEDIUM: Few-shot 9 干支-to-`annualForecast15` cross-reference
- LOW: Persona inconsistency between chat (命理顧問) and guide (人生攻略撰寫師)

### Other Phase 3.2 candidates
- **Iterate 3.1c judge prompt** — richer context blocks for COMPAT (timing year-干支, doctrineInjectors content, dimensionScores findings). Goal: judge fail rate < 15% (matching Phase 1.5 follow-up C target).
- **Partner-cross-sell click-through analytics** — instrument compat page to track CTR on `partner_*` cross-sell links.
- **Cron-scheduled metrics snapshot** — daily snapshot to a new `chat_metrics` table for time-series analysis (currently on-demand only).
- **COMPATIBILITY admin UI** — add COMPAT to admin chat-questions page (currently SQL-direct).
- **K-4 partial-give refuse detection** — extend `CHAT_V1_TOPIC_REFUSE_OPENING_REGEX` to optionally match «理解您的心情，但...無法...完整答案的地方» style partial-gives. Current behavior: charged normally (acceptable trade-off).
- **15 audit-from-Phase-3-follow-up fixes**: full list in `next-the-big-feature-proud-manatee.md` plan — all 15 fixes shipped + audit-of-fixes approved, listed here for traceability.

## Cache invalidation post-deploy (Phase 3.1)

After deploying Phase 3.1 changes, run `redis-cli FLUSHALL` post-deploy.
The COMPATIBILITY prompt v1.0.1→v1.1.0 + pre-analysis v1.8.1→v1.8.2 bumps will
invalidate all existing COMPAT chat sessions (CONTEXT_VERSION_DRIFTED).
LIFETIME / LOVE / CAREER / ANNUAL sessions are NOT affected (per-type version map).

⚠️ Operator checklist (mirrors Phase 12g/12i pattern):
1. Confirm with product owner that cache bust is acceptable
2. Stage deploy outside peak read traffic
3. Monitor Anthropic API spend dashboard for 48h post-deploy
4. Document expected regen volume in deploy ticket

Phase 3.1 cache bust scope: COMPATIBILITY only (no LIFETIME/LOVE/CAREER/ANNUAL hit).

## Phase 3.1 Sign-off

- [x] Bazi-master review (sub-agent, batched 5 reading types) — findings returned + COMPAT HIGHEST/HIGH/MEDIUM applied
- [x] COMPATIBILITY doctrine eval corpus (17 trials, $1.66 spend, 17/17 PASS substring)
- [x] LLM-as-judge for COMPAT (minimum-viable; polish deferred to 3.2)
- [x] ChatMetricsService + admin endpoint shipped
- [x] Prompt version bumped + Nest restarted + Redis flushed
- [x] LOVE/CAREER/ANNUAL/LIFETIME findings documented as Phase 3.2 candidates
- [ ] Beta cohort uses new Phase 3.1 metrics endpoint daily to monitor refuseRate + cost

**Phase 3.1 complete. Bazi AI chat feature now ships ALL 5 reading types with polished COMPATIBILITY prompts, automated regression CI test (17 trials), and production observability.**

