import { getDaysInMonth, to12Hour, to24Hour } from '../date-time-utils';

describe('date-time-utils', () => {
  it('getDaysInMonth handles leap years', () => {
    expect(getDaysInMonth('2024', '2')).toBe(29); // leap
    expect(getDaysInMonth('2023', '2')).toBe(28);
    expect(getDaysInMonth('2024', '1')).toBe(31);
  });

  it('to12Hour converts 24h → 12h + period', () => {
    expect(to12Hour('14')).toEqual({ hour12: '2', period: 'PM' });
    expect(to12Hour('00')).toEqual({ hour12: '12', period: 'AM' });
    expect(to12Hour('12')).toEqual({ hour12: '12', period: 'PM' });
    expect(to12Hour('09')).toEqual({ hour12: '9', period: 'AM' });
    expect(to12Hour('')).toEqual({ hour12: '', period: 'AM' });
  });

  it('to24Hour converts 12h + period → zero-padded 24h', () => {
    expect(to24Hour('2', 'PM')).toBe('14');
    expect(to24Hour('12', 'AM')).toBe('00');
    expect(to24Hour('12', 'PM')).toBe('12');
    expect(to24Hour('9', 'AM')).toBe('09');
    expect(to24Hour('', 'AM')).toBe('');
  });
});
