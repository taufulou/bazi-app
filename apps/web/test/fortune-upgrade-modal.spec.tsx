/**
 * Tests for FortuneUpgradeModal — free-user paywall prompt shown when
 * DateNavigator arrows are clicked.
 *
 * Pattern mirrors `insufficient-credits-modal.spec.tsx` for reviewer
 * one-grep traceability.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import FortuneUpgradeModal from '../app/components/fortune/FortuneUpgradeModal';

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

describe('FortuneUpgradeModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<FortuneUpgradeModal isOpen={false} onClose={jest.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the upgrade title + body copy', () => {
    render(<FortuneUpgradeModal {...defaultProps} />);
    expect(screen.getByText('升級訂閱解鎖完整查詢範圍')).toBeInTheDocument();
    expect(screen.getByText(/免費版僅可查看/)).toBeInTheDocument();
    expect(screen.getByText(/昨日 \+ 今日 \+ 未來 30 天/)).toBeInTheDocument();
  });

  it('primary CTA links to /pricing (locked target per plan)', () => {
    render(<FortuneUpgradeModal {...defaultProps} />);
    const primary = screen.getByText('查看訂閱方案');
    expect(primary.closest('a')).toHaveAttribute('href', '/pricing');
  });

  it('secondary button calls onClose', () => {
    render(<FortuneUpgradeModal {...defaultProps} />);
    fireEvent.click(screen.getByText('稍後再說'));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on ESC key', () => {
    render(<FortuneUpgradeModal {...defaultProps} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on overlay click', () => {
    render(<FortuneUpgradeModal {...defaultProps} />);
    const overlay = document.querySelector('[class*="overlay"]');
    if (overlay) {
      fireEvent.click(overlay);
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('has dialog role + aria attributes', () => {
    render(<FortuneUpgradeModal {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'fortune-upgrade-title');
  });
});
