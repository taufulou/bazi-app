/**
 * Tests for AIReadingDisplay component.
 * Validates reading sections, paywall, cross-sell, and loading states.
 */
import { render, screen } from '@testing-library/react';
import AIReadingDisplay from '../app/components/AIReadingDisplay';

// Mock Next.js navigation (Link component uses router context)
jest.mock('next/link', () => {
  return function MockLink({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: unknown }) {
    return <a href={href} {...rest}>{children}</a>;
  };
});

import React from 'react';

// ============================================================
// Sample data
// ============================================================

const SAMPLE_READING_DATA = {
  sections: [
    {
      key: 'personality',
      title: '命格性格分析',
      preview: '此命盤日主為庚金，性格剛毅果斷，具有領導才能。',
      full: '此命盤日主為庚金，性格剛毅果斷，具有領導才能。庚金之人為人正直，做事有魄力，不畏艱難。從十神分析來看，命局中比肩透出，代表獨立自主。',
    },
    {
      key: 'career',
      title: '事業發展分析',
      preview: '以庚金為日主，適合從事科技和法律行業。',
      full: '以庚金為日主，適合從事科技和法律行業。食神生財的格局，利於創業或技術工作。大運走正財運時，事業穩步上升。',
    },
    {
      key: 'love',
      title: '感情婚姻分析',
      preview: '日柱庚辰，自坐正印，代表另一半溫和體貼。',
      full: '日柱庚辰，自坐正印，代表另一半溫和體貼。辰土為日主的庫地，感情運勢較為穩定。桃花位在午火，早年便有感情機遇。',
    },
  ],
  summary: {
    text: '根據您的八字命盤，AI 已為您生成以下詳細分析報告。',
  },
};

// ============================================================
// Tests
// ============================================================

describe('AIReadingDisplay', () => {
  describe('Loading State', () => {
    it('should render skeleton loading when isLoading', () => {
      const { container } = render(
        <AIReadingDisplay
          data={null}
          readingType="lifetime"
          isSubscriber={false}
          isLoading={true}
        />,
      );
      // Should have skeleton elements
      const skeletons = container.querySelectorAll('[class*="skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('should not render actual content when loading', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={false}
          isLoading={true}
        />,
      );
      expect(screen.queryByText('命理總覽')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty message when data is null', () => {
      render(
        <AIReadingDisplay
          data={null}
          readingType="lifetime"
          isSubscriber={false}
        />,
      );
      expect(screen.getByText('暫無 AI 解讀資料')).toBeInTheDocument();
    });

    it('should show empty message when sections are empty', () => {
      render(
        <AIReadingDisplay
          data={{ sections: [] }}
          readingType="lifetime"
          isSubscriber={false}
        />,
      );
      expect(screen.getByText('暫無 AI 解讀資料')).toBeInTheDocument();
    });
  });

  describe('Summary Card', () => {
    it('should display summary when available', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
        />,
      );
      expect(screen.getByText('命理總覽')).toBeInTheDocument();
      expect(
        screen.getByText(
          '根據您的八字命盤，AI 已為您生成以下詳細分析報告。',
        ),
      ).toBeInTheDocument();
    });

    it('should not show summary when not provided', () => {
      const dataNoSummary = {
        sections: SAMPLE_READING_DATA.sections,
      };
      render(
        <AIReadingDisplay
          data={dataNoSummary}
          readingType="lifetime"
          isSubscriber={true}
        />,
      );
      expect(screen.queryByText('命理總覽')).not.toBeInTheDocument();
    });
  });

  describe('Subscriber View (Full Content)', () => {
    it('should display all section titles', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
        />,
      );
      expect(screen.getByText('命格性格分析')).toBeInTheDocument();
      expect(screen.getByText('事業發展分析')).toBeInTheDocument();
      expect(screen.getByText('感情婚姻分析')).toBeInTheDocument();
    });

    it('should display full content for subscribers', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
        />,
      );
      // Full content should be visible
      expect(
        screen.getByText(/從十神分析來看/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/食神生財的格局/),
      ).toBeInTheDocument();
    });

    it('should NOT show paywall for subscribers', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
        />,
      );
      expect(
        screen.queryByText('訂閱解鎖完整內容'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('立即訂閱')).not.toBeInTheDocument();
    });
  });

  describe('Free User View (Paywall)', () => {
    it('should display preview text for free users', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={false}
        />,
      );
      expect(
        screen.getByText(
          '此命盤日主為庚金，性格剛毅果斷，具有領導才能。',
        ),
      ).toBeInTheDocument();
    });

    it('should show paywall overlay for free users', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={false}
        />,
      );
      // All sections with different preview/full should show paywall
      const paywallMessages = screen.getAllByText('訂閱解鎖完整內容');
      expect(paywallMessages.length).toBeGreaterThan(0);
    });

    it('should show subscribe button', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={false}
        />,
      );
      const subscribeButtons = screen.getAllByText('立即訂閱');
      expect(subscribeButtons.length).toBeGreaterThan(0);
    });

    it('should show "upgrade" subtext', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={false}
        />,
      );
      const subtexts = screen.getAllByText('升級會員查看詳細分析與建議');
      expect(subtexts.length).toBeGreaterThan(0);
    });
  });

  describe('Streaming Cursor', () => {
    it('should show streaming cursor on last section when streaming', () => {
      const { container } = render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
          isStreaming={true}
        />,
      );
      const cursors = container.querySelectorAll(
        '[class*="streamingCursor"]',
      );
      expect(cursors.length).toBe(1);
    });

    it('should NOT show cursor when not streaming', () => {
      const { container } = render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
          isStreaming={false}
        />,
      );
      const cursors = container.querySelectorAll(
        '[class*="streamingCursor"]',
      );
      expect(cursors.length).toBe(0);
    });
  });

  describe('Entertainment Disclaimer', () => {
    it('should display the disclaimer', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
        />,
      );
      expect(
        screen.getByText(/本服務僅供參考與娛樂用途/),
      ).toBeInTheDocument();
    });
  });

  describe('Cross-Sell Grid', () => {
    it('should display cross-sell section', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
        />,
      );
      expect(screen.getByText('更多運程分析')).toBeInTheDocument();
    });

    it('should not show current reading type in cross-sell', () => {
      render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
        />,
      );
      // Should show other types but NOT lifetime (八字終身運)
      // The cross-sell should contain 5 items (all except current)
      expect(screen.getByText('八字流年運勢')).toBeInTheDocument();
      expect(screen.getByText('事業財運')).toBeInTheDocument();
      expect(screen.getByText('愛情姻緣')).toBeInTheDocument();
      expect(screen.getByText('先天健康分析')).toBeInTheDocument();
      expect(screen.getByText('合盤比較')).toBeInTheDocument();
    });

    it('should link cross-sell cards to correct reading pages', () => {
      const { container } = render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
        />,
      );
      const links = container.querySelectorAll('a[href*="/reading/"]');
      const hrefs = Array.from(links).map((a) => a.getAttribute('href'));
      expect(hrefs).toContain('/reading/annual');
      expect(hrefs).toContain('/reading/career');
      expect(hrefs).toContain('/reading/love');
      expect(hrefs).toContain('/reading/health');
      expect(hrefs).toContain('/reading/compatibility');
      // Should NOT include current type
      expect(hrefs).not.toContain('/reading/lifetime');
    });
  });

  describe('Section Themes', () => {
    it('should apply theme data attribute to sections', () => {
      const { container } = render(
        <AIReadingDisplay
          data={SAMPLE_READING_DATA}
          readingType="lifetime"
          isSubscriber={true}
        />,
      );
      const sections = container.querySelectorAll(
        '[data-theme]',
      );
      // Should have sections with themes
      const themes = Array.from(sections).map((s) =>
        s.getAttribute('data-theme'),
      );
      expect(themes).toContain('personality');
      expect(themes).toContain('career');
      expect(themes).toContain('love');
    });
  });
});
