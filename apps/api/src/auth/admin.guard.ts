import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';
import { RedisService } from '../redis/redis.service';

const ADMIN_CACHE_TTL = 60; // 1 minute — short TTL so role revocation takes effect quickly

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  private readonly clerkClient;

  constructor(
    private configService: ConfigService,
    private redis: RedisService,
  ) {
    this.clerkClient = createClerkClient({
      secretKey: this.configService.get<string>('CLERK_SECRET_KEY') || '',
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.auth?.userId as string | undefined;

    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const cacheKey = `admin:role:${userId}`;

    try {
      const isAdmin = await this.redis.getOrSet<boolean>(
        cacheKey,
        ADMIN_CACHE_TTL,
        async () => {
          const user = await this.clerkClient.users.getUser(userId);
          const role = (user.publicMetadata as Record<string, unknown>)?.role;
          return role === 'admin';
        },
      );

      if (!isAdmin) {
        throw new ForbiddenException('Admin access required');
      }

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;

      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Admin role check failed: ${message}`);
      // Fail closed — if we can't verify, deny access
      throw new ForbiddenException('Unable to verify admin status');
    }
  }
}
