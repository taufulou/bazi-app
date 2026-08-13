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

  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {
    this.secretKey = this.configService.get<string>('CLERK_SECRET_KEY') || '';
    this.publishableKey = this.configService.get<string>('CLERK_PUBLISHABLE_KEY') || '';
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
      //   • M1's rate-limit tracker keys on userId when authenticated and IP
      //     otherwise — on public routes it could only ever see the IP, so
      //     every signed-in user shared one bucket there.
      //   • A public route could not tell a subscriber from an anonymous
      //     caller, which is why `explain-element` hands its paid Layer C/D to
      //     anyone (O3).
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
      const verifiedPayload = await verifyToken(token, {
        secretKey: this.secretKey,
      });

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
      const verified = await verifyToken(token, { secretKey: this.secretKey });
      request.auth = { userId: verified.sub, sessionId: verified.sid };
    } catch {
      // Anonymous. Deliberately not logged at warn — an expired token on a
      // public route is ordinary, and logging it would be noise per request.
    }
  }
}
