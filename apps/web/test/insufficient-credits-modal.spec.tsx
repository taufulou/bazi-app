/**
 * Tests for InsufficientCreditsModal component.
 * Validates modal display, actions, accessibility, new "Buy Credits"
 * button, and disabled "Watch Ad" placeholder.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import InsufficientCreditsModal from '../app/components/InsufficientCreditsModal';

// ============================================================
// Mocks
// ============================================================

jest.mock('next/link', () => {
  return ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...props}>{children}</a>
  );
});

// ============================================================
// Tests
// ============================================================

describe('InsufficientCreditsModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    onViewChart: jest.fn(),
    currentCredits: 1,
    requiredCredits: 3,
    readingName: '八字終身運',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <InsufficientCreditsModal {...defaultProps} isOpen={false} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('displays credit requirement info', () => {
    render(<InsufficientCreditsModal {...defaultProps} />);

    expect(screen.getByText('額度不足')).toBeInTheDocument();
    expect(screen.getByText(/八字終身運/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // required
    expect(screen.getByText('1')).toBeInTheDocument(); // current
  });

  it('has upgrade plan link to /pricing', () => {
    render(<InsufficientCreditsModal {...defaultProps} />);

    const upgradeLink = screen.getByText('升級方案');
    expect(upgradeLink).toBeInTheDocument();
    expect(upgradeLink.closest('a')).toHaveAttribute('href', '/pricing');
  });

  it('has buy credits link to /store', () => {
    render(<InsufficientCreditsModal {...defaultProps} />);

    const buyLink = screen.getByText('購買點數');
    expect(buyLink).toBeInTheDocument();
    expect(buyLink.closest('a')).toHaveAttribute('href', '/store');
  });

  it('shows disabled ad reward button with mobile-only label', () => {
    render(<InsufficientCreditsModal {...defaultProps} />);

    const adBtn = screen.getByText(/看廣告獲得 1 點/);
    expect(adBtn).toBeInTheDocument();
    expect(adBtn).toBeDisabled();
    expect(adBtn.textContent).toContain('行動裝置限定');
  });

  it('calls onViewChart when "查看免費命盤" is clicked', () => {
    render(<InsufficientCreditsModal {...defaultProps} />);

    fireEvent.click(screen.getByText('查看免費命盤'));
    expect(defaultProps.onViewChart).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay is clicked', () => {
    render(<InsufficientCreditsModal {...defaultProps} />);

    // Click the overlay (outermost div)
    const overlay = document.querySelector('[class*="overlay"]');
    if (overlay) {
      fireEvent.click(overlay);
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('calls onClose on ESC key press', () => {
    render(<InsufficientCreditsModal {...defaultProps} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('has proper dialog role and aria attributes', () => {
    render(<InsufficientCreditsModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'credits-modal-title');
  });
});
