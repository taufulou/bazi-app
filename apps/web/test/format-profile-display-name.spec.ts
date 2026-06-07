/**
 * Tests for getProfileDisplayName helper — used by Fortune header chip
 * to convert a BirthProfile into the right display string.
 *
 * Locks the 2026-05-19 design: always return `profile.name` regardless of
 * relationship. `undefined` profile → '' so the chip hides cleanly.
 */
import { getProfileDisplayName } from '../app/lib/format-profile-display-name';
import type { BirthProfile } from '../app/lib/birth-profiles-api';

function makeProfile(overrides: Partial<BirthProfile> = {}): BirthProfile {
  return {
    id: 'profile-1',
    name: 'Roger',
    birthDate: '1987-09-06',
    birthTime: '16:11',
    birthCity: '吉打',
    birthTimezone: 'Asia/Kuala_Lumpur',
    birthLongitude: null,
    birthLatitude: null,
    gender: 'MALE',
    relationshipTag: 'SELF',
    isPrimary: true,
    isLunarDate: false,
    lunarBirthDate: null,
    isLeapMonth: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('getProfileDisplayName', () => {
  it('returns the literal profile.name for SELF profile (2026-05-19 design — no longer 「本人」)', () => {
    expect(
      getProfileDisplayName(makeProfile({ relationshipTag: 'SELF', name: 'Roger' })),
    ).toBe('Roger');
    expect(
      getProfileDisplayName(makeProfile({ relationshipTag: 'SELF', name: 'Alice' })),
    ).toBe('Alice');
  });

  it('returns the literal profile.name for FAMILY profile', () => {
    expect(
      getProfileDisplayName(makeProfile({ relationshipTag: 'FAMILY', name: '老婆' })),
    ).toBe('老婆');
    expect(
      getProfileDisplayName(makeProfile({ relationshipTag: 'FAMILY', name: 'Laopo29' })),
    ).toBe('Laopo29');
  });

  it('returns the literal profile.name for FRIEND profile', () => {
    expect(
      getProfileDisplayName(makeProfile({ relationshipTag: 'FRIEND', name: '小明' })),
    ).toBe('小明');
  });

  it('returns empty string for undefined input', () => {
    expect(getProfileDisplayName(undefined)).toBe('');
  });

  it('returns empty string when profile.name is null (defensive against API schema drift — Bug #3)', () => {
    // Force a runtime "API said name=null even though TS says string"
    const malformed = makeProfile({
      relationshipTag: 'FAMILY',
      name: null as unknown as string,
    });
    expect(getProfileDisplayName(malformed)).toBe('');
  });
});
