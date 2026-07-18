/**
 * RTL tests for the 歷史分析記錄 screen — empty state, list rendering (regular +
 * comparison rows), and the filter that drops mobile-unsupported types
 * (ZWDS/health). Clerk + readings-api are mocked; expo-router is globally mocked
 * in jest.setup.
 */
import { render, screen, waitFor } from '@testing-library/react-native';
import ReadingHistoryScreen from '../history';
import * as readingsApi from '../../lib/readings-api';

jest.mock('@clerk/clerk-expo', () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue('token'), isSignedIn: true, isLoaded: true }),
}));
jest.mock('../../lib/language', () => ({ useZh: () => (s: string) => s }));
jest.mock('../../lib/readings-api');

const mockApi = readingsApi as jest.Mocked<typeof readingsApi>;

function resp(data: unknown[]) {
  return { data, meta: { page: 1, limit: 50, total: data.length, totalPages: 1 } } as never;
}

describe('ReadingHistoryScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the empty state when there are no readings', async () => {
    mockApi.getReadingHistory.mockResolvedValue(resp([]));
    await render(<ReadingHistoryScreen />);
    await waitFor(() => expect(screen.getByText('尚無分析記錄')).toBeTruthy());
    expect(screen.getByText(/開始分析/)).toBeTruthy();
  });

  it('renders regular + comparison rows and filters out unsupported types', async () => {
    mockApi.getReadingHistory.mockResolvedValue(
      resp([
        {
          id: 'r1',
          readingType: 'LIFETIME',
          creditsUsed: 3,
          createdAt: '2026-05-01T00:00:00Z',
          birthProfile: { name: 'Roger', birthDate: '1987-09-06' },
        },
        {
          id: 'c1',
          readingType: 'COMPATIBILITY',
          isComparison: true,
          comparisonType: 'ROMANCE',
          creditsUsed: 3,
          createdAt: '2026-05-02T00:00:00Z',
          birthProfile: { name: 'Roger', birthDate: '1987-09-06' },
          profileB: { name: 'Laopo', birthDate: '1987-01-25' },
        },
        {
          // Unsupported on mobile (no ZWDS/health screen) → must be filtered out.
          id: 'h1',
          readingType: 'HEALTH',
          creditsUsed: 0,
          createdAt: '2026-05-03T00:00:00Z',
          birthProfile: { name: 'ShouldBeHidden', birthDate: '2000-01-01' },
        },
      ]),
    );
    await render(<ReadingHistoryScreen />);
    // Regular reading title (from READING_TYPE_META.lifetime)
    await waitFor(() => expect(screen.getByText('八字終身運')).toBeTruthy());
    // Comparison row: ROMANCE label + partner name (a fragment inside the row Text)
    expect(screen.getByText('感情合盤')).toBeTruthy();
    expect(screen.getByText(/Laopo/)).toBeTruthy();
    // The HEALTH row is filtered out entirely (its unique profile never renders).
    expect(screen.queryByText('ShouldBeHidden')).toBeNull();
  });

  it('shows the error state when the fetch fails', async () => {
    mockApi.getReadingHistory.mockRejectedValue(new Error('boom'));
    await render(<ReadingHistoryScreen />);
    await waitFor(() => expect(screen.getByText('無法載入分析記錄')).toBeTruthy());
  });
});
