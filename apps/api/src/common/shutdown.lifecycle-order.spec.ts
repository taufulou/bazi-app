import {
  Injectable,
  Module,
  OnModuleDestroy,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

/**
 * M6 — locks the reason `main.ts` drives shutdown itself instead of calling
 * `app.enableShutdownHooks()`.
 *
 * The first implementation put the drain in `beforeApplicationShutdown`, which
 * reads like the obvious hook for it. It is the wrong one: Nest runs
 * `onModuleDestroy` FIRST, and both `PrismaService` and `RedisService` tear
 * their connections down there. A drain in the hook would wait for in-flight
 * streams to persist into a disconnected Prisma pool and a Redis client that
 * has already had `quit()` called on it — and ioredis does not auto-reconnect
 * after an explicit quit.
 *
 * Nothing in the app's own tests would catch that regression, because the
 * damage is to real I/O during a real SIGTERM. So it is pinned here.
 */
describe('Nest shutdown hook order (why M6 does not use the hook)', () => {
  const order: string[] = [];

  @Injectable()
  class FakeConnection implements OnModuleDestroy {
    async onModuleDestroy() {
      order.push('onModuleDestroy');
    }
  }

  @Injectable()
  class FakeDrain implements BeforeApplicationShutdown {
    async beforeApplicationShutdown() {
      order.push('beforeApplicationShutdown');
    }
  }

  @Module({ providers: [FakeConnection, FakeDrain] })
  class TestModule {}

  beforeEach(() => {
    order.length = 0;
  });

  it('runs onModuleDestroy BEFORE beforeApplicationShutdown', async () => {
    const app = (
      await Test.createTestingModule({ imports: [TestModule] }).compile()
    ).createNestApplication();
    await app.init();
    await app.close();

    expect(order).toEqual(['onModuleDestroy', 'beforeApplicationShutdown']);
    // Spelled out: if this ever flips, the comment in main.ts is stale and the
    // simpler hook-based implementation becomes viable again.
    expect(order.indexOf('onModuleDestroy')).toBeLessThan(
      order.indexOf('beforeApplicationShutdown'),
    );
  });

  it("main.ts's drain-then-close order puts the drain BEFORE teardown", async () => {
    const app = (
      await Test.createTestingModule({ imports: [TestModule] }).compile()
    ).createNestApplication();
    await app.init();

    // Exactly what the SIGTERM handler in main.ts does.
    order.push('drain');
    await app.close();

    expect(order[0]).toBe('drain');
    expect(order.indexOf('drain')).toBeLessThan(order.indexOf('onModuleDestroy'));
  });
});
