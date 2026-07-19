/**
 * markdown.ts — Minimal markdown bold parser for AI narratives.
 * Verbatim port of apps/web/app/components/fortune/markdown.ts.
 *
 * AI output is untrusted; React text escaping handles safety. Mismatched
 * markers (lone `**`) are stripped defensively. Flat bold only — no nesting,
 * no italic/links/code. `.` doesn't match `\n`, so `**foo\nbar**` yields plain text.
 */

export type Segment = { type: 'text'; value: string } | { type: 'bold'; value: string };

const BOLD_RE = /\*\*(.+?)\*\*/g;

/** Parse a string into alternating text + bold segments. */
export function parseBoldSegments(text: string): Segment[] {
  if (!text) return [];

  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  BOLD_RE.lastIndex = 0; // /g flag is stateful between calls

  while ((match = BOLD_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'bold', value: match[1]! });
    lastIndex = BOLD_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  // Strip any remaining lone `**` in text segments (mismatched / split markers).
  return segments.map((seg) =>
    seg.type === 'text'
      ? { type: 'text' as const, value: seg.value.replace(/\*\*/g, '') }
      : seg,
  );
}
