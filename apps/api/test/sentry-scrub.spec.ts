/**
 * C2 — a Sentry event must carry no birth data, no credentials, and no 干支.
 *
 * The fixture below is a realistic event for THIS product: a failed
 * `POST /api/bazi/readings` whose body is a birth profile, with the chart on
 * `extra` because that is precisely what someone debugging a doctrine bug would
 * attach.
 */
import { scrubSentryEvent, REDACTED, ScrubbableEvent } from '../src/common/sentry-scrub';

/** Everything in here must be absent from the serialised output. */
const SECRETS = [
  '1987-09-06', // birthDate
  '16:11', // birthTime
  '吉打', // birthCity
  'Asia/Kuala_Lumpur',
  'taufulou@gmail.com',
  'eyJhbGciOiJSUzI1NiJ9.fake.token',
  '__session=abc123',
  '丁卯', // year pillar — the 干支 set is a reversible encoding of the birth datetime
  '戊申',
  '戊午',
  '庚申',
  '我先生會外遇嗎', // free text the user typed
];

function realisticEvent(): ScrubbableEvent {
  return {
    message: 'Engine call failed',
    request: {
      url: 'https://api.example.com/api/bazi/readings',
      method: 'POST',
      query_string: 'date=1987-09-06',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.fake.token',
        cookie: '__session=abc123',
        'user-agent': 'jest',
      },
      cookies: { __session: 'abc123' },
      data: {
        birthDate: '1987-09-06',
        birthTime: '16:11',
        birthCity: '吉打',
        birthTimezone: 'Asia/Kuala_Lumpur',
        gender: 'MALE',
        questionText: '我先生會外遇嗎',
      },
    },
    user: { id: 'user-123', email: 'taufulou@gmail.com', ip_address: '203.0.113.9' },
    extra: {
      readingId: 'r-1',
      chartData: {
        fourPillars: {
          year: { stem: '丁', branch: '卯', ganZhi: '丁卯' },
          month: { ganZhi: '戊申' },
          day: { ganZhi: '戊午' },
          hour: { ganZhi: '庚申' },
        },
      },
      profile: { birthCity: '吉打', birthDate: '1987-09-06' },
    },
    contexts: {
      chart: { fourPillars: ['丁卯', '戊申', '戊午', '庚申'] },
    },
    breadcrumbs: [
      { category: 'http', data: { birthDate: '1987-09-06', status: 500 } },
    ],
  };
}

/** Everything the event carries, as one string. */
function serialise(e: unknown): string {
  return JSON.stringify(e);
}

describe('C2 — Sentry event scrubbing', () => {
  it.each(SECRETS)('does not ship %s', (secret) => {
    const out = serialise(scrubSentryEvent(realisticEvent()));
    expect(out).not.toContain(secret);
  });

  it('drops the request body wholesale', () => {
    const out = scrubSentryEvent(realisticEvent());
    expect(out.request?.data).toBe(REDACTED);
  });

  it('redacts the bearer token and the session cookie, keeping benign headers', () => {
    const out = scrubSentryEvent(realisticEvent());

    expect(out.request?.headers).toMatchObject({
      authorization: REDACTED,
      cookie: REDACTED,
      // Debuggability is the point of the whole event — don't scrub what's safe.
      'content-type': 'application/json',
      'user-agent': 'jest',
    });
    expect(out.request?.cookies).toBe(REDACTED);
  });

  it('keeps the user id and drops everything else about them', () => {
    const out = scrubSentryEvent(realisticEvent());

    expect(out.user).toEqual({ id: 'user-123' });
  });

  it('drops whole 干支 subtrees rather than individual keys', () => {
    // The domain rule: a single low-entropy field is fine, the SET identifies.
    // Dropping the container means a pillar field added later is covered too.
    const out = scrubSentryEvent(realisticEvent());

    expect(out.extra?.chartData).toBe(REDACTED);
    // `chart` is itself a dropped container now (the audit found `chart` and
    // `chartContext` wrapping pillar data), so the whole node goes rather than
    // its `fourPillars` child.
    expect(out.contexts?.chart).toBe(REDACTED);
  });

  it('scrubs nested birth fields wherever they appear', () => {
    const out = scrubSentryEvent(realisticEvent());

    expect(out.extra?.profile).toMatchObject({
      birthCity: REDACTED,
      birthDate: REDACTED,
    });
  });

  it('scrubs breadcrumbs — they carry request data too', () => {
    const out = scrubSentryEvent(realisticEvent());

    expect(out.breadcrumbs?.[0]).toMatchObject({
      category: 'http',
      data: { birthDate: REDACTED, status: 500 },
    });
  });

  it('keeps the fields that make an event useful', () => {
    const out = scrubSentryEvent(realisticEvent());

    expect(out.message).toBe('Engine call failed');
    expect(out.request?.url).toBe('https://api.example.com/api/bazi/readings');
    expect(out.request?.method).toBe('POST');
    expect(out.extra?.readingId).toBe('r-1');
  });

  it('is case-insensitive about key names', () => {
    const out = scrubSentryEvent({
      extra: { BirthDate: '1987-09-06', AUTHORIZATION: 'Bearer x', FourPillars: ['丁卯'] },
    });

    expect(serialise(out)).not.toContain('1987-09-06');
    expect(serialise(out)).not.toContain('丁卯');
    expect(out.extra?.AUTHORIZATION).toBe(REDACTED);
  });

  it('does not mutate the event Sentry handed it', () => {
    // Sentry reuses the object; mutating would leak redaction into app state.
    const original = realisticEvent();
    scrubSentryEvent(original);

    expect((original.request?.data as Record<string, unknown>).birthDate).toBe('1987-09-06');
    expect(original.user?.email).toBe('taufulou@gmail.com');
  });

  it('survives an event with none of these fields', () => {
    expect(() => scrubSentryEvent({ message: 'boom' })).not.toThrow();
    expect(scrubSentryEvent({ message: 'boom' })).toEqual({ message: 'boom' });
  });

  it('terminates on a deeply nested structure', () => {
    let deep: Record<string, unknown> = { birthDate: '1987-09-06' };
    for (let i = 0; i < 50; i++) deep = { nested: deep };

    expect(() => scrubSentryEvent({ extra: deep })).not.toThrow();
  });

  it('redacts within the traversal depth', () => {
    // The version of this test that only asserted `not.toThrow()` PASSED WHILE
    // LEAKING — everything below MAX_DEPTH shipped verbatim and the test read
    // like depth coverage. Assert the value, not the absence of a crash.
    let deep: Record<string, unknown> = { birthDate: '1987-09-06' };
    for (let i = 0; i < 6; i++) deep = { nested: deep };

    expect(serialise(scrubSentryEvent({ extra: deep }))).not.toContain('1987-09-06');
  });

  // ============================================================
  // The 干支 second copy, and the free-text surfaces
  // ============================================================

  it('drops `ganZhi` — the engine emits the pillars TWICE', () => {
    // `calculator.py` returns `ganZhi: {year, month, day, hour}` alongside
    // `fourPillars`. Dropping one container while its sibling sailed through
    // defeated the entire rule this file exists for.
    const out = scrubSentryEvent({
      extra: { bazi: { ganZhi: { year: '丁卯', month: '戊申', day: '戊午', hour: '庚申' } } },
    });

    expect(serialise(out)).not.toContain('丁卯');
    expect(serialise(out)).not.toContain('庚申');
  });

  it.each([
    ['yearGanZhi', { yearGanZhi: '丁卯' }, '丁卯'],
    ['chat content', { content: '我先生會外遇嗎' }, '我先生會外遇嗎'],
    ['gender', { gender: 'MALE' }, 'MALE'],
    ['profileBirthDate', { profileBirthDate: '1987-09-06' }, '1987-09-06'],
    ['lunarDate', { lunarDate: '農曆1987-7-14' }, '農曆1987-7-14'],
    ['engineOutput', { engineOutput: { dayGanZhi: '戊子' } }, '戊子'],
    ['chartContext', { chartContext: { lunarDate: '農曆1987-7-14' } }, '農曆1987-7-14'],
    ['chartA/chartB', { chartA: { pillars: ['丁卯'] } }, '丁卯'],
  ])('redacts %s', (_label, extra, secret) => {
    expect(serialise(scrubSentryEvent({ extra }))).not.toContain(secret);
  });

  it('scrubs the EXCEPTION message — Prisma embeds the failing arguments', () => {
    // The most visible field in the Sentry UI (it's the grouping key), and
    // previously untouched. A failed birthProfile.create puts the birth date,
    // time and city straight into it.
    const out = scrubSentryEvent({
      exception: {
        values: [
          {
            type: 'PrismaClientValidationError',
            value:
              'Invalid `prisma.birthProfile.create()`: birthCity: 吉打, birthDate: 1987-09-06, birthTime: 16:11',
          },
        ],
      },
    });

    const s = serialise(out);
    expect(s).not.toContain('1987-09-06');
    expect(s).not.toContain('16:11');
    // The error TYPE must survive — otherwise the event is useless.
    expect(s).toContain('PrismaClientValidationError');
  });

  it('scrubs 干支 and tokens out of a free-text message', () => {
    const out = scrubSentryEvent({
      message: 'Engine failed for 丁卯/戊申 token=eyJhbGciOiJIUzI1NiJ9.abc.def user=a@b.com',
    });

    const s = serialise(out);
    expect(s).not.toContain('丁卯');
    expect(s).not.toContain('戊申');
    expect(s).not.toContain('a@b.com');
    expect(s).toContain('Engine failed');
  });

  it('scrubs span data — transactions carry the payload there, not in `request`', () => {
    // query_string was redacted on the error path while the same query
    // survived as span data on the transaction path. Tracing is enabled.
    const out = scrubSentryEvent({
      spans: [{ op: 'http.client', data: { 'url.query': 'date=1987-09-06', birthCity: '吉打' } }],
    });

    const s = serialise(out);
    expect(s).not.toContain('吉打');
    expect(s).toContain('http.client');
  });

  it('handles a cyclic-free array of objects', () => {
    const out = scrubSentryEvent({
      extra: { profiles: [{ birthCity: '吉打' }, { birthCity: '台北' }] },
    });

    expect(serialise(out)).not.toContain('吉打');
    expect(serialise(out)).not.toContain('台北');
  });
});
