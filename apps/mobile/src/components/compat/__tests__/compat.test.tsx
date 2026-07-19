import { render, screen } from '@testing-library/react-native';
import CompatibilityScoreRevealV2 from '../CompatibilityScoreRevealV2';
import CompatibilityRevealCTA from '../CompatibilityRevealCTA';
import ShareableCompatibilityCard from '../ShareableCompatibilityCard';
import DualBirthDataForm from '../../DualBirthDataForm';
import {
  transformAIResponse,
  COMPAT_ROMANCE_V2_SECTION_ORDER,
} from '../../../lib/readings-api';

// ---- readings-api compat transform ----
describe('transformAIResponse — compat V2 ordering', () => {
  it('orders compat sections by COMPAT_ROMANCE_V2_SECTION_ORDER + maps titles', () => {
    // Scrambled section keys; the marriage_advice/combined_crisis_analysis keys
    // trigger the isCompatV2 branch.
    const sections: Record<string, { preview: string; full: string }> = {
      marriage_advice: { preview: 'p', full: 'f' },
      compatibility_basis: { preview: 'p', full: 'f' },
      combined_crisis_analysis: { preview: 'p', full: 'f' },
      chart_profile_a: { preview: 'p', full: 'f' },
    };
    const out = transformAIResponse({ schemaVersion: 'v2', sections });
    expect(out).not.toBeNull();
    const keys = out!.sections.map((s) => s.key);
    // compatibility_basis is first in the order list → first rendered.
    expect(keys[0]).toBe('compatibility_basis');
    expect(keys.indexOf('chart_profile_a')).toBeLessThan(keys.indexOf('combined_crisis_analysis'));
    // combined_crisis_analysis precedes marriage_advice in the canonical order.
    expect(keys.indexOf('combined_crisis_analysis')).toBeLessThan(keys.indexOf('marriage_advice'));
    // titles mapped to zh-TW
    const basis = out!.sections.find((s) => s.key === 'compatibility_basis');
    expect(basis?.title).toBe('配對基礎分析');
  });

  it('COMPAT_ROMANCE_V2_SECTION_ORDER covers all 18 romance keys', () => {
    expect(COMPAT_ROMANCE_V2_SECTION_ORDER).toHaveLength(18);
    expect(COMPAT_ROMANCE_V2_SECTION_ORDER).toContain('compatibility_summary');
    expect(COMPAT_ROMANCE_V2_SECTION_ORDER).toContain('annual_love_a');
  });
});

// ---- CompatibilityScoreRevealV2 ----
describe('CompatibilityScoreRevealV2', () => {
  const base = {
    score: 85,
    label: '天生一對',
    nameA: 'Roger',
    nameB: 'Laopo',
    peachBlossomCountA: 2,
    peachBlossomCountB: 1,
    spouseStarCountA: 3,
    spouseStarCountB: 2,
    romancePA: {
      postMarriageQuality: { sweetness: { score: 88 }, stability: { score: 80 } },
      combinedCrisis: { overallLevel: '輕微' },
    },
  };

  it('renders label + names + badges + 老師寄語', async () => {
    await render(<CompatibilityScoreRevealV2 {...base} />);
    expect(screen.getByText('天生一對')).toBeTruthy();
    expect(screen.getByText('Roger')).toBeTruthy();
    expect(screen.getByText('Laopo')).toBeTruthy();
    // Emoji prefixes were removed from these badges — the app's own iconography is
    // vector now (emoji inside AI prose is backend-owned and stays).
    expect(screen.getByText('桃花 2朵')).toBeTruthy();
    expect(screen.getByText('姻緣星 3顆')).toBeTruthy();
    expect(screen.getByText(/老師寄語/)).toBeTruthy();
  });

  it('shows the <55 reassurance banner only for low scores', async () => {
    const { rerender } = await render(<CompatibilityScoreRevealV2 {...base} score={40} />);
    expect(screen.getByText(/分數不等於命運/)).toBeTruthy();
    await rerender(<CompatibilityScoreRevealV2 {...base} score={85} />);
    expect(screen.queryByText(/分數不等於命運/)).toBeNull();
  });
});

// ---- CompatibilityRevealCTA ----
describe('CompatibilityRevealCTA', () => {
  it('renders the feature list + reveal button', async () => {
    await render(<CompatibilityRevealCTA onReveal={() => {}} isRevealing={false} />);
    expect(screen.getByText('查看完整報告')).toBeTruthy();
    expect(screen.getByText('八字感情合盤完整報告')).toBeTruthy();
  });

  it('labels 時辰未知 by the unknown party’s actual gender', async () => {
    // hourUnknownA + genderA=female → 女方
    await render(
      <CompatibilityRevealCTA onReveal={() => {}} isRevealing={false} hourUnknownA genderA="female" />,
    );
    expect(screen.getByText(/女方出生時辰那一柱的分析/)).toBeTruthy();
  });

  it('shows 雙方 when both parties lack a birth hour', async () => {
    await render(
      <CompatibilityRevealCTA onReveal={() => {}} isRevealing={false} hourUnknownA hourUnknownB />,
    );
    expect(screen.getByText(/雙方出生時辰那一柱的分析/)).toBeTruthy();
  });
});

// ---- ShareableCompatibilityCard ----
describe('ShareableCompatibilityCard', () => {
  it('renders names + score + label + metrics', async () => {
    await render(
      <ShareableCompatibilityCard score={85} label="天生一對" nameA="Roger" nameB="Laopo" sweetness={88} stability={80} />,
    );
    expect(screen.getByText('Roger')).toBeTruthy();
    expect(screen.getByText('Laopo')).toBeTruthy();
    expect(screen.getByText('85')).toBeTruthy();
    expect(screen.getByText('天生一對')).toBeTruthy();
    expect(screen.getByText('甜蜜度')).toBeTruthy();
  });
});

// ---- DualBirthDataForm ----
describe('DualBirthDataForm', () => {
  const noop = async () => {};
  it('shows the create-profile prompt when no saved profiles', async () => {
    await render(
      <DualBirthDataForm
        onSubmit={noop}
        isLoading={false}
        savedProfiles={[]}
        userCredits={10}
        creditCost={3}
        getToken={async () => 't'}
      />,
    );
    expect(screen.getByText(/請先於「我的」建立您的命盤/)).toBeTruthy();
  });

  it('hides the type selector (only 感情合盤 enabled) + renders the form', async () => {
    const self = {
      id: 'a',
      name: 'Roger',
      birthDate: '1987-09-06',
      birthTime: '16:11',
      hourKnown: true,
      birthCity: 'Kedah',
      birthTimezone: 'Asia/Kuala_Lumpur',
      birthLongitude: null,
      birthLatitude: null,
      gender: 'MALE' as const,
      relationshipTag: 'SELF' as const,
      isPrimary: true,
      isLunarDate: false,
      lunarBirthDate: null,
      isLeapMonth: false,
      createdAt: '',
      updatedAt: '',
    };
    await render(
      <DualBirthDataForm
        onSubmit={noop}
        isLoading={false}
        savedProfiles={[self]}
        userCredits={10}
        creditCost={3}
        getToken={async () => 't'}
      />,
    );
    // Only 感情合盤 is enabled → the type selector is hidden entirely.
    expect(screen.queryByText('事業合盤')).toBeNull();
    expect(screen.queryByText('友誼合盤')).toBeNull();
    // The form itself still renders (romance-only subtitle + 對方 panel).
    expect(screen.getByText('八字合盤分析')).toBeTruthy();
    expect(screen.getByText('對方')).toBeTruthy();
  });
});
