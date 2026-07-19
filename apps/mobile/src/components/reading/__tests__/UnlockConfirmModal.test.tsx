import { render, screen, fireEvent } from '@testing-library/react-native';
import UnlockConfirmModal from '../UnlockConfirmModal';

const base = {
  visible: true,
  readingName: '八字終身運',
  creditCost: 3,
  isUnlocking: false,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

describe('UnlockConfirmModal', () => {
  it('shows cost + balance + reading name', async () => {
    await render(<UnlockConfirmModal {...base} credits={951} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('將扣除')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText(/951/)).toBeTruthy();
    expect(screen.getByText(/八字終身運/)).toBeTruthy();
  });

  it('fires onConfirm when credits are sufficient', async () => {
    const onConfirm = jest.fn();
    await render(<UnlockConfirmModal {...base} credits={951} onConfirm={onConfirm} onCancel={jest.fn()} />);
    // «解鎖完整報告» is both the sheet title AND the confirm button — press the button (last).
    const matches = screen.getAllByText('解鎖完整報告');
    fireEvent.press(matches[matches.length - 1]!);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('shows the insufficient-credits guard (no onConfirm path)', async () => {
    const onConfirm = jest.fn();
    const onBuy = jest.fn();
    await render(
      <UnlockConfirmModal {...base} credits={1} onConfirm={onConfirm} onCancel={jest.fn()} onBuyCredits={onBuy} />,
    );
    expect(screen.getByText('點數不足，請先購買點數')).toBeTruthy();
    fireEvent.press(screen.getByText('前往購買點數'));
    expect(onBuy).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the 時辰未知 warning only when hourUnknown', async () => {
    const { rerender } = await render(
      <UnlockConfirmModal {...base} credits={951} hourUnknown onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(screen.getByText(/因為沒有出生時辰/)).toBeTruthy();
    await rerender(
      <UnlockConfirmModal {...base} credits={951} hourUnknown={false} onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(screen.queryByText(/因為沒有出生時辰/)).toBeNull();
  });
});
