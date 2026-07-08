/**
 * Dev-only console warning for a dashboard feature that silently degrades when a
 * backend service is unreachable (credit badge, banner, daily-fortune card, …).
 *
 * These features intentionally degrade gracefully in production (render nothing /
 * fall back) so a downed service is invisible — which makes a not-started service
 * look like a bug during local development. This surfaces a clear, actionable hint
 * in the browser console naming the likely-down service.
 *
 * No-op unless `NODE_ENV === 'development'` — an allow-list, so it stays silent in
 * both production (graceful degradation preserved) and tests (`NODE_ENV=test`).
 */
export function devWarnServiceDown(feature: string, hint: string, err?: unknown): void {
  if (process.env.NODE_ENV !== 'development') return;
  // eslint-disable-next-line no-console
  console.warn(`[dev] ${feature} unavailable — ${hint}`, err ?? '');
}
