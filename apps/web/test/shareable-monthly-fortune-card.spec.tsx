/**
 * ShareableMonthlyFortuneCard — Tier B1 月運 share PNG card render test.
 *
 * Pure render test (no html2canvas / qrcode / Web Share API — those are
 * ShareFortuneButton's concern). Asserts: month band (derived from
 * data.month — NO top-level `year` field), ring score, label band, 4 dim
 * names, the 上半月/下半月 summary when intraMonthBreakdown is present AND its
 * omission when absent, headline source (overview first-sentence → friendly
 * fallback), and that NO folk grid is rendered (daily-only).
 */
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';

// Mock lucide-react — its ForwardRefExoticComponent shape collides with the
// dual `@types/react` identity in the test renderer. The card pulls dim icons
// via MONTHLY_DIM_META. Same workaround as narrative-card-streamed-sections.spec.
jest.mock('lucide-react', () =>
  new Proxy(
    {},
    {
      get: () =>
        function StubIcon() {
          return null;
        },
    },
  ),
);

import ShareableMonthlyFortuneCard from '../app/components/fortune/ShareableMonthlyFortuneCard';
import type { MonthlyFortuneResponse } from '../app/lib/fortune-api';

function makeBreakdown(): MonthlyFortuneResponse['intraMonthBreakdown'] {
  return {
    scheme_id: 'tiangan_dizhi_half',
    liuyue_window: { start: '2026-05-05', end: '2026-06-05', days: 31 },
    buckets: [
      {
        label: '上半月',
        day_range: [1, 15],
        governing_pillar: 'stem',
        auspicious_days: 9,
        challenging_days: 5,
        neutral_days: 1,
        peak_signals: [],
        dominant_shensha: ['天喜', '正官'],
      },
      {
        label: '下半月',
        day_range: [16, 31],
        governing_pillar: 'branch',
        auspicious_days: 11,
        challenging_days: 3,
        neutral_days: 2,
        peak_signals: [],
        dominant_shensha: ['驛馬'],
      },
    ],
  };
}

function makeData(overrides?: {
  narrative?: MonthlyFortuneResponse['narrative'];
  intraMonthBreakdown?: MonthlyFortuneResponse['intraMonthBreakdown'];
}): MonthlyFortuneResponse {
  const hasBreakdownOverride = !!overrides && 'intraMonthBreakdown' in overrides;
  return {
    month: '2026-05',
    flowYear: 2026,
    profileId: 'p1',
    profileBirthDate: '1987-09-06',
    profileBirthTime: '16:11',
    engineOutput: {
      monthStem: '癸',
      monthBranch: '巳',
      monthGanZhi: '癸巳',
      monthTenGod: '正財',
      monthLabel: '癸巳月',
      auspiciousness: '平',
      energyScore: 50,
      metaFraming: 'soft_trigger',
      dimensions: {
        career: { score: 62, label: '順遂', labelZh: '順遂', signals: [] },
        finance: { score: 55, label: '平穩', labelZh: '平穩', signals: [] },
        romance: { score: 48, label: '平穩', labelZh: '平穩', signals: [] },
        health: { score: 70, label: '順遂', labelZh: '順遂', signals: [] },
      },
      partitionSpec: { scheme_id: 'tiangan_dizhi_half', buckets: [] },
      ruleTrace: [],
      preAnalysisVersion: 'v1.1.0',
    } as MonthlyFortuneResponse['engineOutput'],
    narrative: overrides?.narrative ?? null,
    intraMonthBreakdown: hasBreakdownOverride ? overrides!.intraMonthBreakdown : makeBreakdown(),
    cacheHit: false,
    generatedAt: '2026-05-01T00:00:00Z',
  };
}

describe('ShareableMonthlyFortuneCard — Tier B1 月運 share', () => {
  it('renders month band (from data.month), ring score, label + 4 dim names; NO folk grid', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <ShareableMonthlyFortuneCard ref={ref} data={makeData()} qrDataUrl="data:image/png;base64,fake" />,
    );

    expect(screen.getByText('2026年5月')).toBeInTheDocument();
    expect(container.textContent).toContain('癸巳月 · 正財');
    expect(screen.getByText('50')).toBeInTheDocument(); // ring score
    expect(screen.getByText('平')).toBeInTheDocument(); // label band (exact — not 平穩)

    ['事業', '財運', '感情', '健康'].forEach((z) =>
      expect(screen.getByText(z)).toBeInTheDocument(),
    );

    // NO folk grid (daily-only differentiator)
    expect(screen.queryByText(/吉色/)).not.toBeInTheDocument();
    expect(screen.queryByText(/吉數/)).not.toBeInTheDocument();
    expect(screen.queryByText(/吉時/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('民俗來源')).not.toBeInTheDocument();
  });

  it('renders the 上半月/下半月 summary when intraMonthBreakdown is present', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <ShareableMonthlyFortuneCard ref={ref} data={makeData()} qrDataUrl="" />,
    );
    expect(screen.getByText('上半月')).toBeInTheDocument();
    expect(screen.getByText('下半月')).toBeInTheDocument();
    expect(container.textContent).toContain('天干主氣');
    expect(container.textContent).toContain('地支主氣');
    expect(container.textContent).toContain('9 吉日');
    expect(container.textContent).toContain('天喜');
  });

  it('omits the whole 上半月/下半月 box when intraMonthBreakdown is absent', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ShareableMonthlyFortuneCard
        ref={ref}
        data={makeData({ intraMonthBreakdown: undefined })}
        qrDataUrl=""
      />,
    );
    expect(screen.queryByText('上半月')).not.toBeInTheDocument();
    expect(screen.queryByText('下半月')).not.toBeInTheDocument();
    // dims still render
    expect(screen.getByText('事業')).toBeInTheDocument();
  });

  it('uses the monthly_overview first sentence as the headline when present', () => {
    const ref = createRef<HTMLDivElement>();
    const narrative = {
      monthly_overview: '本月整體平穩，宜穩中求進。後段更順。',
      monthly_career: '',
      monthly_finance: '',
      monthly_romance: '',
      monthly_health: '',
      monthly_advice: { canTry: [], shouldHold: [] },
    } as MonthlyFortuneResponse['narrative'];
    render(<ShareableMonthlyFortuneCard ref={ref} data={makeData({ narrative })} qrDataUrl="" />);
    expect(screen.getByText('本月整體平穩，宜穩中求進。')).toBeInTheDocument();
  });

  it('falls back to the friendly explanation as headline when narrative is null', () => {
    const ref = createRef<HTMLDivElement>();
    render(<ShareableMonthlyFortuneCard ref={ref} data={makeData()} qrDataUrl="" />);
    // 平 → '整體平穩，無強烈動靜' (no 今日 to swap → unchanged)
    expect(screen.getByText('整體平穩，無強烈動靜')).toBeInTheDocument();
  });
});
