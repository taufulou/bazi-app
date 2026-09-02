/**
 * Purge the `ai_usage_log` rows a load test fabricated.
 *
 * ## Why this exists (#17)
 *
 * `AIUsageLog.userId` and `.readingId` are both `onDelete: SetNull`, and
 * `erasePersonalData` deliberately does NOT touch the table. Deleting the 103
 * load-test accounts therefore nulled the pointers and left 1,383 usage rows in
 * production, which is what made `/admin/ai-costs` report $0.04 total and
 * $0.0000 average per reading over 30 days.
 *
 * ⚠️ The retention policy is CORRECT and is not what this changes. The table
 * holds no personal data — tokens, cost, latency, model — so once `user_id` is
 * nulled the row is an anonymous cost aggregate, in the same class as
 * `Transaction` and `CreditLedger`, which are deliberately retained. Deleting
 * it on account deletion would destroy real billing history.
 *
 * What was missing is that a LOAD TEST produces fabrications rather than
 * history, and its teardown had no step for them. This is that step.
 *
 * ## Safety
 *
 * - **Dry run by default.** `--execute` is required to delete anything.
 * - **Never unscoped.** Both predicates are bounded; the script refuses to
 *   build a statement without a window or an explicit id list.
 * - ⚠️ `user_id IS NULL` ALONE IS NOT SAFE. A genuine user's rows also go NULL
 *   when they delete their account, so the time window is what separates a
 *   fabrication from a real deleted customer's cost history.
 * - It prints the TOKEN SHAPE before deleting. Mock rows carry absurd counts
 *   (`MOCK_USAGE_SCALE=0.01` produced ~208 average input tokens where a real
 *   LIFETIME call is ~22,000), so the operator can see what they are removing
 *   instead of trusting the predicate.
 *
 * ## Usage
 *
 *   node load-test/purge-usage-log.mjs                        # dry run
 *   node load-test/purge-usage-log.mjs --execute --target railway
 *   node load-test/purge-usage-log.mjs --by-ids               # precise; BEFORE deletion
 *   node load-test/purge-usage-log.mjs --until 2026-09-01T00:00:00Z
 *
 * Needs `DATABASE_URL` pointing at the target database.
 *
 * ⚠️ `--execute` also requires `--target <substring>`, which must appear in the
 * resolved host. Found by testing: `DATABASE_URL` is commonly set AMBIENTLY by
 * a shell profile, so a "did you set it?" check never fires and the script
 * would silently purge whichever database happened to be configured — local
 * when you meant production, or the reverse. Naming the target makes hitting
 * the wrong database an explicit act rather than an accident.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** A real LIFETIME call is ~22,000 input tokens; the mock ran at 0.01 scale. */
const FABRICATION_INPUT_TOKEN_CEILING = 2000;
/** The load test ran within a day. Bounding tightly beats trusting `IS NULL`. */
const DEFAULT_WINDOW_HOURS = 24;

function loadManifest() {
  const path = join(HERE, 'seed-manifest.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`Cannot read ${path}: ${e.message}`);
    console.error('Without it there is no run window, and an unscoped delete is refused.');
    process.exit(1);
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is not set. Point it at the target database.');
    process.exit(1);
  }
  // Show WHICH database, always — a destructive tool must never leave this to
  // inference. `DATABASE_URL` is frequently ambient.
  let host = '(unparseable)';
  try { host = new URL(dbUrl).host; } catch { /* keep the placeholder */ }
  console.log(`database: ${host}`);

  // ⚠️ The wrong-database guard, validated UP FRONT rather than just before the
  // delete. Placed late it never ran when the query matched nothing, so a
  // mistyped target looked like success — and argument validation that only
  // fires on the happy path is not validation.
  //
  // DATABASE_URL is usually AMBIENT (a shell profile sets it), so "is it set"
  // proves nothing about WHICH database it names. Naming the target makes
  // hitting the wrong one a deliberate act.
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
  const manifest = loadManifest();
  const from = new Date(manifest.createdAt);
  if (Number.isNaN(from.getTime())) {
    console.error(`manifest.createdAt is not a date: ${manifest.createdAt}`);
    process.exit(1);
  }
  const until = val('until')
    ? new Date(val('until'))
    : new Date(from.getTime() + DEFAULT_WINDOW_HOURS * 3600_000);
  if (Number.isNaN(until.getTime()) || until <= from) {
    console.error('--until must be a date AFTER the manifest window start.');
    process.exit(1);
  }

  const byIds = has('by-ids');
  const dbUserIds = (manifest.users ?? []).map((u) => u.dbUserId).filter(Boolean);
  if (byIds && !dbUserIds.length) {
    console.error('--by-ids needs dbUserId values in the manifest; none found.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    // ⚠️ Two predicates, and WHICH ONE depends on whether the accounts still
    // exist. `--by-ids` is precise but only works BEFORE the deletes null the
    // pointers; after that the time window is all that is left.
    const where = byIds
      ? { userId: { in: dbUserIds } }
      : { userId: null, createdAt: { gte: from, lte: until } };

    console.log(`mode:     ${byIds ? '--by-ids (precise, pre-deletion)' : 'post-hoc window'}`);
    if (!byIds) console.log(`window:   ${from.toISOString()} .. ${until.toISOString()}`);
    else console.log(`ids:      ${dbUserIds.length} seeded dbUserIds`);

    const [matched, agg, total] = await Promise.all([
      prisma.aIUsageLog.count({ where }),
      prisma.aIUsageLog.aggregate({
        where,
        _sum: { inputTokens: true, outputTokens: true },
        _avg: { inputTokens: true },
      }),
      prisma.aIUsageLog.count(),
    ]);

    console.log(`matched:  ${matched} of ${total} rows in the table`);
    if (!matched) { console.log('\nNothing to do.'); return; }

    const avgIn = Math.round(agg._avg.inputTokens ?? 0);
    console.log(`tokens:   ${agg._sum.inputTokens ?? 0} in / ${agg._sum.outputTokens ?? 0} out, avg input ${avgIn}`);
    console.log(
      avgIn <= FABRICATION_INPUT_TOKEN_CEILING
        ? `          ✅ consistent with MOCK_USAGE_SCALE fabrications (a real LIFETIME call is ~22,000)`
        : `          ⚠️  avg input ${avgIn} looks like REAL traffic, not a mock. Check the window before executing.`,
    );

    // Show a couple of rows so the operator sees the thing itself.
    const sample = await prisma.aIUsageLog.findMany({
      where, take: 3, orderBy: { createdAt: 'asc' },
      select: { createdAt: true, readingType: true, aiModel: true, inputTokens: true, outputTokens: true, costUsd: true },
    });
    console.log('\nsample:');
    for (const r of sample) {
      console.log(`  ${r.createdAt.toISOString()}  ${r.readingType ?? '-'}  ${r.aiModel}  ` +
                  `in=${r.inputTokens} out=${r.outputTokens} $${r.costUsd}`);
    }

    if (!has('execute')) {
      console.log(`\nDRY RUN — nothing deleted.`);
      console.log(`To remove these ${matched} rows:  --execute --target <part of "${host}">`);
      return;
    }

    const { count } = await prisma.aIUsageLog.deleteMany({ where });
    const remaining = await prisma.aIUsageLog.count();
    console.log(`\ndeleted:  ${count}`);
    console.log(`remaining in table: ${remaining}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
