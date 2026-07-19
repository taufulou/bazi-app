/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
import { render, screen } from '@testing-library/react-native';
import { MarkdownText, StarRating, ScoreBar, VerdictBanner, Chip, getSectionTheme } from '../primitives';
import AIReadingDisplay from '../AIReadingDisplay';
import type { AIReadingData } from '../../../lib/readings-api';

// react-native-svg (unused here, but AIReadingDisplay tree may pull primitives that don't need it).
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stub = (props: Record<string, unknown>) =>
    React.createElement(View, props, (props as { children?: unknown }).children as never);
  return { __esModule: true, default: Stub, Svg: Stub, Circle: Stub, G: Stub, Path: Stub, Line: Stub, Text: Stub, Polyline: Stub, Rect: Stub };
});

describe('getSectionTheme', () => {
  it('maps known keys + dynamic keys + default', () => {
    expect(getSectionTheme('chart_identity').theme).toBe('personality');
    expect(getSectionTheme('finance_pattern').theme).toBe('finance');
    expect(getSectionTheme('career_pattern').theme).toBe('career');
    expect(getSectionTheme('annual_forecast_2026').theme).toBe('timing');
    expect(getSectionTheme('nonexistent').theme).toBe('default');
    // color resolved
    expect(getSectionTheme('finance_pattern').color).toMatch(/^#/);
  });
});

describe('MarkdownText', () => {
  it('renders emoji sub-headers + bullets + paragraphs + bold', async () => {
    await render(
      <MarkdownText text={'🔥 強項\n- 第一點\n- 第二點\n這是**重點**段落'} />,
    );
    expect(screen.getByText('🔥 強項')).toBeTruthy();
    expect(screen.getByText('第一點')).toBeTruthy();
    expect(screen.getByText('第二點')).toBeTruthy();
    // bold run splits the paragraph → the bold token is its own Text
    expect(screen.getByText('重點')).toBeTruthy();
  });

  it('renders category：a、b、c rows', async () => {
    await render(<MarkdownText text={'- 傳媒與娛樂：傳媒業、廣告、演藝'} />);
    expect(screen.getByText('傳媒與娛樂')).toBeTruthy();
    expect(screen.getByText('傳媒業、廣告、演藝')).toBeTruthy();
  });

  it('applies convert() to the text', async () => {
    await render(<MarkdownText text={'測試'} convert={(s) => s.replace('測試', 'CONVERTED')} />);
    expect(screen.getByText('CONVERTED')).toBeTruthy();
  });
});

describe('StarRating / ScoreBar / VerdictBanner / Chip', () => {
  it('StarRating shows score + label', async () => {
    await render(<StarRating score={3.5} indicatorLabel="中上" />);
    expect(screen.getByText('3.5')).toBeTruthy();
    expect(screen.getByText('· 中上')).toBeTruthy();
  });
  it('ScoreBar shows label + value + level', async () => {
    await render(<ScoreBar label="名聲地位" score={72} levelLabel="良好" />);
    expect(screen.getByText('名聲地位')).toBeTruthy();
    // value + level are composed into one Text node → match by regex
    expect(screen.getByText(/72/)).toBeTruthy();
    expect(screen.getByText(/良好/)).toBeTruthy();
  });
  it('VerdictBanner shows ✓ + label + /100', async () => {
    await render(<VerdictBanner label="適合創業" score={80} tone="positive" />);
    expect(screen.getByText('✓')).toBeTruthy();
    expect(screen.getByText('適合創業')).toBeTruthy();
    expect(screen.getByText(/80/)).toBeTruthy();
  });
  it('Chip renders its label', async () => {
    await render(<Chip label="將星" tone="gold" />);
    expect(screen.getByText('將星')).toBeTruthy();
  });
});

function makeData(): AIReadingData {
  return {
    isV2: true,
    sections: [
      { key: 'chart_identity', title: '先天命格解讀', preview: '預覽內容', full: '完整內容\n🔥 強項\n- 一點' },
      { key: 'finance_pattern', title: '財運格局解讀', preview: '財運預覽', full: '財運完整' },
    ],
    summary: { text: '這是綜合建議' },
  };
}

describe('AIReadingDisplay', () => {
  it('subscriber sees full content + summary', async () => {
    await render(<AIReadingDisplay data={makeData()} isSubscriber />);
    expect(screen.getByText('先天命格解讀')).toBeTruthy();
    expect(screen.getByText('完整內容')).toBeTruthy();
    expect(screen.getByText('財運完整')).toBeTruthy();
    expect(screen.getByText('綜合建議')).toBeTruthy();
    expect(screen.getByText('這是綜合建議')).toBeTruthy();
    // no preview shown when full is available
    expect(screen.queryByText('預覽內容')).toBeNull();
  });

  it('non-subscriber sees preview + paywall (except no-paywall sections)', async () => {
    await render(<AIReadingDisplay data={makeData()} isSubscriber={false} />);
    expect(screen.getByText('預覽內容')).toBeTruthy();
    expect(screen.queryByText('完整內容')).toBeNull();
    // paywall overlay appears
    expect(screen.getAllByText('🔒').length).toBeGreaterThan(0);
  });

  it('shows the streaming skeleton when isStreaming', async () => {
    await render(<AIReadingDisplay data={makeData()} isSubscriber isStreaming nextSectionLabel="正在撰寫感情" />);
    expect(screen.getByText('正在撰寫感情')).toBeTruthy();
  });

  it('renders a header + per-section extras via slots', async () => {
    const { Text } = require('react-native');
    await render(
      <AIReadingDisplay
        data={makeData()}
        isSubscriber
        header={<Text>HEADER_WIDGET</Text>}
        renderExtras={(key) => <Text>{`EXTRA_${key}`}</Text>}
      />,
    );
    expect(screen.getByText('HEADER_WIDGET')).toBeTruthy();
    expect(screen.getByText('EXTRA_chart_identity')).toBeTruthy();
    expect(screen.getByText('EXTRA_finance_pattern')).toBeTruthy();
  });
});
