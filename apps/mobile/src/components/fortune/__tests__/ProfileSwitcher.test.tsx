/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
import { render, screen, fireEvent } from '@testing-library/react-native';
import ProfileSwitcher from '../ProfileSwitcher';
import type { BirthProfile } from '../../../lib/birth-profiles-api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

function makeProfile(over: Partial<BirthProfile> & { id: string; name: string }): BirthProfile {
  return {
    birthDate: '1987-09-06',
    birthTime: '16:11',
    calendarType: 'solar',
    gender: 'male',
    city: '吉打',
    timezone: 'Asia/Kuala_Lumpur',
    relationshipTag: 'SELF',
    isPrimary: false,
    hourKnown: true,
    ...over,
  } as BirthProfile;
}

const roger = makeProfile({ id: 'p-roger', name: 'Roger', isPrimary: true });
const laopo = makeProfile({ id: 'p-laopo', name: '老婆', relationshipTag: 'FAMILY', birthDate: '1987-01-25' });

describe('ProfileSwitcher', () => {
  beforeEach(() => mockPush.mockClear());

  it('renders nothing with a single profile', async () => {
    const { toJSON } = await render(
      <ProfileSwitcher profiles={[roger]} activeProfileId="p-roger" onSelect={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('shows the active profile name on the chip', async () => {
    await render(
      <ProfileSwitcher profiles={[roger, laopo]} activeProfileId="p-laopo" onSelect={jest.fn()} />,
    );
    expect(screen.getByText('老婆')).toBeTruthy();
  });

  it('falls back to the primary profile for the chip when activeProfileId is undefined', async () => {
    await render(
      <ProfileSwitcher profiles={[laopo, roger]} activeProfileId={undefined} onSelect={jest.fn()} />,
    );
    // Roger is isPrimary → shown on the chip even though he's listed second.
    expect(screen.getByText('Roger')).toBeTruthy();
  });

  it('opens the picker modal on chip press (no crash)', async () => {
    await render(
      <ProfileSwitcher profiles={[roger, laopo]} activeProfileId="p-roger" onSelect={jest.fn()} />,
    );
    // The chip is pressable + labelled; opening the RN Modal list is verified
    // on-device (Modal children don't mount in the jest tree — same limitation
    // as the M2 PeriodNavigator test).
    fireEvent.press(screen.getByLabelText('切換命盤，目前為 Roger'));
    expect(screen.getByText('Roger')).toBeTruthy();
  });
});
