/**
 * markdown.ts — Minimal markdown bold parser for AI narratives.
 *
 * Per UX Refinement Sprint Round 1 §R1.3 + Round 2 N1:
 *   - Replaces unsafe `dangerouslySetInnerHTML` regex approach
 *   - AI output is treated as untrusted; React text escaping handles XSS
 *   - Mismatched markers (lone `**`) are stripped server-side AND
 *     defensively here (Round-2 N5 integration)
 *
 * Limitations:
 *   - JS regex `.` does NOT match `\n` by default, so `**foo\nbar**`
 *     does not produce a single bold scope (N1 documented behavior)
 *   - Nested bold (`**foo **bar** baz**`) not supported — flat only
 *   - No other markdown supported (no italic, no links, no code)
 */

export type Segment =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string };

const BOLD_RE = /\*\*(.+?)\*\*/g;

/**
 * Parse a string into alternating text + bold segments.
 *
 * Examples:
 *   parseBoldSegments('hello **world**')
 *     → [{type:'text', value:'hello '}, {type:'bold', value:'world'}]
 *
 *   parseBoldSegments('a **b** c **d**')
 *     → [text 'a ', bold 'b', text ' c ', bold 'd']
 *
 *   parseBoldSegments('lone **marker')   // mismatched
 *     → [text 'lone marker']   // lone ** stripped defensively
 *
 *   parseBoldSegments('**foo\nbar**')     // newline mid-bold (N1)
 *     → [text 'foonbar']  // regex doesn't match across \n; lone markers stripped
 */
export function parseBoldSegments(text: string): Segment[] {
  if (!text) return [];

  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state (BOLD_RE has /g flag — stateful between calls)
  BOLD_RE.lastIndex = 0;

  while ((match = BOLD_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'bold', value: match[1] });
    lastIndex = BOLD_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  // Defensive: strip any remaining lone `**` in text segments (mismatched
  // markers, or markers split across newlines).
  return segments.map((seg) =>
    seg.type === 'text'
      ? { type: 'text' as const, value: seg.value.replace(/\*\*/g, '') }
      : seg,
  );
}
