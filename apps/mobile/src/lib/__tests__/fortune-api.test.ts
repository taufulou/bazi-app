import {
  resolveBaziToday,
  civilTodayTaipei,
  addDaysIso,
  diffDaysIso,
  isDateInSubscriberWindow,
  moodKeywordFromLabel,
  tierOf,
  addMonthsIso,
  diffMonthsIso,
  isMonthInSubscriberWindow,
  resolveCurrentMonthIso,
  resolveCurrentYearIso,
  isYearInSubscriberWindow,
} from '../fortune-api';

// Pure-helper port lock. Node's Intl has full timezone data (Asia/Taipei), so
// the boundary math is testable here. On-device Hermes Intl support is verified
// in M2.3 (resolveBaziToday drives the fortune tab's first render).

describe('resolveBaziToday — 23:00 子時 boundary in Asia/Taipei (UTC+8)', () => {
  it('before 23:00 Taipei → same calendar day', () => {
    // UTC 14:00 = Taipei 22:00 on 2026-07-12
    expect(resolveBaziToday(new Date('2026-07-12T14:00:00Z'))).toBe('2026-07-12');
  });

  it('at/after 23:00 Taipei → rolls forward to next day', () => {
    // UTC 15:30 = Taipei 23:30 on 2026-07-12 → Bazi day is 2026-07-13
    expect(resolveBaziToday(new Date('2026-07-12T15:30:00Z'))).toBe('2026-07-13');
  });

  it('past midnight Taipei → the new calendar day', () => {
    // UTC 16:30 = Taipei 00:30 on 2026-07-13
    expect(resolveBaziToday(new Date('2026-07-12T16:30:00Z'))).toBe('2026-07-13');
  });

  it('rolls across month + year boundaries at 子時', () => {
    // UTC 2026-12-31T15:30 = Taipei 2026-12-31 23:30 → 2027-01-01
    expect(resolveBaziToday(new Date('2026-12-31T15:30:00Z'))).toBe('2027-01-01');
  });
});

describe('civilTodayTaipei — un-rolled Taipei date', () => {
  it('stays on the civil day during the 子時 window (unlike resolveBaziToday)', () => {
    const now = new Date('2026-07-12T15:30:00Z'); // Taipei 23:30
    expect(civilTodayTaipei(now)).toBe('2026-07-12');
    expect(resolveBaziToday(now)).toBe('2026-07-13');
  });
});

describe('day arithmetic', () => {
  it('addDaysIso adds + subtracts across month boundary', () => {
    expect(addDaysIso('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDaysIso('2026-08-01', -1)).toBe('2026-07-31');
    expect(addDaysIso('2026-07-12', 30)).toBe('2026-08-11');
  });

  it('diffDaysIso returns signed whole-day difference', () => {
    expect(diffDaysIso('2026-07-20', '2026-07-12')).toBe(8);
    expect(diffDaysIso('2026-07-11', '2026-07-12')).toBe(-1);
    expect(diffDaysIso('2026-07-12', '2026-07-12')).toBe(0);
  });
});

describe('isDateInSubscriberWindow — day scope', () => {
  const today = '2026-07-12';
  it('FREE: current day only', () => {
    expect(isDateInSubscriberWindow('2026-07-12', today, 'FREE')).toBe(true);
    expect(isDateInSubscriberWindow('2026-07-13', today, 'FREE')).toBe(false);
    expect(isDateInSubscriberWindow('2026-07-11', today, 'FREE')).toBe(false);
  });
  it('undefined tier behaves like FREE', () => {
    expect(isDateInSubscriberWindow('2026-07-13', today, undefined)).toBe(false);
  });
  it('PRO: yesterday + today + next 30 days', () => {
    expect(isDateInSubscriberWindow('2026-07-11', today, 'PRO')).toBe(true); // -1
    expect(isDateInSubscriberWindow('2026-08-11', today, 'PRO')).toBe(true); // +30
    expect(isDateInSubscriberWindow('2026-08-12', today, 'PRO')).toBe(false); // +31
    expect(isDateInSubscriberWindow('2026-07-10', today, 'PRO')).toBe(false); // -2
  });
});

describe('label → mood/tier maps', () => {
  it('moodKeywordFromLabel covers all 9 labels + fallback', () => {
    expect(moodKeywordFromLabel('大吉')).toBe('今日順遂');
    expect(moodKeywordFromLabel('凶上加凶')).toBe('今日大忌');
    expect(moodKeywordFromLabel('unknown')).toBe('今日平穩');
  });
  it('tierOf classifies positive/neutral/negative', () => {
    expect(tierOf('大吉')).toBe('positive');
    expect(tierOf('吉中有凶')).toBe('positive');
    expect(tierOf('平')).toBe('neutral');
    expect(tierOf('凶中有吉')).toBe('neutral');
    expect(tierOf('凶')).toBe('negative');
    expect(tierOf('大凶')).toBe('negative');
  });
});

describe('month arithmetic + window', () => {
  it('addMonthsIso handles year boundary both directions', () => {
    expect(addMonthsIso('2026-12', 1)).toBe('2027-01');
    expect(addMonthsIso('2026-01', -1)).toBe('2025-12');
    expect(addMonthsIso('2026-07', 12)).toBe('2027-07');
  });
  it('diffMonthsIso returns signed whole-month difference', () => {
    expect(diffMonthsIso('2027-07', '2026-07')).toBe(12);
    expect(diffMonthsIso('2026-06', '2026-07')).toBe(-1);
  });
  it('isMonthInSubscriberWindow: PRO -1 / current / +12', () => {
    const cur = '2026-07';
    expect(isMonthInSubscriberWindow('2026-06', cur, 'PRO')).toBe(true);
    expect(isMonthInSubscriberWindow('2027-07', cur, 'PRO')).toBe(true);
    expect(isMonthInSubscriberWindow('2027-08', cur, 'PRO')).toBe(false);
    expect(isMonthInSubscriberWindow('2026-08', cur, 'FREE')).toBe(false);
    expect(isMonthInSubscriberWindow('2026-07', cur, 'FREE')).toBe(true);
  });
  it('resolveCurrentMonthIso returns YYYY-MM in Taipei', () => {
    expect(resolveCurrentMonthIso(new Date('2026-07-12T14:00:00Z'))).toBe('2026-07');
  });
});

describe('year window', () => {
  it('resolveCurrentYearIso returns YYYY in Taipei', () => {
    expect(resolveCurrentYearIso(new Date('2026-07-12T14:00:00Z'))).toBe('2026');
  });
  it('isYearInSubscriberWindow: PRO -1 / current / +4', () => {
    const cur = '2026';
    expect(isYearInSubscriberWindow('2025', cur, 'PRO')).toBe(true);
    expect(isYearInSubscriberWindow('2030', cur, 'PRO')).toBe(true);
    expect(isYearInSubscriberWindow('2031', cur, 'PRO')).toBe(false);
    expect(isYearInSubscriberWindow('2027', cur, 'FREE')).toBe(false);
    expect(isYearInSubscriberWindow('2026', cur, 'FREE')).toBe(true);
  });
});
