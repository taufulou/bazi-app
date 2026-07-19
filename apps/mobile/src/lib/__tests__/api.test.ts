import { apiFetch, ApiError, setUnauthorizedHandler } from '../api';

describe('apiFetch', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    setUnauthorizedHandler(null);
  });

  it('returns parsed JSON on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    }) as unknown as typeof fetch;
    await expect(apiFetch('/x', { token: 't' })).resolves.toEqual({ hello: 'world' });
  });

  it('injects the Authorization header when a token is given', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await apiFetch('/x', { token: 'abc' });
    const init = fetchMock.mock.calls[0][1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });

  it('fires the unauthorized handler and throws ApiError on 401 with a token', async () => {
    const handler = jest.fn();
    setUnauthorizedHandler(handler);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'expired', code: 'SESSION_EXPIRED' }),
    }) as unknown as typeof fetch;

    await expect(apiFetch('/x', { token: 't' })).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire the handler on 401 for a public (tokenless) request', async () => {
    const handler = jest.fn();
    setUnauthorizedHandler(handler);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(apiFetch('/x')).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });
});
