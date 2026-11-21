/**
 * @jest-environment node
 *
 * 1B items 4 and 6 — the website prints its OWN domain, and its copy no longer
 * advertises the deleted 紫微斗數 feature or an accuracy claim on the page the
 * iOS app's forgot-password link opens.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { siteHost } from '../app/lib/site-url';

const APP_DIR = join(__dirname, '../app');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

describe('siteHost', () => {
  it.each([
    ['https://tianmingapp.com', 'tianmingapp.com'],
    ['https://www.tianmingapp.com/', 'tianmingapp.com'],
    ['http://localhost:3000', 'localhost:3000'],
  ])('%s → %s', (url, host) => {
    expect(siteHost(url)).toBe(host);
  });
});

describe('the website never prints a domain we do not own', () => {
  // Built at runtime so this file cannot match its own needle.
  const wrongDomain = ['bazi', 'app', '.com'].join('');

  it(`no file under apps/web/app mentions it`, () => {
    const offenders = sourceFiles(APP_DIR).filter((f) => readFileSync(f, 'utf8').includes(wrongDomain));
    expect(offenders).toEqual([]);
  });
});

describe('site copy (1B item 6)', () => {
  it('metadata no longer advertises the deleted 紫微斗數 feature', () => {
    expect(readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8')).not.toContain('紫微斗數');
  });

  it('the sign-in page carries no accuracy claim and links the legal pages', () => {
    const page = readFileSync(join(APP_DIR, 'sign-in/[[...sign-in]]/page.tsx'), 'utf8');
    // Comments stripped so the explanatory note does not count, then the phrase
    // must be absent anywhere — `<p>…</p>` on one line included.
    const code = page
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('預見你的一生');
    expect(page).toContain('<AuthLegalFooter />');
  });

  it('the legal footer uses plain anchors, not next/link (they are route handlers)', () => {
    const footer = readFileSync(join(APP_DIR, 'components/AuthLegalFooter.tsx'), 'utf8');
    expect(footer).not.toMatch(/from ["']next\/link["']/);
    for (const path of ['/privacy', '/terms', '/support']) expect(footer).toContain(`<a href="${path}">`);
  });

  it('the sign-up page links the legal pages', () => {
    expect(readFileSync(join(APP_DIR, 'sign-up/[[...sign-up]]/page.tsx'), 'utf8')).toContain('<AuthLegalFooter />');
  });
});
