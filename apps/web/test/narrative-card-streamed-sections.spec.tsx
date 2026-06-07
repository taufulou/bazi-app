/**
 * Tests for NarrativeCard's `streamedSections` prop — Phase Fortune Streaming L5.
 *
 * Covers the HYBRID render mode introduced for plan v2 architecture:
 *   - narrative null + streamedSections empty + loading=true → full skeleton
 *   - narrative null + some streamedSections → hybrid (per-section: provisional
 *     prose for received keys, skeleton for pending keys)
 *   - narrative populated → standard render (streamedSections ignored)
 *   - Canonical order: DIM_META iteration enforces order regardless of which
 *     section arrived first (plan v2 H5)
 *   - InlineAskCard visibility: rendered visible only when that dim's
 *     narrative has arrived (avoids prompting questions about un-narrated dims)
 *   - Disclaimer present in hybrid mode (plan v2 H4: Y position stable)
 */
import * as React from 'react'; // Required for dual @types/react JSX-identity workaround

// Mock lucide-react icons — their ForwardRefExoticComponent shape collides
// with the dual `@types/react` identity in the test renderer. Replace with
// simple <span> stubs that preserve the icon's data-icon attribute for
// assertion if needed (none of the tests below do — just needed to keep
// React's reconciler happy).
jest.mock('lucide-react', () => {
  const stub = (name: string) =>
    function StubIcon(_props: any) {
      return null;
    };
  return new Proxy(
    {},
    {
      get: (_target, prop: string) => stub(prop),
    },
  );
});

import { render, screen } from '@testing-library/react';
import NarrativeCard from '../app/components/fortune/NarrativeCard';
import type { DailyFortuneNarrative, FortuneDimension } from '../app/lib/fortune-api';

// ============================================================
// Fixtures
// ============================================================

const DIM: FortuneDimension = {
  score: 50,
  label: '平',
  signals: [],
};
const DIMS = {
  romance: { ...DIM },
  career: { ...DIM },
  finance: { ...DIM },
  travel: { ...DIM },
  health: { ...DIM },
};

const FULL_NARRATIVE: DailyFortuneNarrative = {
  daily_overview: '今日整體偏向平穩',
  daily_romance: '感情敘述',
  daily_romance_takeaway: '感情提醒',
  daily_career: '事業敘述',
  daily_career_takeaway: '事業提醒',
  daily_finance: '財運敘述',
  daily_finance_takeaway: '財運提醒',
  daily_travel: '出行敘述',
  daily_travel_takeaway: '出行提醒',
  daily_health: '健康敘述',
  daily_health_takeaway: '健康提醒',
  daily_advice: {
    canTry: ['整理桌面'],
    shouldHold: ['重大決定延後'],
  },
};

// ============================================================
// Tests
// ============================================================

describe('NarrativeCard streamedSections', () => {
  describe('mode dispatch', () => {
    it('renders FULL skeleton when narrative=null + streamedSections empty + loading=true', () => {
      const { container } = render(
        <NarrativeCard
          narrative={null}
          dimensions={DIMS}
          loading
          streamedSections={{}}
        />,
      );
      expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
      expect(container.querySelectorAll('[class*="skeletonLine"]').length).toBeGreaterThan(0);
      // No real prose text yet
      expect(screen.queryByText('感情敘述')).not.toBeInTheDocument();
    });

    it('renders honest AI-unavailable fallback when narrative=null + streamedSections empty + loading=false', () => {
      render(
        <NarrativeCard
          narrative={null}
          dimensions={DIMS}
          loading={false}
        />,
      );
      // Honest copy (2026-05-31 resilience fix): the engine data above stays
      // usable + the user is told to come back, rather than a misleading
      // «請重新整理頁面再試一次» that wouldn't help during an AI outage.
      expect(screen.getByText(/AI 文字解讀暫時無法產生/)).toBeInTheDocument();
    });

    it('renders HYBRID when narrative=null + some streamedSections + loading=true', () => {
      render(
        <NarrativeCard
          narrative={null}
          dimensions={DIMS}
          loading
          streamedSections={{
            daily_overview: '提早到達的整體敘述',
          }}
        />,
      );
      // Provisional overview rendered
      expect(screen.getByText('提早到達的整體敘述')).toBeInTheDocument();
      // Disclaimer present (plan v2 H4 — Y position stable)
      expect(screen.getByText(/今日運勢為「軟提示」/)).toBeInTheDocument();
    });

    it('renders STANDARD when narrative is fully populated (streamedSections ignored)', () => {
      render(
        <NarrativeCard
          narrative={FULL_NARRATIVE}
          dimensions={DIMS}
          streamedSections={{
            daily_overview: '【provisional — should NOT win】',
          }}
        />,
      );
      // narrative wins over streamedSections
      expect(screen.getByText('今日整體偏向平穩')).toBeInTheDocument();
      expect(screen.queryByText('【provisional — should NOT win】')).not.toBeInTheDocument();
      // No aria-busy on standard render
      expect(document.querySelector('section[aria-busy="true"]')).not.toBeInTheDocument();
    });
  });

  describe('per-section dispatch', () => {
    it('renders provisional text for received sections + skeleton for pending', () => {
      const { container } = render(
        <NarrativeCard
          narrative={null}
          dimensions={DIMS}
          loading
          streamedSections={{
            daily_overview: '整體已到達',
            daily_romance: '感情已到達',
          }}
        />,
      );
      expect(screen.getByText('整體已到達')).toBeInTheDocument();
      expect(screen.getByText('感情已到達')).toBeInTheDocument();
      // Other dim narratives NOT yet — skeleton lines instead
      expect(screen.queryByText('事業敘述')).not.toBeInTheDocument();
      // Should still have skeleton lines for the missing sections
      expect(container.querySelectorAll('[class*="skeletonLine"]').length).toBeGreaterThan(0);
    });

    it('renders advice provisional when only daily_advice has arrived', () => {
      render(
        <NarrativeCard
          narrative={null}
          dimensions={DIMS}
          loading
          streamedSections={{
            daily_advice: { canTry: ['提早建議'], shouldHold: ['提早警告'] },
          }}
        />,
      );
      expect(screen.getByText('提早建議')).toBeInTheDocument();
      expect(screen.getByText('提早警告')).toBeInTheDocument();
    });

    it('canonical order: DIM_META iteration order is independent of arrival order', () => {
      // Arrange section arrival OUT OF ORDER: health first, romance last
      const { container } = render(
        <NarrativeCard
          narrative={null}
          dimensions={DIMS}
          loading
          streamedSections={{
            daily_health: '健康先到達',
            daily_overview: '整體後到',
            daily_romance: '感情最後',
          }}
        />,
      );
      // Plan v2 H5 — DIM_META iteration in NarrativeCard enforces canonical
      // render order regardless of arrival order. Verify by examining the
      // ORDER OF TEXT in the rendered DOM.
      const html = container.innerHTML;
      const romanceIdx = html.indexOf('感情最後');
      const healthIdx = html.indexOf('健康先到達');
      expect(romanceIdx).toBeGreaterThanOrEqual(0);
      expect(healthIdx).toBeGreaterThanOrEqual(0);
      // Romance section comes BEFORE health in the canonical DIM_META order
      // (romance / career / finance / travel / health)
      expect(romanceIdx).toBeLessThan(healthIdx);
    });
  });

  describe('InlineAskCard visibility (plan v2 H4 layout reservation)', () => {
    it('renders InlineAskCard VISIBLE for narrated dim sections', () => {
      const renderAfterDimension = jest.fn(() => (
        <div data-testid="inline-ask-card">Ask card</div>
      ));
      render(
        <NarrativeCard
          narrative={null}
          dimensions={DIMS}
          loading
          streamedSections={{
            daily_romance: '感情已到',
          }}
          renderAfterDimension={renderAfterDimension}
        />,
      );
      // 5 dim sections always render the slot (visible OR hidden)
      expect(renderAfterDimension).toHaveBeenCalledTimes(5);
    });

    it('hides InlineAskCard (visibility:hidden) for un-narrated dims to reserve space', () => {
      const renderAfterDimension = jest.fn(() => (
        <div data-testid="inline-ask-card">Ask card</div>
      ));
      const { container } = render(
        <NarrativeCard
          narrative={null}
          dimensions={DIMS}
          loading
          streamedSections={{
            daily_romance: '感情已到',
          }}
          renderAfterDimension={renderAfterDimension}
        />,
      );
      // The 4 un-narrated dims' ask-card wrappers should have visibility:hidden
      // inline style for layout reservation (plan v2 H4 — keeps disclaimer Y
      // delta ≤ 8px when sections fill in).
      const hiddenWrappers = container.querySelectorAll(
        'div[style*="visibility: hidden"], div[style*="visibility:hidden"]',
      );
      // 4 hidden (career/finance/travel/health) + 1 visible (romance)
      expect(hiddenWrappers.length).toBe(4);
    });
  });

  describe('layout stability (plan v2 H4 — disclaimer presence)', () => {
    it('disclaimer present in hybrid mode', () => {
      render(
        <NarrativeCard
          narrative={null}
          dimensions={DIMS}
          loading
          streamedSections={{ daily_overview: 'x' }}
        />,
      );
      expect(screen.getByText(/今日運勢為「軟提示」/)).toBeInTheDocument();
    });

    it('disclaimer present in standard mode (full narrative)', () => {
      render(
        <NarrativeCard
          narrative={FULL_NARRATIVE}
          dimensions={DIMS}
        />,
      );
      expect(screen.getByText(/今日運勢為「軟提示」/)).toBeInTheDocument();
    });

    it('disclaimer present in full-skeleton mode (no sections yet)', () => {
      render(
        <NarrativeCard
          narrative={null}
          dimensions={DIMS}
          loading
          streamedSections={{}}
        />,
      );
      expect(screen.getByText(/今日運勢為「軟提示」/)).toBeInTheDocument();
    });
  });
});
