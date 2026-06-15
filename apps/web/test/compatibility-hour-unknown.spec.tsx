/**
 * 時辰未知 (Phase 3d) — COMPATIBILITY frontend regression locks.
 *
 * 1. toBirthDataFormValues honors the quick-mode (時辰未知) toggle → hourKnown
 *    flows false (pre-Phase-3 it was hard-coded true, blocking compat 時辰未知).
 * 2. CompatibilityRomancePaywallCTA renders the 3-pillar partial warning block
 *    with the correct 男方/女方/雙方 label, and omits it when both hours known.
 */
import { render, screen } from '@testing-library/react';
import {
  EMPTY_PERSON_FIELDS,
  toBirthDataFormValues,
  type PersonFieldValues,
} from '../app/lib/date-time-utils';
import { formValuesToPayload } from '../app/lib/birth-profiles-api';
import CompatibilityRomancePaywallCTA from '../app/components/CompatibilityRomancePaywallCTA';

// ── 1. Form flip ──

const baseFields = (over: Partial<PersonFieldValues> = {}): PersonFieldValues => ({
  ...EMPTY_PERSON_FIELDS,
  name: '王小明',
  gender: 'male',
  year: '1990',
  month: '5',
  day: '15',
  cityCode: 'TPE',
  timezone: 'Asia/Taipei',
  ...over,
});

describe('toBirthDataFormValues — 時辰未知 toggle (Phase 3d)', () => {
  it('quickMode=true → hourKnown=false + empty birthTime', () => {
    const v = toBirthDataFormValues(baseFields({ quickMode: true, hour: '', minute: '' }));
    expect(v.hourKnown).toBe(false);
    expect(v.birthTime).toBe('');
  });

  it('quickMode=false with a time → hourKnown=true + HH:MM', () => {
    const v = toBirthDataFormValues(
      baseFields({ quickMode: false, hour: '2', minute: '30', period: 'PM' }),
    );
    expect(v.hourKnown).toBe(true);
    expect(v.birthTime).toBe('14:30');
  });

  // N1 boundary: the create-profile payload must OMIT birthTime when hour
  // unknown (→ backend stores null → 3-pillar, no engine 422).
  it('formValuesToPayload: hourKnown=false → birthTime undefined', () => {
    const v = toBirthDataFormValues(baseFields({ quickMode: true }));
    const payload = formValuesToPayload(v, 'SELF', '');
    expect(payload.hourKnown).toBe(false);
    expect(payload.birthTime).toBeUndefined();
  });

  it('formValuesToPayload: hourKnown=true → birthTime present', () => {
    const v = toBirthDataFormValues(baseFields({ quickMode: false, hour: '2', minute: '30', period: 'PM' }));
    const payload = formValuesToPayload(v, 'SELF', '');
    expect(payload.hourKnown).toBe(true);
    expect(payload.birthTime).toBe('14:30');
  });
});

// ── 2. Paywall warning block ──

const ctaProps = {
  creditCost: 3,
  currentCredits: 99,
  isSubscriber: true,
  isSignedIn: true,
  onUnlock: jest.fn(),
  isUnlocking: false,
  onCreditsRefresh: jest.fn(),
};

const WARN = '這份合盤會以「年、月、日」三柱推算';

describe('CompatibilityRomancePaywallCTA — 時辰未知 warning (Phase 3d)', () => {
  it('A unknown → 男方', () => {
    render(<CompatibilityRomancePaywallCTA {...ctaProps} hourUnknownA />);
    expect(screen.getByText(new RegExp(`因為男方沒有出生時辰`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(WARN))).toBeInTheDocument();
  });

  it('B unknown → 女方', () => {
    render(<CompatibilityRomancePaywallCTA {...ctaProps} hourUnknownB />);
    expect(screen.getByText(/因為女方沒有出生時辰/)).toBeInTheDocument();
  });

  it('both unknown → 雙方', () => {
    render(<CompatibilityRomancePaywallCTA {...ctaProps} hourUnknownA hourUnknownB />);
    expect(screen.getByText(/因為雙方沒有出生時辰/)).toBeInTheDocument();
  });

  it('both known → no warning block', () => {
    render(<CompatibilityRomancePaywallCTA {...ctaProps} />);
    expect(screen.queryByText(new RegExp(WARN))).not.toBeInTheDocument();
  });

  // BUG-1 (comprehensive QA 2026-06-15): label by ACTUAL gender so the CTA
  // agrees with the AI narrative (which labels by gender, not position).
  it('female-A unknown → 女方 (not the positional 男方)', () => {
    render(<CompatibilityRomancePaywallCTA {...ctaProps} hourUnknownA genderA="female" genderB="male" />);
    expect(screen.getByText(/因為女方沒有出生時辰/)).toBeInTheDocument();
    expect(screen.queryByText(/因為男方沒有出生時辰/)).not.toBeInTheDocument();
  });

  it('male-B unknown → 男方 (not the positional 女方)', () => {
    render(<CompatibilityRomancePaywallCTA {...ctaProps} hourUnknownB genderA="female" genderB="male" />);
    expect(screen.getByText(/因為男方沒有出生時辰/)).toBeInTheDocument();
  });

  it('same-sex (both female), A unknown → 女方', () => {
    render(<CompatibilityRomancePaywallCTA {...ctaProps} hourUnknownA genderA="female" genderB="female" />);
    expect(screen.getByText(/因為女方沒有出生時辰/)).toBeInTheDocument();
  });
});
