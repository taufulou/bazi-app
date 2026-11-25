/**
 * One wording for the paid memberships everywhere (App Store plan step 0.10,
 * owner decision 2026-11-21): 基礎會員 / 專業會員 / 大師會員.
 *
 * Before this they disagreed across five places (基本 / 基本方案 / Basic 方案 /
 * 基礎版 / 基礎會員), and App Store product names are hard to change once
 * reviewed. This pins every copy — web, mobile, the seed, and the newest
 * migration that sets the production `plans` rows (which also name the Stripe
 * checkout product) — and fails on the old wordings.
 *
 * Lives in apps/api because this suite runs in CI on every PR.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const EXPECTED = { BASIC: '基礎會員', PRO: '專業會員', MASTER: '大師會員' } as const;
const EXPECTED_CN = { basic: '基础会员', pro: '专业会员', master: '大师会员' } as const;
const SLUG = { BASIC: 'basic', PRO: 'pro', MASTER: 'master' } as const;
type Tier = keyof typeof EXPECTED;
const TIERS = Object.keys(EXPECTED) as Tier[];

/** `BASIC: '基礎會員'` (either quote style) in a source file. */
function tierLiteral(src: string, tier: Tier): string | undefined {
  return src.match(new RegExp(`\\b${tier}:\\s*['"]([^'"]+)['"]`))?.[1];
}

describe('paid membership names', () => {
  it('web: the shared constant', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const web = require(join(ROOT, 'apps/web/app/lib/tier-names.ts')) as { PAID_TIER_NAMES: Record<Tier, string> };
    expect(web.PAID_TIER_NAMES).toEqual(EXPECTED);
  });

  it('mobile: the badge labels (also used by 我的 and the store screen)', () => {
    const src = read('apps/mobile/src/components/home/CreditBadge.tsx');
    for (const t of TIERS) expect(tierLiteral(src, t)).toBe(EXPECTED[t]);
  });

  it('seed: the plans rows a fresh database gets', () => {
    const src = read('apps/api/prisma/seed.ts');
    for (const t of TIERS) {
      const row = src.match(new RegExp(`slug: '${SLUG[t]}', nameZhTw: '([^']+)', nameZhCn: '([^']+)'`));
      expect(row?.[1]).toBe(EXPECTED[t]);
      expect(row?.[2]).toBe(EXPECTED_CN[SLUG[t]]);
    }
  });

  it('production: the newest migration that renames the plans rows', () => {
    const dir = join(ROOT, 'apps/api/prisma/migrations');
    const renames = readdirSync(dir)
      .filter((d) => !d.endsWith('.toml'))
      .sort()
      .map((d) => read(relative(ROOT, join(dir, d, 'migration.sql'))))
      .filter((sql) => /UPDATE "plans" SET "name_zh_tw"/.test(sql));
    expect(renames.length).toBeGreaterThan(0);
    const latest = renames[renames.length - 1];
    for (const t of TIERS) {
      expect(latest).toMatch(
        new RegExp(`"name_zh_tw" = '${EXPECTED[t]}', "name_zh_cn" = '${EXPECTED_CN[SLUG[t]]}'[^;]*"slug" = '${SLUG[t]}'`),
      );
    }
  });

  it('no old wording is left in the web or mobile app', () => {
    const OLD = /基本方案|專業方案|大師方案|Basic 方案|Pro 方案|Master 方案|基礎版|專業版|大師版|BASIC:\s*['"]基本['"]|PRO:\s*['"]專業['"]|MASTER:\s*['"]大師['"]/;
    const offenders: string[] = [];
    const walk = (rel: string) => {
      for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
        const p = `${rel}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '__tests__') continue;
          walk(p);
        } else if (/\.(tsx?|jsx?)$/.test(e.name) && OLD.test(read(p))) {
          offenders.push(p);
        }
      }
    };
    walk('apps/web/app');
    walk('apps/mobile/src');
    expect(offenders).toEqual([]);
  });
});
