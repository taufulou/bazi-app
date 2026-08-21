import { execFileSync } from 'child_process';
import { join } from 'path';

/**
 * The B3-b gate must FAIL for the right reasons. A pre-flight check that says
 * "go" on thin evidence is worse than no check — the whole point is that
 * flipping ENGINE_REQUIRE_KEY on an un-keyed caller is an outage.
 */
const SCRIPT = join(__dirname, '..', '..', '..', 'scripts', 'b3b-preflight.mjs');

function run(log: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT], { input: log, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const ALL_KEYED = {
  mode: 'enforce',
  window_s: 60,
  totals: { keyed: 12 },
  by_path: {
    keyed: {
      '/calculate<-bazi.reading': 2,
      '/explain-element<-bazi.passthrough': 1,
      '/compatibility<-bazi.compatibility': 1,
      '/daily-fortune<-fortune.daily': 1,
      '/monthly-fortune<-fortune.monthly': 1,
      '/yearly-fortune<-fortune.yearly': 1,
      '/build-chat-context<-chat.context': 1,
      '/build-chat-context-compat<-chat.context-compat': 1,
      '/build-chat-context-fortune<-chat.context-fortune': 1,
    },
  },
  rejected_key_fingerprints: {},
};
const line = (o: unknown) => `2026-08-21 INFO bazi_engine.auth ENGINE-AUTH-ROLLUP ${JSON.stringify(o)}`;

describe('B3-b pre-flight gate', () => {
  it('passes when every endpoint was keyed by a recognised caller', () => {
    const r = run(line(ALL_KEYED));
    expect(r.code).toBe(0);
    expect(r.out).toContain('Conditions 1-3 met');
  });

  it('REFUSES an empty log — no traffic is not the same as no problems', () => {
    // The failure mode this catches: reading the wrong service, or a window in
    // which nothing happened, and calling the silence a pass.
    const r = run('some unrelated log output\n');
    expect(r.code).toBe(1);
    expect(r.out).toContain('empty window is NOT a pass');
  });

  it('REFUSES when an endpoint was only keyed by "unknown"', () => {
    // Somebody curled it with the key. That proves a human held the secret, not
    // that the API call site sends it — which is the thing being gated.
    const only = JSON.parse(JSON.stringify(ALL_KEYED));
    only.by_path.keyed['/compatibility<-unknown'] = 1;
    delete only.by_path.keyed['/compatibility<-bazi.compatibility'];

    const r = run(line(only));
    expect(r.code).toBe(1);
    expect(r.out).toContain('/compatibility');
    expect(r.out).toContain('saw unknown');
  });

  it('REFUSES when any unkeyed traffic appeared', () => {
    const withAbsent = JSON.parse(JSON.stringify(ALL_KEYED));
    withAbsent.totals.absent = 1;
    withAbsent.by_path.absent = { '/calculate<-unknown': 1 };

    const r = run(line(withAbsent));
    expect(r.code).toBe(1);
    expect(r.out).toContain('absent=1');
  });

  it('REFUSES when the counter itself was failing', () => {
    // A broken counter reads "zero unkeyed" while passing everything through —
    // the same reads-zero-while-non-zero hazard the rollup exists to avoid.
    const r = run(`${line(ALL_KEYED)}\nERROR engine-auth bookkeeping failed; request unaffected\n`);
    expect(r.code).toBe(1);
    expect(r.out).toContain('bookkeeping failure');
  });

  it('flags a window where no keys were configured at all', () => {
    const unconfigured = JSON.parse(JSON.stringify(ALL_KEYED));
    unconfigured.totals.unconfigured = 5;
    unconfigured.warning = 'ENGINE_KEYS/ENGINE_KEY is unset — this window proves nothing';

    const r = run(line(unconfigured));
    expect(r.code).toBe(1);
    expect(r.out).toContain('proves NOTHING');
  });

  it('never claims condition 4 is satisfied — it is not machine-checkable', () => {
    const r = run(line(ALL_KEYED));
    expect(r.out).toContain('NOT machine-checkable');
    expect(r.out).toContain('judge it yourself');
  });
});
