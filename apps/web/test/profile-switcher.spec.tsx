/**
 * Tests for ProfileSwitcher — custom popover chip for Fortune surface.
 *
 * Key behaviors:
 *   - Hidden entirely when profiles.length <= 1
 *   - Opens/closes via trigger click
 *   - Closes on outside click + Escape key
 *   - Active profile shows check icon
 *   - Footer link to /dashboard/profiles
 */
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileSwitcher from '../app/components/fortune/ProfileSwitcher';
import type { BirthProfile } from '../app/lib/birth-profiles-api';

jest.mock('next/link', () => {
  const MockLink = ({
    children,
    href,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  );
  MockLink.displayName = 'MockLink';
  return MockLink;
});

// Mock lucide-react icons — see date-navigator.spec.tsx for rationale
jest.mock('lucide-react', () => ({
  __esModule: true,
  Check: () => <span data-icon="Check" />,
  RefreshCw: () => <span data-icon="RefreshCw" />,
  ChevronDown: () => <span data-icon="ChevronDown" />,
}));

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

describe('ProfileSwitcher', () => {
  it('renders nothing when profiles list is empty', () => {
    const { container } = render(
      <ProfileSwitcher profiles={[]} activeProfileId={undefined} onSelect={jest.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when only one profile (no value in switching)', () => {
    const { container } = render(
      <ProfileSwitcher
        profiles={[makeProfile()]}
        activeProfileId="profile-1"
        onSelect={jest.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  describe('with 2+ profiles', () => {
    const profiles = [
      makeProfile({ id: 'p1', name: 'Roger', relationshipTag: 'SELF' }),
      makeProfile({ id: 'p2', name: '老婆', relationshipTag: 'FAMILY' }),
    ];

    it('renders trigger button', () => {
      render(<ProfileSwitcher profiles={profiles} activeProfileId="p1" onSelect={jest.fn()} />);
      expect(screen.getByLabelText('切換命盤')).toBeInTheDocument();
    });

    it('popover is closed by default', () => {
      render(<ProfileSwitcher profiles={profiles} activeProfileId="p1" onSelect={jest.fn()} />);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('clicking trigger opens popover with profile rows', () => {
      render(<ProfileSwitcher profiles={profiles} activeProfileId="p1" onSelect={jest.fn()} />);
      fireEvent.click(screen.getByLabelText('切換命盤'));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getByText('Roger')).toBeInTheDocument();
      expect(screen.getByText('老婆')).toBeInTheDocument();
    });

    it('selecting a row fires onSelect AND closes popover', () => {
      const onSelect = jest.fn();
      render(<ProfileSwitcher profiles={profiles} activeProfileId="p1" onSelect={onSelect} />);
      fireEvent.click(screen.getByLabelText('切換命盤'));
      fireEvent.click(screen.getByText('老婆'));
      expect(onSelect).toHaveBeenCalledWith('p2');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('selecting the active row does NOT fire onSelect', () => {
      const onSelect = jest.fn();
      render(<ProfileSwitcher profiles={profiles} activeProfileId="p1" onSelect={onSelect} />);
      fireEvent.click(screen.getByLabelText('切換命盤'));
      fireEvent.click(screen.getByText('Roger'));
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('Escape key closes popover', () => {
      render(<ProfileSwitcher profiles={profiles} activeProfileId="p1" onSelect={jest.fn()} />);
      fireEvent.click(screen.getByLabelText('切換命盤'));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('outside click closes popover', () => {
      render(
        <div>
          <button data-testid="outside">outside</button>
          <ProfileSwitcher profiles={profiles} activeProfileId="p1" onSelect={jest.fn()} />
        </div>,
      );
      fireEvent.click(screen.getByLabelText('切換命盤'));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('footer link points to /dashboard/profiles', () => {
      render(<ProfileSwitcher profiles={profiles} activeProfileId="p1" onSelect={jest.fn()} />);
      fireEvent.click(screen.getByLabelText('切換命盤'));
      const footerLink = screen.getByText(/管理命盤/);
      expect(footerLink.closest('a')).toHaveAttribute('href', '/dashboard/profiles');
    });

    it('shows relationship tag label for each profile', () => {
      render(<ProfileSwitcher profiles={profiles} activeProfileId="p1" onSelect={jest.fn()} />);
      fireEvent.click(screen.getByLabelText('切換命盤'));
      expect(screen.getByText('本人')).toBeInTheDocument(); // SELF
      expect(screen.getByText('家人')).toBeInTheDocument(); // FAMILY
    });
  });
});
