/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
import { render, screen } from '@testing-library/react-native';
import { CareerWidgets, CareerForecastBadge } from '../career-widgets';
import { AnnualWidgets, LoveWidgets } from '../annual-love-widgets';
import { LifetimeDeterministicCard, CharacterCard } from '../lifetime-cards';
import { LuckPeriodTimeline, LuckPeriodHeader } from '../luck-periods';
import { renderReadingExtras, ReadingHeader } from '../readingWidgets';
import type {
  CareerV2DeterministicData,
  AnnualV2DeterministicData,
  LoveV2DeterministicData,
  LifetimeV2DeterministicData,
  LuckPeriodDetailData,
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

// ---- Career ----
const careerDet = {
  reputationScore: { score: 72, level: '良好', subScores: {} },
  wealthScore: { score: 65, tier: '中上', subScores: {} },
  weightedElements: {},
  weightedTenGods: {},
  pattern: '食神',
  companyTypeFit: { type: 'stable', label: '穩定型', description: '大型企業' },
  entrepreneurshipFit: { score: 60, type: 'freelancer', reasons: ['創意強'] },
  partnershipFit: { score: 40, suitable: false, reasons: [] },
  favorableIndustries: ['傳媒', '設計'],
  unfavorableIndustries: ['金融'],
  careerAllies: { nobles: [], careerShensha: [], allies: [], mobilityBringers: [], enemies: [], antagonists: [], elementHelpers: [] },
  annualForecasts: [{ year: 2026, stem: '丙', branch: '午', tenGod: '偏印', auspiciousness: '大吉', branchInteractions: [], careerIndicators: [], luckPeriodStem: '', luckPeriodBranch: '', luckPeriodTenGod: '' }],
  monthlyForecasts: [],
  fiveQiStates: {},
  patternType: '',
  activeLuckPeriod: null,
  suitablePositions: [],
} as unknown as CareerV2DeterministicData;

describe('CareerWidgets', () => {
  it('renders a verdict for company_type_fit', async () => {
    await render(<CareerWidgets sectionKey="company_type_fit" det={careerDet} />);
    expect(screen.getByText(/穩定型/)).toBeTruthy();
  });
  it('renders favorable industries chips', async () => {
    await render(<CareerWidgets sectionKey="career_directions_favorable" det={careerDet} />);
    expect(screen.getByText('傳媒')).toBeTruthy();
  });
  it('returns null for a non-matching section', async () => {
    const { toJSON } = await render(<CareerWidgets sectionKey="love_summary" det={careerDet} />);
    expect(toJSON()).toBeNull();
  });
  it('CareerForecastBadge matches a year', async () => {
    await render(<CareerForecastBadge sectionKey="annual_forecast_2026" det={careerDet} />);
    expect(screen.getByText(/大吉/)).toBeTruthy();
  });
});

// ---- Annual ----
const annualDet = {
  flowYear: { stem: '丙', branch: '午', year: 2026, tenGod: '偏印', auspiciousness: '大吉' },
  flowYearHarmony: { pattern: '', description: '' },
  taiSui: { hasTaiSui: false, summary: '今年無明顯太歲', pillarResults: [] },
  dayunContext: { available: false, stem: '', branch: '', tenGod: '', role: '', favorability: '', startYear: 0, endYear: 0 },
  career: { flowYearTenGod: '偏印', tenGodRole: '喜神', auspiciousness: '大吉', signals: [], shenShaSignals: [] },
  finance: { wealthPresent: true, wealthCondition: '穩健', signals: [] },
  marriageStar: { romanceLevel: '中', romanceScore: 60, trackCount: 1, tracks: [] },
  relationships: { palaceRelationships: {} },
  sealStar: { isSealYear: true, sealRole: '喜神', signals: [] },
  health: { lifeStage: '帝旺', healthVitality: { vitality: '旺', label: '精力充沛' }, yangrenDanger: false, riskOrgans: [], elementWarnings: [] },
  luYangRen: { luShen: { active: false, favorable: false }, yangRen: { active: false, favorable: false, dangerLevel: '' } },
  monthlyForecasts: [],
} as unknown as AnnualV2DeterministicData;

describe('AnnualWidgets', () => {
  it('renders flowYear overview', async () => {
    await render(<AnnualWidgets sectionKey="annual_overview" det={annualDet} />);
    expect(screen.getAllByText(/大吉/).length).toBeGreaterThan(0);
  });
  it('returns null for a non-matching section', async () => {
    const { toJSON } = await render(<AnnualWidgets sectionKey="love_summary" det={annualDet} />);
    expect(toJSON()).toBeNull();
  });
});

// ---- Love ----
const loveDet = {
  lovePersonality: { archetypeLabel: '溫柔型', archetypeTrait: '體貼', elementStyle: '水', strengthClass: '偏弱', dominantTenGod: '正財', dominantCount: 2 },
  peachBlossoms: { summary: '桃花中等', positiveCount: 2, negativeCount: 0, positiveTypes: ['紅鸞'], negativeTypes: [] },
  spouseStar: { star: '正財', visibility: '透干', role: '用神', balance: '平衡', balanceDesc: '', challenges: [], hourWealthNote: '' },
  marriagePalace: { dayBranch: '午', element: '火', tenGod: '正印', twelveStage: '帝旺', isKongWang: false, appearanceGrade: '上', appearanceNote: '' },
  partnerRecommendations: { favorable: ['屬狗'], favorableSecondary: [], avoidance: ['屬鼠'], favorableSeasons: [] },
  romanceTimeline: { goodYears: [{ year: 2027, type: '正緣', conflicted: false, conflictedDetail: '' }], dangerYears: [], changeYears: [] },
  timingIndicators: { earlySignals: [], lateSignals: [] },
  annualForecasts: [],
  monthlyForecasts: [],
} as unknown as LoveV2DeterministicData;

describe('LoveWidgets', () => {
  it('renders love personality', async () => {
    await render(<LoveWidgets sectionKey="love_personality" det={loveDet} />);
    expect(screen.getByText(/溫柔型|正財/)).toBeTruthy();
  });
  it('renders good years', async () => {
    await render(<LoveWidgets sectionKey="romance_good_years" det={loveDet} />);
    expect(screen.getByText(/2027/)).toBeTruthy();
  });
});

// ---- Lifetime ----
const lifeDet = {
  favorableInvestments: ['房地產', '基金'],
  unfavorableInvestments: ['高風險股'],
  careerDirections: [],
  favorableDirection: '南方',
  careerBenefactorsElement: ['火'],
  careerBenefactorsZodiac: ['馬'],
  partnerElement: ['火'],
  partnerZodiac: ['馬'],
  romanceYears: [2027],
  romanceWarningYears: [],
  parentHealthYears: { father: [], mother: [] },
  luckPeriodsEnriched: [],
  bestPeriod: null,
  annualTenGod: '偏印',
} as unknown as LifetimeV2DeterministicData;

describe('LifetimeDeterministicCard', () => {
  it('renders investments for finance_pattern', async () => {
    await render(<LifetimeDeterministicCard sectionKey="finance_pattern" det={lifeDet} chartData={null} isSubscriber />);
    expect(screen.getByText(/房地產/)).toBeTruthy();
  });
  it('CharacterCard renders trait layers from a minimal chart', async () => {
    await render(<CharacterCard chartData={CHART_FIXTURE} />);
    // day-master 戊 → 本質 trait block renders
    expect(screen.getByText('🌟 本質')).toBeTruthy();
  });
  it('CharacterCard does not crash on null chartData (renders nothing)', async () => {
    const { toJSON } = await render(<CharacterCard chartData={null} />);
    expect(toJSON()).toBeNull();
  });
});

/** Minimal chart shape CharacterCard reads. */
const CHART_FIXTURE: Record<string, unknown> = {
  dayMasterStem: '戊',
  dayMaster: { strength: '偏弱', pattern: '食神格' },
  gender: 'male',
  fourPillars: {
    year: { stem: '丁', branch: '卯', tenGod: '正印', hiddenStemGods: [], shenSha: ['將星'] },
    month: { stem: '戊', branch: '申', tenGod: '比肩', hiddenStemGods: [], shenSha: [] },
    day: { stem: '戊', branch: '午', tenGod: '日元', hiddenStemGods: [], shenSha: [] },
    hour: { stem: '庚', branch: '申', tenGod: '食神', hiddenStemGods: [], shenSha: [] },
  },
};

// ---- Luck periods ----
const periods: LuckPeriodDetailData[] = [
  { stem: '乙', branch: '巳', startAge: 30, endAge: 39, startYear: 2017, endYear: 2026, score: 55, stemPhase: '', branchPhase: '', interactions: ['沖'], isCurrent: true, tenGod: '正官' },
  { stem: '甲', branch: '辰', startAge: 40, endAge: 49, startYear: 2027, endYear: 2036, score: 62, stemPhase: '', branchPhase: '', interactions: [], isCurrent: false, tenGod: '偏官' },
];

describe('Luck period widgets', () => {
  it('LuckPeriodTimeline renders period rows', async () => {
    await render(<LuckPeriodTimeline periods={periods} bestPeriod={periods[1]!} />);
    expect(screen.getAllByText(/乙巳|正官/).length).toBeGreaterThan(0);
  });
  it('LuckPeriodHeader resolves current_period', async () => {
    const det = { luckPeriodsEnriched: periods, bestPeriod: periods[1] } as unknown as LifetimeV2DeterministicData;
    const { toJSON } = await render(<LuckPeriodHeader sectionKey="current_period" det={det} />);
    expect(toJSON()).toBeTruthy();
  });
});

// ---- Dispatcher ----
describe('renderReadingExtras / ReadingHeader dispatch', () => {
  it('lifetime header is CharacterCard; career section → career widget', async () => {
    await render(<ReadingHeader readingType="lifetime" chartData={CHART_FIXTURE} />);
    expect(screen.getByText('🌟 本質')).toBeTruthy();
    await render(
      <>{renderReadingExtras({ readingType: 'career', sectionKey: 'company_type_fit', deterministic: careerDet, chartData: null, isSubscriber: true })}</>,
    );
    expect(screen.getByText(/穩定型/)).toBeTruthy();
  });
  it('returns null with no deterministic data', () => {
    expect(
      renderReadingExtras({ readingType: 'career', sectionKey: 'company_type_fit', deterministic: undefined, chartData: null, isSubscriber: true }),
    ).toBeNull();
  });
});
