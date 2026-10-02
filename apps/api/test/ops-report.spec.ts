import { execFileSync } from 'child_process';
import { join } from 'path';
import { pathToFileURL } from 'url';

/**
 * PR #74 review — `load-test/ops.mjs` is the arm-time AND teardown-time safety
 * check for the load-test mock, and had no tests. Every decision and every line
 * it prints now comes from `load-test/ops-report.mjs`, tested here.
 *
 * ts-jest compiles to CommonJS, where `import()` of an ES module becomes a
 * `require` and fails — so, like `ci-docker-install-parity.guard.spec.ts`, this
 * runs the module in a child `node` and reads JSON back.
 */

const MODULE_URL = pathToFileURL(join(__dirname, '..', '..', '..', 'load-test', 'ops-report.mjs')).href;

/* eslint-disable @typescript-eslint/no-explicit-any */
function call(fn: string, ...args: unknown[]): any {
  const script =
    `import * as m from ${JSON.stringify(MODULE_URL)};` +
    'const [fn, args] = JSON.parse(process.argv[1]);' +
    'const r = m[fn](...args);' +
    'process.stdout.write(JSON.stringify(r instanceof Map ? [...r] : r));';
  return JSON.parse(execFileSync('node', ['--input-type=module', '-e', script, JSON.stringify([fn, args])], { encoding: 'utf8' }));
}

// Every timestamp is absolute and relative to `generatedAt`, so `ageOn()` never
// falls back to Date.now() and nothing here can drift or flake.
const GENERATED_AT = '2026-10-02T10:00:00.000Z';
const TEN_S_BEFORE = Date.parse('2026-10-02T09:59:50.000Z');
const REAL = 'https://api.anthropic.com';
const MOCK = 'http://mock-anthropic.railway.internal:8080';

const idle = {
  outputTokensRemaining: null, outputTokensReset: null, observedAt: null, requestsStarted: 0,
  transportErrors: 0, responsesSeen: 0, okWithoutHeaders: 0, lastResponseAt: null, lastResponseStatus: null,
};

function sample(replicaId: string | null, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generatedAt: GENERATED_AT,
    replicas: 2,
    spend: { dayUsd: 1, dayLimitUsd: 50, dayPct: 2 },
    breaker: { trippedOn: null },
    ...(replicaId
      ? { instance: { replicaId, replicaIdSource: 'railway', deploymentId: 'dep-1', commitSha: 'abc', startedAt: GENERATED_AT } }
      : {}),
    aiBaseUrlEffective: REAL,
    aiBaseUrlOverride: null,
    rateLimit: idle,
    ...over,
  };
}
const withInstance = (s: Record<string, any>, patch: Record<string, unknown>): Record<string, any> => ({ ...s, instance: { ...s.instance, ...patch } });
const withDeployment = (s: Record<string, any>, deploymentId: string) => withInstance(s, { deploymentId });
const rl = (over: Record<string, unknown>) => ({ rateLimit: { ...idle, ...over } });

describe('ops-report — the load-test arm/teardown verdict', () => {
  describe('each arming signal ALONE arms a replica (the two dangerous directions)', () => {
    it('override set, no client built yet (effective null) → armed', () => {
      const v = call('verdict', [sample('a', { replicas: 1, aiBaseUrlEffective: null, aiBaseUrlOverride: MOCK })]);
      expect(v.kind).toBe('armed');
    });
    it('override null, effective redirected by a bare ANTHROPIC_BASE_URL → armed', () => {
      const v = call('verdict', [sample('a', { replicas: 1, aiBaseUrlEffective: MOCK, aiBaseUrlOverride: null })]);
      expect(v.kind).toBe('armed');
    });
  });

  describe('ARM time — only a fully armed fleet passes', () => {
    it('both replicas reached and armed, one deployment → armed, with the EXACT orange headline', () => {
      // The worst regression this tool could have is an armed fleet printing the
      // green all-clear at teardown — so the line itself is pinned, not just the kind.
      const armed = { aiBaseUrlEffective: MOCK, aiBaseUrlOverride: MOCK };
      const s = [sample('a', armed), sample('b', armed)];
      expect(call('verdict', s).kind).toBe('armed');
      expect(call('render', s)[1]).toBe('  🟠 ARMED on all 2 replica(s) reached — AI traffic is going to the MOCK, not to Anthropic.');
    });
    it('armed through the override with no client built → ARMED, and no "rests on the override" caveat', () => {
      const lines = call('render', [sample('a', { replicas: 1, aiBaseUrlEffective: null, aiBaseUrlOverride: MOCK })]);
      expect(lines[1]).toBe('  🟠 ARMED on all 1 replica(s) reached — AI traffic is going to the MOCK, not to Anthropic.');
      expect(lines.join('\n')).not.toContain('rests on the override');
    });
    it('both reached and armed, but an unattributed sample was NOT armed → partially_armed', () => {
      const armed = { aiBaseUrlEffective: MOCK };
      const s = [sample('a', armed), sample('b', armed), sample(null)];
      expect(call('verdict', s).kind).toBe('partially_armed');
      expect(call('render', s)[1]).toContain('1 unattributed sample(s) were NOT armed');
    });
    it('both reached, ONE armed → partially_armed, "1 of the 2"', () => {
      const s = [sample('a', { aiBaseUrlEffective: MOCK }), sample('b')];
      expect(call('verdict', s).kind).toBe('partially_armed');
      expect(call('render', s)[1]).toContain('PARTIALLY ARMED — 1 of the 2 replica(s) reached');
    });
    it('one reached and armed, the other never answered → partially_armed', () => {
      const s = [sample('a', { aiBaseUrlEffective: MOCK })];
      expect(call('verdict', s).kind).toBe('partially_armed');
      expect(call('render', s)[1]).toContain('1 of 2 never answered');
    });
    it('both armed but two deployments answered (mid-deploy) → partially_armed', () => {
      const armed = { aiBaseUrlEffective: MOCK };
      const s = [sample('a', armed), withDeployment(sample('b', armed), 'dep-2')];
      expect(call('verdict', s).kind).toBe('partially_armed');
      expect(call('render', s)[1]).toContain('a deploy is in progress');
    });
    it('no replica identified itself, one unattributed sample armed → partially_armed, worded plainly', () => {
      const s = [sample(null, { aiBaseUrlEffective: MOCK }), sample(null)];
      const head = call('render', s).find((l: string) => l.includes('ARMED'));
      expect(call('verdict', s).kind).toBe('partially_armed');
      expect(head).toContain('no replica identified itself (expected 2), but 1 unattributed sample(s) point at the MOCK');
      expect(head).not.toContain('0 of the 0');
    });
    it('the only armed sample is unattributed (old code) → partially_armed, never "0 of 2"', () => {
      const s = [sample('a', { replicas: 2 }), sample(null, { aiBaseUrlEffective: MOCK })];
      const head = call('render', s).find((l: string) => l.includes('ARMED'));
      expect(call('verdict', s).kind).toBe('partially_armed');
      expect(head).toContain('0 of the 1 replica(s) reached');
      expect(head).toContain('and 1 unattributed sample(s) did');
      expect(head).not.toContain('of 2 replica');
    });
  });

  describe('TEARDOWN — only a clean, complete NOT ARMED passes', () => {
    it('both reached, none armed → not_armed (green)', () => {
      const s = [sample('a'), sample('b')];
      expect(call('verdict', s).kind).toBe('not_armed');
      expect(call('render', s)[1]).toBe('  🟢 NOT ARMED — AI traffic is going to the real Anthropic API.');
    });
    it('one of two reached → inconclusive (yellow), "1 of 2"', () => {
      const s = [sample('a')];
      expect(call('verdict', s).kind).toBe('inconclusive');
      expect(call('render', s)[1]).toContain('🟡 INCONCLUSIVE — not armed on the 1 replica(s) reached, but 1 of 2 never answered');
    });
    it('only old-code samples (no identity) → inconclusive', () => {
      expect(call('verdict', [sample(null), sample(null)]).kind).toBe('inconclusive');
    });
    it('two reached but from two deployments → inconclusive, mentioning the deploy', () => {
      const s = [sample('a'), withDeployment(sample('b'), 'dep-2')];
      expect(call('verdict', s).kind).toBe('inconclusive');
      expect(call('render', s)[1]).toContain('a deploy is in progress (2 deployments answered)');
    });
    it('no override and no client built anywhere → uncertain, with the EXACT yellow headline', () => {
      const s = [sample('a', { replicas: 1, aiBaseUrlEffective: null })];
      expect(call('verdict', s).kind).toBe('uncertain');
      expect(call('render', s)[1]).toBe(
        '  🟡 NOT CONFIRMED — no override set, but 1 of the 1 replica(s) reached had not built an Anthropic client to ' +
          'confirm against. Make AI calls until each has served one (the load balancer decides which replica does), then run again.',
      );
    });
    it('green needs EVERY replica confirmed: one replica on Anthropic, one with no client yet → NOT green', () => {
      const s = [sample('a'), sample('b', { aiBaseUrlEffective: null })];
      expect(call('verdict', s).kind).toBe('uncertain');
      const lines = call('render', s);
      expect(lines[1]).toContain('🟡 NOT CONFIRMED');
      expect(lines.join('\n')).toContain('1 replica(s) reached had not built an Anthropic client, so for them');
    });
    it('uncertainty from an unattributed sample only: the caveat blames the sample, not "0 replica(s)"', () => {
      const s = [sample('a'), sample('b'), sample(null, { aiBaseUrlEffective: null })];
      const lines = call('render', s);
      expect(lines[1]).toContain('1 unattributed sample(s) reported none');
      const caveat = lines.find((l: string) => l.startsWith('  ⚠️  ') && l.includes('rests on the override'));
      expect(caveat).toBe('  ⚠️  1 unattributed sample(s) reported none, so for them "not armed" rests on the override');
    });
    it('a null deploymentId on one sample is not counted as a second deployment', () => {
      expect(call('verdict', [sample('a'), withInstance(sample('b'), { deploymentId: null })]).kind).toBe('not_armed');
    });
    it('no replica identified itself → inconclusive, worded plainly, and told to use --samples 20', () => {
      const head = call('render', [sample(null), sample(null)])[1];
      expect(head).toContain('🟡 INCONCLUSIVE — not armed as far as it can tell, but no replica identified itself (expected 2)');
      expect(head).toContain('--samples 20');
    });
    it('a normal partial run says "wait 60s and run again" — not --samples, which auto-sampling already does', () => {
      const lines = call('render', [sample('a')]);
      expect(lines[1]).toContain('wait 60s (30/min throttle) and run again');
      expect(lines.join('\n')).not.toContain('--samples');
    });
    it('when the FIRST sample had no identity, the bottom block says to add --samples 20', () => {
      const lines = call('render', [sample(null), sample('a')]);
      expect(lines.join('\n')).toContain('stops auto-sampling — add --samples 20');
    });
    it('the "no client built" caveat is STILL printed when INCONCLUSIVE takes the headline', () => {
      const lines = call('render', [sample('a', { aiBaseUrlEffective: null })]);
      expect(lines[1]).toContain('INCONCLUSIVE');
      expect(lines.join('\n')).toContain('No replica reached had built an Anthropic client');
    });
  });

  describe('interpret — in flight is not failure (#24 counters)', () => {
    const first = (over: Record<string, unknown>) => call('interpret', sample('a', rl(over)));
    it('no call since start', () => {
      expect(first({ requestsStarted: 0 })[0]).toContain('no Anthropic call');
    });
    it('2 started, nothing back, no errors → in flight', () => {
      expect(first({ requestsStarted: 2 })[0]).toBe('2 call(s) in flight, nothing back yet — run again in a few seconds');
    });
    it('3 started, 1 transport error, 2 still in flight → in flight + a warning, NOT 🔴', () => {
      const notes = first({ requestsStarted: 3, transportErrors: 1 });
      expect(notes[0]).toContain('2 call(s) in flight');
      expect(notes[1]).toContain('1 call(s) already got no HTTP response');
      expect(notes.join(' ')).not.toContain('🔴');
    });
    it('101 started, 100 transport errors, 1 still in flight → 🔴 leads (failures outnumber calls waiting)', () => {
      expect(first({ requestsStarted: 101, transportErrors: 100 })[0])
        .toContain('🔴 100 call(s) got NO HTTP response and none has answered (1 still in flight)');
    });
    it('2 started, 2 transport errors, nothing in flight → 🔴 every call failed', () => {
      expect(first({ requestsStarted: 2, transportErrors: 2 })[0]).toContain('🔴 every call (2) got NO HTTP response');
    });
    it('responses but no headers and no 2xx → only error responses', () => {
      expect(first({ requestsStarted: 2, responsesSeen: 2, lastResponseStatus: 529 })[0])
        .toBe('only error responses so far (last status 529) — not a capture bug');
    });
    it('a reading → working, aged on the server clock', () => {
      expect(first({ requestsStarted: 1, responsesSeen: 1, observedAt: TEN_S_BEFORE, outputTokensRemaining: 5 })[0])
        .toBe('working — reading taken 10s ago');
    });
  });

  describe('needMoreSamples — adaptive by default, exact with --samples', () => {
    const two = (n: number) => Array.from({ length: n }, (_, i) => sample(i % 2 ? 'b' : 'a'));
    it('auto: keeps going at 1 of 2 replicas', () => {
      expect(call('needMoreSamples', [sample('a')], {})).toBe(true);
    });
    it('auto: stops once both replicas have answered', () => {
      expect(call('needMoreSamples', two(2), {})).toBe(false);
    });
    it('auto: still going at 19 samples from one replica', () => {
      expect(call('needMoreSamples', Array.from({ length: 19 }, () => sample('a')), {})).toBe(true);
    });
    it('explicit --samples 25 is capped at 20', () => {
      expect(call('needMoreSamples', two(19), { explicit: 25 })).toBe(true);
      expect(call('needMoreSamples', two(20), { explicit: 25 })).toBe(false);
    });
    it('auto: stops at 20 even if a replica never answered', () => {
      expect(call('needMoreSamples', Array.from({ length: 20 }, () => sample('a')), {})).toBe(false);
    });
    it('auto: stops at once when the first sample has no identity (an API older than #24)', () => {
      expect(call('needMoreSamples', [sample(null)], {})).toBe(false);
    });
    it('explicit 5: continues even though both replicas have answered', () => {
      expect(call('needMoreSamples', two(2), { explicit: 5 })).toBe(true);
      expect(call('needMoreSamples', two(5), { explicit: 5 })).toBe(false);
    });
  });

  describe('the move out of ops.mjs changed nothing it did not mean to', () => {
    // Golden output captured from the PRE-change ops.mjs for the same samples
    // (2026-10-02). A complete, healthy fleet: identical, headline included.
    it('a complete, healthy 2-replica fleet renders exactly as before', () => {
      const a = withInstance(sample('a', {
        pools: { reading: { inFlight: 0, limit: 12, peak: 3 }, interactive: { inFlight: 1, limit: 20 } },
        ...rl({ outputTokensRemaining: 2000000, outputTokensReset: '2026-10-02T10:00:05Z', observedAt: TEN_S_BEFORE,
          requestsStarted: 4, responsesSeen: 4, lastResponseAt: TEN_S_BEFORE, lastResponseStatus: 200 }),
        spend: { dayUsd: 1.23, dayLimitUsd: 50, dayPct: 2.5 },
      }), { commitSha: 'abc123', startedAt: '2026-10-02T09:00:00.000Z' });
      const b = withInstance(sample('b', {
        generatedAt: '2026-10-02T10:00:00.250Z',
        pools: { reading: { inFlight: 0, limit: 12, peak: 0 }, interactive: { inFlight: 0, limit: 20 } },
      }), { commitSha: 'abc123', startedAt: '2026-10-02T09:01:00.000Z' });
      expect(call('render', [a, b])).toEqual([
        '',
        '  🟢 NOT ARMED — AI traffic is going to the real Anthropic API.',
        '',
        '  replicas           : 2',
        '  spend today        : $1.23 / $50 (2.5%)',
        '  breaker            : healthy',
        '',
        '  replicas reached   : 2 of 2 identified (in 2 samples)',
        '',
        '  ▸ replica a  [railway]  ×1',
        '      started        : 2026-10-02T09:00:00.000Z',
        '      commit         : abc123',
        '      AI base URL    : https://api.anthropic.com',
        '      pools.reading  : inFlight=0 limit=12 peak=3   interactive: inFlight=1 limit=20',
        '      rate limit     : 2000000 output tokens left (resets 2026-10-02T10:00:05Z)',
        '      counters       : started 4   noResponse 0   responses 4   okWithoutHeaders 0',
        '      last response  : 10s ago (status 200)   reading taken: 10s ago',
        '      → working — reading taken 10s ago',
        '',
        '  ▸ replica b  [railway]  ×1',
        '      started        : 2026-10-02T09:01:00.000Z',
        '      commit         : abc123',
        '      AI base URL    : https://api.anthropic.com',
        '      pools.reading  : inFlight=0 limit=12 peak=0   interactive: inFlight=0 limit=20',
        '      rate limit     : null output tokens left',
        '      counters       : started 0   noResponse 0   responses 0   okWithoutHeaders 0',
        '      last response  : — (status —)   reading taken: —',
        '      → no Anthropic call on this replica since it started — null is expected, NOT a bug',
        '',
      ]);
    });

    it('a partial fleet with an old-code sample: every block as before except the headline, the re-run advice and the caveat wording', () => {
      const a = withInstance(
        sample('a', { aiBaseUrlEffective: null, spend: { dayUsd: null, dayLimitUsd: 50, dayPct: null }, breaker: { trippedOn: '2026-10-02' } }),
        { replicaIdSource: 'hostname', deploymentId: null, commitSha: null, startedAt: '2026-10-02T09:00:00.000Z' },
      );
      const old = { generatedAt: GENERATED_AT, replicas: 2, spend: a.spend, breaker: a.breaker, rateLimit: { outputTokensRemaining: null } };
      const lines = call('render', [a, old]);
      const before = [
        '',
        '  ⚠️  THE DEPLOYED API IS OLDER THAN THIS SCRIPT (on at least one replica).',
        '     /api/admin/ops did not return aiBaseUrlEffective or aiBaseUrlOverride.',
        '     That field ships with the load-test switch, so the running code',
        '     probably predates the rename and reads ANTHROPIC_BASE_URL instead.',
        '     Setting LOADTEST_ANTHROPIC_BASE_URL against it does nothing at all.',
        '     Deploy the current branch before trusting anything below.',
        '',
        '  🟢 NOT ARMED — no override set, and no replica reached had built a client to confirm against.',
        '',
        '  replicas           : 2',
        '  spend today        : $? / $50 (?%)',
        '  breaker            : 2026-10-02',
        '',
        '  replicas reached   : 1 of 2 identified (in 2 samples)',
        '',
        '  ▸ replica a  [hostname]  ×1',
        '      started        : 2026-10-02T09:00:00.000Z',
        '      commit         : (unknown — CLI deploy, or not on Railway)',
        '      AI base URL    : (no client built yet on this replica)',
        '      rate limit     : null output tokens left',
        '      counters       : started 0   noResponse 0   responses 0   okWithoutHeaders 0',
        '      last response  : — (status —)   reading taken: —',
        '      → no Anthropic call on this replica since it started — null is expected, NOT a bug',
        '',
        '  ⚠️  1 sample(s) came from a replica running code OLDER than this script',
        '     (no `instance`), so they cannot be attributed to a replica. What they reported:',
        '       AI base URL (no client yet) · rate limit null · unknown — this replica runs code older than the #24 counters, so a null cannot be explained',
        '',
        '  ⚠️  INCONCLUSIVE about 1 of 2 replica(s):',
        '     they never answered with an identity. The load balancer decides routing, so this',
        // Intended change (line audit): auto-sampling is now the default, so a
        // plain re-run reaches as many replicas as `--samples` would.
        '     script cannot force a replica — wait 60s (30/min throttle) and run again.',
        '',
        // Intended change (re-audit): the caveat now names every source of doubt,
        // like the headline, and the advice is per replica.
        '  ⚠️  No replica reached had built an Anthropic client, and 1 unattributed sample(s) reported none, so for them "not armed" rests on the override',
        '     alone. Run this again once each has served an AI call, to confirm against a built client.',
        '',
      ];
      const HEADLINE = 8;
      expect(lines.length).toBe(before.length);
      expect(lines.filter((_: string, i: number) => i !== HEADLINE)).toEqual(before.filter((_, i) => i !== HEADLINE));
      expect(lines[HEADLINE]).toContain('🟡 INCONCLUSIVE');
    });
  });
});
