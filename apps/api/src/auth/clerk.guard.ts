import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyToken } from '@clerk/backend';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);
  private readonly secretKey: string;
  private readonly publishableKey: string;
  /** B5 — `azp` allowlist. Empty = the claim is not checked. */
  private readonly authorizedParties: string[];

  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {
    this.secretKey = this.configService.get<string>('CLERK_SECRET_KEY') || '';
    this.publishableKey = this.configService.get<string>('CLERK_PUBLISHABLE_KEY') || '';
    this.authorizedParties = parseAuthorizedParties(
      this.configService.get<string>('CLERK_AUTHORIZED_PARTIES'),
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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();

    if (isPublic) {
      // B1 — OPTIONAL AUTH on public routes.
      //
      // This used to `return true` immediately, so `request.auth` was never
      // populated even when the caller sent a perfectly good token. Two
      // consequences, both real:
      //   • A public route could not tell a subscriber from an anonymous
      //     caller, which is why `explain-element` handed its paid layers to
      //     anyone (O3). That is the reason this exists.
      //
      // ⚠️ An earlier version of this comment also claimed it fixed M1's
      // rate-limit keying. It does NOT: there is no custom tracker in this
      // codebase (`grep getTracker|extends ThrottlerGuard|generateKey` → 0),
      // `app.module.ts` registers the stock IP-scoped `ThrottlerGuard`, and M1
      // is still future work. Populating `request.auth` is a PREREQUISITE for
      // that work, not the work itself.
      //
      // Best-effort by design: a missing, malformed or expired token leaves
      // `request.auth` undefined and the request proceeds as anonymous. It
      // must NEVER throw — that would turn a public route private.
      await this.tryAttachAuth(request);
      return true;
    }

    const authHeader = request.headers.authorization as string | undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.split(' ')[1];

    try {
      const verifiedPayload = await verifyToken(token, this.verifyOptions());

      // Attach user info to request
      request.auth = {
        userId: verifiedPayload.sub,
        sessionId: verifiedPayload.sid,
      };

      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Token verification failed: ${message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Verify-if-present. Populates `request.auth` when a valid Bearer token is
   * supplied, and does nothing otherwise.
   *
   * ⚠️ Swallows every error on purpose. This runs on PUBLIC routes; throwing
   * here would make them private, which is a worse outage than the missing
   * personalisation. The identity it attaches is signature-VERIFIED — never a
   * decoded-but-unverified `sub`, which would let a forged bearer mint
   * unlimited rate-limit buckets and impersonate a subscriber.
   */
  private async tryAttachAuth(request: {
    headers: Record<string, unknown>;
    auth?: { userId: string; sessionId?: string };
  }): Promise<void> {
    const authHeader = request.headers.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) return;

    const token = authHeader.split(' ')[1];
    if (!token) return;

    try {
      // Same options as the protected path — INCLUDING the azp allowlist. A
      // public route that personalises on identity (explain-element hands out
      // paid layers to subscribers) is exactly as exposed to a foreign-origin
      // token as a protected one; verifying more loosely here would leave the
      // hole open on the surface B1 built to read identity.
      const verified = await verifyToken(token, this.verifyOptions());
      request.auth = { userId: verified.sub, sessionId: verified.sid };
    } catch {
      // Anonymous. Deliberately not logged at warn — an expired token on a
      // public route is ordinary, and logging it would be noise per request.
    }
  }

  /**
   * Shared `verifyToken` options, so the protected and optional-auth paths can
   * never drift apart on what "valid" means.
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

/**
 * Parse `CLERK_AUTHORIZED_PARTIES` — a comma-separated origin list.
 *
 * Exported for tests. Trims, drops empties, and de-duplicates so a stray comma
 * or trailing space in a Railway env var can't produce an `''` entry — which
 * would be a live allowlist member matching nothing, quietly, forever.
 */
export function parseAuthorizedParties(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}
