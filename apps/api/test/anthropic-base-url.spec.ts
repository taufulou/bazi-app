import {
  anthropicBaseUrlOverride,
  createAnthropicClient,
  resetBaseUrlWarning,
} from '../src/ai/anthropic-client';

/**
 * L1 — the load-test redirect.
 *
 * The risk this carries is not that it fails to work; it is that it keeps
 * working after the load test, silently pointing production at a mock that has
 * been torn down. So the tests cover the parsing, the precedence, and the
 * loudness.
 */
describe('anthropicBaseUrlOverride', () => {
  const saved = process.env.ANTHROPIC_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved;
    resetBaseUrlWarning();
    jest.restoreAllMocks();
  });

  it('is null when unset — the real API is the default', () => {
    delete process.env.ANTHROPIC_BASE_URL;
    expect(anthropicBaseUrlOverride()).toBeNull();
  });

  it('treats blank and whitespace as unset, not as a URL', () => {
    // An empty env var is how a "cleared" value usually arrives on a platform.
    // Returning '' would hand the SDK a falsy baseURL and change behaviour in
    // a way nobody intended.
    for (const v of ['', '   ', '\t']) {
      process.env.ANTHROPIC_BASE_URL = v;
      expect(anthropicBaseUrlOverride()).toBeNull();
    }
  });

  it('reads at call time, so a late-loaded .env still applies', () => {
    // ConfigModule loads .env AFTER this module is imported. A module-scope
    // read would work in production and silently skip the override locally —
    // the trap PrismaService hit with its pool settings.
    delete process.env.ANTHROPIC_BASE_URL;
    expect(anthropicBaseUrlOverride()).toBeNull();
    process.env.ANTHROPIC_BASE_URL = 'http://mock:8080';
    expect(anthropicBaseUrlOverride()).toBe('http://mock:8080');
  });
});

describe('createAnthropicClient honours the override', () => {
  const saved = process.env.ANTHROPIC_BASE_URL;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    resetBaseUrlWarning();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved;
    jest.restoreAllMocks();
  });

  it('redirects the client when set', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://mock-anthropic:8080';
    const c = createAnthropicClient({ apiKey: 'k' });
    expect(c.baseURL).toBe('http://mock-anthropic:8080');
  });

  it('leaves the SDK default alone when unset', () => {
    delete process.env.ANTHROPIC_BASE_URL;
    const c = createAnthropicClient({ apiKey: 'k' });
    expect(c.baseURL).toContain('api.anthropic.com');
  });

  it('lets an explicit option win over the env var', () => {
    // So a test double supplying its own baseURL is not silently redirected by
    // a variable left set on the machine.
    process.env.ANTHROPIC_BASE_URL = 'http://mock:8080';
    const c = createAnthropicClient({ apiKey: 'k', baseURL: 'http://explicit:9999' });
    expect(c.baseURL).toBe('http://explicit:9999');
  });

  it('warns loudly, because forgetting to unset it is the real failure', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://mock:8080';
    createAnthropicClient({ apiKey: 'k' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NOT the real API'));
  });

  it('warns once, not once per client — seven sites would be seven copies', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://mock:8080';
    createAnthropicClient({ apiKey: 'k' });
    createAnthropicClient({ apiKey: 'k' });
    createAnthropicClient({ apiKey: 'k' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays silent when there is nothing to warn about', () => {
    delete process.env.ANTHROPIC_BASE_URL;
    createAnthropicClient({ apiKey: 'k' });
    expect(warn).not.toHaveBeenCalled();
  });
});
