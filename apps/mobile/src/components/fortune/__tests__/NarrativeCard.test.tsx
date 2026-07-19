import { render, screen } from '@testing-library/react-native';
import NarrativeCard from '../NarrativeCard';
import type { DailyFortuneNarrative, FortuneDimension } from '../../../lib/fortune-api';

const dims: Record<'romance' | 'career' | 'finance' | 'travel' | 'health', FortuneDimension> = {
  romance: { score: 46, label: '需謹慎', signals: [{ type: 'honluan', narrative: '紅鸞星動觸發' }] },
  career: { score: 47, label: '需謹慎', signals: [] },
  finance: { score: 45, label: '需謹慎', signals: [] },
  travel: { score: 32, label: '不利', signals: [] },
  health: { score: 41, label: '需謹慎', signals: [] },
};

const narrative: DailyFortuneNarrative = {
  daily_overview: '今日整體平穩無強烈動靜',
  daily_romance: '感情層面宜溫和對話',
  daily_career: '事業層面穩健推進',
  daily_finance: '財運層面宜守不宜攻',
  daily_travel: '出行層面注意安全',
  daily_health: '健康層面宜養護為主',
  daily_advice: { canTry: ['安排學習閱讀'], shouldHold: ['避免重大簽約'] },
};

describe('NarrativeCard — 4 render states', () => {
  it('loading: renders the full skeleton (heading + AI hint + disclaimer)', async () => {
    await render(<NarrativeCard narrative={null} dimensions={dims} loading />);
    expect(screen.getByText('今日整體')).toBeTruthy();
    expect(screen.getByText('AI 命理師正在為您解讀今日命盤…')).toBeTruthy();
    expect(screen.getByText(/今日運勢為「軟提示」/)).toBeTruthy();
  });

  it('AI-failed fallback: shows the fallback lead + deterministic signals list', async () => {
    await render(<NarrativeCard narrative={null} dimensions={dims} loading={false} />);
    expect(screen.getByText(/AI 文字解讀暫時無法產生/)).toBeTruthy();
    // SignalsList renders each dim's signals (romance has one)
    expect(screen.getByText('· 紅鸞星動觸發')).toBeTruthy();
  });

  it('success: renders hero + per-dim narratives + advice + disclaimer', async () => {
    await render(<NarrativeCard narrative={narrative} dimensions={dims} />);
    expect(screen.getByText('今日整體平穩無強烈動靜')).toBeTruthy();
    expect(screen.getByText('感情層面宜溫和對話')).toBeTruthy();
    expect(screen.getByText('健康層面宜養護為主')).toBeTruthy();
    expect(screen.getByText('今日可試試')).toBeTruthy();
    expect(screen.getByText('安排學習閱讀')).toBeTruthy();
    expect(screen.getByText('今日宜緩')).toBeTruthy();
    expect(screen.getByText('避免重大簽約')).toBeTruthy();
    expect(screen.getByText(/今日運勢為「軟提示」/)).toBeTruthy();
  });

  it('hybrid streaming: renders provisional streamedSections while narrative is null', async () => {
    await render(
      <NarrativeCard
        narrative={null}
        dimensions={dims}
        streamedSections={{ daily_overview: '串流中的今日總覽', daily_career: '串流事業段落' }}
      />,
    );
    expect(screen.getByText('串流中的今日總覽')).toBeTruthy();
    expect(screen.getByText('串流事業段落')).toBeTruthy();
  });
});
