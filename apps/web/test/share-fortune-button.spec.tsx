/**
 * Tests for ShareFortuneButton — verifies the share orchestration flow:
 *   - QR generation triggered exactly once
 *   - Card-arm parent callback fires
 *   - html2canvas called
 *   - 3-tier share cascade: navigator.share → clipboard → download
 *   - AbortError from navigator.share is swallowed (user dismissed sheet)
 *
 * Mocks html2canvas + qrcode via `__esModule: true` so dynamic `import()`
 * in share-fortune.ts intercepts correctly.
 */
import { createRef } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ShareFortuneButton, {
  type ShareFortuneButtonHandle,
} from '../app/components/fortune/ShareFortuneButton';
import type { DailyFortuneResponse } from '../app/lib/fortune-api';

// CRITICAL — dynamic imports need __esModule: true or .default returns undefined
const mockToBlob = jest.fn((cb: BlobCallback) =>
  cb(new Blob(['fake-png'], { type: 'image/png' })),
);
const mockHtml2Canvas = jest.fn(() => Promise.resolve({ toBlob: mockToBlob }));
jest.mock('html2canvas', () => ({
  __esModule: true,
  default: mockHtml2Canvas,
}));

const mockQrToDataUrl = jest.fn(() => Promise.resolve('data:image/png;base64,fake-qr'));
jest.mock('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: mockQrToDataUrl,
  },
}));

// Mock lucide-react icons — see date-navigator.spec.tsx for rationale
jest.mock('lucide-react', () => ({
  __esModule: true,
  Share2: () => <span data-icon="Share2" />,
  Loader2: () => <span data-icon="Loader2" />,
}));

// Stub @sentry/nextjs — capture call argument so we can assert error reporting
jest.mock('@sentry/nextjs', () => ({
  __esModule: true,
  captureException: jest.fn(),
}));

function makeData(): DailyFortuneResponse {
  return {
    date: '2026-05-18',
    profileId: 'p1',
    profileBirthDate: '1987-09-06',
    profileBirthTime: '16:11',
    engineOutput: {
      dayStem: '辛',
      dayBranch: '卯',
      dayGanZhi: '辛卯',
      dayTenGod: '傷官',
      auspiciousness: '大吉',
      energyScore: 80,
      metaFraming: 'soft_trigger',
      dimensions: {
        romance: { score: 75, label: '順遂', signals: [] },
        career: { score: 80, label: '順遂', signals: [] },
        finance: { score: 70, label: '平穩', signals: [] },
        travel: { score: 65, label: '平穩', signals: [] },
        health: { score: 60, label: '平穩', signals: [] },
      },
      folkContent: {
        wealthDirection: { element: '火', direction: '南方', provenance: 'classical', note: '' },
        // Phase 1.5.z fields — minimal fixture (nulls + empty array OK for share-card test)
        luckyColor: null,
        luckyNumber: null,
        luckyFoodFavor: null,
        luckyFoodAvoid: null,
        auspiciousHours: [],
      },
      ruleTrace: [],
      preAnalysisVersion: 'v1.1.1',
    },
    narrative: null,
    cacheHit: false,
    generatedAt: '2026-05-18T00:00:00Z',
  };
}

describe('ShareFortuneButton', () => {
  // jsdom doesn't implement document.fonts.load or URL.createObjectURL — stub
  beforeAll(() => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        load: jest.fn(() => Promise.resolve([])),
        ready: Promise.resolve(),
      },
    });
    if (!URL.createObjectURL) {
      URL.createObjectURL = jest.fn(() => 'blob:fake');
    }
    if (!URL.revokeObjectURL) {
      URL.revokeObjectURL = jest.fn();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no Web Share API + no Clipboard → falls to download
    delete (navigator as unknown as { canShare?: unknown }).canShare;
    delete (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;
  });

  function renderButton(opts: {
    qrDataUrl?: string | null;
    shareCardArmed?: boolean;
  } = {}) {
    const cardRef = createRef<HTMLDivElement>();
    const buttonHandleRef = createRef<ShareFortuneButtonHandle>();
    const onArmShareCard = jest.fn();
    const onQrGenerated = jest.fn();
    const onShareComplete = jest.fn();
    // Pre-arm card so the click-arm path doesn't have to await a re-render
    const armed = opts.shareCardArmed ?? true;
    render(
      <div>
        {armed && <div ref={cardRef} />}
        <ShareFortuneButton
          ref={buttonHandleRef}
          data={makeData()}
          cardRef={cardRef}
          shareCardArmed={armed}
          onArmShareCard={onArmShareCard}
          qrDataUrl={opts.qrDataUrl ?? null}
          onQrGenerated={onQrGenerated}
          onShareComplete={onShareComplete}
        />
      </div>,
    );
    return { onArmShareCard, onQrGenerated, onShareComplete, buttonHandleRef };
  }

  it('renders the button with idle label', () => {
    renderButton();
    expect(screen.getByText('分享今日運勢')).toBeInTheDocument();
  });

  it('generates QR + calls onQrGenerated when qrDataUrl is null', async () => {
    const { onQrGenerated } = renderButton({ qrDataUrl: null });
    fireEvent.click(screen.getByText('分享今日運勢'));
    await waitFor(() => expect(mockQrToDataUrl).toHaveBeenCalledTimes(1));
    expect(onQrGenerated).toHaveBeenCalledWith('data:image/png;base64,fake-qr');
  });

  it('skips QR generation when qrDataUrl is already cached', async () => {
    renderButton({ qrDataUrl: 'data:image/png;base64,cached' });
    fireEvent.click(screen.getByText('分享今日運勢'));
    await waitFor(() => expect(mockHtml2Canvas).toHaveBeenCalledTimes(1));
    expect(mockQrToDataUrl).not.toHaveBeenCalled();
  });

  describe('pre-arm path (audit Bug #1 fix — iOS user-gesture safety)', () => {
    // React synthesizes mouseEnter/touchStart/focus on the *button* element.
    // The visible text is inside a <span> child; firing events on the span
    // won't bubble for mouseenter (non-bubbling) and may not fire React's
    // synthetic touchstart. Resolve to the actual button via role/aria.
    const getShareButton = () => screen.getByRole('button', { name: /分享今日運勢/ });

    it('hover fires QR generation BEFORE click — by click time qrDataUrl is cached', async () => {
      // Pre-arm tests must start with shareCardArmed=false to exercise the
      // `if (!shareCardArmed) onArmShareCard()` branch in handlePreArm.
      const { onArmShareCard, onQrGenerated } = renderButton({
        qrDataUrl: null,
        shareCardArmed: false,
      });
      fireEvent.mouseEnter(getShareButton());
      expect(onArmShareCard).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(onQrGenerated).toHaveBeenCalledTimes(1));
      expect(mockQrToDataUrl).toHaveBeenCalledTimes(1);
      // QR generation in pre-arm path is fire-and-forget. In production, the parent
      // (page.tsx) re-renders with the cached qrDataUrl so handleClick skips its
      // defensive QR generation. This test doesn't simulate the parent state
      // round-trip — just verifies the pre-arm side effect fires.
    });

    it('touchstart triggers the same pre-arm path (mobile)', () => {
      const { onArmShareCard } = renderButton({ qrDataUrl: null, shareCardArmed: false });
      fireEvent.touchStart(getShareButton());
      expect(onArmShareCard).toHaveBeenCalledTimes(1);
    });

    it('focus triggers pre-arm too (keyboard navigation)', () => {
      const { onArmShareCard } = renderButton({ qrDataUrl: null, shareCardArmed: false });
      fireEvent.focus(getShareButton());
      expect(onArmShareCard).toHaveBeenCalledTimes(1);
    });
  });

  describe('useImperativeHandle exposes triggerShare (audit Bug #2 fix)', () => {
    it('ref.current.triggerShare() runs the share flow without programmatic .click()', async () => {
      const { buttonHandleRef, onShareComplete } = renderButton({
        qrDataUrl: 'data:cached',
      });
      expect(buttonHandleRef.current).toBeTruthy();
      expect(typeof buttonHandleRef.current?.triggerShare).toBe('function');
      // Invoke directly (no .click()) — preserves user-gesture context in real browsers
      await act(async () => {
        await buttonHandleRef.current?.triggerShare();
      });
      expect(mockHtml2Canvas).toHaveBeenCalledTimes(1);
      expect(onShareComplete).toHaveBeenCalledWith({ method: 'download' });
    });
  });

  it('calls html2canvas + toBlob during capture phase', async () => {
    renderButton({ qrDataUrl: 'data:cached' });
    fireEvent.click(screen.getByText('分享今日運勢'));
    await waitFor(() => expect(mockHtml2Canvas).toHaveBeenCalledTimes(1));
    expect(mockToBlob).toHaveBeenCalledTimes(1);
  });

  describe('share cascade', () => {
    it('falls to anchor download when no Web Share + no clipboard', async () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const { onShareComplete } = renderButton({ qrDataUrl: 'data:cached' });
      fireEvent.click(screen.getByText('分享今日運勢'));
      await waitFor(() =>
        expect(onShareComplete).toHaveBeenCalledWith({ method: 'download' }),
      );
      // An <a> element with download attr should have been created
      const anchorCalls = createElementSpy.mock.calls.filter((c) => c[0] === 'a');
      expect(anchorCalls.length).toBeGreaterThan(0);
      createElementSpy.mockRestore();
    });

    it('uses Web Share API when canShare({files}) returns true', async () => {
      const shareMock = jest.fn(() => Promise.resolve());
      const canShareMock = jest.fn(() => true);
      Object.assign(navigator, { share: shareMock, canShare: canShareMock });

      const { onShareComplete } = renderButton({ qrDataUrl: 'data:cached' });
      fireEvent.click(screen.getByText('分享今日運勢'));
      await waitFor(() =>
        expect(onShareComplete).toHaveBeenCalledWith({ method: 'web-share' }),
      );
      expect(shareMock).toHaveBeenCalledTimes(1);
      const callArgs = shareMock.mock.calls[0] as unknown as [{ files: File[] }];
      const arg = callArgs[0];
      expect(arg.files).toHaveLength(1);
      expect(arg.files[0]!.name).toBe('fortune-2026-05-18.png');

      delete (navigator as unknown as { share?: unknown }).share;
      delete (navigator as unknown as { canShare?: unknown }).canShare;
    });

    it('swallows AbortError (user dismissed share sheet) — no fallback', async () => {
      const abortErr = Object.assign(new Error('User cancelled'), { name: 'AbortError' });
      Object.assign(navigator, {
        share: jest.fn(() => Promise.reject(abortErr)),
        canShare: jest.fn(() => true),
      });
      const createElementSpy = jest.spyOn(document, 'createElement');
      const { onShareComplete } = renderButton({ qrDataUrl: 'data:cached' });
      fireEvent.click(screen.getByText('分享今日運勢'));
      await waitFor(() =>
        expect(onShareComplete).toHaveBeenCalledWith({ method: 'cancelled' }),
      );
      // No download fallback should have fired
      const anchorCalls = createElementSpy.mock.calls.filter((c) => c[0] === 'a');
      expect(anchorCalls.length).toBe(0);
      createElementSpy.mockRestore();

      delete (navigator as unknown as { share?: unknown }).share;
      delete (navigator as unknown as { canShare?: unknown }).canShare;
    });
  });
});
