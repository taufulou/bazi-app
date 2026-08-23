/**
 * M1(b) — how many proxy hops Express may believe.
 *
 * ⚠️ NEVER `true`. Express's `trust proxy: true` trusts the ENTIRE
 * `X-Forwarded-For` chain, and that header is client-supplied: a caller sends
 * `X-Forwarded-For: 1.2.3.4` and Express reports `req.ip` as `1.2.3.4`. Since
 * `req.ip` is what the anonymous rate-limit bucket is keyed on, blanket trust
 * means an attacker mints a fresh bucket per request — the limit stops existing
 * for exactly the traffic it is for. A HOP COUNT is safe because Express then
 * counts back from the socket, so only addresses the real edge appended can be
 * selected.
 *
 * The correct number can only be established against the live edge — send a
 * request with a junk XFF and see how many entries Railway's proxy has added.
 * Until that is done the honest value is 0, which is why that is the default:
 * every anonymous caller shares the proxy's address in one bucket. That
 * over-throttles rather than under-throttles, and authenticated callers are
 * keyed on their verified userId, so the coarse bucket only covers anonymous
 * traffic.
 */
export const TRUST_PROXY_ENV = 'TRUST_PROXY_HOPS';

export interface TrustProxyResolution {
  hops: number;
  /** Non-null when the operator supplied something we refused to honour. */
  rejected?: string;
}

export function resolveTrustProxyHops(raw: string | undefined): TrustProxyResolution {
  if (raw === undefined || raw.trim() === '') return { hops: 0 };

  const value = raw.trim();
  // Explicitly refuse the booleans Express would otherwise accept. Someone WILL
  // try `true` — it is the setting every tutorial shows — and it must not work.
  if (!/^\d+$/.test(value)) return { hops: 0, rejected: value };

  const hops = Number(value);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 10) return { hops: 0, rejected: value };
  return { hops };
}
