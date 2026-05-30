/**
 * Phase 3 年運 — YearlyDimensionStars RTL spec.
 *
 * Covers:
 *   - Renders 4 dim cards (事業/財運/感情/健康)
 *   - ★ filled count matches engine `stars` (filled ★ vs empty ☆)
 *   - AI keyword line renders when provided, omitted when absent
 *   - Verdict label (engine `label`) renders
 */
import * as React from 'react';
import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';

// Lucide uses forwardRef which triggers a React identity mismatch in jsdom
// (multiple @types/react resolve to different namespaces). Replacing with
// plain spans dodges this AND keeps tests focused on behavior, not icons.
jest.mock('lucide-react', () => ({
  __esModule: true,
  HeartHandshake: () => <span data-icon="HeartHandshake" />,
  Briefcase: () => <span data-icon="Briefcase" />,
  Wallet: () => <span data-icon="Wallet" />,
  Activity: () => <span data-icon="Activity" />,
}));

import YearlyDimensionStars from '../app/components/fortune/YearlyDimensionStars';
import type { YearlyFortuneDimension } from '../app/lib/fortune-api';

function mkDim(over: Partial<YearlyFortuneDimension>): YearlyFortuneDimension {
  return { score: 60, label: '順遂', stars: 4, labelZh: '順遂', ...over };
}

const DIMENSIONS = {
  career: mkDim({ stars: 5, label: '極佳', score: 85 }),
  finance: mkDim({ stars: 3, label: '平穩', score: 50 }),
  romance: mkDim({ stars: 2, label: '需謹慎', score: 35 }),
  health: mkDim({ stars: 4, label: '順遂', score: 70 }),
};

describe('YearlyDimensionStars', () => {
  it('renders all 4 dim labels', () => {
    render(<YearlyDimensionStars dimensions={DIMENSIONS} />);
    expect(screen.getByText('事業')).toBeInTheDocument();
    expect(screen.getByText('財運')).toBeInTheDocument();
    expect(screen.getByText('感情')).toBeInTheDocument();
    expect(screen.getByText('健康')).toBeInTheDocument();
  });

  it('renders ★ stars matching engine `stars` count via aria-label', () => {
    render(<YearlyDimensionStars dimensions={DIMENSIONS} />);
    // career=5 filled
    expect(
      screen.getByLabelText('事業：5 顆星（共 5 顆）'),
    ).toBeInTheDocument();
    // romance=2 filled
    expect(
      screen.getByLabelText('感情：2 顆星（共 5 顆）'),
    ).toBeInTheDocument();
  });

  it('renders filled ★ and empty ☆ glyphs per star count', () => {
    render(
      <YearlyDimensionStars
        dimensions={{
          ...DIMENSIONS,
          career: mkDim({ stars: 3, label: '平穩', score: 50 }),
        }}
      />,
    );
    const careerCard = screen
      .getByLabelText('事業：3 顆星（共 5 顆）');
    const filled = careerCard.querySelectorAll('[data-filled="true"]');
    const empty = careerCard.querySelectorAll('[data-filled="false"]');
    expect(filled).toHaveLength(3);
    expect(empty).toHaveLength(2);
  });

  it('renders AI keyword when provided, omits when absent', () => {
    const { rerender } = render(
      <YearlyDimensionStars
        dimensions={DIMENSIONS}
        keywords={{ career: '突破升遷' }}
      />,
    );
    expect(screen.getByText('突破升遷')).toBeInTheDocument();

    rerender(<YearlyDimensionStars dimensions={DIMENSIONS} />);
    expect(screen.queryByText('突破升遷')).not.toBeInTheDocument();
  });

  it('renders the verdict label from engine', () => {
    render(<YearlyDimensionStars dimensions={DIMENSIONS} />);
    expect(screen.getByText('極佳')).toBeInTheDocument();
    expect(screen.getByText('需謹慎')).toBeInTheDocument();
  });

  it('defaults to 3 stars when a dim is missing stars (defensive)', () => {
    render(
      <YearlyDimensionStars
        dimensions={{
          ...DIMENSIONS,
          health: mkDim({ stars: undefined as unknown as number }),
        }}
      />,
    );
    expect(
      screen.getByLabelText('健康：3 顆星（共 5 顆）'),
    ).toBeInTheDocument();
  });
});
