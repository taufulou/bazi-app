/**
 * #6 — the admin AI-costs page shows PROMPT-cache tokens next to input tokens.
 *
 * Once a reading caches its system prompt, a row's `input_tokens` is only the
 * uncached remainder, so a page showing input tokens alone looks as if ~70% of
 * the tokens vanished. The API now returns the cached part per summary, per
 * provider and per reading type; this pins that the page shows it — and that it
 * still renders against an API deployed BEFORE those fields existed (web and API
 * deploy independently).
 */
import { render, screen, within } from '@testing-library/react';
import AdminAICostsPage from '../app/admin/ai-costs/page';
import type { AICosts } from '../app/lib/admin-api';

const mockGetToken = jest.fn();

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken, isLoaded: true }),
}));

const mockGetAICosts = jest.fn();

jest.mock('../app/lib/admin-api', () => ({
  getAICosts: (...args: unknown[]) => mockGetAICosts(...args),
}));

/** An API response from BEFORE #6: no prompt-cache field anywhere. */
const OLD_API: AICosts = {
  days: 30,
  totalCost: 2.3,
  avgCostPerReading: 0.023,
  totalTokens: 75_000,
  totalInputTokens: 50_000,
  totalOutputTokens: 25_000,
  totalRequests: 100,
  cacheHitRate: 0.2,
  costByProvider: [
    { provider: 'CLAUDE', totalCost: 1.5, count: 60, avgCost: 0.025, totalInputTokens: 30_000, totalOutputTokens: 15_000 },
  ],
  costByReadingType: [
    {
      readingType: 'LIFETIME',
      totalCost: 0.8,
      count: 20,
      avgCost: 0.04,
      avgInputTokens: 2_000,
      avgOutputTokens: 1_000,
      totalInputTokens: 40_000,
      totalOutputTokens: 20_000,
      avgLatencyMs: 2_500,
      cacheHitRate: 0.25,
    },
  ],
  costByTier: [],
  dailyCosts: [],
};

/** The same response with every #6 field populated, all values distinct. */
const CURRENT_API: AICosts = {
  ...OLD_API,
  totalPromptCacheReadTokens: 93_000,
  totalPromptCacheWriteTokens: 31_400,
  totalPromptCacheWrite5mTokens: 31_400,
  costByProvider: [
    { ...OLD_API.costByProvider[0]!, totalPromptCacheReadTokens: 62_000, totalPromptCacheWriteTokens: 15_700 },
  ],
  costByReadingType: [
    { ...OLD_API.costByReadingType[0]!, avgPromptCacheReadTokens: 1_550, avgPromptCacheWriteTokens: 785 },
  ],
};

/** The value shown in the stat card whose label is `label`. */
const card = (label: string) => within(screen.getByText(label).parentElement!);

/**
 * The row whose first cell is `rowLabel`, as header → cell text. Asserting by
 * header pins each value to its OWN column — a page-wide `getByText` would pass
 * with the read and write columns swapped.
 */
function rowByHeader(rowLabel: string): Record<string, string> {
  const tr = screen.getByText(rowLabel).closest('tr')!;
  const heads = [...tr.closest('table')!.querySelectorAll('th')].map((h) => h.textContent!.trim());
  const cells = [...tr.querySelectorAll('td')].map((d) => d.textContent!.trim());
  expect(cells).toHaveLength(heads.length);
  return Object.fromEntries(heads.map((h, i) => [h, cells[i]!]));
}

beforeEach(() => {
  mockGetToken.mockReset().mockResolvedValue('token');
  mockGetAICosts.mockReset();
});

describe('admin AI-costs page — prompt-cache tokens', () => {
  it('shows the cached tokens in the summary cards and in both tables', async () => {
    mockGetAICosts.mockResolvedValue(CURRENT_API);
    render(<AdminAICostsPage />);
    await screen.findByText('AI Costs');

    // Summary — and the input-only total says so.
    expect(screen.getByText('Total Tokens (excl. cached)')).toBeInTheDocument();
    expect(card('Prompt Cache Read Tokens').getByText('93,000')).toBeInTheDocument();
    expect(card('Prompt Cache Write Tokens').getByText('31,400')).toBeInTheDocument();

    // Reading-type table — each value under its own header.
    expect(rowByHeader('Bazi Lifetime')).toMatchObject({
      'Avg In Tokens': '2,000',
      'Avg Prompt Cache Read': '1,550',
      'Avg Prompt Cache Write': '785',
      'Avg Out Tokens': '1,000',
    });

    // Provider table.
    expect(rowByHeader('CLAUDE')).toMatchObject({
      'Input Tokens': '30,000',
      'Prompt Cache Read': '62,000',
      'Prompt Cache Write': '15,700',
      'Output Tokens': '15,000',
    });
  });

  it('renders zeros — and does not crash — against an API that predates the fields', async () => {
    // Every new cell is rendered here (a provider row AND a reading-type row),
    // so a single `.toLocaleString()` on an undefined value fails this test.
    mockGetAICosts.mockResolvedValue(OLD_API);
    render(<AdminAICostsPage />);
    await screen.findByText('AI Costs');

    expect(card('Prompt Cache Read Tokens').getByText('0')).toBeInTheDocument();
    expect(card('Prompt Cache Write Tokens').getByText('0')).toBeInTheDocument();
    // Every new table cell shows '0' — not blank, not 'undefined' — and the
    // existing columns are unaffected.
    expect(rowByHeader('Bazi Lifetime')).toMatchObject({
      'Avg In Tokens': '2,000',
      'Avg Prompt Cache Read': '0',
      'Avg Prompt Cache Write': '0',
    });
    expect(rowByHeader('CLAUDE')).toMatchObject({
      'Input Tokens': '30,000',
      'Prompt Cache Read': '0',
      'Prompt Cache Write': '0',
    });
  });
});
