/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
import { render, screen, fireEvent } from '@testing-library/react-native';
import EnergyScoreRing from '../EnergyScoreRing';
import DimensionBars from '../DimensionBars';
import PeriodNavigator from '../PeriodNavigator';
import type { FortuneDimension } from '../../../lib/fortune-api';

// react-native-svg native components throw during commit under jest-expo → stub as Views.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stub = (props: Record<string, unknown>) =>
    React.createElement(View, props, (props as { children?: unknown }).children as never);
  return { __esModule: true, default: Stub, Svg: Stub, Circle: Stub, G: Stub, Path: Stub, Text: Stub };
});

const dims: Record<'romance' | 'career' | 'finance' | 'travel' | 'health', FortuneDimension> = {
  romance: { score: 46, label: '需謹慎', signals: [] },
  career: { score: 47, label: '需謹慎', signals: [] },
  finance: { score: 45, label: '需謹慎', signals: [] },
  travel: { score: 32, label: '不利', signals: [] },
  health: { score: 41, label: '需謹慎', signals: [] },
};

describe('EnergyScoreRing', () => {
  it('renders score, label band, day-pillar sub-line', async () => {
    await render(
      <EnergyScoreRing label="凶中有吉" score={42} date="2026-07-12" dayGanZhi="丁亥" dayTenGod="正印" />,
    );
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('凶中有吉')).toBeTruthy(); // label band (disclaimer is a distinct node)
    expect(screen.getByText('丁亥日 · 正印')).toBeTruthy();
  });
});

describe('DimensionBars', () => {
  it('renders all 5 dims with scores + names', async () => {
    await render(<DimensionBars dimensions={dims} />);
    for (const name of ['感情', '事業', '財運', '出行', '健康']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getByText('46')).toBeTruthy();
    expect(screen.getByText('32')).toBeTruthy();
    expect(screen.getByText('不利')).toBeTruthy();
  });
});

describe('PeriodNavigator — gating', () => {
  const options = [
    { label: '2026年7月12日 週日', value: '2026-07-12' },
    { label: '2026年7月13日 週一', value: '2026-07-13' },
  ];

  it('renders the current label + hint', async () => {
    await render(
      <PeriodNavigator
        currentLabel="2026年7月12日 週日"
        hint="點擊選擇日期"
        pickerTitle="選擇日期"
        options={options}
        value="2026-07-12"
        onChange={() => {}}
        isFree={false}
        onLockedAttempt={() => {}}
      />,
    );
    expect(screen.getByText('2026年7月12日 週日')).toBeTruthy();
    expect(screen.getByText('點擊選擇日期')).toBeTruthy();
  });

  it('FREE tier: tapping the chip fires onLockedAttempt (upsell), not the picker', async () => {
    const onLockedAttempt = jest.fn();
    const onChange = jest.fn();
    await render(
      <PeriodNavigator
        currentLabel="2026年7月12日 週日"
        hint="點擊選擇日期"
        pickerTitle="選擇日期"
        options={options}
        value="2026-07-12"
        onChange={onChange}
        isFree
        onLockedAttempt={onLockedAttempt}
      />,
    );
    fireEvent.press(screen.getByLabelText(/需訂閱/));
    expect(onLockedAttempt).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
