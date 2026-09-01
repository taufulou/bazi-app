import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { AIService } from '../src/ai/ai.service';
import { AiSpendService } from '../src/ai/ai-spend.service';
import { AI_CALL_LOG_PREFIX, hashUserId } from '../src/ai/ai-call-log';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

/**
 * Ob1 #12 — attribution on the streamed reading path.
 *
 * A streamed reading is the most expensive generation in the app, and its
 * `AI-CALL` lines could be attributed to neither an ACCOUNT nor a CALL: the
 * user id was absent (`userIdHash: null`) and every streamed call rendered as
 * `stream:CLAUDE`, so Call 1 and Call 2 of one reading — and all three calls of
 * a compatibility reveal — were indistinguishable rows.
 *
 * Both halves are one property: the line has to say who the call was for and
 * which call it was, or "why is the bill up today" has no answer on the path
 * that dominates the bill.
 */
describe('streamed calls carry attribution', () => {
  function build() {
    const record = jest.fn();
    const svc = Object.create(AIService.prototype) as AIService;
    Object.assign(svc, {
      aiSpend: { record, recordFailure: jest.fn() },
      streamClaude: async function* () { yield 'chunk'; },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    const drain = async (attribution?: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gen = (svc as any)._streamProviderInner(
        { provider: 'CLAUDE', model: 'claude-sonnet-4-5' },
        'sys', 'user', undefined, { inputTokens: 5, outputTokens: 5 }, attribution,
      ) as AsyncGenerator<string>;
      for await (const chunk of gen) void chunk;
      return record.mock.calls[0]![0];
    };
    return { drain, record };
  }

  it('uses the supplied route instead of the provider name', async () => {
    const { drain } = build();
    const args = await drain({ route: 'stream:LIFETIME:call1', userId: 'user-42' });
    expect(args).toMatchObject({ context: 'stream:LIFETIME:call1', userId: 'user-42' });
    // The old label carried no reading type and no call number.
    expect(args.context).not.toBe('stream:CLAUDE');
  });

  it('falls back to the old label when a site has not been threaded', async () => {
    // Keeps any unthreaded caller emitting a usable line rather than `undefined`.
    const { drain } = build();
    expect(await drain(undefined)).toMatchObject({
      context: 'stream:CLAUDE',
      userId: null,
    });
  });

  // ⚠️ There is deliberately NO test here that builds two attribution objects
  // and asserts they differ. That passes whatever the production call sites do
  // — it only exercises the literals the test itself wrote. The property
  // "Call 1 and Call 2 are distinguishable" is about the SITES, so it is
  // asserted against the source below.
});

/**
 * The id must be HASHED by the time it is a log line. Asserting on the string
 * the logger actually received, not on the argument handed to `record()` —
 * those are different halves and only the second one reaches a log store.
 */
describe('the raw user id never reaches the line', () => {
  const RAW = '3c0c5b50-0b8d-44ca-820b-df10b73d969c';

  function spendService() {
    const lines: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      incrByFloat: jest.fn().mockResolvedValue(1),
    };
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const service = new AiSpendService(redis as never, config as never);
    return { service, lines };
  }

  afterEach(() => jest.restoreAllMocks());

  it('emits the hash, and the raw id appears nowhere', async () => {
    const { service, lines } = spendService();
    await service.record({
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-5',
      usage: { inputTokens: 10, outputTokens: 10 },
      context: 'stream:LIFETIME:call1',
      userId: RAW,
    });
    const line = lines.find((l) => l.includes(AI_CALL_LOG_PREFIX))!;
    expect(line).toBeDefined();
    expect(line).toContain(hashUserId(RAW));
    expect(line).not.toContain(RAW);
    expect(line).not.toContain('3c0c5b50');
  });
});

/**
 * Completeness. The execution tests above prove the mechanism; this proves
 * every SITE uses it. `streamProvider` keeps a fallback so an unthreaded caller
 * still logs something — which is the right runtime behaviour and exactly why
 * a missing one would otherwise be invisible.
 */
describe('every streaming provider call site is attributed', () => {
  const SRC = readFileSync(join(__dirname, '..', 'src/ai/ai.service.ts'), 'utf8');

  /** Every route literal handed to `streamProvider`, in source order. */
  function routeLiterals(): string[] {
    const lines = SRC.split('\n');
    const out: string[] = [];
    lines.forEach((l, i) => {
      if (!l.includes('this.streamProvider(')) return;
      for (const near of lines.slice(i, i + 6)) {
        const m = near.match(/route: [`']([^`']+)[`']/);
        if (m) { out.push(m[1]!); return; }
      }
    });
    return out;
  }

  it('no two call sites share a route — that WAS the bug', () => {
    // Every streamed call used to render as `stream:CLAUDE`, so the two V2
    // calls of a reading and the three of a compat reveal were one
    // indistinguishable row. Collapsing any two back together fails here.
    const routes = routeLiterals();
    expect(routes.length).toBeGreaterThan(1);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('the V2 reading routes VARY by reading type, not a fixed string', () => {
    // The distinctness check above compares template TEXT, so a route
    // hardcoded to one type would still look unique. What matters is that the
    // reading type is interpolated — otherwise every LIFETIME, CAREER, ANNUAL
    // and LOVE stream shares a row again, which is half the original bug.
    // COMPATIBILITY is excluded on purpose: it has exactly one reading type, so
    // its three routes are correctly literal. The multi-type V2 path is not.
    const v2 = routeLiterals().filter(
      (r) => /:call[12]$/.test(r) && !r.startsWith('stream:COMPATIBILITY'),
    );
    expect(v2.length).toBe(2);
    expect(v2.filter((r) => r.includes('${readingType}'))).toEqual(v2);
  });

  it('the compat reveal labels all three of its parallel calls', () => {
    const routes = routeLiterals();
    expect(routes.filter((r) => r.startsWith('stream:COMPATIBILITY:')).sort()).toEqual([
      'stream:COMPATIBILITY:call1',
      'stream:COMPATIBILITY:call2',
      'stream:COMPATIBILITY:call3',
    ]);
  });

  it('each this.streamProvider( call passes a route', () => {
    // Count call sites, then count those with a `route:` within the following
    // few lines — the argument list never spans more than that.
    const lines = SRC.split('\n');
    const sites: number[] = [];
    lines.forEach((l, i) => { if (l.includes('this.streamProvider(')) sites.push(i); });
    expect(sites.length).toBeGreaterThan(0);
    const unattributed = sites.filter(
      (i) => !lines.slice(i, i + 6).some((l) => l.includes('route:')),
    );
    expect(unattributed.map((i) => i + 1)).toEqual([]);
  });

  it('the five public stream entry points all REQUIRE a userId', () => {
    // ⚠️ The COMPILER is the real enforcer here, and it is stronger than this
    // test: weakening `userId` to optional fails tsc (the helper below it takes
    // `string | null`, so `undefined` is rejected), and deleting it fails at
    // both the helper and every call site. Verified by doing both.
    //
    // What this adds is the case tsc cannot see — a NEW entry point declared
    // with `userId?:` and no caller yet. That compiles, ships with attribution
    // silently absent, and is exactly how the original gap arose.
    for (const name of [
      'streamLifetimeV2', 'streamCareerV2', 'streamAnnualV2',
      'streamLoveV2', 'streamCompatibilityRomanceV2',
    ]) {
      const at = SRC.indexOf(`  ${name}(`);
      expect(at).toBeGreaterThan(-1);
      const sig = SRC.slice(at, SRC.indexOf('): Observable<MessageEvent> {', at));
      expect(sig).toContain('userId: string | null');
      expect(sig).not.toContain('userId?:');
    }
  });
});
