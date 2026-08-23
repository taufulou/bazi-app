import express from 'express';
import { resolveTrustProxyHops } from '../src/common/trust-proxy';

/**
 * M1(b) acceptance — "spoofed XFF ≠ new bucket", proven against real Express
 * rather than against my reading of its docs.
 *
 * `resolveTrustProxyHops` is unit-tested separately, but that only covers the
 * string parsing. The property that matters is what `req.ip` — the value the
 * anonymous rate-limit bucket is keyed on — actually becomes when a client
 * sends `X-Forwarded-For` under each setting. Nothing tested that end of it.
 */
async function ipSeenBy(trustProxy: number | boolean | undefined, xff: string): Promise<string> {
  const app = express();
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  app.get('/', (req, res) => res.json({ ip: req.ip }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { 'X-Forwarded-For': xff } });
    return ((await res.json()) as { ip: string }).ip;
  } finally {
    server.close();
  }
}

const SPOOF = '1.2.3.4';

describe('M1(b) — what a spoofed X-Forwarded-For can actually do', () => {
  it('at the SHIPPED DEFAULT (env unset → hops 0) a spoofed header is ignored', async () => {
    // main.ts only calls app.set when hops > 0, so this is Express's default.
    expect(resolveTrustProxyHops(undefined).hops).toBe(0);
    const ip = await ipSeenBy(undefined, SPOOF);
    expect(ip).not.toBe(SPOOF);
    expect(ip).toMatch(/127\.0\.0\.1$/);
  });

  it('explicit 0 hops behaves the same', async () => {
    const ip = await ipSeenBy(0, SPOOF);
    expect(ip).not.toBe(SPOOF);
  });

  it('⚠️ at 1 hop the header IS trusted — which is why the count must be verified against the real edge', async () => {
    // Correct ONLY if exactly one real proxy sits in front and clients cannot
    // reach the origin directly. This test documents the hazard rather than
    // asserting the setting is safe.
    expect(await ipSeenBy(1, SPOOF)).toBe(SPOOF);
  });

  it('`true` trusts the whole client-supplied chain — the thing resolveTrustProxyHops refuses', async () => {
    expect(await ipSeenBy(true, SPOOF)).toBe(SPOOF);
    // and the parser will never produce it
    expect(resolveTrustProxyHops('true')).toEqual({ hops: 0, rejected: 'true' });
  });
});
