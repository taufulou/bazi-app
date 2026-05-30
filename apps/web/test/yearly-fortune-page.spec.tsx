/**
 * Phase 3 年運 — Yearly view components basic-render RTL spec.
 *
 * The full /reading/fortune page is heavy (Clerk + useSearchParams + SSE).
 * This spec exercises the yearly presentational components that make up the
 * YearlyFortuneView render stack, verifying the section structure + content
 * shape Seer parity requires:
 *   - YearlyEnergyRing (overall 0-100 ring + ganzhi/十神 sub-line)
 *   - YearlyNarrativeCard (年度總結 headline + overview + dim prose + 年度建議)
 *   - YearlyRiskOpportunityGrid (核心風險&機會 columns + flatYear)
 *   - YearlyLuckMethodsCard (改運建議&好運加持 + 民俗 badge)
 *   - YearlyCrossSellCard (→ /reading/annual)
 */
import * as React from 'react';
import { describe, expect, it } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';

// Lucide forwardRef dodge.
jest.mock('lucide-react', () => ({
  __esModule: true,
  HeartHandshake: () => <span data-icon="HeartHandshake" />,
  Briefcase: () => <span data-icon="Briefcase" />,
  Wallet: () => <span data-icon="Wallet" />,
  Activity: () => <span data-icon="Activity" />,
  ArrowUpRight: () => <span data-icon="ArrowUpRight" />,
}));

// next/link → plain anchor.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// InfoTooltip pulls icons / portals — stub it for the ring test.
jest.mock('../app/components/fortune/InfoTooltip', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="info-tooltip">{children}</span>
  ),
}));

import YearlyEnergyRing from '../app/components/fortune/YearlyEnergyRing';
import YearlyNarrativeCard from '../app/components/fortune/YearlyNarrativeCard';
import YearlyRiskOpportunityGrid from '../app/components/fortune/YearlyRiskOpportunityGrid';
import YearlyLuckMethodsCard from '../app/components/fortune/YearlyLuckMethodsCard';
import YearlyCrossSellCard from '../app/components/fortune/YearlyCrossSellCard';
import type {
  YearlyFortuneNarrative,
  YearlyCoreRiskOpportunity,
  YearlyLuckMethods,
} from '../app/lib/fortune-api';

describe('YearlyEnergyRing', () => {
  it('renders year + ganzhi/十神 sub-line + score + label', () => {
    render(
      <YearlyEnergyRing
        label="吉"
        score={68}
        year={2026}
        yearGanZhi="丙午"
        yearTenGod="偏官"
      />,
    );
    expect(screen.getByText('2026年')).toBeInTheDocument();
    expect(screen.getByText(/丙午年/)).toBeInTheDocument();
    expect(screen.getByText(/偏官/)).toBeInTheDocument();
    expect(screen.getByText('68')).toBeInTheDocument();
    expect(screen.getByText('吉')).toBeInTheDocument();
  });
});

describe('YearlyNarrativeCard', () => {
  const NARRATIVE: YearlyFortuneNarrative = {
    yearly_headline: '丙午年事業突破之年',
    yearly_overview: '今年整體偏向積極進取。',
    yearly_career: '事業有升遷契機。',
    yearly_career_keyword: '升遷',
    yearly_finance: '財運穩中有進。',
    yearly_finance_keyword: '穩進',
    yearly_romance: '感情和諧。',
    yearly_romance_keyword: '和諧',
    yearly_health: '注意作息。',
    yearly_health_keyword: '養生',
    yearly_advice: '建議今年穩中求進，把握上半年機會。',
    yearly_risk_opportunities: [],
  };

  const DIMS = {
    career: { score: 80, label: '極佳' },
    finance: { score: 60, label: '順遂' },
    romance: { score: 55, label: '平穩' },
    health: { score: 45, label: '需謹慎' },
  };

  it('renders headline + overview + advice block', () => {
    render(<YearlyNarrativeCard narrative={NARRATIVE} dimensions={DIMS} />);
    expect(screen.getByText('年度總結')).toBeInTheDocument();
    expect(screen.getByText('丙午年事業突破之年')).toBeInTheDocument();
    expect(screen.getByText('今年整體偏向積極進取。')).toBeInTheDocument();
    expect(screen.getByText('年度建議')).toBeInTheDocument();
    expect(
      screen.getByText('建議今年穩中求進，把握上半年機會。'),
    ).toBeInTheDocument();
  });

  it('renders 4 dim prose blocks + keywords', () => {
    render(<YearlyNarrativeCard narrative={NARRATIVE} dimensions={DIMS} />);
    expect(screen.getByText('事業有升遷契機。')).toBeInTheDocument();
    expect(screen.getByText('升遷')).toBeInTheDocument();
    expect(screen.getByText('養生')).toBeInTheDocument();
  });

  it('renders loading skeleton when narrative null + loading', () => {
    render(
      <YearlyNarrativeCard narrative={null} dimensions={DIMS} loading />,
    );
    expect(screen.getByLabelText('今年 AI 解讀載入中')).toBeInTheDocument();
  });

  it('hybrid render: pulls a section from streamedSections when narrative null', () => {
    render(
      <YearlyNarrativeCard
        narrative={null}
        dimensions={DIMS}
        loading
        streamedSections={{ yearly_overview: '串流中的總覽段落。' }}
      />,
    );
    expect(screen.getByText('串流中的總覽段落。')).toBeInTheDocument();
  });
});

describe('YearlyRiskOpportunityGrid', () => {
  const NORMAL: YearlyCoreRiskOpportunity = {
    flatYear: false,
    opportunities: [
      {
        month: 3,
        monthLabel: '3月',
        auspiciousness: '吉',
        energyScore: 72,
        dim: 'career',
        dimZh: '事業',
        deviationSign: 'positive',
        caveat: false,
        slot: 'opportunity',
      },
    ],
    risks: [
      {
        month: 8,
        monthLabel: '8月',
        auspiciousness: '凶',
        energyScore: 30,
        dim: 'health',
        dimZh: '健康',
        deviationSign: 'negative',
        caveat: true,
        slot: 'risk',
      },
    ],
  };

  it('renders 機會點 + 風險點 columns with engine months', () => {
    render(<YearlyRiskOpportunityGrid coreRiskOpportunity={NORMAL} />);
    expect(screen.getByText('機會點')).toBeInTheDocument();
    expect(screen.getByText('風險點')).toBeInTheDocument();
    expect(screen.getByText('3月')).toBeInTheDocument();
    expect(screen.getByText('8月')).toBeInTheDocument();
  });

  it('renders AI keyword + narrative paired by index', () => {
    render(
      <YearlyRiskOpportunityGrid
        coreRiskOpportunity={NORMAL}
        aiEntries={[
          {
            month_label: '3月',
            type: 'opportunity',
            keyword: '升遷良機',
            narrative: '三月事業見光。',
          },
          {
            month_label: '8月',
            type: 'risk',
            keyword: '健康警訊',
            narrative: '八月注意身體。',
          },
        ]}
      />,
    );
    expect(screen.getByText('升遷良機')).toBeInTheDocument();
    expect(screen.getByText('八月注意身體。')).toBeInTheDocument();
  });

  it('renders caveat tag for caveat=true entry', () => {
    render(<YearlyRiskOpportunityGrid coreRiskOpportunity={NORMAL} />);
    expect(screen.getByText('機會中留意：健康')).toBeInTheDocument();
  });

  it('renders flatYear message when flatYear=true', () => {
    render(
      <YearlyRiskOpportunityGrid
        coreRiskOpportunity={{ flatYear: true, opportunities: [], risks: [] }}
      />,
    );
    expect(
      screen.getByText(/今年運勢平穩，無顯著起伏/),
    ).toBeInTheDocument();
    expect(screen.queryByText('機會點')).not.toBeInTheDocument();
  });
});

describe('YearlyLuckMethodsCard', () => {
  const LUCK: YearlyLuckMethods = {
    weakestDim: 'health',
    weakestDimZh: '健康',
    disclaimer: '改運建議僅供參考。',
    cards: [
      {
        id: 'm1',
        title: '用神方位調養',
        body: '常居南方有助運勢。',
        provenance: 'classical',
        usefulGodElement: '火',
        usefulGodDirection: '南方',
      },
      {
        id: 'm2',
        title: '吉色穿搭',
        body: '可多穿紅色衣物。',
        provenance: 'folk_tradition',
      },
    ],
  };

  it('renders title + cards + disclaimer', () => {
    render(<YearlyLuckMethodsCard luckMethods={LUCK} />);
    expect(screen.getByText('改運建議 & 好運加持')).toBeInTheDocument();
    expect(screen.getByText('用神方位調養')).toBeInTheDocument();
    expect(screen.getByText('吉色穿搭')).toBeInTheDocument();
    expect(screen.getByText('改運建議僅供參考。')).toBeInTheDocument();
  });

  it('shows 民俗 badge ONLY on folk_tradition / mixed cards', () => {
    render(<YearlyLuckMethodsCard luckMethods={LUCK} />);
    const badges = screen.getAllByText('民俗');
    expect(badges).toHaveLength(1); // only the folk_tradition card
  });

  it('renders useful-god meta chips when present', () => {
    render(<YearlyLuckMethodsCard luckMethods={LUCK} />);
    expect(screen.getByText('用神：火')).toBeInTheDocument();
    expect(screen.getByText('方位：南方')).toBeInTheDocument();
  });

  it('renders nothing when cards empty', () => {
    const { container } = render(
      <YearlyLuckMethodsCard
        luckMethods={{ ...LUCK, cards: [] }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('YearlyCrossSellCard', () => {
  it('links to the paid /reading/annual reading', () => {
    render(<YearlyCrossSellCard />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/reading/annual');
    expect(
      within(link).getByText('想要完整的流年深度解讀？'),
    ).toBeInTheDocument();
  });
});
