/**
 * The APP_GUARD ordering facts M1's design rests on — established by
 * experiment, because they are not stated anywhere we control and a wrong
 * assumption here is silent.
 *
 * Why it mattered: the throttler must key its bucket on a VERIFIED userId, so
 * it needs `request.auth`. `ThrottlerGuard` is registered in AppModule and
 * `ClerkAuthGuard` in the imported AuthModule — and as test 1 shows, the ROOT
 * module's guard runs FIRST. So at tracker time `request.auth` is not there yet.
 *
 * The fix deliberately does NOT depend on these facts: `AuthIdentityService.attach`
 * is idempotent, so whichever guard runs first verifies and the other reuses it.
 * This spec exists to document what we measured and to make it loud if the
 * framework's behaviour ever changes — not because correctness hangs on it.
 */
import { Module, Injectable, CanActivate, Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';

const order: string[] = [];

@Injectable()
class ChildGuard implements CanActivate {
  canActivate(): boolean { order.push('child(AuthModule-like)'); return true; }
}
@Injectable()
class RootGuard implements CanActivate {
  canActivate(): boolean { order.push('root(AppModule-like)'); return true; }
}

@Module({ providers: [{ provide: APP_GUARD, useClass: ChildGuard }] })
class ChildModule {}

@Controller('probe')
class ProbeController { @Get() get() { return { ok: true }; } }

@Module({
  imports: [ChildModule],
  controllers: [ProbeController],
  providers: [{ provide: APP_GUARD, useClass: RootGuard }],
})
class RootModule {}

describe('APP_GUARD execution order — imported module vs root providers', () => {
  it('reports the real order for this exact topology', async () => {
    const mod = await Test.createTestingModule({ imports: [RootModule] }).compile();
    const app = mod.createNestApplication();
    await app.listen(0);
    const url = await app.getUrl();
    order.length = 0;
    const res = await fetch(`${url.replace('[::1]', '127.0.0.1')}/probe`);
    expect(res.status).toBe(200);
    await app.close();
    // Asserted, not just printed. A previous version only checked the LENGTH,
    // so a framework change reversing the order would have left this green
    // while silently falsifying the comments that cite it as evidence.
    expect(order).toEqual(['root(AppModule-like)', 'child(AuthModule-like)']);
  });
});


@Module({
  controllers: [ProbeController],
  providers: [
    { provide: APP_GUARD, useClass: ChildGuard },
    { provide: APP_GUARD, useClass: RootGuard },
  ],
})
class BothInRootModule {}

describe('APP_GUARD order WITHIN one providers array', () => {
  it('follows array order', async () => {
    const mod = await Test.createTestingModule({ imports: [BothInRootModule] }).compile();
    const app = mod.createNestApplication();
    await app.listen(0);
    const url = await app.getUrl();
    order.length = 0;
    await fetch(`${url.replace('[::1]', '127.0.0.1')}/probe`);
    await app.close();
    expect(order).toEqual(['child(AuthModule-like)', 'root(AppModule-like)']);
  });
});
