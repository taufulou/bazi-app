/**
 * M9 — the Stripe redirect allowlist.
 *
 * The regex this replaced had no tests at all: `payments-controller.spec.ts`
 * calls the controller method directly, so the `ValidationPipe` never runs and
 * its `successUrl: 'https://example.com/success'` fixtures would in fact have
 * been REJECTED by the very validation they appear to exercise. So these are
 * the first assertions that the redirect allowlist does anything.
 */
import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe-options';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IsString } from 'class-validator';
import {
  CreateCreditCheckoutDto,
  CreatePortalSessionDto,
  CreateSubscriptionCheckoutDto,
} from '../src/payments/payments.controller';
import {
  DEFAULT_WEB_ORIGIN,
  parseWebOrigins,
  reportWebOrigins,
  resolveRedirectUrl,
  webOriginsFromEnv,
} from '../src/payments/safe-redirect-url';
import { SafeRedirectUrl } from '../src/payments/safe-redirect-url.decorator';

const OURS = parseWebOrigins('https://ours.example.com');

describe('parseWebOrigins', () => {
  it('normalises case, default port and trailing path to a bare origin', () => {
    const parsed = parseWebOrigins('HTTPS://Ours.Example.COM:443/app/');
    expect(parsed.origins).toEqual(['https://ours.example.com']);
    expect(parsed.normalised).toEqual([
      ['HTTPS://Ours.Example.COM:443/app/', 'https://ours.example.com'],
    ]);
  });

  it('keeps a non-default port, which is part of the origin', () => {
    expect(parseWebOrigins('http://localhost:3001').origins).toEqual([
      'http://localhost:3001',
    ]);
  });

  it('preserves order — the first entry is the canonical base', () => {
    const parsed = parseWebOrigins('https://a.example.com, https://b.example.com');
    expect(parsed.origins).toEqual(['https://a.example.com', 'https://b.example.com']);
    expect(parsed.canonical).toBe('https://a.example.com');
  });

  it('dedupes entries that normalise to the same origin', () => {
    expect(parseWebOrigins('https://a.example.com,https://A.example.com/x').origins)
      .toEqual(['https://a.example.com']);
  });

  it('drops non-http(s) entries rather than allowlisting an XSS sink', () => {
    // `javascript:`/`data:` have an opaque origin, but `ftp:`/`ws:` are
    // "special" schemes in the URL spec and DO produce a real `.origin` — so
    // they are only excluded by the explicit scheme check. Mutation-tested:
    // deleting that check leaves the opaque pair still rejected, so without the
    // ftp/ws rows here the check would look covered while being unguarded.
    const parsed = parseWebOrigins(
      'javascript:alert(1),data:text/html;x,ftp://nope.example.com,ws://nope.example.com',
    );
    expect(parsed.origins).toEqual([DEFAULT_WEB_ORIGIN]);
    expect(parsed.rejected.map(([e]) => e)).toEqual([
      'javascript:alert(1)',
      'data:text/html;x',
      'ftp://nope.example.com',
      'ws://nope.example.com',
    ]);
  });

  it('drops relative entries — an allowlist entry must name an origin', () => {
    const parsed = parseWebOrigins('/store');
    expect(parsed.rejected).toEqual([['/store', 'not an absolute URL']]);
    expect(parsed.usedFallback).toBe(true);
  });

  it('tolerates blank entries from a trailing comma', () => {
    expect(parseWebOrigins('https://a.example.com, ,').origins)
      .toEqual(['https://a.example.com']);
  });

  it('falls back to localhost only when nothing usable was configured', () => {
    for (const raw of [undefined, '', '   ', ',,']) {
      const parsed = parseWebOrigins(raw);
      expect(parsed.usedFallback).toBe(true);
      expect(parsed.origins).toEqual([DEFAULT_WEB_ORIGIN]);
    }
    expect(parseWebOrigins('https://a.example.com').usedFallback).toBe(false);
  });
});

describe('resolveRedirectUrl — accepts', () => {
  it('resolves a relative path to an absolute URL, which is what Stripe needs', () => {
    expect(resolveRedirectUrl('/store?credits=success', OURS)).toEqual({
      ok: true,
      url: 'https://ours.example.com/store?credits=success',
    });
  });

  it('passes through an absolute URL on an allowlisted origin', () => {
    expect(resolveRedirectUrl('https://ours.example.com/pricing?cancelled=true', OURS))
      .toEqual({ ok: true, url: 'https://ours.example.com/pricing?cancelled=true' });
  });

  it('accepts any allowlisted origin, not only the canonical one', () => {
    const both = parseWebOrigins('https://a.example.com,https://b.example.com');
    expect(resolveRedirectUrl('https://b.example.com/x', both).ok).toBe(true);
  });

  it('is case-insensitive on scheme and host, per the URL spec', () => {
    expect(resolveRedirectUrl('HTTPS://OURS.EXAMPLE.COM/x', OURS)).toEqual({
      ok: true,
      url: 'https://ours.example.com/x',
    });
  });

  it('treats an explicit default port as the same origin', () => {
    expect(resolveRedirectUrl('https://ours.example.com:443/x', OURS).ok).toBe(true);
  });

  it('preserves the query string and fragment', () => {
    expect(resolveRedirectUrl('/a?b=c&d=e#f', OURS)).toEqual({
      ok: true,
      url: 'https://ours.example.com/a?b=c&d=e#f',
    });
  });
});

describe('resolveRedirectUrl — rejects', () => {
  // Each of the first three PASSED the regex this replaced, because it
  // pattern-matched the input string instead of the resolved origin.
  it('rejects a protocol-relative URL that the old regex allowed', () => {
    expect(resolveRedirectUrl('//evil.example.com/x', OURS)).toEqual({
      ok: false,
      reason: 'origin is not allowlisted',
    });
  });

  it('rejects the backslash variant browsers read as protocol-relative', () => {
    for (const input of ['/\\evil.example.com', '\\/evil.example.com', '/\\\\evil.example.com']) {
      expect(resolveRedirectUrl(input, OURS).ok).toBe(false);
    }
  });

  it('rejects userinfo smuggling — the host is what follows the @', () => {
    expect(resolveRedirectUrl('https://ours.example.com@evil.example.com/', OURS))
      .toEqual({ ok: false, reason: 'origin is not allowlisted' });
  });

  it('rejects a suffix-confusion host', () => {
    expect(resolveRedirectUrl('https://ours.example.com.evil.test/x', OURS).ok).toBe(false);
    expect(resolveRedirectUrl('https://notours.example.com/x', OURS).ok).toBe(false);
  });

  it('rejects a different scheme on an allowlisted host', () => {
    expect(resolveRedirectUrl('http://ours.example.com/x', OURS).ok).toBe(false);
  });

  it('rejects a different port on an allowlisted host', () => {
    expect(resolveRedirectUrl('https://ours.example.com:8443/x', OURS).ok).toBe(false);
  });

  it('rejects javascript: and data:', () => {
    expect(resolveRedirectUrl('javascript:alert(1)', OURS).ok).toBe(false);
    expect(resolveRedirectUrl('data:text/html,<script>x</script>', OURS).ok).toBe(false);
  });

  it('rejects empty, blank and non-string input', () => {
    for (const input of ['', '   ', undefined, null, 42, {}, ['/x']]) {
      expect(resolveRedirectUrl(input, OURS).ok).toBe(false);
    }
  });

  it('rejects a scheme-only form that would resolve somewhere surprising', () => {
    // `new URL('https:evil.example.com', base)` is `<base>/evil.example.com` —
    // safe, but not what the caller asked for. Refuse rather than reinterpret.
    expect(resolveRedirectUrl('https:evil.example.com', OURS)).toEqual({
      ok: false,
      reason: 'must be a relative path or an absolute http(s) URL',
    });
  });

  it('rejects a deployed origin when WEB_ORIGINS was left unset — fails CLOSED', () => {
    const unset = parseWebOrigins(undefined);
    expect(resolveRedirectUrl('https://app.up.railway.app/store', unset).ok).toBe(false);
    expect(resolveRedirectUrl('http://localhost:3000/store', unset).ok).toBe(true);
  });
});

describe('webOriginsFromEnv', () => {
  it('reads WEB_ORIGINS from the supplied environment', () => {
    expect(webOriginsFromEnv({ WEB_ORIGINS: 'https://x.example.com' } as NodeJS.ProcessEnv).origins)
      .toEqual(['https://x.example.com']);
  });
});

describe('reportWebOrigins', () => {
  it('warns about the fallback, the rejected entry and the rewritten one', () => {
    const logs: string[] = [];
    const warns: string[] = [];
    reportWebOrigins(parseWebOrigins(undefined), (m) => logs.push(m), (m) => warns.push(m));
    expect(warns.join('\n')).toMatch(/not set/);
    expect(logs).toHaveLength(0);

    warns.length = 0;
    reportWebOrigins(
      parseWebOrigins('HTTPS://Ours.Example.COM/,ftp://nope.example.com'),
      (m) => logs.push(m),
      (m) => warns.push(m),
    );
    expect(warns.some((w) => /ignoring "ftp:/.test(w))).toBe(true);
    expect(warns.some((w) => /normalised/.test(w))).toBe(true);
    expect(logs.some((l) => /https:\/\/ours\.example\.com/.test(l))).toBe(true);
  });
});

describe('@SafeRedirectUrl() on a DTO', () => {
  class Dto {
    @IsString()
    @SafeRedirectUrl()
    successUrl!: string;
  }

  const ENV = process.env.WEB_ORIGINS;
  beforeEach(() => {
    process.env.WEB_ORIGINS = 'https://ours.example.com';
  });
  afterAll(() => {
    if (ENV === undefined) delete process.env.WEB_ORIGINS;
    else process.env.WEB_ORIGINS = ENV;
  });

  async function check(successUrl: unknown) {
    const dto = plainToInstance(Dto, { successUrl });
    return { errors: await validate(dto), dto };
  }

  it('rewrites a relative path to the absolute URL the controller will send', async () => {
    const { errors, dto } = await check('/store?credits=success');
    expect(errors).toHaveLength(0);
    expect(dto.successUrl).toBe('https://ours.example.com/store?credits=success');
  });

  it('leaves an already-absolute allowlisted URL alone', async () => {
    const { errors, dto } = await check('https://ours.example.com/a');
    expect(errors).toHaveLength(0);
    expect(dto.successUrl).toBe('https://ours.example.com/a');
  });

  it('fails validation for a foreign origin and quotes what was sent', async () => {
    const { errors, dto } = await check('https://evil.example.com/a');
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0]!.constraints ?? {}).join()).toMatch(/not allowlisted/);
    // Unresolvable input is left untouched so the error is about the real value.
    expect(dto.successUrl).toBe('https://evil.example.com/a');
  });

  it('fails validation for the protocol-relative form', async () => {
    const { errors } = await check('//evil.example.com/a');
    expect(errors).toHaveLength(1);
  });

  it('reads the allowlist per request, not at decoration time', async () => {
    process.env.WEB_ORIGINS = 'https://other.example.com';
    const { errors, dto } = await check('/x');
    expect(errors).toHaveLength(0);
    expect(dto.successUrl).toBe('https://other.example.com/x');
  });
});

/**
 * The wiring, not the helper.
 *
 * Everything above proves `resolveRedirectUrl` and `plainToInstance` behave.
 * Neither proves the value the CONTROLLER receives is the resolved one — that
 * depends on the global pipe being constructed with `transform: true`, which
 * lives in `main.ts`, a file none of the tests above touch. This session has
 * repeatedly found a correct helper behind untested wiring, so: run the real
 * `ValidationPipe` over the real DTO classes and read what comes out.
 */
describe('through the real ValidationPipe, on the real DTOs', () => {
  // The SAME options object main.ts passes, imported rather than retyped. See
  // validation-pipe-options.ts for which option combinations preserve the
  // `@SafeRedirectUrl` rewrite — a hardcoded copy here could not catch a
  // production change that dropped it.
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

  const ENV = process.env.WEB_ORIGINS;
  beforeEach(() => {
    process.env.WEB_ORIGINS = 'https://ours.example.com';
  });
  afterAll(() => {
    if (ENV === undefined) delete process.env.WEB_ORIGINS;
    else process.env.WEB_ORIGINS = ENV;
  });

  const run = (metatype: new () => object, value: unknown) =>
    pipe.transform(value, { type: 'body', metatype });

  it('hands the controller an ABSOLUTE url when the browser sent a relative one', async () => {
    const out = (await run(CreateCreditCheckoutDto, {
      packageSlug: 'starter',
      successUrl: '/store?credits=success',
      cancelUrl: '/store?cancelled=true',
    })) as CreateCreditCheckoutDto;

    // Stripe rejects a relative success_url, so this rewrite is the whole
    // reason relative paths work at all.
    expect(out.successUrl).toBe('https://ours.example.com/store?credits=success');
    expect(out.cancelUrl).toBe('https://ours.example.com/store?cancelled=true');
  });

  it('rejects a foreign origin with 400 before Stripe is ever called', async () => {
    await expect(
      run(CreateSubscriptionCheckoutDto, {
        planSlug: 'pro',
        billingCycle: 'monthly',
        successUrl: 'https://evil.example.com/x',
        cancelUrl: '/pricing',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects the protocol-relative form the old regex accepted', async () => {
    await expect(
      run(CreatePortalSessionDto, { returnUrl: '//evil.example.com/x' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects every deployed origin when WEB_ORIGINS is unset — fails CLOSED', async () => {
    delete process.env.WEB_ORIGINS;
    await expect(
      run(CreatePortalSessionDto, { returnUrl: 'https://app.up.railway.app/dashboard' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
