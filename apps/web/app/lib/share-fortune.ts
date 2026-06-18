/**
 * share-fortune — helpers for the Phase 1.5 ShareFortuneButton.
 *
 * - `rasterizeNode`: dynamic-import wrapper around `html2canvas` so the
 *   ~50KB lib only ships on first share click.
 * - `generateQrDataUrl`: dynamic-import wrapper around `qrcode`.
 * - `shareOrDownloadPng`: 3-tier cascade — Web Share API (files) →
 *   clipboard image → anchor download.
 * - `loadFortuneCardFonts`: force-loads Noto Serif TC weights used by
 *   ShareableFortuneCard so html2canvas captures them instead of system
 *   fallback. Critical because `next/font/google` uses `display: swap`,
 *   which means fonts may not be requested until something references them.
 */

const SHARE_TITLE = '我的今日運勢';

export interface ShareResult {
  method: 'web-share' | 'clipboard' | 'download' | 'cancelled';
}

/**
 * Force-load the Noto Serif TC weights ShareableFortuneCard renders, then
 * await `document.fonts.ready`. Without explicit `.load()`, swap-display
 * fonts may not be requested before html2canvas captures, leaving the
 * shared PNG with system-fallback text.
 *
 * Safe to call repeatedly — `document.fonts.load` resolves immediately for
 * already-loaded faces.
 */
export async function loadFortuneCardFonts(simplified = false): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  // For zh-CN the card's var(--font-noto-serif-tc) is remapped to Noto Serif SC, so
  // load the SC weights instead — else html2canvas captures system-fallback glyphs.
  const family = simplified ? '"Noto Serif SC"' : '"Noto Serif TC"';
  try {
    await Promise.all([
      document.fonts.load(`700 64px ${family}`),
      document.fonts.load(`400 24px ${family}`),
      document.fonts.load(`700 28px ${family}`),
    ]);
    await document.fonts.ready;
  } catch {
    // Some browsers reject .load() if font-family isn't declared anywhere.
    // html2canvas will fall back to system serif gracefully.
  }
}

/**
 * Generate a QR code as a data URL. Dynamic-imports `qrcode` so the lib
 * doesn't ship until first share intent.
 *
 * Caller is responsible for caching the result if they want to reuse it
 * (the dataURL is ~3-5KB, fine to keep in state).
 */
export async function generateQrDataUrl(url: string, width: number = 320): Promise<string> {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toDataURL(url, { margin: 0, width });
}

/**
 * Rasterize a DOM node to a canvas via html2canvas. Returns the canvas;
 * caller converts to blob via `canvas.toBlob(cb, 'image/png')`.
 *
 * Why dynamic import: html2canvas is ~50KB gzipped; lazy-loading defers
 * the cost until first share click. iOS Safari supports `await import()`
 * inside a user-gesture click handler without losing the gesture.
 */
export async function rasterizeNode(node: HTMLElement): Promise<HTMLCanvasElement> {
  const html2canvas = (await import('html2canvas')).default;
  return html2canvas(node, {
    scale: 2, // 1200x1600 logical → 2400x3200 actual hi-DPI
    backgroundColor: '#FFF3E0', // matches --bg-primary
    useCORS: true,
    allowTaint: false,
    logging: false,
    width: 1200,
    height: 1600,
    windowWidth: 1200,
    windowHeight: 1600,
  });
}

/**
 * Share a PNG blob using the best available browser capability.
 *
 * Cascade:
 *   1. Web Share API Level 2 (files) — iOS Safari 15+, Android Chrome
 *   2. Clipboard image — desktop Chrome/Edge ≥ 102
 *   3. Anchor download — universal fallback
 *
 * IMPORTANT — this function MUST be called inside a user-gesture event
 * handler. iOS Safari rejects `navigator.share` with `NotAllowedError`
 * otherwise, even though `canShare` returns true.
 */
export async function shareOrDownloadPng(
  blob: Blob,
  filename: string,
  text: string,
): Promise<ShareResult> {
  const file = new File([blob], filename, { type: 'image/png' });

  // Tier 1: Web Share API Level 2
  if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
    try {
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: SHARE_TITLE, text });
          return { method: 'web-share' };
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') {
            // User dismissed the OS share sheet — NOT an error
            return { method: 'cancelled' };
          }
          // Real failure (rare) — fall through to clipboard/download
        }
      }
    } catch {
      // canShare throws on some embedded contexts — fall through
    }
  }

  // Tier 2: Clipboard image
  if (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.clipboard?.write
  ) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return { method: 'clipboard' };
    } catch {
      // Permission denied or unsupported mime — fall through
    }
  }

  // Tier 3: Anchor download (universal)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { method: 'download' };
}

/** Compute the QR target URL — works in dev / staging / prod without
 *  hardcoded domain. Safe-guarded for SSR (returns empty string). */
export function fortuneShareUrl(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/?ref=fortune-share`;
}

/** Filename for the downloaded/shared PNG. Date-only — Chinese profile
 *  names would slug-strip to empty, falling back to UUID hex which isn't
 *  human-readable. Browser handles duplicate-filename collisions natively. */
export function fortuneShareFilename(dateIso: string): string {
  return `fortune-${dateIso}.png`;
}
