/** @jest-environment node */
/**
 * 1B item 1 — the public legal pages served on the website.
 *
 * Three properties, each asserted by BEHAVIOUR rather than by grepping:
 *   1. the proxy returns the API's HTML on success and a static 503 on every
 *      failure shape (non-200, throw, timeout) — never a redirect;
 *   2. the middleware treats exactly /privacy /terms /support as public, and
 *      not lookalikes that would widen the allowlist;
 *   3. the route files carry no top-level route config (which would make
 *      `next build` call the API).
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { createRouteMatcher } from '@clerk/nextjs/server';

import { serveLegalPage, LEGAL_CONTACT_EMAIL } from '../app/lib/legal-proxy';

const okFetch = (body: string, status = 200) =>
  jest.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

describe('serveLegalPage', () => {
  it('returns the upstream HTML with an html content-type', async () => {
    const f = okFetch('<h1>隱私權政策</h1>');
    const res = await serveLegalPage('privacy', f);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe('<h1>隱私權政策</h1>');
  });

  it.each(['privacy', 'terms', 'support'] as const)('fetches /%s from the API', async (page) => {
    const f = okFetch('x');
    await serveLegalPage(page, f);
    const [url, init] = (f as unknown as jest.Mock).mock.calls[0];
    expect(url).toMatch(new RegExp(`/${page}$`));
    expect(init.signal).toBeDefined();
    expect(init.next).toEqual({ revalidate: 3600 });
  });

  it.each([404, 500, 502])('serves the static fallback (503) when upstream answers %i', async (status) => {
    const res = await serveLegalPage('terms', okFetch('upstream error page', status));
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toContain('upstream error page');
    expect(body).toContain(LEGAL_CONTACT_EMAIL);
    expect(res.headers.get('location')).toBeNull();
  });

  it('serves the fallback when fetch throws (timeout / DNS / refused)', async () => {
    const f = jest.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as unknown as typeof fetch;
    const res = await serveLegalPage('support', f);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('keeps the contact email in sync with the API constant', () => {
    const apiConstants = fs.readFileSync(
      path.join(__dirname, '../../api/src/legal/legal-constants.ts'),
      'utf8',
    );
    expect(apiConstants).toContain(`export const CONTACT_EMAIL = '${LEGAL_CONTACT_EMAIL}';`);
  });
});

describe('middleware public allowlist', () => {
  // Read the pattern list from the middleware module itself, then build the
  // SAME matcher Clerk builds, so this asserts what production does.
  let isPublic: (req: NextRequest) => boolean;
  beforeAll(async () => {
    const mod = await import('../middleware');
    isPublic = createRouteMatcher(mod.PUBLIC_ROUTE_PATTERNS);
  });
  const req = (p: string) => new NextRequest(new URL(p, 'https://tianmingapp.com'));

  it.each(['/privacy', '/terms', '/support'])('%s is public', (p) => {
    expect(isPublic(req(p))).toBe(true);
  });

  it.each(['/privacyx', '/privacy/anything', '/terms-old', '/supporter', '/pricing', '/store', '/'])(
    '%s stays protected',
    (p) => {
      expect(isPublic(req(p))).toBe(false);
    },
  );
});

describe('route files', () => {
  it.each(['privacy', 'terms', 'support'])('app/%s/route.ts has no top-level route config', (p) => {
    const src = fs.readFileSync(path.join(__dirname, `../app/${p}/route.ts`), 'utf8');
    expect(src).not.toMatch(/^export const (revalidate|dynamic|fetchCache|runtime)\b/m);
    expect(src).toMatch(/export async function GET\(/);
    expect(src).not.toMatch(/export async function (POST|PUT|DELETE|PATCH)\(/);
  });

  it('sitemap lists the three legal pages', async () => {
    const { default: sitemap } = await import('../app/sitemap');
    const urls = (await sitemap()).map((e) => new URL(e.url).pathname);
    expect(urls).toEqual(expect.arrayContaining(['/privacy', '/terms', '/support']));
  });
});
