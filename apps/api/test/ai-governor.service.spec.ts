import { ServiceUnavailableException } from '@nestjs/common';
import { AiGovernorService, AI_BUSY_CODE, AiPool } from '../src/ai/ai-governor.service';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

/**
 * S1 — the concurrency governor.
 *
 * The failure mode that matters most is a LEAKED SLOT: the pool shrinks by one
 * for the life of the process, invisibly, until throughput collapses. Several
 * tests below exist only to prove a slot comes back on the unhappy paths —
 * throw, queue timeout, and an abandoned generator.
 */

const make = (env: Record<string, string | number> = {}) =>
  new AiGovernorService({ get: (k: string) => env[k] } as never);

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => jest.clearAllMocks());

describe('S1 — limits', () => {
  it('uses the budget-derived defaults', () => {
    const g = make();
    expect(g.limitFor('reading')).toBe(25);
    expect(g.limitFor('interactive')).toBe(40);
  });

  it('honours overrides and falls back on garbage', () => {
    expect(make({ AI_MAX_CONCURRENT_READING: '5' }).limitFor('reading')).toBe(5);
    expect(make({ AI_MAX_CONCURRENT_READING: 'abc' }).limitFor('reading')).toBe(25);
    expect(make({ AI_MAX_CONCURRENT_READING: '-1' }).limitFor('reading')).toBe(25);
  });

  it('0 disables the pool — the documented rollback', async () => {
    const g = make({ AI_MAX_CONCURRENT_READING: '0' });
    // 100 concurrent acquisitions must all pass straight through.
    const releases = await Promise.all(
      Array.from({ length: 100 }, () => g.acquire('reading')),
    );
    expect(releases).toHaveLength(100);
    expect(g.snapshot().reading.inFlight).toBe(0); // disabled ⇒ no accounting
    releases.forEach((r) => r());
  });
});

describe('S1 — admission', () => {
  it('admits up to the limit without queueing', async () => {
    const g = make({ AI_MAX_CONCURRENT_READING: '3' });
    const releases = await Promise.all([
      g.acquire('reading'),
      g.acquire('reading'),
      g.acquire('reading'),
    ]);
    expect(g.snapshot().reading.inFlight).toBe(3);
    expect(g.snapshot().reading.queued).toBe(0);
    releases.forEach((r) => r());
  });

  it('queues the (limit+1)th caller and admits it when a slot frees', async () => {
    const g = make({ AI_MAX_CONCURRENT_READING: '1' });
    const first = await g.acquire('reading');

    let admitted = false;
    const second = g.acquire('reading').then((r) => {
      admitted = true;
      return r;
    });

    await Promise.resolve();
    expect(admitted).toBe(false);
    expect(g.snapshot().reading.queued).toBe(1);

    first();
    const release = await second;
    expect(admitted).toBe(true);
    expect(g.snapshot().reading.inFlight).toBe(1);
    release();
  });

  it('the pools are independent — a full reading pool does not block chat', async () => {
    // The whole reason there are two: a burst of readings must not freeze the
    // interactive surface, and vice versa.
    const g = make({ AI_MAX_CONCURRENT_READING: '1', AI_MAX_CONCURRENT_INTERACTIVE: '1' });
    const r = await g.acquire('reading');
    const i = await g.acquire('interactive'); // must not wait
    expect(g.snapshot().reading.inFlight).toBe(1);
    expect(g.snapshot().interactive.inFlight).toBe(1);
    r();
    i();
  });
});

describe('S1 — the limit is never exceeded', () => {
  it('a barging caller cannot push inFlight above the limit', async () => {
    // ⚠️ The defect this pins. `release()` decrements and THEN resolves a
    // waiter, and that resolution is a microtask — so a caller whose
    // continuation was already queued can take the freed slot SYNCHRONOUSLY,
    // and the woken waiter (with `if` instead of `while`) then increments
    // anyway. Demonstrated at limit=1 reaching inFlight=2, and every
    // simultaneous release can over-admit again, degrading the ceiling toward
    // 2x — which makes the control's own arithmetic ("25 x $0.30 < $8") wrong.
    const g = make({ AI_MAX_CONCURRENT_READING: '1' });
    const holder = await g.acquire('reading');

    const waiter = g.acquire('reading'); // queued behind the holder
    await Promise.resolve();
    expect(g.snapshot().reading.queued).toBe(1);

    // Release and barge in the same tick — the barger's acquire runs before
    // the woken waiter's continuation.
    holder();
    const barger = await g.acquire('reading');

    expect(g.snapshot().reading.inFlight).toBeLessThanOrEqual(1);

    barger();
    (await waiter)();
    expect(g.snapshot().reading.inFlight).toBe(0);
  });

  it('never exceeds the limit across a burst', async () => {
    const limit = 3;
    const g = make({ AI_MAX_CONCURRENT_READING: String(limit) });
    const seen: number[] = [];
    const gate = deferred();

    const jobs = Array.from({ length: 12 }, () =>
      g.run('reading', 'burst', async () => {
        seen.push(g.snapshot().reading.inFlight);
        await gate.promise;
      }),
    );
    await Promise.resolve();
    gate.resolve();
    await Promise.all(jobs);

    // Sampled at every admission — the assertion the pool exists to make.
    expect(Math.max(...seen)).toBeLessThanOrEqual(limit);
    expect(g.snapshot().reading.inFlight).toBe(0);
  });
});

describe('S1 — refusal', () => {
  jest.setTimeout(10_000);

  it('rejects with a typed AI_BUSY once the queue times out', async () => {
    const g = make({ AI_MAX_CONCURRENT_INTERACTIVE: '1' });
    const held = await g.acquire('interactive');

    // interactive queue timeout is 3s — fail fast is the point.
    await expect(g.acquire('interactive')).rejects.toBeInstanceOf(ServiceUnavailableException);
    held();
  });

  it('the refusal carries the code clients branch on', async () => {
    const g = make({ AI_MAX_CONCURRENT_INTERACTIVE: '1' });
    const held = await g.acquire('interactive');
    try {
      await g.acquire('interactive');
      throw new Error('should have refused');
    } catch (err) {
      expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
        code: AI_BUSY_CODE,
      });
    }
    held();
  });

  it('a timed-out waiter does NOT consume a slot when one later frees', async () => {
    // The subtle leak: if the abandoned waiter stays queued, `release()` hands
    // it the slot, nobody uses it, and the pool is permanently one smaller.
    const g = make({ AI_MAX_CONCURRENT_INTERACTIVE: '1' });
    const held = await g.acquire('interactive');
    await expect(g.acquire('interactive')).rejects.toThrow();
    expect(g.snapshot().interactive.queued).toBe(0);

    held();
    expect(g.snapshot().interactive.inFlight).toBe(0);

    // The pool is intact: a fresh caller is admitted immediately.
    const fresh = await g.acquire('interactive');
    expect(g.snapshot().interactive.inFlight).toBe(1);
    fresh();
  });
});

describe('S1 — slots always come back', () => {
  it('run() releases on success', async () => {
    const g = make({ AI_MAX_CONCURRENT_READING: '1' });
    await g.run('reading', 'test', async () => 'ok');
    expect(g.snapshot().reading.inFlight).toBe(0);
  });

  it('run() releases when the work THROWS', async () => {
    const g = make({ AI_MAX_CONCURRENT_READING: '1' });
    await expect(
      g.run('reading', 'test', async () => {
        throw new Error('provider exploded');
      }),
    ).rejects.toThrow('provider exploded');
    expect(g.snapshot().reading.inFlight).toBe(0);
  });

  it('runGenerator() holds the slot for the WHOLE stream, then releases', async () => {
    const g = make({ AI_MAX_CONCURRENT_READING: '1' });
    const gen = g.runGenerator('reading', 'test', async function* () {
      yield 'a';
      yield 'b';
    });

    expect(g.snapshot().reading.inFlight).toBe(0); // nothing acquired until first pull
    await gen.next();
    // Releasing at first byte would let N slots admit far more than N upstream
    // calls — the number would look bounded and not be.
    expect(g.snapshot().reading.inFlight).toBe(1);
    await gen.next();
    expect(g.snapshot().reading.inFlight).toBe(1);
    await gen.next(); // done
    expect(g.snapshot().reading.inFlight).toBe(0);
  });

  it('runGenerator() releases when the consumer ABANDONS the stream', async () => {
    // What a client disconnect looks like from here.
    const g = make({ AI_MAX_CONCURRENT_READING: '1' });
    const gen = g.runGenerator('reading', 'test', async function* () {
      yield 'a';
      yield 'never reached';
    });
    await gen.next();
    expect(g.snapshot().reading.inFlight).toBe(1);
    await gen.return(undefined as never);
    expect(g.snapshot().reading.inFlight).toBe(0);
  });

  it('double release cannot inflate the pool', async () => {
    const g = make({ AI_MAX_CONCURRENT_READING: '2' });
    const release = await g.acquire('reading');
    release();
    release();
    expect(g.snapshot().reading.inFlight).toBe(0);
  });

  it('survives a full acquire/release cycle under contention', async () => {
    const g = make({ AI_MAX_CONCURRENT_READING: '2' });
    const gate = deferred();
    const work = Array.from({ length: 6 }, (_, i) =>
      g.run('reading', `job-${i}`, async () => {
        await gate.promise;
        return i;
      }),
    );
    gate.resolve();
    expect(await Promise.all(work)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(g.snapshot().reading.inFlight).toBe(0);
    expect(g.snapshot().reading.queued).toBe(0);
  });
});

describe('S1 — observability', () => {
  it('reports peak and counters for the ops endpoint', async () => {
    const g = make({ AI_MAX_CONCURRENT_READING: '2' });
    const a = await g.acquire('reading');
    const b = await g.acquire('reading');
    a();
    b();
    const snap = g.snapshot()['reading' as AiPool];
    expect(snap.peak).toBe(2);
    expect(snap.admitted).toBe(2);
    expect(snap.rejected).toBe(0);
  });
});
