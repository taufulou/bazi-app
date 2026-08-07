#!/usr/bin/env node
/**
 * Collector for the mobile typography measurement (apps/mobile/src/dev/type-audit.ts).
 *
 *   node scripts/type-collector.js [--out DIR] [--port 8099]
 *   node scripts/type-collector.js --summary [--out DIR]
 *
 * The app POSTs one report per screen; this stores the LATEST per (platform, screen)
 * and can print a verdict over everything collected so far.
 *
 * WHY A SERVER: a console.log from the app lands in Metro's terminal, which is not
 * readable from here. An HTTP POST makes the walk produce a FILE — which is what
 * turns "I looked at the screens" into something re-runnable that a later session
 * can diff against.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const OUT = path.resolve(arg('--out', '/tmp/mobile-type'));
const PORT = Number(arg('--port', '8099'));

/**
 * Floors, from CLAUDE.md's "Type floors (CJK)" note.
 * 12 is the floor for ANYTHING A USER READS, including dense tabular cells.
 * 11 survives only for non-CJK ornaments, where stroke density is not a factor.
 */
const CJK_FLOOR = 12;
const ORNAMENT_FLOOR = 11;

/**
 * Does this string actually WRAP? Leading only matters on text that takes more than
 * one line; a single-line chip or picker option renders identically leaded or not.
 *
 * CJK advance is 1em, so a run of N CJK characters at S points is about N*S wide.
 * USABLE is the widest a text block gets on a 402pt screen after screen padding,
 * card padding and any chip padding — deliberately generous, so this UNDER-reports
 * rather than crying wolf. A ">= 12 characters" rule claimed 175 offenders; nearly
 * all were chips that comfortably fit one line.
 *
 * ⚠️ KNOWN BLIND SPOT: it assumes a FULL-WIDTH container. Text in a narrow one — a
 * centred label inside an energy ring, a half-width card, a column in a grid — wraps
 * far below USABLE_PT and will not be flagged. EnergyScoreRing.microDisclaimer was
 * exactly that case: 18 CJK chars at 12pt is only ~216pt, so this estimate would
 * have missed it, and it was caught by reading the component instead.
 *
 * So "0 wrapping unleaded" is weaker evidence than "0 below floor", which is a
 * direct measurement. Closing this properly needs the rendered width — an onLayout
 * on each Text, or the host node's measured frame — not a character count.
 */
const USABLE_PT = 330;
const wraps = (s) => {
  const cjk = (s.text.match(/[㐀-䶿一-鿿]/g) || []).length;
  const other = s.text.length - cjk;
  return cjk * s.fontSize + other * s.fontSize * 0.55 > USABLE_PT;
};

fs.mkdirSync(OUT, { recursive: true });
const safe = (s) => s.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'root';

function summary() {
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.json'));
  if (!files.length) {
    console.log(`No reports in ${OUT}. Is the collector running and the app walking?`);
    process.exit(2); // proving nothing is a failure, not a pass
  }
  let screens = 0;
  let samples = 0;
  const dead = [];
  const offenders = [];
  const unleaded = [];
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
    screens += 1;
    if (!r.samples.length) dead.push(`${r.platform}:${r.screen} (${r.diagnostic})`);
    /**
     * DEDUPE. React keeps alternate fibers, and a tab navigator holds several screen
     * instances mounted at once, so the same string is walked many times — "八字愛情姻緣"
     * appeared 30x on one screen. Counting raw would report ~1000 phantom defects and
     * bury the handful of real ones.
     */
    const uniq = new Map();
    for (const s of r.samples) {
      uniq.set(`${s.text}|${s.fontSize}|${s.lineHeight}|${s.owner}`, s);
    }
    for (const s of uniq.values()) {
      samples += 1;
      // A node with no fontSize of its own is a NESTED <Text> fragment: RN resolves
      // both its size AND its leading from the enclosing <Text>. Judging such a node
      // on its own flattened style reports every inline run inside a correctly-leaded
      // paragraph as unleaded — which is how an early version of this summary claimed
      // 80 offenders, most of them fragments of prose that was already right.
      if (s.fontSize == null) continue;
      const floor = s.cjk ? CJK_FLOOR : ORNAMENT_FLOOR;
      if (s.fontSize < floor) {
        offenders.push({ ...s, screen: r.screen, platform: r.platform, floor });
      }
      // Leading matters most for CJK: dense glyphs at Latin default leading read
      // worse than smaller text that is correctly leaded.
      /**
       * Only LONG CJK counts. A single-line heading with no explicit leading renders
       * at the font's natural line height and reads fine; leading is load-bearing
       * when the text WRAPS, which is where CJK at Latin default leading hurts.
       * Flagging every unleaded label would drown the signal — it reported 1025
       * before this cut, nearly all single-line titles.
       */
      if (s.cjk && s.lineHeight == null && wraps(s)) {
        unleaded.push({ ...s, screen: r.screen, platform: r.platform });
      }
    }
  }
  if (dead.length) {
    // A screen that reported zero text nodes did not "pass" — it proved nothing.
    console.log(`\n⚠️  ${dead.length} screen(s) reported ZERO text nodes:`);
    dead.forEach((d) => console.log(`     ${d}`));
  }
  console.log(`\nscreens reported : ${screens}`);
  console.log(`text nodes read  : ${samples}`);
  console.log(`\nBELOW FLOOR (CJK<${CJK_FLOOR}, ornament<${ORNAMENT_FLOOR}): ${offenders.length}`);
  offenders
    .sort((a, b) => a.fontSize - b.fontSize)
    .forEach((o) =>
      console.log(
        `  ${String(o.fontSize).padStart(5)}pt ${o.cjk ? 'CJK' : '   '} ` +
          `${String(o.owner || '?').padEnd(24)} ${o.screen.padEnd(22)} "${o.text.slice(0, 24)}"`
      )
    );
  console.log(`\nWRAPPING CJK WITHOUT LEADING (est. >${USABLE_PT}pt wide): ${unleaded.length}`);
  const byOwner = {};
  unleaded.forEach((u) => {
    const k = `${u.owner || '?'} (${u.fontSize ?? '-'}pt)`;
    byOwner[k] = (byOwner[k] || 0) + 1;
  });
  Object.entries(byOwner)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}x  ${k}`));
  process.exit(offenders.length ? 1 : 0);
}

if (process.argv.includes('--summary')) summary();

http
  .createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/report')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const r = JSON.parse(body);
        const name = `${safe(r.platform)}__${safe(r.screen)}.json`;
        fs.writeFileSync(path.join(OUT, name), JSON.stringify(r));
        const sizes = r.samples.map((s) => s.fontSize).filter((n) => typeof n === 'number');
        const min = sizes.length ? Math.min(...sizes) : '-';
        const warn = r.samples.length === 0 ? `   ⚠️ ZERO — ${r.diagnostic}` : '';
        console.log(
          `  ${r.platform.padEnd(8)} ${String(r.screen).padEnd(26)} ` +
            `${String(r.samples.length).padStart(4)} nodes   min ${min}pt${warn}`
        );
      } catch (e) {
        console.error('  bad report:', e.message);
      }
      res.writeHead(204).end();
    });
  })
  .listen(PORT, () => {
    console.log(`type-collector on :${PORT} -> ${OUT}`);
    console.log('walk the app; each screen reports automatically.\n');
  });
