/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
/**
 * UI-9 web-parity regression tests:
 *  - Fix D: family_data renders for parents_analysis ONLY (not children_analysis)
 *  - Fix B+C: renderReadingSectionHeader dispatch per reading type, incl. the
 *    career verdict/summary star exclusion; and header renders BEFORE the prose
 *  - Fix A: MascotViewer 2-slide swipe + glyph fallback
 *  - Fix E: deterministic-card titles
 */
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import AIReadingDisplay from '../AIReadingDisplay';
import MascotViewer from '../MascotViewer';
import { LifetimeDeterministicCard } from '../lifetime-cards';
import { renderReadingSectionHeader, renderReadingExtras } from '../readingWidgets';
import type {
  LifetimeV2DeterministicData,
  CareerV2DeterministicData,
  AnnualV2DeterministicData,
  LoveV2DeterministicData,
  AIReadingData,
} from '../../../lib/readings-api';

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stub = (props: Record<string, unknown>) =>
    React.createElement(View, props, (props as { children?: unknown }).children as never);
  return {
    __esModule: true,
    default: Stub, Svg: Stub, Circle: Stub, G: Stub, Path: Stub, Line: Stub,
    Text: Stub, Polyline: Stub, Polygon: Stub, Rect: Stub, Defs: Stub,
    LinearGradient: Stub, Stop: Stub,
  };
});
jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Image: (props: Record<string, unknown>) => React.createElement(View, props) };
});
// A resolvable assets host so MascotViewer builds real URIs (default env is '').
jest.mock('../../../lib/env', () => ({ env: { assetsUrl: 'https://cdn.test', apiUrl: '' } }));

const lifetimeDet = {
  parentHealthYears: { father: [2027], mother: [2031] },
  favorableInvestments: ['房地產'],
  unfavorableInvestments: ['期貨'],
  careerDirections: [{ anchor: '食神', category: '創意', industries: ['設計'] }],
  favorableDirection: '南方',
  careerBenefactorsElement: ['火'],
  careerBenefactorsZodiac: ['馬'],
  dayPillarDetailed: {
    title: '戊午日柱', subtitle: '烈日當空',
    coreImage: '核心', personality: '性格', career: '事業', relationships: '感情', advice: '提醒',
  },
  luckPeriodsEnriched: [{ stem: '甲', branch: '子', startAge: 5, endAge: 14, tenGod: '七殺', score: 60, isCurrent: true }],
} as unknown as LifetimeV2DeterministicData;

describe('Fix D — family_data dispatch', () => {
  it('renders the 父母健康 card for parents_analysis', async () => {
    await render(
      <LifetimeDeterministicCard sectionKey="parents_analysis" det={lifetimeDet} chartData={null} isSubscriber />,
    );
    expect(screen.getByText('父母健康提點')).toBeTruthy();
    expect(screen.getByText('父親健康注意年份')).toBeTruthy();
  });

  it('renders NOTHING for children_analysis (web maps family_data to parents only)', async () => {
    const { toJSON } = await render(
      <LifetimeDeterministicCard sectionKey="children_analysis" det={lifetimeDet} chartData={null} isSubscriber />,
    );
    expect(toJSON()).toBeNull();
  });
});

describe('Fix E — deterministic-card titles', () => {
  it('investments / career / day-pillar cards carry the web titles', async () => {
    await render(<LifetimeDeterministicCard sectionKey="finance_pattern" det={lifetimeDet} chartData={null} isSubscriber />);
    expect(screen.getByText('投資理財方向')).toBeTruthy();

    await render(<LifetimeDeterministicCard sectionKey="career_pattern" det={lifetimeDet} chartData={null} isSubscriber />);
    expect(screen.getByText('有利發展的職業方向')).toBeTruthy();

    await render(<LifetimeDeterministicCard sectionKey="chart_identity" det={lifetimeDet} chartData={null} isSubscriber />);
    expect(screen.getByText('戊午日柱')).toBeTruthy();
    expect(screen.getByText(/八字中的日柱是你自己的代表/)).toBeTruthy();
    expect(screen.getByText(/性格解析/)).toBeTruthy(); // web label, not 個性
  });
});

describe('Fix B+C — renderReadingSectionHeader dispatch', () => {
  it('lifetime scored section → StarRating', async () => {
    await render(
      <>{renderReadingSectionHeader({ readingType: 'lifetime', section: { key: 'chart_identity', title: 'T', preview: '', full: '', score: 4 }, deterministic: lifetimeDet })}</>,
    );
    expect(screen.getByText('4.0')).toBeTruthy();
  });

  it('lifetime timing section → LuckPeriodHeader (not a star)', async () => {
    const node = renderReadingSectionHeader({
      readingType: 'lifetime',
      section: { key: 'current_period', title: 'T', preview: '', full: '', score: 4 },
      deterministic: lifetimeDet,
    });
    const { toJSON } = await render(<>{node}</>);
    expect(toJSON()).toBeTruthy();
    expect(screen.queryByText('4.0')).toBeNull();
  });

  it('career forecast section (not verdict/summary) → StarRating', async () => {
    await render(
      <>{renderReadingSectionHeader({ readingType: 'career', section: { key: 'annual_forecast_2026', title: 'T', preview: '', full: '', score: 3.5 }, deterministic: {} as CareerV2DeterministicData })}</>,
    );
    expect(screen.getByText('3.5')).toBeTruthy();
  });

  it('career verdict/summary sections → NO star (web shows a badge there)', () => {
    for (const key of ['company_type_fit', 'entrepreneurship', 'partnership', 'career_pattern', 'career_allies']) {
      expect(
        renderReadingSectionHeader({
          readingType: 'career',
          section: { key, title: 'T', preview: '', full: '', score: 4 },
          deterministic: {} as CareerV2DeterministicData,
        }),
      ).toBeNull();
    }
  });

  it('annual + love → the whole badge widget in the header, and body is null', async () => {
    const annualDet = { flowYear: { stem: '丙', branch: '午', year: 2026, tenGod: '偏印', auspiciousness: '大吉' } } as unknown as AnnualV2DeterministicData;
    await render(
      <>{renderReadingSectionHeader({ readingType: 'annual', section: { key: 'annual_overview', title: 'T', preview: '', full: '' }, deterministic: annualDet })}</>,
    );
    // 大吉 appears twice (star indicator + the 吉凶 info row) — presence is the assertion.
    expect(screen.getAllByText(/大吉/).length).toBeGreaterThan(0);
    // body moved to header → null
    expect(
      renderReadingExtras({ readingType: 'annual', sectionKey: 'annual_overview', deterministic: annualDet, chartData: null, isSubscriber: true }),
    ).toBeNull();

    const loveDet = { peachBlossoms: { positiveCount: 2, negativeCount: 0, summary: '正桃花為主' } } as unknown as LoveV2DeterministicData;
    expect(
      renderReadingExtras({ readingType: 'love', sectionKey: 'peach_blossom_analysis', deterministic: loveDet, chartData: null, isSubscriber: true }),
    ).toBeNull();
    expect(
      renderReadingSectionHeader({ readingType: 'love', section: { key: 'peach_blossom_analysis', title: 'T', preview: '', full: '' }, deterministic: loveDet }),
    ).toBeTruthy();
  });
});

describe('Fix B+C — header renders BEFORE the prose', () => {
  it('section header node precedes the narrative in the rendered tree', async () => {
    const data: AIReadingData = {
      sections: [{ key: 'chart_identity', title: '先天命格', preview: 'PROSE_MARKER', full: 'PROSE_MARKER', score: 4 }],
      isV2: true,
    };
    const { toJSON } = await render(
      <AIReadingDisplay
        data={data}
        isSubscriber
        renderSectionHeader={() => <Text>__HDR__</Text>}
      />,
    );
    const tree = JSON.stringify(toJSON());
    expect(tree.indexOf('__HDR__')).toBeGreaterThan(-1);
    expect(tree.indexOf('PROSE_MARKER')).toBeGreaterThan(-1);
    expect(tree.indexOf('__HDR__')).toBeLessThan(tree.indexOf('PROSE_MARKER'));
  });
});

describe('Fix A — MascotViewer', () => {
  it('renders BOTH 全身 + 半身 slides with the swipe hint', async () => {
    await render(<MascotViewer stem="戊" gender="male" />);
    expect(screen.getByLabelText('角色卡 全身圖')).toBeTruthy();
    expect(screen.getByLabelText('角色卡 半身圖')).toBeTruthy();
    expect(screen.getByText('← 左右滑動切換視角 →')).toBeTruthy();
  });

  it('collapses to a single slide when the 半身 art fails to load', async () => {
    await render(<MascotViewer stem="戊" gender="male" />);
    // React 19 + jest-expo defers the setState flush → async act (repo pattern).
    await act(async () => {
      fireEvent(screen.getByLabelText('角色卡 半身圖'), 'error');
    });
    expect(screen.getByLabelText('角色卡 全身圖')).toBeTruthy();
    expect(screen.queryByLabelText('角色卡 半身圖')).toBeNull();
    // single slide → no swipe hint
    expect(screen.queryByText('← 左右滑動切換視角 →')).toBeNull();
  });

  it('falls back to the day-master glyph for an invalid stem', async () => {
    await render(<MascotViewer stem="X" gender="female" />);
    expect(screen.getByText('◆')).toBeTruthy();
  });
});
