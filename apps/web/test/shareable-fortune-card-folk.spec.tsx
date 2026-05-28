/**
 * ShareableFortuneCard — Phase 1.5.z folk grid regression lock.
 *
 * Verifies the share PNG card renders the 4 new folk slots
 * (吉色 / 吉數 [民俗] / 今日宜食 / 吉時) when engine populates them,
 * and gracefully hides the slot (or whole grid) when the engine omits
 * the field (rare: unresolved 用神 edge case).
 *
 * NOTE: this is a pure render test — no html2canvas / qrcode / Web Share API
 * involvement. Those concerns are covered by share-fortune-button.spec.tsx.
 */
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import ShareableFortuneCard from '../app/components/fortune/ShareableFortuneCard';
import type { DailyFortuneResponse } from '../app/lib/fortune-api';

// Mock HeadlinerAnchorLine to avoid pulling its chip-rendering deps —
// share card rendering of folk slots is what we want to assert.
jest.mock('../app/components/fortune/HeadlinerAnchorLine', () => ({
  __esModule: true,
  default: () => <div data-testid="headliner-mock" />,
}));

function makeFullFolkContent() {
  return {
    wealthDirection: {
      element: '火',
      direction: '南方',
      provenance: 'classical' as const,
      note: '',
    },
    luckyColor: {
      element: '火',
      primary: '紅',
      secondary: '紫',
      tertiary: '青綠',
      provenance: 'classical' as const,
      cite: '黃帝內經素問·五常政大論',
      note: '用神（火）配色',
    },
    luckyNumber: {
      element: '火',
      numbers: [2, 7],
      provenance: 'folk_tradition' as const,
      cite: '河圖：二七同道為火',
      note: '河圖五行數',
    },
    luckyFoodFavor: {
      element: '火',
      category: '紅色食物/苦味/養心',
      examples: ['番茄', '紅棗', '紅豆', '苦瓜', '蓮子心'],
      provenance: 'classical' as const,
      cite: '素問·陰陽應象大論',
    },
    luckyFoodAvoid: null,
    auspiciousHours: [
      { branch: '寅', hourRange: '03:00-05:00', classicalName: '青龍', provenance: 'classical' as const },
      { branch: '辰', hourRange: '07:00-09:00', classicalName: '金匱', provenance: 'classical' as const },
      { branch: '巳', hourRange: '09:00-11:00', classicalName: '天德', provenance: 'classical' as const },
      { branch: '申', hourRange: '15:00-17:00', classicalName: '玉堂', provenance: 'classical' as const },
      { branch: '酉', hourRange: '17:00-19:00', classicalName: '司命', provenance: 'classical' as const },
      { branch: '亥', hourRange: '21:00-23:00', classicalName: '明堂', provenance: 'classical' as const },
    ],
  };
}

function makeData(
  folkOverrides?: Partial<ReturnType<typeof makeFullFolkContent>>,
): DailyFortuneResponse {
  return {
    date: '2026-05-25',
    profileId: 'p1',
    profileBirthDate: '1987-09-06',
    profileBirthTime: '16:11',
    engineOutput: {
      dayStem: '己',
      dayBranch: '亥',
      dayGanZhi: '己亥',
      dayTenGod: '劫財',
      auspiciousness: '吉',
      energyScore: 72,
      metaFraming: 'soft_trigger',
      dimensions: {
        romance: { score: 75, label: '順遂', signals: [] },
        career: { score: 72, label: '順遂', signals: [] },
        finance: { score: 70, label: '平穩', signals: [] },
        travel: { score: 65, label: '平穩', signals: [] },
        health: { score: 60, label: '平穩', signals: [] },
      },
      folkContent: { ...makeFullFolkContent(), ...(folkOverrides ?? {}) },
      ruleTrace: [],
      preAnalysisVersion: 'v1.2.0',
    },
    narrative: null,
    cacheHit: false,
    generatedAt: '2026-05-25T00:00:00Z',
  };
}

describe('ShareableFortuneCard — Phase 1.5.z folk grid', () => {
  it('renders all 4 folk slots when engine populates them', () => {
    const ref = createRef<HTMLDivElement>();
    render(<ShareableFortuneCard ref={ref} data={makeData()} qrDataUrl="data:image/png;base64,fake" />);

    expect(screen.getByText(/🌈 吉色/)).toBeInTheDocument();
    expect(screen.getByText('紅／紫')).toBeInTheDocument();

    expect(screen.getByText(/🔢 吉數/)).toBeInTheDocument();
    expect(screen.getByText('2、7')).toBeInTheDocument();

    expect(screen.getByText(/🍃 今日宜食/)).toBeInTheDocument();
    expect(screen.getByText('紅色食物/苦味/養心')).toBeInTheDocument();

    expect(screen.getByText(/🕘 吉時/)).toBeInTheDocument();
    expect(screen.getByText('寅、辰、巳、申、酉、亥')).toBeInTheDocument();
  });

  it('renders 民俗 badge ONLY next to 吉數 (not on 吉色/吉食/吉時)', () => {
    const ref = createRef<HTMLDivElement>();
    render(<ShareableFortuneCard ref={ref} data={makeData()} qrDataUrl="" />);

    // Exactly ONE 民俗 badge on the card — locked to the 吉數 slot per
    // Phase 1.5.z provenance dispatch.
    const badges = screen.getAllByLabelText('民俗來源');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('民俗');
  });

  it('omits 「忌食」 from share card (deliberately positive vibe)', () => {
    const ref = createRef<HTMLDivElement>();
    render(<ShareableFortuneCard ref={ref} data={makeData()} qrDataUrl="" />);

    // The «今日宜食» label is present (favor); «今日忌食» / «忌食» MUST NOT be —
    // share card deliberately excludes the avoid framing + 五行 reason
    // citation + medical disclaimer to keep the shared image upbeat.
    expect(screen.queryByText(/今日忌/)).not.toBeInTheDocument();
    expect(screen.queryByText(/避免/)).not.toBeInTheDocument();
  });

  it('hides individual slot when its field is null (defensive, e.g. unresolved 用神 case)', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ShareableFortuneCard
        ref={ref}
        data={makeData({ luckyNumber: null })}
        qrDataUrl=""
      />,
    );

    expect(screen.queryByText(/🔢 吉數/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('民俗來源')).not.toBeInTheDocument();
    // Other slots still present.
    expect(screen.getByText(/🌈 吉色/)).toBeInTheDocument();
    expect(screen.getByText(/🍃 今日宜食/)).toBeInTheDocument();
    expect(screen.getByText(/🕘 吉時/)).toBeInTheDocument();
  });

  it('hides ENTIRE folk grid when engine omits all 4 fields (cleanup, no empty box)', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ShareableFortuneCard
        ref={ref}
        data={makeData({
          luckyColor: null,
          luckyNumber: null,
          luckyFoodFavor: null,
          luckyFoodAvoid: null,
          auspiciousHours: [],
        })}
        qrDataUrl=""
      />,
    );

    expect(screen.queryByText(/🌈 吉色/)).not.toBeInTheDocument();
    expect(screen.queryByText(/🔢 吉數/)).not.toBeInTheDocument();
    expect(screen.queryByText(/🍃 今日宜食/)).not.toBeInTheDocument();
    expect(screen.queryByText(/🕘 吉時/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('民俗來源')).not.toBeInTheDocument();
  });
});
