/**
 * Should this process publish the OpenAPI document?
 *
 * ## Why this is a module and not two lines in `main.ts`
 *
 * It has been wrong twice, in the same direction, and both times the mistake
 * was invisible in review:
 *
 * 1. `NODE_ENV !== 'production'` — fails OPEN. An unset `NODE_ENV` publishes
 *    the entire API surface. It was held shut only by `ENV NODE_ENV=production`
 *    in `docker/Dockerfile.api`, and no `railway.json` pins that Dockerfile as
 *    the builder.
 * 2. `ENABLE_SWAGGER === 'true' || NODE_ENV === 'development'` — the "fix",
 *    which fails open through a different door. `app.module.ts` validates
 *    config with
 *    `NODE_ENV: Joi.string().valid(...).default('development')`, and
 *    `@nestjs/config` writes validated values BACK into `process.env`. The gate
 *    runs after `NestFactory.create`, so on a host with no `NODE_ENV` the value
 *    it reads is not `undefined` — it is `'development'`. Same exposure, same
 *    deployment shape, new spelling.
 *
 * ## The rule that follows
 *
 * ⚠️ This function must NEVER read `NODE_ENV`. Not because `NODE_ENV` is wrong
 * in principle, but because in this application it is no longer host-controlled
 * by the time anyone can read it — Joi supplies a value when the host does not.
 * An explicit opt-in variable has no default anywhere, so absence means absence.
 *
 * Local development keeps its docs via `ENABLE_SWAGGER=true` in
 * `apps/api/.env`, which is both gitignored and dockerignored and therefore
 * cannot reach a deployed image.
 *
 * ## What this is no longer load-bearing for
 *
 * It used to be the sole mitigation for an accepted advisory — `@nestjs/swagger`
 * pins `js-yaml` at an exact vulnerable version, and I recorded that npm could
 * not override a package nested inside a workspace. That was wrong: the
 * parent-scoped override works once `npm update @nestjs/swagger` forces the
 * subtree to re-resolve, and the advisory is now gone rather than accepted.
 * The gate stands on its own merits — an unauthenticated map of every endpoint
 * is worth withholding regardless of what it transitively depends on.
 *
 * ⚠️ OPERATIONAL NOTE for that override, which has nowhere better to live:
 * `@nestjs/swagger` depends on `js-yaml` at an EXACT version, so only a
 * parent-scoped `overrides` entry in the root package.json can reach the
 * patched 5.3.0. Editing it requires `npm update @nestjs/swagger` afterwards —
 * a plain `npm install` reuses the lockfile and ignores the new override
 * silently, reporting success either way. Verify with:
 *   node -p "require('./node_modules/@nestjs/swagger/node_modules/js-yaml/package.json').version"
 * This warning used to be a `_comment` key inside the override object itself,
 * which broke `npm ci` outright: npm reads every key in a nested override as a
 * package name, so `Override without name: _comment` failed the install before
 * any work began. JSON has no comment syntax that survives there.
 */

/** Accepted spellings of yes. Operators write `1` and `yes`, not only `true`. */
const TRUTHY = new Set(['true', '1', 'yes', 'on']);

export function isSwaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ENABLE_SWAGGER;
  if (typeof raw !== 'string') return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
