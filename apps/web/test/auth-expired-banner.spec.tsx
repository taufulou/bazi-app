/**
 * Tests for AuthExpiredBanner — shown when useUserTier.authError is true.
 *
 * Locks Phase 1.5.x decisions:
 *   - role='alert' + warm copy
 *   - link to /sign-in
 *   - dismiss button fires onDismiss
 *   - keyboard activation (Tab → Enter on dismiss)
 */
import { render, screen, fireEvent } from '@testing-library/react';
import AuthExpiredBanner from '../app/components/fortune/AuthExpiredBanner';

jest.mock('next/link', () => {
  const MockLink = ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
  MockLink.displayName = 'MockLink';
  return MockLink;
});

jest.mock('lucide-react', () => ({
  __esModule: true,
  AlertCircle: () => <span data-icon="AlertCircle" />,
  X: () => <span data-icon="X" />,
}));

describe('AuthExpiredBanner', () => {
  it("renders role='alert' with the locked Chinese copy", () => {
    render(<AuthExpiredBanner onDismiss={jest.fn()} />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain('登入狀態已過期');
    expect(alert.textContent).toContain('部分功能受限');
  });

  it("re-auth link has href='/sign-in'", () => {
    render(<AuthExpiredBanner onDismiss={jest.fn()} />);
    const link = screen.getByText('重新登入 →');
    expect(link.closest('a')).toHaveAttribute('href', '/sign-in');
  });

  it('dismiss button click fires onDismiss exactly once', () => {
    const onDismiss = jest.fn();
    render(<AuthExpiredBanner onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('關閉提示'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Enter on focused dismiss button fires onDismiss (keyboard activation)', () => {
    const onDismiss = jest.fn();
    render(<AuthExpiredBanner onDismiss={onDismiss} />);
    const dismissBtn = screen.getByLabelText('關閉提示');
    dismissBtn.focus();
    expect(document.activeElement).toBe(dismissBtn);
    // Native button + role='button' auto-handles Enter as click event
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
