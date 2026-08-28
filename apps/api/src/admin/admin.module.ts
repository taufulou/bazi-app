import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { OpsService } from './ops.service';
import { AdminGuard } from '../auth/admin.guard';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [CreditsModule],
  controllers: [AdminController],
  providers: [AdminService, OpsService, AdminGuard],
})
export class AdminModule {}
