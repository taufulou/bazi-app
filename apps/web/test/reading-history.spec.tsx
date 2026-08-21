/**
 * Tests for ReadingHistoryPage component.
 * Validates loading state, empty state, error state, and reading list rendering.
 */
import { render, screen, waitFor } from '@testing-library/react';
import ReadingHistoryPage from '../app/dashboard/readings/page';
import { READING_TYPE_META } from '@repo/shared';

// ============================================================
// Mocks
// ============================================================

const mockGetToken = jest.fn();

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({
    getToken: mockGetToken,
    isLoaded: true,
  }),
}));

// Mock Next.js Link component (needs router context in jsdom)
jest.mock('next/link', () => {
  return ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...props}>{children}</a>
  );
});

const mockGetReadingHistory = jest.fn();

jest.mock('../app/lib/readings-api', () => ({
  getReadingHistory: (...args: any[]) => mockGetReadingHistory(...args),
}));

// ⚠️ NOT mocked. This used to stub `@repo/shared` with a READING_TYPE_META that
// had icons and names but NO `creditCost`. After eb68c81 made the page read
// `meta.creditCost`, every row fell to `?? 0`, so all three rendered 免費 and
// both credit assertions failed — invisibly, because web jest is not in CI.
//
// The real constants come through jest's moduleNameMapper, so the page sees the
// same prices users do and the stub cannot drift from them again.

// ============================================================
// Test Data
// ============================================================

const mockReadings = [
  {
    id: 'reading-1',
    readingType: 'LIFETIME',
    creditsUsed: 2,
    createdAt: '2025-01-15T10:30:00.000Z',
    birthProfile: { name: '張三' },
  },
  {
    id: 'reading-2',
    readingType: 'ZWDS_LIFETIME',
    creditsUsed: 0,
    createdAt: '2025-01-14T08:00:00.000Z',
    birthProfile: { name: '李四' },
  },
  {
    id: 'reading-3',
    readingType: 'CAREER',
    creditsUsed: 2,
    createdAt: '2025-01-13T14:00:00.000Z',
    birthProfile: null,
  },
];

// ============================================================
// Tests
// ============================================================

describe('ReadingHistoryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToken.mockResolvedValue('test-token');
  });

  it('should show loading state initially', () => {
    mockGetReadingHistory.mockImplementation(() => new Promise(() => {})); // Never resolves
    render(<ReadingHistoryPage />);
    expect(screen.getByText('載入中...')).toBeInTheDocument();
  });

  it('should show empty state when no readings exist', async () => {
    mockGetReadingHistory.mockResolvedValue({ data: [] });

    render(<ReadingHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText('尚無分析記錄')).toBeInTheDocument();
    });
    expect(screen.getByText('開始分析 →')).toBeInTheDocument();
  });

  it('should render reading cards with correct data', async () => {
    mockGetReadingHistory.mockResolvedValue({ data: mockReadings });

    render(<ReadingHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText('張三')).toBeInTheDocument();
    });
    expect(screen.getByText('李四')).toBeInTheDocument();
    expect(screen.getByText('未命名')).toBeInTheDocument();
  });

  it('shows the CANONICAL price for a paid reading, not the charged amount', async () => {
    // eb68c81 — "Use canonical credit costs on history page instead of stale DB
    // values". The row's own `creditsUsed` is deliberately NOT what is shown.
    const lifetimeCost = READING_TYPE_META.lifetime.creditCost;
    const careerCost = READING_TYPE_META.career.creditCost;
    // Named rather than indexed: `[0]` is both weaker under
    // noUncheckedIndexedAccess and silently wrong if the fixture is reordered.
    const lifetimeRow = mockReadings.find((r) => r.readingType === 'LIFETIME');
    if (!lifetimeRow) throw new Error('fixture must contain a LIFETIME reading');
    const charged = lifetimeRow.creditsUsed;

    // Guard: if the fixture ever matches the canonical price this test proves
    // nothing, because both behaviours would print the same string.
    expect(lifetimeCost).not.toBe(charged);

    mockGetReadingHistory.mockResolvedValue({ data: mockReadings });
    render(<ReadingHistoryPage />);

    await waitFor(() => expect(screen.getAllByText(/免費|額度/)).toHaveLength(3));
    const badges = screen.getAllByText(/免費|額度/).map((el) => el.textContent);

    expect(badges).toEqual(
      expect.arrayContaining([`-${lifetimeCost} 額度`, `-${careerCost} 額度`]),
    );
    expect(badges).not.toContain(`-${charged} 額度`);
  });

  it('shows 免費 only for the reading that was actually free', async () => {
    // `creditsUsed === 0` is the free predicate for ordinary readings (unlike
    // comparisons, which use `paidAt` because create is now free). Exactly one
    // fixture row has it, so all-three-free is the failure to catch.
    const free = mockReadings.filter((r) => r.creditsUsed === 0);
    expect(free).toHaveLength(1);

    mockGetReadingHistory.mockResolvedValue({ data: mockReadings });
    render(<ReadingHistoryPage />);

    await waitFor(() => expect(screen.getAllByText('免費')).toHaveLength(1));
  });

  it('should show error state when API fails', async () => {
    mockGetReadingHistory.mockRejectedValue(new Error('Network error'));

    render(<ReadingHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText('無法載入分析記錄')).toBeInTheDocument();
    });
  });

  it('should show error when not signed in', async () => {
    mockGetToken.mockResolvedValue(null);

    render(<ReadingHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText('請先登入')).toBeInTheDocument();
    });
  });

  it('should link reading cards to /reading/[slug]?id=[readingId]', async () => {
    mockGetReadingHistory.mockResolvedValue({ data: [mockReadings[0]] });

    render(<ReadingHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText('張三')).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /張三/i });
    expect(link).toHaveAttribute('href', '/reading/lifetime?id=reading-1');
  });

  it('should show reading type name in Chinese', async () => {
    mockGetReadingHistory.mockResolvedValue({ data: mockReadings });

    render(<ReadingHistoryPage />);

    // Derived, not hardcoded: the old stub asserted 紫微終身命盤, a name the real
    // constants never used (it is 紫微終身運), so this passed against the mock
    // and would have failed against the product.
    const lifetimeName = READING_TYPE_META.lifetime.nameZhTw;
    const zwdsName = READING_TYPE_META['zwds-lifetime'].nameZhTw;

    await waitFor(() => {
      expect(screen.getByText(lifetimeName)).toBeInTheDocument();
    });
    expect(screen.getByText(zwdsName)).toBeInTheDocument();
  });

  it('should call getReadingHistory with token, page 1, limit 50', async () => {
    mockGetReadingHistory.mockResolvedValue({ data: [] });

    render(<ReadingHistoryPage />);

    await waitFor(() => {
      expect(mockGetReadingHistory).toHaveBeenCalledWith('test-token', 1, 50);
    });
  });
});
