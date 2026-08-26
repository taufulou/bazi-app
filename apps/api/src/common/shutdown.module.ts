import { Global, Module } from '@nestjs/common';
import { ShutdownService } from './shutdown.service';

/**
 * Global because the streaming services that must register with it live in
 * feature modules (chat, fortune) that have no other reason to depend on each
 * other — the same reasoning as `AiSpendModule`. Making it global keeps M6 out
 * of every module's import list, so a new streaming surface can register
 * without also editing its module.
 */
@Global()
@Module({
  providers: [ShutdownService],
  exports: [ShutdownService],
})
export class ShutdownModule {}
