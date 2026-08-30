import {
  anthropicBaseUrlOverride,
  createAnthropicClient,
  effectiveAnthropicBaseUrl,
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
  const saved = process.env.LOADTEST_ANTHROPIC_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    else process.env.LOADTEST_ANTHROPIC_BASE_URL = saved;
    resetBaseUrlWarning();
    jest.restoreAllMocks();
  });

  it('is null when unset — the real API is the default', () => {
    delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    expect(anthropicBaseUrlOverride()).toBeNull();
  });

  it('treats blank and whitespace as unset, not as a URL', () => {
    // An empty env var is how a "cleared" value usually arrives on a platform.
    // Returning '' would hand the SDK a falsy baseURL and change behaviour in
    // a way nobody intended.
    for (const v of ['', '   ', '\t']) {
      process.env.LOADTEST_ANTHROPIC_BASE_URL = v;
      expect(anthropicBaseUrlOverride()).toBeNull();
    }
  });

  it('reads at call time, so a late-loaded .env still applies', () => {
    // ConfigModule loads .env AFTER this module is imported. A module-scope
    // read would work in production and silently skip the override locally —
    // the trap PrismaService hit with its pool settings.
    delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    expect(anthropicBaseUrlOverride()).toBeNull();
    process.env.LOADTEST_ANTHROPIC_BASE_URL = 'http://mock:8080';
    expect(anthropicBaseUrlOverride()).toBe('http://mock:8080');
  });
});

/**
 * ⚠️ `ANTHROPIC_BASE_URL` is listed in turbo.json's `globalPassThroughEnv` NOT
 * because the app consumes it — it deliberately does not — but because this
 * block reads it to prove we ignore it, and `turbo/no-undeclared-env-vars`
 * cannot tell the two apart. turbo.json is JSON and cannot hold that comment,
 * so it lives here.
 */
describe('the generic ANTHROPIC_BASE_URL must NOT redirect us', () => {
  const savedGeneric = process.env.ANTHROPIC_BASE_URL;
  const savedOurs = process.env.LOADTEST_ANTHROPIC_BASE_URL;
  afterEach(() => {
    if (savedGeneric === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = savedGeneric;
    if (savedOurs === undefined) delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    else process.env.LOADTEST_ANTHROPIC_BASE_URL = savedOurs;
    resetBaseUrlWarning();
    jest.restoreAllMocks();
  });

  it('ignores it entirely — it is not a variable this app owns', () => {
    // Claude Code exports ANTHROPIC_BASE_URL for its own SDK, and the first
    // local boot after this shipped warned that production was pointed at a
    // mock when it was not. A variable that redirects where the API KEY is sent
    // must not share a name the ecosystem treats as generic: the real failure
    // is a silent redirect by a variable nobody thought was ours.
    delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'http://someone-elses-tooling:9999';
    expect(anthropicBaseUrlOverride()).toBeNull();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    createAnthropicClient({ apiKey: 'k' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('but the SDK honours it anyway — so ops must report the EFFECTIVE url', () => {
    // The uncomfortable half. Renaming stopped OUR code reading the generic
    // variable; it did not stop the SDK, which reads it too. Traffic is still
    // redirected — and `aiBaseUrlOverride` now says `null` while it happens,
    // which is worse than the original problem. Only the resolved baseURL
    // cannot lie about this.
    delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'http://someone-elses-tooling:9999';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = createAnthropicClient({ apiKey: 'k' });
    expect(c.baseURL).toBe('http://someone-elses-tooling:9999');   // the SDK did it
    expect(anthropicBaseUrlOverride()).toBeNull();                 // our switch is off
    expect(effectiveAnthropicBaseUrl()).toBe('http://someone-elses-tooling:9999');
  });

  it('and ours still wins when both are set', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://someone-elses-tooling:9999';
    process.env.LOADTEST_ANTHROPIC_BASE_URL = 'http://our-mock:8080';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(createAnthropicClient({ apiKey: 'k' }).baseURL).toBe('http://our-mock:8080');
  });
});

describe('createAnthropicClient honours the override', () => {
  const saved = process.env.LOADTEST_ANTHROPIC_BASE_URL;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    resetBaseUrlWarning();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    else process.env.LOADTEST_ANTHROPIC_BASE_URL = saved;
    jest.restoreAllMocks();
  });

  it('redirects the client when set', () => {
    process.env.LOADTEST_ANTHROPIC_BASE_URL = 'http://mock-anthropic:8080';
    const c = createAnthropicClient({ apiKey: 'k' });
    expect(c.baseURL).toBe('http://mock-anthropic:8080');
  });

  it('leaves the SDK default alone when unset', () => {
    delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    const c = createAnthropicClient({ apiKey: 'k' });
    expect(c.baseURL).toContain('api.anthropic.com');
  });

  it('lets an explicit option win over the env var', () => {
    // So a test double supplying its own baseURL is not silently redirected by
    // a variable left set on the machine.
    process.env.LOADTEST_ANTHROPIC_BASE_URL = 'http://mock:8080';
    const c = createAnthropicClient({ apiKey: 'k', baseURL: 'http://explicit:9999' });
    expect(c.baseURL).toBe('http://explicit:9999');
  });

  it('warns loudly, because forgetting to unset it is the real failure', () => {
    process.env.LOADTEST_ANTHROPIC_BASE_URL = 'http://mock:8080';
    createAnthropicClient({ apiKey: 'k' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('LOADTEST_ANTHROPIC_BASE_URL is set'));
  });

  it('warns once, not once per client — seven sites would be seven copies', () => {
    process.env.LOADTEST_ANTHROPIC_BASE_URL = 'http://mock:8080';
    createAnthropicClient({ apiKey: 'k' });
    createAnthropicClient({ apiKey: 'k' });
    createAnthropicClient({ apiKey: 'k' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays silent when there is nothing to warn about', () => {
    delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    createAnthropicClient({ apiKey: 'k' });
    expect(warn).not.toHaveBeenCalled();
  });
});
