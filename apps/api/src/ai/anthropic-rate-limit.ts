/**
 * The standard `fetch` signature, written structurally on purpose.
 *
 * Two tempting alternatives are both worse. Importing `Fetch` from
 * `@anthropic-ai/sdk/internal/builtin-types` reaches a path that is NOT in the
 * package's `exports` map — it resolves today only because TypeScript falls
 * back to walking the filesystem, and stops the moment the SDK tightens its
 * exports or this workspace moves to `moduleResolution: bundler`. Deriving it
 * from the public `ClientOptions` avoids that, but pulls an
 * `@anthropic-ai/sdk` import into a file with no spend controls, which
 * `scripts/check-ai-spend-metering.mjs` correctly flags as an unmetered
 * provider import — a security guard should not have to learn that some
 * imports are type-only.
 *
 * Nothing is lost by writing it out: this is the WHATWG signature, not an
 * Anthropic invention, and `anthropic-client.ts` assigns the result straight
 * into `ClientOptions['fetch']` — so if the SDK's shape ever drifts, that
 * assignment fails to compile. The compatibility check lives where the two
 * types actually meet.
 */
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Ob1 — capture Anthropic's `anthropic-ratelimit-*` response headers.
 *
 * These are the early-warning signal for the failure S1's governor exists to
 * prevent. Without them the first news of rate-limit pressure is a 429 — i.e.
 * a user-visible failure — and the pool sizes stay guesses. With them, "output
 * tokens remaining" is a gauge you can watch approach zero and act on before
 * anything breaks.
 *
 * ## Why this hooks `fetch` and not the 11 call sites
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * 1. The headers describe an ACCOUNT-level rolling budget. Every response
 *    carries the same counters, so reading them is not per-call work — it is
 *    one global gauge that eleven call sites would each have to remember to
 *    thread a `Response` out of. Eleven chances to miss one, and the miss is
 *    silent.
 *
 * 2. **A failed call has headers too, and it is the one you most want.** A hook
 *    placed after a successful parse — which is where every call site's usage
 *    accounting lives — never runs on a 429, a 529 or a timeout. The response
 *    that says "you are out of output tokens, reset at T" is precisely the
 *    response that does not reach `record()`. Hooking the transport is the only
 *    placement that sees it.
 *
 * ## What this is NOT
 *
 * The snapshot is **latest observed across the process**, not "the headers for
 * this specific call". Under concurrency the value a log line reports may come
 * from a sibling request that landed microseconds earlier. That is the correct
 * trade for a gauge — freshest available reading of a shared quantity — but it
 * means the number must never be read as an attribute of one request. Treat it
 * the way you would a CPU gauge sampled at log time.
 *
 * ⚠️ Per-process, like the governor's pools. With N replicas each sees only its
 * own traffic's headers. The VALUE is account-wide, so a reading from any
 * replica is a reading of the same budget — but a replica that has not called
 * Anthropic since it started has NO reading, and reports `null`. That is what
 * an ops request that lands on the idle replica sees (todo #24). The counters
 * below exist so that a `null` explains itself (keep this table, the runbook's
 * and `load-test/ops.mjs`'s `interpret` in sync):
 *
 * | state | meaning |
 * |---|---|
 * | `requestsStarted == 0` | this replica has made no Anthropic call since it started |
 * | `transportErrors > 0`, `responsesSeen == 0` | EVERY call got NO HTTP response (network failure, DNS — e.g. a stale load-test mock URL — or a timeout before headers): check `aiBaseUrlEffective` and `AI-CALL` lines with `outcome:error` |
 * | `transportErrors > 0`, `responsesSeen > 0` | some calls got no response — often routine: the counter is cumulative and also counts client disconnects / shutdown aborts before headers and SDK attempts later retried (`requestsStarted` counts attempts, retries included) |
 * | `observedAt` set, `outputTokensRemaining` set | working; the reading is `now − observedAt` old |
 * | `observedAt` set, `outputTokensRemaining == null` | PARTIAL — some rate-limit headers parse but not the output-token ones (`rlOutRemaining` on `AI-CALL` lines is blind) |
 * | `observedAt == null`, `okWithoutHeaders > 0` | CAPTURE BROKEN — successful responses lack the headers we parse |
 * | `observedAt == null`, `okWithoutHeaders == 0`, `responsesSeen > 0` | only error responses so far (outage, bad key, edge 502) — see `lastResponseStatus` |
 * | `okWithoutHeaders > 0` in ANY state | warning — if `observedAt` is set, the reading may be STALE; compare its age with `lastResponseAt` |
 */

export interface RateLimitSnapshot {
  /** `anthropic-ratelimit-output-tokens-remaining` */
  outputTokensRemaining: number | null;
  /** `anthropic-ratelimit-output-tokens-limit` */
  outputTokensLimit: number | null;
  /** `anthropic-ratelimit-output-tokens-reset` — RFC 3339, verbatim. */
  outputTokensReset: string | null;
  /** `anthropic-ratelimit-requests-remaining` */
  requestsRemaining: number | null;
  /** When we last saw ANY of the above, epoch ms. `null` ⇒ never. */
  observedAt: number | null;
  /** HTTP status of the response the reading came from. */
  observedStatus: number | null;
  /**
   * #24 — requests this process's Anthropic clients STARTED (counted by the
   * transport wrapper before it awaits). With `responsesSeen` and
   * `transportErrors` it separates "idle" from "every call is failing".
   */
  requestsStarted: number;
  /**
   * #24 — requests that ended with NO HTTP response: a network error, DNS
   * failure, TLS failure, or a timeout / abort before headers arrived. Those
   * never reach `absorbRateLimitHeaders`, so without this a replica whose every
   * call fails at the network level would look exactly like an idle one.
   */
  transportErrors: number;
  /** #24 — every response this process's Anthropic clients received. */
  responsesSeen: number;
  /**
   * #24 — 2xx responses carrying NONE of the headers above. Non-zero means
   * capture is (or was) broken for successful calls. Error responses without
   * headers (a proxy page, an edge 502) are expected and do NOT count here.
   */
  okWithoutHeaders: number;
  /** #24 — when ANY response last arrived (epoch ms), headers or not. */
  lastResponseAt: number | null;
  /** #24 — the status of that last response. */
  lastResponseStatus: number | null;
}

/** The header-derived part, replaced wholesale on each observation. */
type HeaderReading = Omit<
  RateLimitSnapshot,
  | 'requestsStarted'
  | 'transportErrors'
  | 'responsesSeen'
  | 'okWithoutHeaders'
  | 'lastResponseAt'
  | 'lastResponseStatus'
>;

const EMPTY: HeaderReading = {
  outputTokensRemaining: null,
  outputTokensLimit: null,
  outputTokensReset: null,
  requestsRemaining: null,
  observedAt: null,
  observedStatus: null,
};

let latest: HeaderReading = { ...EMPTY };

// #24 — kept OUTSIDE `latest`, which is replaced wholesale on each observation.
let requestsStarted = 0;
let transportErrors = 0;
let responsesSeen = 0;
let okWithoutHeaders = 0;
let lastResponseAt: number | null = null;
let lastResponseStatus: number | null = null;

/** A header may be absent, empty, or non-numeric. All three mean "unknown". */
function intHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fold one response's headers into the process-wide snapshot.
 *
 * Exported for tests and for any transport that is not the SDK's `fetch`.
 * Never throws — see {@link observeRateLimits}.
 */
export function absorbRateLimitHeaders(headers: Headers, status: number): void {
  // #24 — counted BEFORE the no-headers early return below, so a response
  // without headers is still visible as "a response arrived".
  responsesSeen += 1;
  lastResponseAt = Date.now();
  lastResponseStatus = status;

  const outRemaining = intHeader(headers, 'anthropic-ratelimit-output-tokens-remaining');
  const outLimit = intHeader(headers, 'anthropic-ratelimit-output-tokens-limit');
  const outReset = headers.get('anthropic-ratelimit-output-tokens-reset');
  const reqRemaining = intHeader(headers, 'anthropic-ratelimit-requests-remaining');

  // A response with none of these is not an observation — a proxy error page or
  // a network-level failure would otherwise blank a perfectly good reading.
  if (outRemaining === null && outLimit === null && outReset === null && reqRemaining === null) {
    // Only a SUCCESSFUL response without the headers says capture is broken;
    // an error page or edge 502 without them is expected.
    if (status >= 200 && status < 300) okWithoutHeaders += 1;
    return;
  }

  latest = {
    outputTokensRemaining: outRemaining,
    outputTokensLimit: outLimit,
    outputTokensReset: outReset,
    requestsRemaining: reqRemaining,
    observedAt: Date.now(),
    observedStatus: status,
  };
}

/** Latest observed reading. Always a fresh object — callers may not mutate ours. */
export function getRateLimitSnapshot(): RateLimitSnapshot {
  return {
    ...latest,
    requestsStarted,
    transportErrors,
    responsesSeen,
    okWithoutHeaders,
    lastResponseAt,
    lastResponseStatus,
  };
}

/** Tests only. */
export function resetRateLimitSnapshot(): void {
  latest = { ...EMPTY };
  requestsStarted = 0;
  transportErrors = 0;
  responsesSeen = 0;
  okWithoutHeaders = 0;
  lastResponseAt = null;
  lastResponseStatus = null;
}

/**
 * Wrap a `fetch` so every Anthropic response updates the snapshot.
 *
 * ⚠️ This sits on the hot path of every AI call in the application, so its one
 * hard requirement is that it cannot change behaviour. The observation is
 * wrapped and the original response is returned untouched — the body is never
 * read, cloned or buffered (which would break streaming), and an error in the
 * observer degrades to nothing at all rather than failing a call the user has
 * already paid for.
 *
 * Pass no argument to wrap the global `fetch`, which is what the SDK would have
 * used anyway.
 */
export function observeRateLimits(inner?: Fetch): Fetch {
  const base: Fetch = inner ?? ((input, init) => fetch(input, init));
  return async (input, init) => {
    // #24 — plain integer increments: they cannot throw, so they cannot change
    // the call's behaviour. The rejection is rethrown UNCHANGED.
    requestsStarted += 1;
    let response: Response;
    try {
      response = await base(input, init);
    } catch (err) {
      transportErrors += 1;
      throw err;
    }
    try {
      absorbRateLimitHeaders(response.headers, response.status);
    } catch {
      // Deliberately silent. A logger here would fire on every call in the
      // pathological case, and the thing being protected is a metric.
    }
    return response;
  };
}
