/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted; they must use require() */
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import BaziChart from '../BaziChart';
import type { BaziChartData } from '../../lib/bazi-types';
import type { ElementClickInfo } from '../ElementExplanation';
import rogerFixture from './roger-chart.fixture.json';

// Capture the ElementExplanation `info` prop so we can assert what a cell tap sends
// (also avoids @gorhom/bottom-sheet + expo-blur + reanimated in the test env).
const capturedInfo: { last: ElementClickInfo | null } = { last: null };
jest.mock('../ElementExplanation', () => ({
  ElementExplanation: (props: { info: unknown }) => {
    capturedInfo.last = props.info as ElementClickInfo | null;
    return null;
  },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// react-native-svg isn't fully mocked by jest-expo → its native components throw
// during commit. Render the ring primitives as plain Views for this layout test.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stub = (props: Record<string, unknown>) =>
    React.createElement(View, props, (props as { children?: unknown }).children as never);
  return { __esModule: true, default: Stub, Svg: Stub, Circle: Stub, G: Stub, Path: Stub, Text: Stub };
});

const roger = rogerFixture as unknown as BaziChartData;

describe('BaziChart — Roger anchor (丁卯/戊申/戊午/庚申)', () => {
  it('renders the four pillar columns', async () => {
    await render(<BaziChart data={roger} gender="male" />);
    expect(screen.getByText('年柱')).toBeTruthy();
    expect(screen.getByText('月柱')).toBeTruthy();
    expect(screen.getByText('日柱')).toBeTruthy();
    expect(screen.getByText('時柱')).toBeTruthy();
  });

  it('renders the exact stems + branches from the fixture', async () => {
    await render(<BaziChart data={roger} gender="male" />);
    // year 丁卯 / month 戊申 / day 戊午 / hour 庚申
    expect(screen.getByText('丁')).toBeTruthy(); // year stem (unique among stems)
    expect(screen.getByText('庚')).toBeTruthy(); // hour stem (unique)
    expect(screen.getAllByText('戊').length).toBeGreaterThanOrEqual(2); // month + day stems
    expect(screen.getByText('卯')).toBeTruthy(); // year branch (unique)
    expect(screen.getByText('午')).toBeTruthy(); // day branch (unique)
    expect(screen.getAllByText('申').length).toBeGreaterThanOrEqual(2); // month + hour branches
  });

  it('renders the day-master analysis (戊 土 偏弱)', async () => {
    await render(<BaziChart data={roger} gender="male" />);
    expect(screen.getByText('日主分析')).toBeTruthy();
    expect(screen.getByText('戊（土陽）')).toBeTruthy();
    expect(screen.getByText('偏弱（39分）')).toBeTruthy();
  });

  // Regression for the H1 audit bug: the 旺相休囚死 tap must send the STATE
  // (旺/相/休/囚/死), not the element (木/火/土/金/水). The engine keys the
  // seasonal encyclopedia entry by the state name.
  it('sends the seasonal STATE (not the element) when a 旺相休囚死 tag is tapped', async () => {
    capturedInfo.last = null;
    await render(<BaziChart data={roger} gender="male" />);
    // Fixture: 金 → 旺.
    fireEvent.press(screen.getByTestId('seasonal-金'));
    await waitFor(() =>
      expect(capturedInfo.last).toMatchObject({ elementType: 'seasonal_state', value: '旺' }),
    );
    // 水 → 相.
    fireEvent.press(screen.getByTestId('seasonal-水'));
    await waitFor(() => expect(capturedInfo.last?.value).toBe('相'));
  });
});

describe('BaziChart — 時辰未知 (unknown hour)', () => {
  it('tags the hour column as 時辰未知 when the hour pillar is blank', async () => {
    const unknownHour = {
      ...roger,
      hourKnown: false,
      fourPillars: {
        ...roger.fourPillars,
        hour: {
          ...roger.fourPillars.hour,
          stem: '',
          branch: '',
          hiddenStems: [],
          hiddenStemGods: [],
          shenSha: [],
        },
      },
    } as unknown as BaziChartData;
    await render(<BaziChart data={unknownHour} birthDate="1987-09-06" gender="male" />);
    // subHeader carries the 「(時辰未知)」 tag (birthDate present); flattened <Text>.
    expect(screen.getByText('時辰未知', { exact: false })).toBeTruthy();
    // Hour column renders the 「時辰 / 未知」 placeholder instead of a ganzhi.
    expect(screen.getByText('未知')).toBeTruthy();
    // Known pillars still render.
    expect(screen.getByText('丁')).toBeTruthy();
    expect(screen.getByText('卯')).toBeTruthy();
  });
});
