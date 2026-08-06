#!/usr/bin/env node
/**
 * Live typography sweep — the half a static guard structurally cannot do.
 *
 * The guards parse source text. This reads COMPUTED styles from a real render,
 * catching what source analysis cannot see: inherited sizes, cascade outcomes,
 * `em` chains, third-party DOM (Clerk renders its own markup, sized by Clerk,
 * entirely outside our CSS), and SVG <text>.
 *
 *   node scripts/type-sweep.js --base http://localhost:3000 [--lang zh-TW]
 *                              [--out report.json] [--min-covered N]
 *
 * ⚠️ READ THIS BEFORE TRUSTING A GREEN RUN
 * A line audit found two defects that made a green run meaningless:
 *   (1) a run against a DEAD PORT exited 0 — every route errored, every counter
 *       stayed 0, and the tool reported its strongest possible pass having proven
 *       nothing. Coverage is now COUNTED and asserted (--min-covered), and any
 *       route error exits non-zero.
 *   (2) the overflow check could never fire: globals.css sets
 *       `html, body { overflow-x: hidden }`, so nothing ever reports
 *       scrollWidth > clientWidth. It reported 0 on all 32 route×viewport combos
 *       even with a 5000px div injected. It now measures text against its
 *       container's box AND runs a POSITIVE SELF-TEST each run — if the self-test
 *       cannot detect deliberate overflow, the run fails loudly rather than
 *       reporting a clean zero.
 */
const fs = require('fs');
const path = require('path');

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};

const BASE = arg('--base', 'http://localhost:3000');
const LANG = arg('--lang', 'zh-TW');
const OUT = arg('--out', null);
/** Playwright storageState with a real Clerk session. Without it only
 *  middleware-public routes render — see COVERAGE LIMITATION at the bottom. */
const STATE = arg('--storage-state', null);
/** Full-page screenshots for visual-regression diffing between phases. */
const SHOTS = arg('--shots', null);

/**
 * Routes. NOTE: without a real Clerk session only middleware-public routes
 * render — see COVERAGE LIMITATION at the bottom of this file.
 */
const ROUTES = [
  // `/` IS the dashboard in this app; `/dashboard` intentionally redirects to it.
  '/', '/pricing', '/store', '/dashboard/profiles',
  '/dashboard/readings', '/dashboard/settings', '/dashboard/subscription',
  // Reading FORMS (birth-data entry)
  '/reading/lifetime', '/reading/love', '/reading/career', '/reading/annual',
  '/reading/compatibility', '/reading/fortune',
  '/sign-in', '/sign-up',
];

/**
 * Routes that render a COMPLETED reading — AIReadingDisplay, BaziChart and the
 * AI-narrated CJK prose. These are the surfaces the whole migration is FOR, and
 * without them the sweep only ever measured the birth-data form's chrome.
 * Requires --storage-state; skipped (and not counted) without it.
 */
const AUTHED_CONTENT_ROUTES = [
  '/reading/lifetime?id=fc7dfde8-bdf9-49a4-82fa-fcb23af41745',
  '/reading/love?id=2db032f4-1c97-42f1-bdad-0a1d262d3120',
  '/reading/compatibility?id=0ae7eecb-6d35-44c4-bc95-688d0894d105',
];

/** Expected covered route×viewport count. Pinned so silent coverage LOSS fails
 *  the run — e.g. an auth change turning 8 covered routes into redirects. */
const MIN_COVERED = Number(arg('--min-covered', '16'));

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
];

const CONTENT_FLOOR = 14;
const ORNAMENT_FLOOR = 12;
const CONTROL_MIN = 16;

/**
 * Below-floor elements that are DECIDED exceptions. Matched on a WHOLE class
 * name, and never applied to CJK — the stated reason each entry exists is "no
 * CJK strokes", so letting CJK through them would contradict the reason.
 */
const ORNAMENT_ALLOW = [
  { match: /(^|\.)([\w-]*[Bb]adge[\w-]*)$/, why: 'latin numeral / count badge' },
  { match: /(^|\.)([\w-]*[Ii]con[\w-]*)$/, why: 'icon or emoji glyph, not text' },
];

/** Containers that are SUPPOSED to scroll — seeded before the chart phase so the
 *  check does not flag its own horizontal-scroll remedy. */
const SCROLL_ALLOW = [/pillarsTable|chartScroll|tableWrap|scrollArea|carousel/];

const PROBE = `(() => {
  const CONTENT_FLOOR = ${CONTENT_FLOOR}, CONTROL_MIN = ${CONTROL_MIN};
  const out = { floor: [], controls: [], overflow: [], selfTest: null,
    // Fingerprint of what was ACTUALLY measured. Without this, a route that
    // rendered the wrong DOM reports a plausible-looking count and nobody knows.
    textLen: document.body.innerText.length,
    head: document.body.innerText.slice(0, 60).replace(/\s+/g, ' ') };
  const CJK = /[\\u3400-\\u4DBF\\u4E00-\\u9FFF]/;
  const label = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = (typeof el.className === 'string' ? el.className : '')
      .trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + id + (cls ? '.' + cls : '');
  };

  // ── 1. floor. Walk text nodes so we measure what the READER sees. SVG <text>
  //    is included via the same walk (its parentElement is the <text> element);
  //    a \`seen\` set stops it being counted twice.
  const seen = new Set();
  const record = (el, t, isSvg) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    if (!px || px >= CONTENT_FLOOR) return;
    // An element composed from the token file has a size DECIDED BY THE SCALE.
    // caption is 12 and label/meta are 13 by design (units, disclaimers, field
    // labels), so counting them as violations conflates "arbitrary small text"
    // with "correctly-sized caption" — and makes the metric un-zeroable, since it
    // would plateau at however many captions the app legitimately has.
    const cls = typeof el.className === 'string' ? el.className : '';
    const roled = /type-module__[\\w-]+__(caption|label|meta|dataSmall)/.test(cls);
    out.floor.push({ sel: label(el), px, lineHeight: cs.lineHeight,
      text: t.slice(0, 24), cjk: CJK.test(t), svg: !!isSvg, roled });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim();
    if (t) record(n.parentElement, t, n.parentElement &&
      n.parentElement.namespaceURI === 'http://www.w3.org/2000/svg');
  }
  for (const el of document.querySelectorAll('svg text')) {
    record(el, (el.textContent || '').trim(), true);
  }

  // ── 2. THE proof of the iOS zoom rule. Only TEXT-ENTRY controls zoom; a
  //    checkbox/radio has nothing to type into (22 false positives originally).
  const ZOOMABLE = new Set(['text','password','email','tel','number','search','url',
    'date','time','datetime-local','month','week','']);
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.tagName.toLowerCase() === 'input' &&
        !ZOOMABLE.has((el.type || '').toLowerCase())) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px && px < CONTROL_MIN) {
      out.controls.push({ sel: label(el), px, type: el.type || el.tagName });
    }
  }

  // ── 3. overflow. NOT scrollWidth: html/body carry overflow-x:hidden, so the
  //    root clips and no ancestor ever reports it. Measure the text's own ink
  //    box against its element box instead.
  const overflowing = (root) => {
    const hits = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const t = (node.textContent || '').trim();
      if (!t) continue;
      const el = node.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.overflow === 'auto' || cs.overflow === 'scroll' ||
          cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
      const r = document.createRange();
      r.selectNodeContents(el);
      const ink = r.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      if (ink.width === 0 || box.width === 0) continue;
      // A single glyph (emoji/ornament) is not content clipping — emoji ink is
      // routinely wider than its em square. Flagging it trains people to ignore
      // the check, which is worse than not having it.
      if (t.replace(/\s/g, '').length <= 2) continue;
      if (ink.right > box.right + 1 || ink.width > box.width + 1) {
        hits.push({ sel: label(el), ink: Math.round(ink.width),
          box: Math.round(box.width), text: t.slice(0, 20) });
      }
    }
    return hits;
  };
  out.overflow = overflowing(document.body);

  // ── POSITIVE SELF-TEST. A check that cannot fire is worse than no check: it
  //    reports zero and reads as a pass. Inject a deliberately clipped box and
  //    assert the detector sees it; the runner treats a miss as a hard error.
  const probe = document.createElement('div');
  probe.style.cssText = 'width:40px;overflow:hidden;white-space:nowrap;position:fixed;left:-9999px;top:0';
  probe.textContent = '命格互補靈魂契合度婚姻宮互動整體相容緣分星曜';
  document.body.appendChild(probe);
  out.selfTest = { detected: overflowing(probe).length > 0 };
  probe.remove();

  return out;
})()`;

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('playwright not resolvable. Run from the repo root.');
    process.exit(2);
  }

  // CORS is disabled ONLY in this throwaway headless browser. The worktree dev
  // server runs on a port outside the API's CORS_ORIGINS, and typography — not
  // CORS — is what this measures. Nothing shared is modified to achieve it.
  const browser = await chromium.launch({
    args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'],
  });
  const ctx = await browser.newContext(
    STATE ? { storageState: STATE } : {},
  );
  // ⚠️ ONLY in anonymous mode. `__e2e_auth=1` does NOT authenticate (it is read
  // client-side only and cannot satisfy Clerk's server-side auth.protect()) — it
  // switches the app into its E2E-TEST branch, which bypasses useAuth() and does
  // not fetch real data. Setting it alongside a real session made every reading
  // route silently render the birth-data form instead of the reading.
  if (!STATE) {
    await ctx.addCookies([{ name: '__e2e_auth', value: '1', url: BASE }]);
  }

  const report = { base: BASE, lang: LANG, generatedAt: new Date().toISOString(), routes: {} };
  let floorHits = 0, controlHits = 0, overflowHits = 0;
  let covered = 0, redirected = 0, errored = 0, selfTestFails = 0;

  for (const vp of VIEWPORTS) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    // Content routes go FIRST: the Clerk session degrades over a long run, and
    // when it does the reading page silently falls back to the birth-data form
    // (observed: /reading/fortune rendering 「登入狀態已過期」 late in the run while
    // ?id= routes reported plausible-looking form numbers as if they were readings).
    const routeList = STATE ? [...AUTHED_CONTENT_ROUTES, ...ROUTES] : ROUTES;
    for (const route of routeList) {
      const key = `${vp.name} ${route}`;
      try {
        // NOT networkidle: the fortune routes hold an open SSE stream, so it never
        // fires and every load burns the full timeout.
        // Hard-separate every route. Visiting /reading/x then /reading/x?id=… is a
        // SAME-PATHNAME navigation, which the App Router treats as a soft nav — the
        // component never remounts, the ?id= is never picked up, and the sweep
        // measures the birth-data form while believing it measured the reading.
        await page.goto('about:blank');
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
        // Settle until the DOM stops growing. A fixed 700ms silently measured the
        // PRE-HYDRATION birth-data form on reading routes instead of the rendered
        // reading — i.e. it sampled the wrong DOM and under-reported by ~10x.
        // NOT networkidle: the fortune routes hold an open SSE stream, so it never
        // fires and every load burns the full timeout.
        // ⚠️ Stability alone is NOT enough: on a reading route the birth-data
        // form renders fast and sits STILL while the reading is still loading, so
        // a settle-until-quiet loop exits early and measures the form. Wait for
        // the content signal explicitly, then settle.
        let contentOk = true;
        if (route.includes('?id=')) {
          contentOk = await page
            .waitForSelector('[class*="sectionContent"], [class*="pillarsTable"]', { timeout: 25000 })
            .then(() => true).catch(() => false);
        }
        let prev = -1;
        for (let i = 0; i < 12; i++) {
          await page.waitForTimeout(500);
          const len = await page.evaluate(() => document.body.innerText.length);
          if (i >= 2 && len === prev && len > 0) break;
          prev = len;
        }

        if (!contentOk) {
          // Reporting the form's numbers under a reading route's name is the same
          // category of lie as reporting sign-in's numbers under /pricing.
          errored++;
          report.routes[key] = { error: 'content did not render (session expired?)', covered: false };
          console.log(`  XX   ${key.padEnd(38)} CONTENT DID NOT RENDER — not counted`);
          continue;
        }
        const landed = new URL(page.url()).pathname;
        if (landed !== route.split('?')[0]) {
          // Reporting a redirected route's numbers would be reporting the SIGN-IN
          // page's numbers under another route's name — which is exactly how 7
          // routes looked "covered" in the first baseline.
          report.routes[key] = { redirectedTo: landed, covered: false };
          redirected++;
          console.log(`  --   ${key.padEnd(38)} REDIRECTED -> ${landed} (needs auth; NOT covered)`);
          continue;
        }

        if (LANG !== 'zh-TW') {
          await page.evaluate((l) => document.documentElement.setAttribute('data-lang', l), LANG);
          await page.waitForTimeout(300);
        }
        const r = await page.evaluate(PROBE);

        if (!r.selfTest || !r.selfTest.detected) {
          selfTestFails++;
          console.log(`  XX   ${key.padEnd(38)} OVERFLOW SELF-TEST FAILED — detector is blind here`);
        }
        r.roledBelowFloor = r.floor.filter((f) => f.roled).length; // compliant, reported
        r.floor = r.floor.filter((f) => !f.roled).filter((f) =>
          !(f.px >= ORNAMENT_FLOOR && !f.cjk &&
            ORNAMENT_ALLOW.some((a) => a.match.test(f.sel))));
        r.overflow = r.overflow.filter((o) => !SCROLL_ALLOW.some((s) => s.test(o.sel)));

        if ((r.head || '').includes('登入狀態已過期')) {
          errored++;
          report.routes[key] = { error: 'auth-expired banner rendered', covered: false };
          console.log(`  XX   ${key.padEnd(38)} AUTH EXPIRED mid-run — not counted`);
          continue;
        }
        if (SHOTS) {
          const safe = key.replace(/[^\w.-]+/g, '_').slice(0, 90);
          fs.mkdirSync(SHOTS, { recursive: true });
          await page.screenshot({ path: path.join(SHOTS, safe + '.png'), fullPage: true });
        }
        report.routes[key] = { ...r, covered: true };
        covered++;
        floorHits += r.floor.length;
        controlHits += r.controls.length;
        overflowHits += r.overflow.length;

        const bad = r.floor.length + r.controls.length + r.overflow.length;
        console.log(`${bad === 0 ? '  ok  ' : '  !!  '} ${key.padEnd(38)} ` +
          `floor=${r.floor.length} controls=${r.controls.length} overflow=${r.overflow.length}`);
        for (const f of r.floor.slice(0, 3)) {
          console.log(`         ${f.px}px${f.cjk ? ' CJK' : ''}${f.svg ? ' [SVG]' : ''} ${f.sel} "${f.text}"`);
        }
        for (const c of r.controls.slice(0, 3)) {
          console.log(`         CONTROL ${c.px}px ${c.sel} — iOS Safari zooms on focus`);
        }
        for (const o of r.overflow.slice(0, 3)) {
          console.log(`         OVERFLOW ${o.sel} ink=${o.ink}px box=${o.box}px "${o.text}"`);
        }
      } catch (e) {
        errored++;
        report.routes[key] = { error: String(e).split('\n')[0], covered: false };
        console.log(`  ??   ${key.padEnd(38)} ERROR ${String(e).split('\n')[0].slice(0, 55)}`);
      }
    }
    await page.close();
  }
  await browser.close();

  report.summary = { floorHits, controlHits, overflowHits, covered, redirected, errored, selfTestFails };
  console.log(`\nmode: ${STATE ? 'AUTHENTICATED (storageState)' : 'anonymous — public routes only'}`);
  console.log(`coverage: ${covered} covered · ${redirected} redirected · ${errored} errored ` +
    `(of ${ROUTES.length * VIEWPORTS.length})`);
  console.log(`TOTAL  sub-${CONTENT_FLOOR}px=${floorHits}  controls<${CONTROL_MIN}px=${controlHits}  overflow=${overflowHits}`);

  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`report -> ${OUT}`);
  }

  // A run that proved nothing must never look like a pass.
  const fatal = [];
  if (errored > 0) fatal.push(`${errored} route(s) errored`);
  if (covered < MIN_COVERED) fatal.push(`coverage ${covered} < required ${MIN_COVERED}`);
  if (selfTestFails > 0) fatal.push(`${selfTestFails} overflow self-test failure(s)`);
  if (fatal.length) {
    console.error(`\nRUN INVALID: ${fatal.join('; ')}`);
    process.exit(2);
  }
  if (controlHits > 0) {
    console.error(`\nFAIL: ${controlHits} focusable control(s) under ${CONTROL_MIN}px (iOS zoom).`);
    process.exit(1);
  }
  process.exit(0);
}

/**
 * ⚠️ COVERAGE LIMITATION — do not read a green run as full coverage.
 *
 * Without a real Clerk session this reaches only middleware-PUBLIC routes:
 * /reading/*, /sign-in, /sign-up. The other 8 redirect. Worse, the /reading/*
 * routes render only the BIRTH-DATA FORM — the reading result, AIReadingDisplay,
 * BaziChart and the AI-narrated CJK prose that motivated this whole migration all
 * require a session, so they are covered by NEITHER half of the tooling.
 *
 * To close it: run an authenticated Playwright `storageState` setup project and
 * pass it to newContext(), then add a route that renders a COMPLETED reading
 * (seeded/cached reading id) and one chart-bearing route — and raise
 * --min-covered accordingly.
 */
main().catch((e) => { console.error(e); process.exit(2); });
