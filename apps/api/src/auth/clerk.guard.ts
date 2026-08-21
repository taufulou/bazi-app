import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthIdentityService, type AuthAttachable } from './auth-identity.service';

// Re-exported: three specs and the api↔web parity spec import it from here, and
// the helpers only moved to break an import cycle (see authorized-parties.ts).
export { parseAuthorizedParties } from './authorized-parties';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  constructor(
    private reflector: Reflector,
    private identity: AuthIdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest() as AuthAttachable;

    // M1 — verification moved into `AuthIdentityService` and is IDEMPOTENT, so
    // this call is usually a no-op: the throttler runs first and has already
    // done it in order to key the bucket per user. One verification per request
    // either way, and — the point of the extraction — ONE definition of what a
    // valid token is. Two paths deciding that separately is how the azp check
    // and the Sentry scrubber both nearly drifted.
    await this.identity.attach(request);

    if (isPublic) {
      // B1 — OPTIONAL AUTH on public routes.
      //
      // This used to `return true` immediately, so `request.auth` was never
      // populated even when the caller sent a perfectly good token, and a
      // public route could not tell a subscriber from an anonymous caller —
      // which is why `explain-element` handed its paid layers to anyone (O3).
      //
      // Best-effort by design: a missing, malformed or expired token leaves
      // `request.auth` undefined and the request proceeds as anonymous. It
      // must NEVER throw — that would turn a public route private.
      //
      // One failure reason is not ordinary and is surfaced HERE, where we know
      // the route is public and "downgraded" is therefore accurate. A
      // misconfigured allowlist does not 401 on a public route; it quietly
      // drops every SUBSCRIBER to the free tier (this is the path that decides
      // whether `explain-element` returns paid layers), and the web proxy
      // swallows its own errors too — so the symptom would be "customers say
      // the paid content vanished" with nothing in any log.
      if (request.authFailureWasAzp) {
        this.logger.warn(
          'A token was rejected for its azp claim on a PUBLIC route — the caller ' +
            'was silently downgraded to anonymous. If this repeats, ' +
            'CLERK_AUTHORIZED_PARTIES is probably wrong or incomplete.',
        );
      }
      return true;
    }

    if (request.auth) return true;

    // Distinguish the two failures for the caller, as before. The distinction
    // is in the MESSAGE only — both are 401, and neither leaks why the token
    // was rejected.
    const authHeader = request.headers.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }
    // Logged here rather than in the service: on a public route a rejected
    // token is ordinary and silent, but on a protected one it is the reason
    // somebody is locked out, and that is worth a line.
    this.logger.warn(`Token verification failed: ${request.authFailure ?? 'no reason recorded'}`);
    throw new UnauthorizedException('Invalid or expired token');
  }
}
