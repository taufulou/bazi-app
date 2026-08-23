import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { isAuthorizedPartiesFailure, parseAuthorizedParties } from './authorized-parties';

/** What a verified token puts on the request. Nothing else may write this. */
export interface RequestAuth {
  userId: string;
  sessionId?: string;
}

export interface AuthAttachable {
  headers: Record<string, unknown>;
  auth?: RequestAuth;
  /** Set once `attach` has run, so a second call is a no-op. */
  authResolved?: boolean;
  /** Why verification failed, for the protected path's 401 message. */
  authFailure?: string;
  /** Was that failure specifically the azp allowlist? The caller decides how to report it. */
  authFailureWasAzp?: boolean;
}

/**
 * The ONE place a bearer token is turned into an identity.
 *
 * M1 needed this. The rate limiter has to key per user, and the plan is explicit
 * that the userId must come from a signature-VERIFIED token — a decoded-but-
 * unverified `sub` would let anyone mint unlimited buckets by editing a JWT.
 * But `ThrottlerGuard` runs BEFORE `ClerkAuthGuard` (empirically confirmed in
 * `guard-order.spec.ts`: a root-module APP_GUARD beats an imported module's),
 * so at tracker time `request.auth` is not populated yet.
 *
 * Two ways out. Reordering the guards was rejected: putting Clerk first means a
 * protected route 401s BEFORE the throttler runs, so unauthenticated floods
 * would stop being rate-limited at all — trading one control for another. The
 * other is this: make attachment idempotent and let whichever guard runs first
 * do the work. Order then stops mattering, which also means the fix does not
 * rest on a framework ordering rule that took an experiment to discover and
 * could change under us.
 *
 * ⚠️ NEVER throws. It runs on public routes, where throwing would make them
 * private, and in the rate limiter, where throwing would 500 every request.
 * "Could not verify" and "no token" are the same outcome: anonymous.
 */
@Injectable()
export class AuthIdentityService {
  private readonly logger = new Logger(AuthIdentityService.name);
  private readonly secretKey: string;
  /** B5 — `azp` allowlist. Empty = the claim is not checked. */
  private readonly authorizedParties: string[];

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('CLERK_SECRET_KEY') || '';
    this.authorizedParties = parseAuthorizedParties(
      this.configService.get<string>('CLERK_AUTHORIZED_PARTIES'),
      (original, normalised) =>
        this.logger.warn(
          `CLERK_AUTHORIZED_PARTIES entry "${original}" was normalised to ` +
            `"${normalised}" — Clerk matches the azp claim EXACTLY, so the ` +
            `original would have matched nothing. Fix the env var.`,
        ),
    );

    if (this.authorizedParties.length === 0) {
      // Loud, because the failure mode is silence: everything keeps working and
      // the control simply isn't there. Must be set before launch.
      this.logger.warn(
        'CLERK_AUTHORIZED_PARTIES is not set — the JWT `azp` claim will NOT be ' +
          'checked, so a token minted for a different frontend origin on this ' +
          'Clerk instance would be accepted. Set it to the web origin(s).',
      );
    } else {
      this.logger.log(`Clerk azp allowlist: ${this.authorizedParties.join(', ')}`);
    }
  }

  /**
   * Recently-verified tokens, for the RATE LIMITER only.
   *
   * ⚠️ Read `peekVerifiedUserId` before touching this: it exists because
   * verifying in the throttler's tracker was a denial-of-service hole, and it
   * is safe ONLY because bucketing is not an authorization decision.
   *
   * Keyed by a hash of the token, never the token itself — this map would
   * otherwise be a pile of live bearer credentials sitting in memory for any
   * heap dump or debugger to read.
   */
  private readonly recentlyVerified = new Map<string, { userId: string; expiresAt: number }>();
  private static readonly PEEK_TTL_MS = 60_000;
  private static readonly PEEK_MAX_ENTRIES = 10_000;

  /**
   * The userId for this request's token IF we verified it very recently.
   * Never verifies, never touches the network, never throws.
   *
   * ⚠️ WHY THIS EXISTS. The throttler's tracker used to call `attach`, which
   * awaits Clerk's `verifyToken`. For a token whose `kid` we have never seen —
   * i.e. any forged one — Clerk's JWKS cache misses by construction and it
   * issues a fresh HTTP request to Clerk, with no timeout anywhere in the
   * chain. So `Authorization: Bearer <garbage>` forced an unbounded outbound
   * call BEFORE the rate limiter had decided anything, which inverts the whole
   * point of having a rate limiter: the cheap gate must come first.
   *
   * A cache read restores that ordering. The cost is that the FIRST request of
   * a session buckets by IP rather than by user; from the second on it keys per
   * user. That is an acceptable trade for bucketing, and it is emphatically NOT
   * acceptable for authorization — which is why `ClerkAuthGuard` still calls
   * `attach` and verifies properly on every single request. A stale entry here
   * can only put someone in the wrong rate-limit bucket for up to a minute; it
   * can never grant access.
   */
  peekVerifiedUserId(request: AuthAttachable): string | undefined {
    const token = this.bearerToken(request);
    if (!token) return undefined;

    const hit = this.recentlyVerified.get(hashToken(token));
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) return undefined; // swept lazily below
    return hit.userId;
  }

  private remember(token: string, userId: string): void {
    // Cheap bound: the map is only ever a throttling optimisation, so dropping
    // the oldest entries under pressure costs a coarser bucket, nothing more.
    if (this.recentlyVerified.size >= AuthIdentityService.PEEK_MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of this.recentlyVerified) {
        if (v.expiresAt <= now) this.recentlyVerified.delete(k);
      }
      if (this.recentlyVerified.size >= AuthIdentityService.PEEK_MAX_ENTRIES) {
        // Still full of live entries — evict in insertion order.
        const oldest = this.recentlyVerified.keys().next();
        if (!oldest.done) this.recentlyVerified.delete(oldest.value);
      }
    }
    this.recentlyVerified.set(hashToken(token), {
      userId,
      expiresAt: Date.now() + AuthIdentityService.PEEK_TTL_MS,
    });
  }

  private bearerToken(request: AuthAttachable): string | undefined {
    const header = request.headers.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) return undefined;
    return header.split(' ')[1] || undefined;
  }

  /**
   * Verify-if-present, at most once per request.
   *
   * Idempotent via `authResolved` rather than by checking `auth` — an anonymous
   * request leaves `auth` undefined, and without the separate flag every later
   * caller would retry the verification it already knows fails.
   */
  async attach(request: AuthAttachable): Promise<void> {
    if (request.authResolved) return;
    request.authResolved = true;

    const token = this.bearerToken(request);
    if (!token) return;

    try {
      const verified = await verifyToken(token, this.verifyOptions());
      request.auth = { userId: verified.sub, sessionId: verified.sid };
      this.remember(token, verified.sub);
    } catch (err: unknown) {
      // Anonymous. An expired token on a public route is ORDINARY and must stay
      // silent — logging it would be noise on every request.
      //
      // But one reason is not ordinary. A misconfigured allowlist doesn't 401
      // here; it quietly drops every SUBSCRIBER to the free tier (this is the
      // path that decides whether `explain-element` returns paid layers), and
      // the web proxy swallows its own errors too — so the symptom would be
      // "customers say the paid content vanished" with nothing in any log.
      // Clerk tags this distinctly, so surface exactly it and nothing else.
      // ⚠️ Recorded, NOT logged here. Whether an azp rejection means "silently
      // downgraded to anonymous" (public route) or "rejected with a 401"
      // (protected) depends on the route, which this service cannot see — and
      // an earlier version claimed the former on both, which would send anyone
      // debugging a 401 looking for a downgrade that never happened.
      request.authFailureWasAzp = isAuthorizedPartiesFailure(err);
      // Kept for the protected path, which turns "we tried and failed" into a
      // 401 with the right message. Never surfaced to the client.
      request.authFailure = err instanceof Error ? err.message : 'unknown';
    }
  }

  /**
   * Shared `verifyToken` options, so every path can never drift apart on what
   * "valid" means.
   *
   * B5 — `authorizedParties` pins the JWT's `azp` claim, which Clerk sets to the
   * origin that requested the token. Without it, a token minted for ANY frontend
   * on this Clerk instance is accepted by this API.
   *
   * ⚠️ It constrains tokens that CARRY an origin; it cannot constrain ones that
   * don't. `@clerk/backend`'s check is `if (!azp || !authorizedParties.length) return`
   * — a missing `azp` short-circuits before the allowlist is consulted. That is
   * deliberate on Clerk's part and is what keeps NATIVE clients working: the
   * mobile app has no web origin, so its tokens carry no `azp` and are unaffected
   * by this list. Do not add mobile "origins" here expecting them to be enforced,
   * and do not read this as a complete origin lock.
   */
  private verifyOptions(): { secretKey: string; authorizedParties?: string[] } {
    return {
      secretKey: this.secretKey,
      // Omitted entirely when empty. Passing `[]` would be equivalent (Clerk
      // treats a zero-length list as "no check"), but omission states the intent.
      ...(this.authorizedParties.length > 0 && {
        authorizedParties: this.authorizedParties,
      }),
    };
  }
}

/** SHA-256 so the cache never holds a usable credential. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
