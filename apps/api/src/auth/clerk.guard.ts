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

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
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
}
