/**
 * Static guards for the type + colour rules the theme documents.
 *
 * WHY THIS EXISTS: a typography pass across ~40 files repeatedly "finished" while
 * leaving the same four defect classes behind — a tier label at 11pt CJK on one
 * screen while its twin was fixed on another, a warning line at 1.63:1, a serif
 * bold that silently rendered Regular, and files that were named as targets and
 * never edited. Every one of those has a mechanical signature. Recalling which
 * files were done does not scale; running this does.
 *
 * These are SOURCE-TEXT checks, not render checks. They are deliberately dumb:
 * they parse style-object literals out of the .tsx and assert on them. That
 * catches the drift a renderer test would not (an unused-but-wrong style still
 * fails here), at the cost of a regex that only understands the house style —
 * `  name: { ... }` inside StyleSheet.create.
 *
 * EVERY exception must be named in an allowlist below, with a reason. That is the
 * load-bearing part: an exception that has to be typed out is an exception someone
 * decided on, rather than one that merely exists.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../..');

/** Fixed 1200x1600 PNG export canvases — their small sizes are correct in context. */
const EXCLUDE_DIR = /__tests__/;
const EXCLUDE_FILE = /Shareable.*Card\.tsx$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIR.test(entry.name)) walk(full, out);
    } else if (entry.name.endsWith('.tsx') && !EXCLUDE_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

interface StyleBlock {
  file: string;
  line: number;
  name: string;
  body: string;
}

/** Pull `  name: { ... }` blocks. Brace-counted so nested objects survive. */
function styleBlocks(file: string): StyleBlock[] {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(SRC, file);
  const blocks: StyleBlock[] = [];
  const opener = /^[ \t]{2,}([A-Za-z_][\w]*): \{/gm;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(text)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push({
      file: rel,
      line: text.slice(0, m.index).split('\n').length,
      name: m[1],
      body: text.slice(start, i + 1),
    });
  }
  return blocks;
}

const FILES = walk(SRC);
const BLOCKS = FILES.flatMap(styleBlocks);

/** Role name -> the size it resolves to. Mirrors `text` in theme/index.ts. */
const ROLE_SIZE: Record<string, number> = {
  display: 34, title: 24, section: 19, subsection: 17, body: 17,
  bodyTight: 15, cell: 14, label: 13, meta: 13, caption: 12, dense: 12,
  data: 15, dataSmall: 12, ganzhi: 28,
};
const TOKEN_SIZE: Record<string, number> = {
  xs: 12, sm: 15, base: 17, lg: 18, xl: 20, xxl: 24, title: 28, hero: 34,
};

function sizeOf(body: string): number | null {
  const raw = body.match(/fontSize:\s*(?:fontSize\.(\w+)|(\d+))/);
  if (raw) return raw[1] ? (TOKEN_SIZE[raw[1]] ?? null) : Number(raw[2]);
  const role = body.match(/\.\.\.T\.(\w+)/);
  if (role) return ROLE_SIZE[role[1]] ?? null;
  return null;
}

const fmt = (b: StyleBlock, extra = '') => `${b.file}:${b.line} ${b.name}${extra}`;

// ─────────────────────────────────────────────────────────────────────────────
describe('Guard A — nothing below the 12pt CJK floor', () => {
  /**
   * 12 is the floor for anything a user READS. 11 survives only where stroke
   * density is not a factor: emoji, latin numerals, pure ornaments. Each entry
   * says which of those it is.
   */
  const ALLOW: Record<string, string> = {
    'components/reading/primitives.tsx dot': 'bullet ornament (•), not text',
    'components/reading/lifetime-cards.tsx layerMark': 'ornament glyph, not text',
    'components/home/CreditBadge.tsx creditIcon': 'emoji 💎, no CJK strokes',
    'components/chat/ChatFloatingButton.tsx badgeText': 'latin numeral badge count',
  };

  it('has no text style under 12pt outside the named ornament allowlist', () => {
    const bad = BLOCKS.filter((b) => {
      const s = sizeOf(b.body);
      return s !== null && s < 12 && !ALLOW[`${b.file} ${b.name}`];
    });
    expect(bad.map((b) => fmt(b, ` = ${sizeOf(b.body)}pt`))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Guard B — vivid fill tokens are never text colours', () => {
  /**
   * `colors.error/success/warning/gold/…` are SIGNAL FILLS for bars, rings and
   * badges. As type they measure 1.6–3.7:1 on the warm-cream ground and fail AA.
   * The theme ships AA-safe cuts of the same hues (`errorText`, `successText`,
   * `cautionText`, `warningText`, `metalText`) — use those wherever the value is
   * being read rather than filled.
   */
  const FILLS = [
    'orange', 'warning', 'success', 'error', 'info',
    'gold', 'goldLight', 'scoreGood', 'scorePoor',
  ];
  const ALLOW: Record<string, string> = {
    'components/fortune/SectionDivider.tsx diamond': '◆ ornament, decorative by design',
    'components/reading/primitives.tsx dot': 'bullet ornament, decorative by design',
    'components/reading/lifetime-cards.tsx layerMark': 'ornament glyph, decorative by design',
  };

  it('has no fill token used as a text colour outside the named ornaments', () => {
    const bad = BLOCKS.filter((b) => {
      if (!/fontSize:|\.\.\.T\./.test(b.body)) return false; // not a text style
      const c = b.body.match(/\bcolor:\s*colors\.(\w+)/);
      return !!c && FILLS.includes(c[1]) && !ALLOW[`${b.file} ${b.name}`];
    });
    expect(
      bad.map((b) => fmt(b, ` uses colors.${b.body.match(/\bcolor:\s*colors\.(\w+)/)![1]}`)),
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Guard C — serif bold names the bold FAMILY', () => {
  /**
   * React Native does NOT synthesize weight for custom fonts: every loaded face is
   * its own family, so `fonts.serif` (Regular) + fontWeight:'700' silently renders
   * REGULAR. This hid in 106 of 109 serif usages once and made the whole app read
   * thinner than the web.
   */
  it('never pairs fonts.serif with a bold weight', () => {
    const bad = BLOCKS.filter(
      (b) =>
        /fontFamily:\s*fonts\.serif\b/.test(b.body) &&
        /fontWeight:\s*'(?:[6-9]00|bold)'/.test(b.body),
    );
    expect(bad.map((b) => fmt(b, ' — use fonts.serifBold'))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Guard D — raw fontSize budget ratchets down', () => {
  /**
   * The count of style declarations that set a raw size instead of taking a
   * `text.*` role. This is the guard against the failure mode that actually bit:
   * naming a file as a target and never editing it. Unfinished work shows up here
   * as a number rather than as someone's recollection.
   *
   * ⚠️ This number may only ever DECREASE. If a change raises it, that change is
   * adding a style outside the role system — migrate it instead of raising the
   * budget. Lower it whenever a pass drops it, so the ratchet keeps its teeth.
   */
  const BUDGET = 342; // web-typography Phase 4: hourWarnLead/hourWarnItem took T.bodyTight

  it('does not add raw fontSize declarations', () => {
    const count = FILES.reduce(
      (n, f) => n + (fs.readFileSync(f, 'utf8').match(/fontSize:/g)?.length ?? 0),
      0,
    );
    if (count > BUDGET) {
      throw new Error(
        `raw fontSize declarations rose ${BUDGET} -> ${count}. Take a text.* role instead of ` +
          `raising the budget; see theme/index.ts.`,
      );
    }
    if (count < BUDGET) {
      throw new Error(
        `raw fontSize declarations fell ${BUDGET} -> ${count}. Good — re-pin BUDGET to ${count} ` +
          `so the ratchet keeps its teeth.`,
      );
    }
  });
});
