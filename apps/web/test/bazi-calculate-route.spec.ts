/**
 * @jest-environment node
 */

/**
 * M10 — the free-preview route must reach the engine THROUGH NestJS.
 *
 * The guard (`scripts/check-engine-callers.mjs`) proves no web file calls the
 * engine any more. That is a negative; it cannot say the route still WORKS, nor
 * that it sends the bearer M1's per-user throttle keying will depend on. These
 * pin the positive half of the contract.
 */

const CALCULATE_BODY = { birth_date: '1987-09-06', gender: 'male' };

let mockToken: string | null = 'tok_abc';
let mockAuthThrows = false;

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(async () => {
    if (mockAuthThrows) throw new Error('clerk unavailable');
    return { getToken: async () => mockToken };
  }),
}));

async function post(body: unknown = CALCULATE_BODY) {
  const { POST } = await import('../app/api/bazi-calculate/route');
  return POST({ json: async () => body } as never);
}

describe('POST /api/bazi-calculate — proxies to NestJS, not the engine', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    mockToken = 'tok_abc';
    mockAuthThrows = false;
    fetchMock = jest.fn(async () => new Response(JSON.stringify({ status: 'ok', data: { pillars: 1 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    global.fetch = fetchMock as never;
  });

  it('calls the NestJS calculate route, never the Python engine', async () => {
    await post();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/bazi/calculate');
    // The failure this exists to catch: reverting to a direct engine call.
    // Note both URLs END in /calculate, so the discriminator is the HOST and
    // the /api/bazi prefix — not the path suffix.
    expect(url).not.toMatch(/5001|engine/i);
    expect(new URL(url).pathname).toBe('/api/bazi/calculate');
  });

  it('attaches a server-minted bearer so M1 can key per user', async () => {
    await post();

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok_abc');
  });

  it('omits the bearer for an anonymous caller rather than failing', async () => {
    mockToken = null;
    const res = await post();

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(res.status).toBe(200); // anonymous is a valid state for the free preview
  });

  it('treats a Clerk failure as anonymous, not as an error', async () => {
    mockAuthThrows = true;
    const res = await post();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('returns the engine envelope unchanged — the client reads data || body', async () => {
    const res = await post();
    await expect(res.json()).resolves.toEqual({ status: 'ok', data: { pillars: 1 } });
  });

  it("surfaces NestJS's array-shaped validation message as a single .error string", async () => {
    // NestJS returns `message` as an ARRAY for validation failures. The client
    // renders `errData.error`, so an array would stringify as "[object Object]"
    // or vanish entirely.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: ['birth_date must be a string', 'gender is required'] }), {
        status: 400,
      }),
    );
    const res = await post();

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'birth_date must be a string; gender is required',
    });
  });

  it("passes through the engine's own `detail` on a passthrough failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: '無法解析出生日期' }), { status: 422 }),
    );
    const res = await post();

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: '無法解析出生日期' });
  });

  it('never lets a non-string message reach the client as "[object Object]"', async () => {
    // `AllExceptionsFilter` casts `resObj.message` to string without checking,
    // and other routes in this API throw `HttpException({ code, message })`.
    // The client does `new Error(errData.error || ...)`, so an object here is
    // rendered to the user verbatim as "[object Object]".
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: { code: 'NOPE', detail: 'nested' } }), { status: 400 }),
    );
    const res = await post();

    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error).not.toContain('[object Object]');
    expect(body.error).toBe('排盤失敗 (400)'); // falls back to the status line
  });

  it('returns 502 with an .error when NestJS is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await post();

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('ECONNREFUSED');
  });
});
