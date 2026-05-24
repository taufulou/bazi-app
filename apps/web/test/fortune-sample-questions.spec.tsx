/**
 * Phase Fortune — FortuneSampleQuestions horizontal pill strip RTL spec.
 *
 * Covers:
 * - Renders pills for general FORTUNE questions (sectionKey=null)
 * - Pill tap calls onAsk with question text
 * - Title CTA tap calls onOpenChat
 * - Loading state → returns null
 * - Empty state → returns null
 * - Caps display at 6 pills
 * - Issue 9 regression-lock: resolveBaziToday TZ fix
 */
import { render, screen, fireEvent } from '@testing-library/react';
import FortuneSampleQuestions from '../app/components/fortune/FortuneSampleQuestions';
import { resolveBaziToday } from '../app/lib/fortune-api';

// Mock useSampleQuestions hook to control test conditions
const mockUseSampleQuestions = jest.fn();
jest.mock('../app/components/chat/hooks/useSampleQuestions', () => ({
  __esModule: true,
  useSampleQuestions: (readingType: string, sectionKey: string | null) =>
    mockUseSampleQuestions(readingType, sectionKey),
}));

describe('FortuneSampleQuestions', () => {
  const sampleQuestions = [
    { id: 'q1', questionText: '今天能量為什麼這麼低？', displayOrder: 1 },
    { id: 'q2', questionText: '今天適合做什麼？', displayOrder: 2 },
    { id: 'q3', questionText: '今天我要小心什麼？', displayOrder: 3 },
    { id: 'q4', questionText: '今日有什麼好兆頭嗎？', displayOrder: 4 },
    { id: 'q5', questionText: '今天宜往哪個方向？', displayOrder: 5 },
    { id: 'q6', questionText: '今天最重要的提醒是什麼？', displayOrder: 6 },
    { id: 'q7', questionText: 'overflow question 7', displayOrder: 7 },
  ];

  beforeEach(() => {
    mockUseSampleQuestions.mockReset();
  });

  it('queries FORTUNE + null sectionKey for general questions', () => {
    mockUseSampleQuestions.mockReturnValue({ questions: sampleQuestions, loading: false });
    render(<FortuneSampleQuestions onAsk={jest.fn()} onOpenChat={jest.fn()} />);
    expect(mockUseSampleQuestions).toHaveBeenCalledWith('FORTUNE', null);
  });

  it('renders pills for active questions', () => {
    mockUseSampleQuestions.mockReturnValue({ questions: sampleQuestions, loading: false });
    render(<FortuneSampleQuestions onAsk={jest.fn()} onOpenChat={jest.fn()} />);
    expect(screen.getByText('今天能量為什麼這麼低？')).toBeInTheDocument();
    expect(screen.getByText('今天適合做什麼？')).toBeInTheDocument();
  });

  it('caps display at 6 pills (does not render 7th overflow pill)', () => {
    mockUseSampleQuestions.mockReturnValue({ questions: sampleQuestions, loading: false });
    render(<FortuneSampleQuestions onAsk={jest.fn()} onOpenChat={jest.fn()} />);
    expect(screen.getByText('今天最重要的提醒是什麼？')).toBeInTheDocument();
    expect(screen.queryByText('overflow question 7')).not.toBeInTheDocument();
  });

  it('pill tap calls onAsk with the question text', () => {
    mockUseSampleQuestions.mockReturnValue({ questions: sampleQuestions, loading: false });
    const onAsk = jest.fn();
    render(<FortuneSampleQuestions onAsk={onAsk} onOpenChat={jest.fn()} />);
    fireEvent.click(screen.getByText('今天適合做什麼？'));
    expect(onAsk).toHaveBeenCalledWith('今天適合做什麼？');
  });

  it('title CTA tap calls onOpenChat', () => {
    mockUseSampleQuestions.mockReturnValue({ questions: sampleQuestions, loading: false });
    const onOpenChat = jest.fn();
    render(<FortuneSampleQuestions onAsk={jest.fn()} onOpenChat={onOpenChat} />);
    fireEvent.click(screen.getByLabelText('開啟 AI 命理師對話'));
    expect(onOpenChat).toHaveBeenCalled();
  });

  it('returns null during loading state', () => {
    mockUseSampleQuestions.mockReturnValue({ questions: [], loading: true });
    const { container } = render(<FortuneSampleQuestions onAsk={jest.fn()} onOpenChat={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no questions exist (empty state)', () => {
    mockUseSampleQuestions.mockReturnValue({ questions: [], loading: false });
    const { container } = render(<FortuneSampleQuestions onAsk={jest.fn()} onOpenChat={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});

// ============================================================
// Issue 9 — resolveBaziToday Asia/Taipei TZ resolution
// ============================================================

describe('resolveBaziToday — Issue 9 TZ fix', () => {
  it('at PT 23:30 (= Taipei 14:30 next-day-equivalent), resolves to Taipei calendar date', () => {
    // PT 23:30 = UTC 06:30 = Taipei 14:30 (same UTC day)
    const pt2330 = new Date('2026-05-21T06:30:00.000Z');
    const result = resolveBaziToday(pt2330);
    // At Taipei 14:30 (well before the 23:00 子時 boundary), the Bazi
    // day matches Taipei calendar date. Both PT and UTC see this as
    // 2026-05-21 in their respective wall clocks, so the assertion is
    // that we get the Taipei date (which happens to also be 2026-05-21).
    expect(result).toBe('2026-05-21');
  });

  it('at Taipei 23:30, advances to next Taipei day (子時 start)', () => {
    // Taipei 23:30 on 2026-05-20 = UTC 15:30 on 2026-05-20
    const tw2330 = new Date('2026-05-20T15:30:00.000Z');
    const result = resolveBaziToday(tw2330);
    expect(result).toBe('2026-05-21');
  });

  it('at Taipei 22:59, stays on the same Taipei day (still 戌時)', () => {
    const tw2259 = new Date('2026-05-20T14:59:00.000Z');
    const result = resolveBaziToday(tw2259);
    expect(result).toBe('2026-05-20');
  });

  it('returns YYYY-MM-DD format string', () => {
    const now = new Date('2026-05-15T10:00:00.000Z');
    const result = resolveBaziToday(now);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
