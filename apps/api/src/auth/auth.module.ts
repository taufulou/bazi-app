import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ClerkAuthGuard } from './clerk.guard';
import { AuthIdentityService } from './auth-identity.service';

@Module({
  providers: [
    AuthIdentityService,
    {
      provide: APP_GUARD,
      useClass: ClerkAuthGuard,
    },
  ],
  // M1 — the throttler guard (registered in AppModule) keys its bucket on the
  // verified userId, so it needs the same identity service. Exported rather
  // than instantiated twice: a second copy would re-log the boot warnings and,
  // worse, could be constructed with different options.
  exports: [AuthIdentityService],
})
export class AuthModule {}
