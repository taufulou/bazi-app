import { ReadinessService } from './readiness.service';
import { ShutdownService } from '../common/shutdown.service';

/**
 * M6 — the readiness flip is the half of graceful shutdown that stops NEW
 * traffic. Cutting streams cleanly is worthless if the load balancer keeps
 * handing us fresh requests while we drain.
 *
 * These assert the two properties that actually matter, both of which are easy
 * to break by "tidying" the check order in `ReadinessService.check()`:
 *   1. shutting down ⇒ never `ready`
 *   2. the answer must not come from, or populate, the 1s cache
 */
describe('ReadinessService — shutdown behaviour', () => {
  function build() {
    const queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const ping = jest.fn().mockResolvedValue('PONG');
    const prisma = { $queryRaw: queryRaw } as never;
    const redis = { getClient: () => ({ ping }) } as never;
    const config = { get: jest.fn().mockReturnValue('http://127.0.0.1:1') } as never;
    const shutdown = new ShutdownService();
    return {
      service: new ReadinessService(prisma, redis, config, shutdown),
      shutdown,
      queryRaw,
      ping,
    };
  }

  it('reports ready while running', async () => {
    const { service } = build();
    const report = await service.check();
    expect(report.ready).toBe(true);
    expect(report.status).not.toBe('not_ready');
  });

  it('reports not_ready the instant shutdown begins', async () => {
    const { service, shutdown } = build();
    expect((await service.check()).ready).toBe(true);

    // No signal name: flips the flag and returns at once. The multi-second
    // signal-driven drain is covered in shutdown.service.spec.ts; paying for
    // it here would add 10s to the suite to re-test the same flag.
    await shutdown.beforeApplicationShutdown();
    const report = await service.check();

    expect(report.ready).toBe(false);
    expect(report.status).toBe('not_ready');
    expect(report.checks.shutdown?.status).toBe('unhealthy');
  });

  it('is not served from the 1s cache — a stale ready:true would keep traffic coming', async () => {
    const { service, shutdown } = build();
    // Warm the cache with a healthy report, then shut down well inside the
    // READINESS_CACHE_MS window. Reading the flag AFTER the cache check would
    // return that cached `ready: true`.
    await service.check();
    await shutdown.beforeApplicationShutdown();
    expect((await service.check()).ready).toBe(false);
  });

  it('skips the dependency probes once shutting down', async () => {
    const { service, shutdown, queryRaw, ping } = build();
    await shutdown.beforeApplicationShutdown();
    await service.check();
    // Probing a database whose pool we are closing is noise at best and an
    // error log at worst; the verdict does not depend on the answer.
    expect(queryRaw).not.toHaveBeenCalled();
    expect(ping).not.toHaveBeenCalled();
  });
});
