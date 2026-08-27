import { ConsoleLogger } from '@nestjs/common';

/**
 * Drops Nest's per-route boot chatter, and nothing else.
 *
 * Nest logs one line per mapped route at startup. With 105 routes across 15
 * controllers that is ~140 lines — `[RouterExplorer]`, `[RoutesResolver]` and
 * `[InstanceLoader]` — before the handful that carry information.
 *
 * They describe STATIC FACTS about the code, not runtime state: `/api/bazi/
 * readings` was mapped, and it will be mapped on every boot forever. Nothing
 * there is actionable.
 *
 * The cost is not volume, it is burial. The lines you actually watch for are
 * single lines by design — `Prisma pool — connection_limit=…`, a
 * `Connection budget:` warning, and above all M6's
 *
 *     SIGTERM received — draining (N active stream(s))
 *     Drain complete in Nms — closing server
 *
 * which arrive during a deploy INTERLEAVED with the replacement container's
 * ~140 startup lines. The two lines that say whether graceful shutdown worked
 * are the ones most likely to scroll past unread.
 *
 * ⚠️ Only the `log` level is filtered, and only for those three contexts. A
 * WARN or ERROR from any of them still prints — the point is to remove a known
 * inventory, not to make a subsystem silent.
 *
 * Set `LOG_ROUTES=1` to get the full output back when confirming a route
 * actually mounted.
 */
export class QuietBootstrapLogger extends ConsoleLogger {
  /**
   * Nest's boot-time inventory contexts. Deliberately an explicit list rather
   * than a pattern: a new noisy context should have to be added on purpose,
   * and a renamed one should show up again rather than stay hidden.
   */
  private static readonly INVENTORY_CONTEXTS: ReadonlySet<string> = new Set([
    'RouterExplorer',
    'RoutesResolver',
    'InstanceLoader',
  ]);

  log(message: unknown, ...rest: unknown[]): void {
    if (QuietBootstrapLogger.isInventoryLine(rest)) return;
    (super.log as (m: unknown, ...r: unknown[]) => void)(message, ...rest);
  }

  /**
   * Nest passes the context as the LAST argument, so that is where to look.
   * Anything without a recognised trailing context string is someone else's
   * log and passes through untouched.
   */
  private static isInventoryLine(rest: unknown[]): boolean {
    if (routeLoggingEnabled()) return false;
    const context = rest.length > 0 ? rest[rest.length - 1] : undefined;
    return typeof context === 'string' && QuietBootstrapLogger.INVENTORY_CONTEXTS.has(context);
  }
}

/** Read at call time so a test can flip it without reloading the module. */
export function routeLoggingEnabled(): boolean {
  const raw = (process.env.LOG_ROUTES ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
