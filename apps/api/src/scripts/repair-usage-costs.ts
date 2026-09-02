/**
 * D2 — repair `ai_usage_log` rows that recorded `$0` against real token counts.
 *
 * ## Why they exist
 *
 * `logUsage` used to take the row's cost from a caller-supplied
 * `estimatedCostUsd`, and nine call sites hardcoded `0`. D1 removed that
 * parameter so the row is priced from `model` + tokens and a caller cannot get
 * it wrong. This repairs what was written before that.
 *
 * ⚠️ **Run this only AFTER D1 is deployed.** Not for correctness — the price
 * table this reads is already the only one it can reach — but for completeness:
 * before D1, new `$0` rows keep accruing behind the repair.
 *
 * ## ⚠️ This write is ONE-WAY
 *
 * The predicate is `costUsd = 0 AND (inputTokens > 0 OR outputTokens > 0)`.
 * A repaired row has `costUsd > 0` and NO LONGER MATCHES, so a second run
 * cannot reach it. If a run prices wrongly there is no bulk way back — which is
 * why `--rows` exists, and why the dry run is the default rather than a
 * courtesy.
 *
 * ## Why not the load-test `.mjs` script
 *
 * `load-test/purge-usage-log.mjs` is plain `.mjs` importing `@prisma/client`
 * directly. `PRICE_TABLE` is a non-exported `const` in TypeScript and
 * `findPrice`'s longest-prefix matching is non-trivial, so putting the repair
 * there would mean a THIRD copy of the pricing rules — the exact defect D1
 * exists to remove — in an untested script writing money figures to production.
 *
 * ## Why not `NestFactory.createApplicationContext`
 *
 * The plan called for that, and it would work. But `estimateCostUsd`,
 * `hasPriceEntry` and `priceFor` touch neither `redis` nor `config` (verified:
 * zero references), so booting the whole `AppModule` would open Redis
 * connections, register shutdown hooks and require full env — for a pure
 * function. Instantiating the real service directly reuses the real
 * `PRICE_TABLE` and the real matching logic, which is the actual requirement,
 * with none of that surface.
 *
 * ## Usage
 *
 *   npm --prefix apps/api run repair-usage-costs                    # dry run
 *   npm --prefix apps/api run repair-usage-costs -- --execute --target <db-host>
 *   npm --prefix apps/api run repair-usage-costs -- --rows <id,id>  # recovery
 *   npm --prefix apps/api run repair-usage-costs -- --allow-fallback-price
 */
import { PrismaClient } from '@prisma/client';
import { AiSpendService } from '../ai/ai-spend.service';

/** One row, reduced to what the repair decision needs. */
export interface RepairableRow {
  id: string;
  aiModel: string;
  inputTokens: number;
  outputTokens: number;
}

export interface RepairPlan<T extends RepairableRow> {
  /** Model resolves to a real PRICE_TABLE entry — safe to write. */
  priced: T[];
  /** No entry: pricing these would use FALLBACK and overstate them. */
  unpriced: T[];
  /** What would actually be written, given `allowFallback`. */
  willWrite: T[];
  /** Cost to be written per row id. */
  costs: Map<string, number>;
  totalUsd: number;
}

/**
 * Decide what to repair. Pure, so the money decision is testable without a
 * database — the objection to putting this in an untested script was never
 * only about the price table.
 *
 * ⚠️ `hasPriceEntry` is the whole reason this lives in the TS project. It
 * cannot be answered from outside `AiSpendService`: `FALLBACK_PRICE` is not
 * exported, and comparing VALUES is actively wrong, being byte-identical to the
 * `claude-opus` entries — a value check would report the most expensive REAL
 * models as unpriced and skip exactly the rows most worth repairing.
 */
export function planRepair<T extends RepairableRow>(
  rows: T[],
  pricer: Pick<AiSpendService, 'hasPriceEntry' | 'estimateCostUsd'>,
  opts: { allowFallback?: boolean } = {},
): RepairPlan<T> {
  const priced: T[] = [];
  const unpriced: T[] = [];
  for (const r of rows) (pricer.hasPriceEntry(r.aiModel) ? priced : unpriced).push(r);

  const willWrite = opts.allowFallback ? [...priced, ...unpriced] : priced;
  const costs = new Map<string, number>();
  let totalUsd = 0;
  for (const r of willWrite) {
    // Rounded to 6dp, matching `priceOrZero` and what the Decimal(10,6) column
    // stores — so a repaired row is byte-comparable with a freshly written one.
    const c =
      Math.round(
        pricer.estimateCostUsd(r.aiModel, {
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
        }) * 1_000_000,
      ) / 1_000_000;
    costs.set(r.id, c);
    totalUsd += c;
  }
  return { priced, unpriced, willWrite, costs, totalUsd };
}

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const val = (f: string): string | undefined => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** Rows are updated one at a time — `updateMany` cannot set a per-row computed
 *  value. O(rows), which is fine at the scale this exists for; the cap keeps a
 *  mistake bounded rather than being a performance concern. */
const DEFAULT_MAX_ROWS = 5000;
const maxRows = (v: string | undefined): number => {
  const n = v === undefined ? DEFAULT_MAX_ROWS : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_ROWS;
};

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is not set. Point it at the target database.');
    process.exit(1);
  }
  let host = '(unparseable)';
  try {
    host = new URL(dbUrl).host;
  } catch {
    /* keep the placeholder */
  }
  console.log(`database: ${host}`);

  // ⚠️ The wrong-database guard, validated UP FRONT rather than just before the
  // write. Placed late it would not run when the query matches nothing, so a
  // mistyped target would look like success. DATABASE_URL is usually AMBIENT (a
  // shell profile sets it), so "is it set" proves nothing about WHICH database
  // it names.
  if (has('execute')) {
    const target = val('target');
    if (!target) {
      console.error(`\n--execute requires --target <substring of "${host}"> as a deliberate confirmation.`);
      process.exit(1);
    }
    if (!host.includes(target)) {
      console.error(`\nREFUSED — --target "${target}" does not appear in the host "${host}".`);
      console.error('That mismatch is the wrong-database case this check exists for.');
      process.exit(1);
    }
  }

  const rowsFlag = val('rows');
  const ids = rowsFlag ? rowsFlag.split(',').map((s) => s.trim()).filter(Boolean) : null;

  // ⚠️ `hasPriceEntry` is why this is not a `.mjs` script. It cannot be answered
  // from outside the service: `FALLBACK_PRICE` is not exported, and comparing
  // VALUES is actively wrong — it is byte-identical to the `claude-opus` entries,
  // so a value check would report the most expensive REAL models as unpriced and
  // skip exactly the rows most worth repairing.
  //
  // The constructor deps are unused by the three pricing methods (verified), so
  // they are not wired.
  const pricer = new AiSpendService(null as never, null as never);
  const prisma = new PrismaClient();

  try {
    const where = ids
      ? { id: { in: ids } }
      : { costUsd: 0, OR: [{ inputTokens: { gt: 0 } }, { outputTokens: { gt: 0 } }] };

    console.log(
      ids
        ? `mode:     --rows (recovery — ${ids.length} explicit id(s))`
        : 'mode:     $0 rows with real tokens',
    );

    // ⚠️ Count the MATCHING rows, not the table. An earlier version reported
    // `rows.length` against the table total, so a batch truncated by `take`
    // read as "matched 5000 of 120000" — and the operator, seeing
    // "repaired: 5000", would believe the job was done while rows stayed
    // broken with no signal. On a ONE-WAY write that is the worst kind of
    // quiet: a silent cap reads as complete coverage.
    const matching = await prisma.aIUsageLog.count({ where });
    const rows = await prisma.aIUsageLog.findMany({
      where,
      select: { id: true, aiModel: true, inputTokens: true, outputTokens: true },
      take: maxRows(val('max-rows')),
      orderBy: { createdAt: 'asc' },   // stable, so a re-run resumes predictably
    });
    console.log(`matched:  ${matching} row(s)`);
    if (matching > rows.length) {
      console.log(`⚠️ TRUNCATED — this run covers ${rows.length} of them (--max-rows ${maxRows(val('max-rows'))}).`);
      console.log(`   ${matching - rows.length} will remain. Re-run to continue; the predicate still`);
      console.log('   reaches them because an unrepaired row is still $0.');
    }
    if (!rows.length) {
      console.log('\nNothing to do.');
      return;
    }

    // ⚠️ Partition BEFORE writing. `priceFor` bills an unrecognised model at
    // FALLBACK_PRICE ($15/$75) so the BREAKER errs toward tripping early — a
    // bias that is right for a breaker and simply wrong for a one-way reporting
    // repair, where it would permanently overstate the row.
    const plan = planRepair(rows, pricer, { allowFallback: has('allow-fallback-price') });
    const { priced, unpriced, willWrite, costs } = plan;
    const costOf = (r: (typeof rows)[number]) => costs.get(r.id) ?? 0;

    console.log(`priced:   ${priced.length} rows → $${plan.totalUsd.toFixed(6)} total`);
    console.log(`unpriced: ${unpriced.length} rows (model not in PRICE_TABLE)`);

    for (const r of priced.slice(0, 3)) {
      console.log(`  ${r.aiModel}  in=${r.inputTokens} out=${r.outputTokens}  $0 → $${costOf(r).toFixed(6)}`);
    }
    if (unpriced.length) {
      console.log('\n  ⚠️ SKIPPED — no PRICE_TABLE entry, so pricing them would use the');
      console.log('     most-expensive fallback rate and overstate them irreversibly:');
      for (const [m, n] of Object.entries(
        unpriced.reduce<Record<string, number>>((a, r) => ((a[r.aiModel] = (a[r.aiModel] ?? 0) + 1), a), {}),
      )) {
        console.log(`       ${String(n).padStart(5)}  ${m}`);
      }
      console.log('     Add the model to PRICE_TABLE and re-run — these rows are');
      console.log('     untouched at $0, so the predicate still reaches them.');
    }

    if (has('allow-fallback-price') && unpriced.length) {
      console.log(`\n  ⚠️ --allow-fallback-price: the ${unpriced.length} skipped rows WILL be written`);
      console.log('     at the most expensive known rate. This is irreversible.');
    }

    if (!has('execute')) {
      console.log(`\nDRY RUN — nothing written.`);
      console.log(`To repair these ${willWrite.length} rows:  --execute --target <part of "${host}">`);
      console.log('⚠️ Read the numbers above first. A repaired row stops matching the');
      console.log('   predicate, so a wrong run is not fixable in bulk — only via --rows.');
      return;
    }

    // ⚠️ One row at a time — `updateMany` cannot set a per-row computed value.
    // O(rows), which is the point of the cap above rather than a perf concern.
    //
    // ⚠️ If a write throws mid-loop, report how far it got BEFORE rethrowing.
    // The run is one-way and partially applied, so "which rows are done" is the
    // only thing the operator needs; a bare stack trace does not say.
    let written = 0;
    try {
      for (const r of willWrite) {
        await prisma.aIUsageLog.update({ where: { id: r.id }, data: { costUsd: costOf(r) } });
        written++;
      }
    } catch (err) {
      console.error(`\n⚠️ FAILED after repairing ${written} of ${willWrite.length} rows.`);
      console.error('   The repaired ones now have costUsd > 0 and no longer match the');
      console.error('   predicate; the rest are untouched at $0, so a re-run continues.');
      throw err;
    }
    console.log(`\nrepaired: ${written} rows`);
    console.log(`skipped:  ${rows.length - written} rows`);
    if (matching > rows.length) {
      console.log(`remaining: ${matching - rows.length} matched rows NOT covered by this run — re-run.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
