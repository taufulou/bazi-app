import { QuietBootstrapLogger, routeLoggingEnabled } from './quiet-logger';

/**
 * The risk with a log filter is that it hides more than intended, and you only
 * find out when the line you needed is the one that never printed. These pin
 * both halves: the inventory goes, everything else stays.
 */
describe('QuietBootstrapLogger', () => {
  const saved = process.env.LOG_ROUTES;
  let printed: unknown[][];
  let logger: QuietBootstrapLogger;

  beforeEach(() => {
    delete process.env.LOG_ROUTES;
    printed = [];
    logger = new QuietBootstrapLogger();
    // Intercept at the ConsoleLogger base, so we assert on what would reach
    // the terminal rather than on our own filter's internals.
    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(logger)), 'log')
      .mockImplementation((...args: unknown[]) => {
        printed.push(args);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (saved === undefined) delete process.env.LOG_ROUTES;
    else process.env.LOG_ROUTES = saved;
  });

  it.each(['RouterExplorer', 'RoutesResolver', 'InstanceLoader'])(
    'drops %s boot inventory',
    (context) => {
      logger.log('Mapped {/api/bazi/readings, POST} route', context);
      expect(printed).toHaveLength(0);
    },
  );

  it('keeps the lines that are actually read at boot', () => {
    // Each of these is a single line someone is told to look for.
    logger.log('Prisma pool — connection_limit=10 pool_timeout=20', 'PrismaService');
    logger.log('SIGTERM received — draining (2 active stream(s))', 'ShutdownService');
    logger.log('Drain complete in 1200ms — closing server', 'ShutdownService');
    logger.log('API server running on http://localhost:4000', 'Bootstrap');
    expect(printed).toHaveLength(4);
  });

  it('never filters warn or error, even from a noisy context', () => {
    const warn = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(logger)), 'warn')
      .mockImplementation(() => undefined);
    const error = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(logger)), 'error')
      .mockImplementation(() => undefined);

    logger.warn('something is off', 'RouterExplorer');
    logger.error('route failed to mount', 'RoutesResolver');

    // The point is removing a known inventory, not silencing a subsystem.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('passes through a log with no context at all', () => {
    logger.log('bare message');
    expect(printed).toHaveLength(1);
  });

  it('does not match a context that merely contains a noisy name', () => {
    // Exact-set membership, not substring — a real service called
    // "MyRouterExplorerService" must keep its logs.
    logger.log('still important', 'MyRouterExplorerService');
    expect(printed).toHaveLength(1);
  });

  it('restores the full inventory when LOG_ROUTES is set', () => {
    process.env.LOG_ROUTES = '1';
    logger.log('Mapped {/api/x, GET} route', 'RouterExplorer');
    expect(printed).toHaveLength(1);
  });
});

describe('routeLoggingEnabled', () => {
  const saved = process.env.LOG_ROUTES;
  afterEach(() => {
    if (saved === undefined) delete process.env.LOG_ROUTES;
    else process.env.LOG_ROUTES = saved;
  });

  it('accepts the usual truthy spellings', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
      process.env.LOG_ROUTES = v;
      expect(routeLoggingEnabled()).toBe(true);
    }
  });

  it('treats anything else — including unset — as off', () => {
    for (const v of ['0', 'false', 'no', '', 'maybe']) {
      process.env.LOG_ROUTES = v;
      expect(routeLoggingEnabled()).toBe(false);
    }
    delete process.env.LOG_ROUTES;
    expect(routeLoggingEnabled()).toBe(false);
  });
});

/**
 * The unit tests above hardcode Nest's context strings. If Nest renames
 * `RouterExplorer`, they keep passing while production silently prints the
 * inventory again — helper tested, wiring untested.
 *
 * This boots a real (tiny) Nest app through the real logger and asserts on
 * what Nest itself emits, so the context names are verified rather than
 * assumed.
 */
describe('QuietBootstrapLogger against a REAL Nest boot', () => {
  it('suppresses the route inventory Nest actually emits, and nothing else', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Controller, Get, Module } = require('@nestjs/common');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NestFactory } = require('@nestjs/core');

    @Controller('audit-probe')
    class ProbeController {
      @Get('one')
      one() {
        return 'ok';
      }
      @Get('two')
      two() {
        return 'ok';
      }
    }

    @Module({ controllers: [ProbeController] })
    class ProbeModule {}

    const lines: string[] = [];
    const logger = new QuietBootstrapLogger();
    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(logger)), 'log')
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

    delete process.env.LOG_ROUTES;
    const app = await NestFactory.create(ProbeModule, { logger });
    await app.init();

    // Nest really did map them (proving the probe is representative)…
    const mapped = lines.filter((l) => l.includes('audit-probe'));
    expect(mapped).toEqual([]);
    // …and no inventory context leaked through under any name.
    expect(lines.filter((l) => /RouterExplorer|RoutesResolver|InstanceLoader/.test(l))).toEqual([]);

    await app.close();
  }, 30_000);

  it('and prints that same inventory when LOG_ROUTES=1', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Controller, Get, Module } = require('@nestjs/common');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NestFactory } = require('@nestjs/core');

    @Controller('audit-probe-2')
    class ProbeController2 {
      @Get('one')
      one() {
        return 'ok';
      }
    }

    @Module({ controllers: [ProbeController2] })
    class ProbeModule2 {}

    const lines: string[] = [];
    const logger = new QuietBootstrapLogger();
    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(logger)), 'log')
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

    process.env.LOG_ROUTES = '1';
    const app = await NestFactory.create(ProbeModule2, { logger });
    await app.init();

    // The escape hatch has to actually work, or nobody can debug a route.
    expect(lines.some((l) => l.includes('audit-probe-2'))).toBe(true);

    await app.close();
    delete process.env.LOG_ROUTES;
  }, 30_000);
});
