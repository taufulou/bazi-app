import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * M6 — a static sweep over every `registerStream` call site.
 *
 * Behavioural tests exist for the daily-fortune path, but writing one for all
 * six surfaces would mean six heavyweight harnesses (monthly, yearly, chat, and
 * two `@Sse` Observables in bazi). The defect class they would guard against is
 * structural and cheap to detect by reading the source: a registration whose
 * release is missing, or moved out of its `finally`.
 *
 * Both failures are SILENT. A leaked registration fails no test and makes every
 * later shutdown burn the full stream grace waiting for a stream that already
 * ended; a release moved too early makes the post-abort wait a no-op and puts
 * the spend record and LKG write back in a race with the pool disconnecting.
 *
 * Same reasoning as the mobile typography guards: exceptions should have to be
 * decided on, not merely happen.
 */

const SRC = join(__dirname, '..');

/** Every file expected to register streams, and how many sites each has. */
const REGISTRATION_SITES: ReadonlyArray<{ file: string; sites: number; hasAiSlot: boolean }> = [
  { file: 'fortune/fortune-stream.service.ts', sites: 3, hasAiSlot: true },
  { file: 'chat/chat-stream.service.ts', sites: 1, hasAiSlot: true },
  { file: 'bazi/bazi.service.ts', sites: 2, hasAiSlot: false },
];

const TOTAL_EXPECTED = REGISTRATION_SITES.reduce((n, f) => n + f.sites, 0);

function read(file: string): string {
  return readFileSync(join(SRC, file), 'utf8');
}

describe('M6 — shutdown registration guards', () => {
  it.each(REGISTRATION_SITES)('$file registers exactly $sites stream(s)', ({ file, sites }) => {
    const src = read(file);
    const declarations = src.match(/const releaseShutdown = this\.shutdown\.registerStream\(/g) ?? [];
    expect(declarations).toHaveLength(sites);
  });

  it.each(REGISTRATION_SITES)('$file releases every registration it takes', ({ file, sites }) => {
    const src = read(file);
    // Counts invocations (`releaseShutdown()`), not the declaration.
    const invocations = src.match(/(?<!= )releaseShutdown\(\)/g) ?? [];
    // Observable teardowns invoke it twice per site (`.finally(...)` and the
    // returned teardown), so this is a floor, not an equality.
    expect(invocations.length).toBeGreaterThanOrEqual(sites);
  });

  it.each(REGISTRATION_SITES.filter((f) => f.hasAiSlot))(
    '$file releases AFTER the spend record and AI slot, not before',
    ({ file, sites }) => {
      const src = read(file);
      const lines = src.split('\n');
      const slotLines = lines
        .map((l, i) => (l.includes('releaseSlot();') ? i : -1))
        .filter((i) => i >= 0);
      const releaseLines = lines
        .map((l, i) => (/^\s*releaseShutdown\(\);/.test(l) ? i : -1))
        .filter((i) => i >= 0);

      expect(slotLines).toHaveLength(sites);
      expect(releaseLines).toHaveLength(sites);

      // Pairwise: each release must sit below its `releaseSlot()`, which is the
      // last statement of the `finally` before it. An earlier release means the
      // drain stops waiting while `aiSpend.record(...)` is still in flight.
      for (let i = 0; i < sites; i++) {
        expect(releaseLines[i]).toBeGreaterThan(slotLines[i]);
      }
    },
  );

  it('has no registration site outside the listed files', () => {
    // Forces a new streaming surface to be added here deliberately rather than
    // inheriting no coverage by default.
    const out = execSync(
      `grep -rl "shutdown.registerStream" ${SRC} --include="*.ts" | grep -v ".spec.ts" || true`,
      { encoding: 'utf8' },
    );
    const found = out
      .split('\n')
      .filter(Boolean)
      .map((p) => p.replace(`${SRC}/`, ''))
      .sort();
    expect(found).toEqual(REGISTRATION_SITES.map((f) => f.file).sort());
  });

  it('the expected total matches the documented six surfaces', () => {
    expect(TOTAL_EXPECTED).toBe(6);
  });
});
