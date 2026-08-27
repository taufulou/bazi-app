import type { Request, Response, NextFunction } from 'express';

/**
 * M1(b) — a temporary way to see what the edge actually sends.
 *
 * `TRUST_PROXY_HOPS` cannot be guessed. Too high and Express believes a
 * client-supplied `X-Forwarded-For`, so a caller mints a fresh rate-limit
 * bucket per request and the limit stops existing for exactly the anonymous
 * traffic it protects. Too low and every anonymous caller shares one bucket.
 * The default of 0 is the safe end of that trade, not the right answer.
 *
 * `trust-proxy.ts` says the number "can only be established against the live
 * edge — send a request with a junk XFF and see how many entries Railway's
 * proxy has added". Nothing in the app surfaced that, which is why the value
 * has stayed unset. This closes the gap.
 *
 * ## Deliberately awkward to leave on
 *
 * Off unless `LOG_FORWARDED_FOR` is truthy, and it stops after
 * `MAX_PROBE_REQUESTS` even while enabled — a flag someone forgets cannot turn
 * into an unbounded stream of address logs.
 *
 * ## Addresses are masked
 *
 * The measurement needs the SHAPE of the chain (how many entries, and roughly
 * which is yours), not the addresses themselves. IPs are personal data, so
 * each entry is truncated to its network portion: enough to recognise your own
 * request, not enough to be a log of who called.
 */

/** Stop after this many requests even if the flag is left on. */
export const MAX_PROBE_REQUESTS = 5;

export function forwardedForProbeEnabled(): boolean {
  const raw = (process.env.LOG_FORWARDED_FOR ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * `203.0.113.42` -> `203.0.113.x`, `2001:db8::1` -> `2001:db8:x`.
 * Enough to tell "that one is me" apart from "that one is the proxy".
 */
export function maskAddress(value: string): string {
  const addr = value.trim();
  if (addr === '') return '(empty)';
  if (addr.includes(':') && !addr.includes('.')) {
    const groups = addr.split(':').filter(Boolean);
    return groups.length <= 2 ? `${addr}:x` : `${groups.slice(0, 2).join(':')}:x`;
  }
  const octets = addr.split('.');
  return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.x` : `${addr}`;
}

export interface ProbeReading {
  /** Entries in the received header, in order, masked. */
  chain: string[];
  /** How many entries arrived. This is the number the hop count comes from. */
  received: number;
  /** The immediate socket peer — always trustworthy. */
  socket: string;
  /** What Express currently resolves, i.e. what the rate limiter keys on. */
  resolvedIp: string;
}

export function readForwardedFor(req: Request): ProbeReading {
  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  const chain = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    chain: chain.map(maskAddress),
    received: chain.length,
    socket: maskAddress(req.socket?.remoteAddress ?? ''),
    resolvedIp: maskAddress(req.ip ?? ''),
  };
}

/**
 * Express middleware. Install it only when the flag is on; it removes itself
 * from doing any work once the cap is reached.
 */
export function createForwardedForProbe(log: (message: string) => void) {
  let seen = 0;
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (seen < MAX_PROBE_REQUESTS) {
      seen += 1;
      const r = readForwardedFor(req);
      log(
        `LOG_FORWARDED_FOR probe ${seen}/${MAX_PROBE_REQUESTS} — ` +
          `path=${req.path} received=${r.received} chain=[${r.chain.join(' | ')}] ` +
          `socket=${r.socket} express-resolved-ip=${r.resolvedIp}. ` +
          `Set TRUST_PROXY_HOPS to the number of entries the EDGE appended ` +
          `(send a junk X-Forwarded-For and subtract what you sent), then unset ` +
          `LOG_FORWARDED_FOR.`,
      );
      if (seen === MAX_PROBE_REQUESTS) {
        log(`LOG_FORWARDED_FOR probe cap reached — no further probe output.`);
      }
    }
    next();
  };
}
