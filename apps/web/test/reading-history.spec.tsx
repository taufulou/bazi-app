/**
 * Tests for ReadingHistoryPage component.
 * Validates loading state, empty state, error state, and reading list rendering.
 */
import { render, screen, waitFor } from '@testing-library/react';
import ReadingHistoryPage from '../app/dashboard/readings/page';

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

jest.mock('@repo/shared', () => ({
  READING_TYPE_META: {
    lifetime: { icon: '🏛️', nameZhTw: '八字終身運' },
    'zwds-lifetime': { icon: '⭐', nameZhTw: '紫微終身命盤' },
    annual: { icon: '📅', nameZhTw: '八字流年運勢' },
    career: { icon: '💼', nameZhTw: '八字事業詳批' },
  },
}));

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

  it('should show credit cost for paid readings', async () => {
    mockGetReadingHistory.mockResolvedValue({ data: mockReadings });

    render(<ReadingHistoryPage />);

    await waitFor(() => {
      expect(screen.getAllByText('-2 額度')).toHaveLength(2);
    });
  });

  it('should show 免費 for free readings', async () => {
    mockGetReadingHistory.mockResolvedValue({ data: mockReadings });

    render(<ReadingHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText('免費')).toBeInTheDocument();
    });
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

    await waitFor(() => {
      expect(screen.getByText('八字終身運')).toBeInTheDocument();
    });
    expect(screen.getByText('紫微終身命盤')).toBeInTheDocument();
  });

  it('should call getReadingHistory with token, page 1, limit 50', async () => {
    mockGetReadingHistory.mockResolvedValue({ data: [] });

    render(<ReadingHistoryPage />);

    await waitFor(() => {
      expect(mockGetReadingHistory).toHaveBeenCalledWith('test-token', 1, 50);
    });
  });
});
