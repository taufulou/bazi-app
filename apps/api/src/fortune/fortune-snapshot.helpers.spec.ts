/**
 * Unit tests for FortuneSnapshotHelpers.checkEnergyLabelDivergence — the L5
 * post-deploy safeguard that canaries engine label↔energyScore desync.
 *
 * The method is pure (uses only this.logger + Sentry + the module midpoint
 * const), so we new up the helper with stub deps. Sentry is mocked so we can
 * assert the anomaly path fires captureMessage (in a real test env with no
 * SENTRY_DSN it would no-op anyway).
 */
jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
import * as Sentry from '@sentry/nestjs';
import {
  FortuneSnapshotHelpers,
  ENERGY_LABEL_DIVERGENCE_THRESHOLD,
} from './fortune-snapshot.helpers';

describe('FortuneSnapshotHelpers.checkEnergyLabelDivergence', () => {
  let helpers: FortuneSnapshotHelpers;

  beforeEach(() => {
    jest.clearAllMocks();
    // Method touches no DB/Redis — pass minimal stubs. ConfigService.get is
    // called once in the constructor for BAZI_ENGINE_URL (returns undefined → default).
    const cfg = { get: () => undefined } as any;
    helpers = new FortuneSnapshotHelpers({} as any, {} as any, cfg);
  });

  it('no anomaly when energyScore exactly matches the label midpoint', () => {
    const r = helpers.checkEnergyLabelDivergence('day', 42, '凶中有吉'); // midpoint 42
    expect(r.anomaly).toBe(false);
    expect(r.diff).toBe(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('no anomaly when within threshold', () => {
    const r = helpers.checkEnergyLabelDivergence('month', 52, '平'); // midpoint 50, diff 2
    expect(r.anomaly).toBe(false);
    expect(r.diff).toBe(2);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('boundary: diff exactly == threshold is NOT an anomaly (strict >)', () => {
    const r = helpers.checkEnergyLabelDivergence('day', 60, '平'); // midpoint 50, diff 10 == threshold
    expect(r.diff).toBe(ENERGY_LABEL_DIVERGENCE_THRESHOLD);
    expect(r.anomaly).toBe(false);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('anomaly + Sentry alert when divergence exceeds threshold', () => {
    const r = helpers.checkEnergyLabelDivergence('year', 88, '凶'); // midpoint 25, diff 63
    expect(r.anomaly).toBe(true);
    expect(r.diff).toBe(63);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [, ctx] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(ctx.level).toBe('warning');
    expect(ctx.tags).toMatchObject({ feature: 'fortune', scope: 'year', anomaly: 'score_divergence' });
  });

  it('anomaly + Sentry alert when the label is unknown (not in midpoint table)', () => {
    const r = helpers.checkEnergyLabelDivergence('day', 50, '未知標籤');
    expect(r.anomaly).toBe(true);
    expect(r.diff).toBeNull();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [, ctx] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(ctx.tags).toMatchObject({ anomaly: 'unknown_label' });
  });
});
