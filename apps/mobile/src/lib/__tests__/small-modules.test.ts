/** 1C — account display, store rows, links and Sentry options. */
import { accountDisplayName, accountEmailLabel, isAppleRelayEmail } from '../account-display';
import { monthlyCreditsFor, periodLabel, periodSuffix } from '../store-products';
import { PRIVACY_URL, SITE_HOST, SITE_URL, SUPPORT_MAILTO, TERMS_URL } from '../links';
import { sentryInitOptions } from '../sentry-options';
import { REDACTED } from '../sentry-scrub';

describe('account display', () => {
  it('hides an Apple relay address', () => {
    expect(isAppleRelayEmail('abc123@privaterelay.appleid.com')).toBe(true);
    expect(isAppleRelayEmail('ABC@PRIVATERELAY.APPLEID.COM')).toBe(true);
    expect(accountEmailLabel('abc123@privaterelay.appleid.com')).toBe('已隱藏的 Apple 電子郵件');
    expect(accountEmailLabel('roger@example.com')).toBe('roger@example.com');
    expect(accountEmailLabel(undefined)).toBe('');
  });
  it('falls back to 會員 for a missing or blank name', () => {
    expect(accountDisplayName(undefined)).toBe('會員');
    expect(accountDisplayName('  ')).toBe('會員');
    expect(accountDisplayName('小明')).toBe('小明');
  });
});

describe('store rows', () => {
  it('credits per month for the mapped App Store products, nothing for others', () => {
    expect(monthlyCreditsFor('com.tianming.app.basic.monthly')).toBe(5);
    expect(monthlyCreditsFor('com.tianming.app.pro.monthly')).toBe(15);
    expect(monthlyCreditsFor('com.tianming.app.master.monthly')).toBe(50);
    expect(monthlyCreditsFor('tianming_pro_monthly:android')).toBeNull();
  });
  it('period labels', () => {
    expect(periodSuffix('P1M')).toBe('／月');
    expect(periodLabel('P1M')).toBe('每月自動續訂');
    expect(periodSuffix(undefined)).toBe('');
    expect(periodLabel('P2W')).toBe('自動續訂');
  });
});

describe('links', () => {
  it('all on tianmingapp.com', () => {
    for (const u of [SITE_URL, PRIVACY_URL, TERMS_URL]) expect(new URL(u).host).toBe('tianmingapp.com');
    expect(SITE_HOST).toBe('tianmingapp.com');
    expect(SUPPORT_MAILTO).toBe('mailto:TAPPER.FUN@gmail.com');
  });
});

describe('sentryInitOptions', () => {
  const o = sentryInitOptions('https://k@o.ingest.sentry.io/1');
  it('carries every privacy setting', () => {
    expect(o.sendDefaultPii).toBe(false);
    expect(o.attachScreenshot).toBe(false);
    expect(o.attachViewHierarchy).toBe(false);
    expect(o.tracesSampleRate).toBe(0.1);
  });
  it('scrubs events, transactions and breadcrumbs', () => {
    const ev = o.beforeSend({ extra: { fourPillars: { day: '甲子' }, birthDate: '1987-09-06' } }) as {
      extra: Record<string, unknown>;
    };
    expect(ev.extra.fourPillars).toBe(REDACTED);
    expect(ev.extra.birthDate).toBe(REDACTED);
    const tx = o.beforeSendTransaction({ contexts: { chart: { a: 1 } } }) as { contexts: Record<string, unknown> };
    expect(tx.contexts.chart).toBe(REDACTED);
    const bc = o.beforeBreadcrumb({ message: 'day 甲子 born 1987-09-06', data: { email: 'a@b.co' } }) as {
      message: string;
      data: Record<string, unknown>;
    };
    expect(bc.message).not.toMatch(/甲子|1987-09-06/);
    expect(bc.data.email).toBe(REDACTED);
  });
});

describe('enterApp', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { enterApp, APP_HOME } = require('../enter-app') as typeof import('../enter-app');
  it('dismisses the auth modals BEFORE entering, so the app shell is not a modal', () => {
    const calls: string[] = [];
    const router = {
      canDismiss: () => true,
      dismissAll: () => calls.push('dismissAll'),
      replace: (h: string) => calls.push(`replace:${h}`),
    };
    enterApp(router as never);
    expect(calls).toEqual(['dismissAll', `replace:${APP_HOME}`]);
  });
  it('nothing to dismiss → just enters', () => {
    const calls: string[] = [];
    enterApp({ canDismiss: () => false, dismissAll: () => calls.push('dismissAll'), replace: () => calls.push('replace') } as never);
    expect(calls).toEqual(['replace']);
  });
});
