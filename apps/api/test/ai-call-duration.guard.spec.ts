import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ob1 — `ms` must mean the same thing on every line.
 *
 * The governor makes a caller WAIT for a slot. If the timer starts before that
 * wait, `durationMs` becomes "queue time + call time" — on that route only, and
 * inflated precisely when the pool is saturated, which is when someone is
 * reading the number to decide whether to resize it. A latency metric that
 * grows because of the thing you are measuring is worse than no metric.
 *
 * This shipped once, on `chat:sync`, and was caught reading the diff rather
 * than by any test. It is a property of ORDER, so it cannot be asserted from a
 * unit test without mocking the governor at all eleven sites — but it is plain
 * in the source, and one static sweep covers every site at once including the
 * twelfth nobody has written yet.
 */

const SRC = join(__dirname, '..', 'src');

/** Every file that times a provider call. */
const TIMED_FILES = [
  'chat/chat.service.ts',
  'chat/chat-stream.service.ts',
  'chat/chat-validators.service.ts',
  'ai/ai.service.ts',
  'fortune/fortune.service.ts',
  'fortune/fortune-stream.service.ts',
];

const GOVERNOR = /aiGovernor\s*\.\s*(acquire|run|runGenerator)\s*\(/;
const TIMER = /\baiStartedAt\s*=\s*Date\.now\(\)/;
/** Method declarations at class-body indentation. */
const METHOD = /^ {2}(?:private |public |protected )?(?:async )?\*?[_a-zA-Z][\w]*\s*[(<]/;

interface Block {
  name: string;
  lines: string[];
  start: number;
}

function methodsOf(source: string): Block[] {
  const lines = source.split('\n');
  const out: Block[] = [];
  let current: Block | null = null;
  lines.forEach((line, i) => {
    if (METHOD.test(line) && !line.trim().startsWith('//')) {
      current = { name: line.trim().slice(0, 60), lines: [], start: i + 1 };
      out.push(current);
    }
    current?.lines.push(line);
  });
  return out;
}

describe('the timer starts after the slot, never before', () => {
  it.each(TIMED_FILES)('%s', (rel) => {
    const source = readFileSync(join(SRC, rel), 'utf8');
    const offenders: string[] = [];

    for (const method of methodsOf(source)) {
      const timerAt = method.lines.findIndex((l) => TIMER.test(l));
      if (timerAt === -1) continue;
      const governorAt = method.lines.findIndex((l) => GOVERNOR.test(l));
      if (governorAt === -1) continue; // the judge is pool-exempt by design

      // A LATER re-assignment is the documented pattern for the stream sites:
      // declare early so the `finally` can read it, then reset just before the
      // call. So the check is on the LAST assignment, not the first.
      const lastTimerAt = method.lines.reduce((acc, l, i) => (TIMER.test(l) ? i : acc), -1);
      if (lastTimerAt < governorAt) {
        offenders.push(
          `${method.name} (line ~${method.start + lastTimerAt}) starts the timer ` +
            `before acquiring a slot`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it('is actually looking at something (guard the guard)', () => {
    // A regex that matched nothing would make every case above pass vacuously.
    const timed = TIMED_FILES.filter((rel) => TIMER.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(timed).toEqual(TIMED_FILES);
  });

  it('every record() that reports a duration has a timer in its file', () => {
    // Catches the reverse mistake: passing `durationMs` computed from something
    // other than the timer, e.g. a stale variable from an outer scope.
    for (const rel of TIMED_FILES) {
      const source = readFileSync(join(SRC, rel), 'utf8');
      const durations = source.match(/durationMs:/g)?.length ?? 0;
      if (durations === 0) continue;
      expect(TIMER.test(source) || /durationMs: result\.latencyMs/.test(source)).toBe(true);
    }
  });
});
