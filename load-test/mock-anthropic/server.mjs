#!/usr/bin/env node
/**
 * L1 — a stand-in for the Anthropic Messages API, for load testing only.
 *
 * ## Why a mock at all
 *
 * Phase 3 drives 100 concurrent users through the real production stack. Doing
 * that against the real Anthropic API would cost roughly $0.30 per reading and
 * several hundred dollars per run, and would tell us nothing we want to know:
 * the question is whether OUR system holds at concurrency, not whether
 * Anthropic's does.
 *
 * ## What it has to get right, and why each one matters
 *
 * 1. **Anthropic's exact SSE event shape.** `ai.service.ts::streamClaude` reads
 *    `message_start` for `input_tokens` and `message_delta` for a CUMULATIVE
 *    `output_tokens`. Get those wrong and the spend ledger (S2) records
 *    nonsense, which is one of the things the load test is meant to verify.
 *
 * 2. **Structurally valid section JSON.** This is the one most easily missed. A
 *    mock that streams lorem ipsum makes every reading DEGRADE — the parser
 *    fails, the refund path fires, and the run measures the error path at
 *    100 VU instead of the success path. The numbers would look plausible and
 *    mean nothing. So the mock reads the section keys out of the prompt it was
 *    sent and echoes back a well-formed object for exactly those keys.
 *
 *    Reading the keys from the prompt (rather than hardcoding LIFETIME's 8 + 7)
 *    means this also works unchanged for CAREER, LOVE, ANNUAL and COMPATIBILITY.
 *
 * 3. **Realistic pacing.** Readings take ~145s in production across two
 *    concurrent calls. A mock that answers instantly would never let the S1
 *    governor's pools fill, so the pool-occupancy criteria could not be
 *    exercised at all.
 *
 * 4. **Rate-limit response headers.** Ob1's fetch wrapper reads
 *    `anthropic-ratelimit-*`. Emitting them keeps that path live under load.
 *
 * ## ⚠️ Reported usage drives REAL spend accounting
 *
 * The tokens this mock claims are fed to `AiSpendService`, which prices them and
 * moves the real Redis counters. At the default $50 daily cap, a run reporting
 * production-shaped usage trips the breaker after ~165 readings — and every
 * request after that gets a legitimate `AI_SPEND_CAP` 503, which would look
 * like a load failure while actually being the guard working correctly.
 *
 * Decide deliberately which you are testing (see `MOCK_USAGE_SCALE`), and see
 * the README for the run-book.
 *
 * Env:
 *   PORT                 listen port (default 8080)
 *   MOCK_STREAM_MS       wall-clock duration of each stream (default 40000)
 *   MOCK_TTFB_MS         delay before the first event (default 400)
 *   MOCK_USAGE_SCALE     multiplier on reported tokens (default 1; 0 = report
 *                        near-zero so the S2 breaker is not exercised)
 *   MOCK_FAIL_RATE       0..1 — fraction of requests answered with a 529, for
 *                        the Q2 chaos drill (default 0)
 *   MOCK_RL_REMAINING    value for anthropic-ratelimit-output-tokens-remaining
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const STREAM_MS = Number(process.env.MOCK_STREAM_MS || 40_000);
const TTFB_MS = Number(process.env.MOCK_TTFB_MS || 400);
const USAGE_SCALE = process.env.MOCK_USAGE_SCALE === undefined ? 1 : Number(process.env.MOCK_USAGE_SCALE);
const FAIL_RATE = Number(process.env.MOCK_FAIL_RATE || 0);
const RL_REMAINING = Number(process.env.MOCK_RL_REMAINING || 2_000_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pull the section keys out of the output-format block of the prompt.
 *
 * The prompt ends with a literal JSON skeleton, so the keys are the property
 * names inside `"sections": { ... }`. Deliberately tolerant: if nothing
 * matches we fall back to a single generic section rather than 500, because a
 * mock that hard-fails on an unfamiliar prompt turns one unmapped reading type
 * into a dead load test.
 */
function sectionKeysFrom(prompt) {
  const block = prompt.match(/"sections"\s*:\s*\{([\s\S]*?)\n\s*\}/);
  const source = block ? block[1] : prompt;
  const keys = [...source.matchAll(/"([a-z0-9_]+)"\s*:\s*\{\s*"(?:score|preview)"/g)].map((m) => m[1]);
  return keys.length ? [...new Set(keys)] : ['generic_section'];
}

/** Does this prompt ask for a `score` field? (Guide style injects one.) */
const wantsScore = (prompt) => /"score"\s*:/.test(prompt);

/** Filler that is plausibly Chinese, so byte/'token' ratios stay realistic. */
const FILLER =
  '命局中日主力量中和，五行分布相對均衡，整體格局屬於穩健發展的類型。' +
  '在人生的不同階段，會因為大運與流年的變化而呈現不同的樣貌，需要順勢而為。' +
  '建議把握當前階段的優勢，同時留意潛在的挑戰，穩紮穩打地累積實力。';

const text = (chars) => {
  let out = '';
  while (out.length < chars) out += FILLER;
  return out.slice(0, chars);
};

function buildPayload(prompt) {
  const keys = sectionKeysFrom(prompt);
  const score = wantsScore(prompt);
  const sections = {};
  for (const k of keys) {
    sections[k] = {
      ...(score ? { score: 3.5 } : {}),
      preview: text(70),
      full: text(450),
    };
  }
  return JSON.stringify({
    sections,
    summary: { ...(score ? { score: 4 } : {}), preview: text(40), full: text(300) },
  });
}

const sse = (res, event, data) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

async function handleMessages(req, res, body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad json' } }));
  }

  const userPrompt = (parsed.messages || []).map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  const systemPrompt = typeof parsed.system === 'string'
    ? parsed.system
    : Array.isArray(parsed.system) ? parsed.system.map((b) => b.text || '').join('\n') : '';

  // Deliberate failure injection for the Q2 chaos drill. 529 is Anthropic's
  // "overloaded", which is the realistic upstream failure to rehearse.
  if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
    res.writeHead(529, { 'content-type': 'application/json', ...rateLimitHeaders() });
    return res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'mock overloaded' } }));
  }

  const payload = buildPayload(userPrompt);
  // ~1 token per CJK char is close enough for Chinese; the point is that the
  // ratio is production-shaped, not that it is exact.
  const inputTokens = Math.round(((systemPrompt.length + userPrompt.length) * 0.95) * USAGE_SCALE);
  const outputTokens = Math.round(payload.length * 0.95 * USAGE_SCALE);

  if (!parsed.stream) {
    res.writeHead(200, { 'content-type': 'application/json', ...rateLimitHeaders() });
    return res.end(JSON.stringify({
      id: 'msg_mock', type: 'message', role: 'assistant', model: parsed.model,
      content: [{ type: 'text', text: payload }],
      stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }));
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    ...rateLimitHeaders(),
  });

  await sleep(TTFB_MS);
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_mock', type: 'message', role: 'assistant', model: parsed.model, content: [],
      stop_reason: null, stop_sequence: null,
      // The whole input side arrives here — this is what makes an aborted
      // stream meterable, so the mock must supply it too.
      usage: { input_tokens: inputTokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });

  const CHUNKS = 120;
  const size = Math.ceil(payload.length / CHUNKS);
  const gap = Math.max(0, (STREAM_MS - TTFB_MS) / CHUNKS);
  let aborted = false;
  req.on('close', () => { aborted = true; });

  for (let i = 0; i < CHUNKS; i++) {
    if (aborted || res.writableEnded) return;
    const slice = payload.slice(i * size, (i + 1) * size);
    if (slice) sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: slice } });
    // output_tokens is CUMULATIVE on the real API. Summing deltas would
    // multiply the bill, so a mock that emits increments here would hide that
    // class of bug rather than exercise it.
    if (i % 10 === 9) {
      sse(res, 'message_delta', {
        type: 'message_delta', delta: { stop_reason: null, stop_sequence: null },
        usage: { output_tokens: Math.round((outputTokens * (i + 1)) / CHUNKS) },
      });
    }
    await sleep(gap);
  }

  if (aborted || res.writableEnded) return;
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', {
    type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

const rateLimitHeaders = () => ({
  'anthropic-ratelimit-output-tokens-limit': '2000000',
  'anthropic-ratelimit-output-tokens-remaining': String(RL_REMAINING),
  'anthropic-ratelimit-output-tokens-reset': new Date(Date.now() + 60_000).toISOString(),
  'anthropic-ratelimit-requests-remaining': '9999',
  'request-id': 'req_mock_' + Math.random().toString(36).slice(2, 10),
});

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', streamMs: STREAM_MS, usageScale: USAGE_SCALE, failRate: FAIL_RATE }));
  }
  if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: req.url } }));
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => { handleMessages(req, res, body).catch(() => { try { res.end(); } catch {} }); });
});

// ⚠️ Bind the IPv6 wildcard EXPLICITLY, exactly as docker/Dockerfile.bazi does
// (`--host ::`) and for the same documented reason: Railway's
// `*.railway.internal` DNS resolves to IPv6 ONLY, so an IPv4-only bind is
// unreachable over private networking. Node's bare `.listen(port)` usually
// dual-stacks and would probably have worked — but "probably" is the wrong
// standard when the sibling service carries a comment warning about precisely
// this, and the symptom would be a service that looks healthy while the API
// cannot reach it.
//
// On a dual-stack host (`bindv6only=0`) an IPv6 wildcard also accepts IPv4, so
// this stays reachable on localhost for the local smoke test.
server.listen(PORT, '::', () => {
  const a = server.address();
  console.log(
    `mock-anthropic listening on ${typeof a === 'object' && a ? `${a.address}:${a.port}` : PORT} ` +
      `— streamMs=${STREAM_MS} usageScale=${USAGE_SCALE} failRate=${FAIL_RATE}`,
  );
});

// If the port is taken or the bind fails, say so loudly rather than exiting
// silently — a container that dies without a line in the deploy log is the
// hardest kind to diagnose from a dashboard.
server.on('error', (err) => {
  console.error(`mock-anthropic FAILED to bind :${PORT} — ${err.message}`);
  process.exit(1);
});
