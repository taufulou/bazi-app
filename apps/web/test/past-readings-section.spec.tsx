/**
 * Tests for PastReadingsSection — collapsible same-category reading history
 * rendered on each reading form above the birth-data form.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import PastReadingsSection from '../app/components/PastReadingsSection';

// ============================================================
// Mocks
// ============================================================

const mockGetToken = jest.fn();
let mockIsSignedIn: boolean | undefined = true;
let mockIsLoaded = true;

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({
    getToken: mockGetToken,
    isSignedIn: mockIsSignedIn,
    isLoaded: mockIsLoaded,
  }),
}));

const mockRouterPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

const mockGetReadingHistoryByType = jest.fn();
jest.mock('../app/lib/readings-api', () => ({
  getReadingHistoryByType: (...args: unknown[]) =>
    mockGetReadingHistoryByType(...args),
}));

jest.mock('@repo/shared', () => ({
  READING_TYPE_META: {
    lifetime: { icon: '🌟', nameZhTw: '八字終身運' },
    annual: { icon: '📅', nameZhTw: '八字流年運勢' },
    career: { icon: '💼', nameZhTw: '八字事業詳批' },
    compatibility: { icon: '🤝', nameZhTw: '合盤比較' },
  },
}));

// ============================================================
// Test data
// ============================================================

const lifetimeItems = [
  {
    id: 'r1',
    readingType: 'LIFETIME',
    creditsUsed: 3,
    createdAt: '2026-03-15T00:00:00.000Z',
    birthProfile: { name: 'Roger', birthDate: '1990-05-15T00:00:00.000Z' },
    isComparison: false,
  },
  {
    id: 'r2',
    readingType: 'LIFETIME',
    creditsUsed: 3,
    createdAt: '2026-02-20T00:00:00.000Z',
    birthProfile: { name: '媽媽', birthDate: '1965-08-22T00:00:00.000Z' },
    isComparison: false,
  },
  {
    id: 'r3',
    readingType: 'LIFETIME',
    creditsUsed: 3,
    createdAt: '2026-01-10T00:00:00.000Z',
    birthProfile: { name: '老婆', birthDate: '1992-03-03T00:00:00.000Z' },
    isComparison: false,
  },
];

const annualItems = [
  {
    id: 'a1',
    readingType: 'ANNUAL',
    creditsUsed: 3,
    createdAt: '2026-03-15T00:00:00.000Z',
    targetYear: 2026,
    birthProfile: { name: 'Roger', birthDate: '1990-05-15T00:00:00.000Z' },
    isComparison: false,
  },
  {
    id: 'a2',
    readingType: 'ANNUAL',
    creditsUsed: 3,
    createdAt: '2025-03-10T00:00:00.000Z',
    targetYear: 2025,
    birthProfile: { name: 'Roger', birthDate: '1990-05-15T00:00:00.000Z' },
    isComparison: false,
  },
];

const compatibilityItems = [
  {
    id: 'c1',
    readingType: 'COMPATIBILITY',
    creditsUsed: 3,
    createdAt: '2026-02-01T00:00:00.000Z',
    comparisonType: 'ROMANCE',
    birthProfile: { name: 'Roger', birthDate: '1990-05-15T00:00:00.000Z' },
    profileB: { name: '老婆', birthDate: '1992-03-03T00:00:00.000Z' },
    isComparison: true,
  },
];

// ============================================================
// Tests
// ============================================================

describe('PastReadingsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToken.mockResolvedValue('test-token');
    mockIsSignedIn = true;
    mockIsLoaded = true;
  });

  it('renders the collapsed header with count when there are past readings', async () => {
    mockGetReadingHistoryByType.mockResolvedValue({
      data: lifetimeItems,
      meta: { page: 1, limit: 50, total: 3, totalPages: 1 },
    });

    render(<PastReadingsSection readingType="lifetime" />);

    await waitFor(() => {
      expect(screen.getByText('(3)')).toBeInTheDocument();
    });
    expect(screen.getByText(/你的/)).toBeInTheDocument();
    // Cards are hidden until expanded
    expect(screen.queryByText('Roger')).not.toBeInTheDocument();
  });

  it('renders null when the user has zero past readings of this type', async () => {
    mockGetReadingHistoryByType.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });

    const { container } = render(<PastReadingsSection readingType="career" />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('renders null when user is not signed in', async () => {
    mockIsSignedIn = false;
    const { container } = render(<PastReadingsSection readingType="lifetime" />);
    // Does not fetch
    expect(mockGetReadingHistoryByType).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('expands the list on header click and shows each card', async () => {
    mockGetReadingHistoryByType.mockResolvedValue({
      data: lifetimeItems,
      meta: { page: 1, limit: 50, total: 3, totalPages: 1 },
    });

    render(<PastReadingsSection readingType="lifetime" />);
    await waitFor(() => expect(screen.getByText('(3)')).toBeInTheDocument());

    const header = screen.getByRole('button', {
      name: /你的八字終身運記錄/,
    });
    fireEvent.click(header);

    expect(screen.getByText('Roger')).toBeInTheDocument();
    expect(screen.getByText('媽媽')).toBeInTheDocument();
    expect(screen.getByText('老婆')).toBeInTheDocument();
  });

  it('clicking a card navigates to /reading/<slug>?id=<id>', async () => {
    mockGetReadingHistoryByType.mockResolvedValue({
      data: lifetimeItems,
      meta: { page: 1, limit: 50, total: 3, totalPages: 1 },
    });

    render(<PastReadingsSection readingType="lifetime" />);
    await waitFor(() => expect(screen.getByText('(3)')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /你的八字終身運記錄/ }));
    fireEvent.click(screen.getByText('Roger').closest('button')!);

    expect(mockRouterPush).toHaveBeenCalledWith('/reading/lifetime?id=r1&from=form');
  });

  it('compat variant: renders A × B with comparisonType icon and navigates to /reading/compatibility?id=X', async () => {
    mockGetReadingHistoryByType.mockResolvedValue({
      data: compatibilityItems,
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    render(<PastReadingsSection readingType="compatibility" />);
    await waitFor(() =>
      expect(screen.getByText('你的合盤比較記錄')).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /你的合盤比較記錄/ }),
    );

    expect(screen.getByText('Roger')).toBeInTheDocument();
    expect(screen.getByText('×')).toBeInTheDocument();
    expect(screen.getByText('老婆')).toBeInTheDocument();
    expect(screen.getByText('💕')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Roger').closest('button')!);
    expect(mockRouterPush).toHaveBeenCalledWith('/reading/compatibility?id=c1&from=form');
  });

  it('annual variant: appends year badge to card line', async () => {
    mockGetReadingHistoryByType.mockResolvedValue({
      data: annualItems,
      meta: { page: 1, limit: 50, total: 2, totalPages: 1 },
    });

    render(<PastReadingsSection readingType="annual" />);
    await waitFor(() =>
      expect(screen.getByText('你的八字流年運勢記錄')).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /你的八字流年運勢記錄/ }),
    );

    expect(screen.getByText('2026年')).toBeInTheDocument();
    expect(screen.getByText('2025年')).toBeInTheDocument();
  });

  it('currentReadingId filters out that specific reading from the rendered list', async () => {
    mockGetReadingHistoryByType.mockResolvedValue({
      data: lifetimeItems,
      meta: { page: 1, limit: 50, total: 3, totalPages: 1 },
    });

    render(
      <PastReadingsSection readingType="lifetime" currentReadingId="r2" />,
    );
    await waitFor(() => expect(screen.getByText('(3)')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /你的八字終身運記錄/ }));

    expect(screen.getByText('Roger')).toBeInTheDocument();
    expect(screen.queryByText('媽媽')).not.toBeInTheDocument(); // r2 filtered
    expect(screen.getByText('老婆')).toBeInTheDocument();
  });

  it('shows retry button on fetch error; clicking retry re-fetches', async () => {
    mockGetReadingHistoryByType.mockRejectedValueOnce(new Error('network'));

    render(<PastReadingsSection readingType="lifetime" />);

    await waitFor(() => {
      expect(screen.getByLabelText('重試')).toBeInTheDocument();
    });

    mockGetReadingHistoryByType.mockResolvedValueOnce({
      data: lifetimeItems,
      meta: { page: 1, limit: 50, total: 3, totalPages: 1 },
    });

    fireEvent.click(screen.getByLabelText('重試'));

    await waitFor(() => expect(screen.getByText('(3)')).toBeInTheDocument());
    expect(mockGetReadingHistoryByType).toHaveBeenCalledTimes(2);
  });

  it('shows the cap footer when totalCount exceeds returned readings length', async () => {
    // Simulate 60 total but only 50 returned
    const fifty = Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`,
      readingType: 'LIFETIME',
      creditsUsed: 3,
      createdAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      birthProfile: { name: `User${i}`, birthDate: '1990-01-01T00:00:00.000Z' },
      isComparison: false,
    }));
    mockGetReadingHistoryByType.mockResolvedValue({
      data: fifty,
      meta: { page: 1, limit: 50, total: 60, totalPages: 2 },
    });

    render(<PastReadingsSection readingType="lifetime" />);
    await waitFor(() => expect(screen.getByText('(60)')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /你的八字終身運記錄/ }));

    expect(screen.getByText('顯示最近 50 筆')).toBeInTheDocument();
  });

  it('handles birthProfile: null gracefully by rendering 未命名 fallback', async () => {
    mockGetReadingHistoryByType.mockResolvedValue({
      data: [
        {
          id: 'r-null',
          readingType: 'LIFETIME',
          creditsUsed: 3,
          createdAt: '2026-03-15T00:00:00.000Z',
          birthProfile: null,
          isComparison: false,
        },
      ],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    render(<PastReadingsSection readingType="lifetime" />);
    await waitFor(() => expect(screen.getByText('(1)')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /你的八字終身運記錄/ }));

    expect(screen.getByText('未命名')).toBeInTheDocument();
  });
});
