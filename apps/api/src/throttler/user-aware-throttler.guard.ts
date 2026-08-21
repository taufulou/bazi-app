import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { AuthIdentityService, type AuthAttachable } from '../auth/auth-identity.service';

/** Prefixes exist so a userId can never collide with an IP literal. */
const USER_PREFIX = 'u:';
const IP_PREFIX = 'ip:';

@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly identity: AuthIdentityService,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * M1(c) — key the bucket per USER when we know who is calling.
   *
   * The stock tracker is `req.ip`. Behind the Next.js web app that is a single
   * address for every visitor, so one user could exhaust the limit for all of
   * them; and on mobile a carrier NAT does the same. Keying on identity fixes
   * both, and is what makes M10's proxying of the free chart preview through
   * NestJS safe rather than a shared 20/min ceiling.
   *
   * ⚠️ The userId MUST come from a signature-VERIFIED token. A decoded-but-
   * unverified `sub` would be attacker-chosen: anyone could mint a fresh bucket
   * per request by editing the JWT payload, which is strictly worse than IP
   * keying because it is free and unlimited. `AuthIdentityService.attach` is the
   * only thing that writes `request.auth`, and it verifies.
   *
   * `attach` is idempotent and this guard usually runs BEFORE `ClerkAuthGuard`
   * (root-module APP_GUARDs beat imported ones — `guard-order.spec.ts`), so the
   * verification happens here and the auth guard reuses it. Neither depends on
   * that order being what it is.
   */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    await this.identity.attach(req as unknown as AuthAttachable);

    const userId = (req as { auth?: { userId?: string } }).auth?.userId;
    if (userId) return `${USER_PREFIX}${userId}`;

    // Anonymous. `req.ip` is only as trustworthy as Express's `trust proxy`
    // setting — see `resolveTrustProxy` in main.ts. Misconfigured, this is the
    // proxy's own address and every anonymous caller shares one bucket; it is
    // never attacker-controlled, which is the property that matters.
    const ip = (req as { ip?: string }).ip;
    return `${IP_PREFIX}${ip || 'unknown'}`;
  }
}
