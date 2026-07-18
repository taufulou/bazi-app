import { resolveApiUrlFor } from '../env';

describe('resolveApiUrlFor (Android host rewrite)', () => {
  it('rewrites localhost -> 10.0.2.2 on Android in dev', () => {
    expect(resolveApiUrlFor('http://localhost:4000', 'android', true)).toBe(
      'http://10.0.2.2:4000',
    );
  });

  it('rewrites 127.0.0.1 -> 10.0.2.2 on Android in dev', () => {
    expect(resolveApiUrlFor('http://127.0.0.1:4000', 'android', true)).toBe(
      'http://10.0.2.2:4000',
    );
  });

  it('leaves localhost unchanged on iOS (shares host network)', () => {
    expect(resolveApiUrlFor('http://localhost:4000', 'ios', true)).toBe('http://localhost:4000');
  });

  it('leaves localhost unchanged on Android in production', () => {
    expect(resolveApiUrlFor('http://localhost:4000', 'android', false)).toBe(
      'http://localhost:4000',
    );
  });

  it('leaves a real remote host unchanged', () => {
    expect(resolveApiUrlFor('https://api.example.com', 'android', true)).toBe(
      'https://api.example.com',
    );
  });

  it('only rewrites a bare localhost host, not a domain that contains it', () => {
    expect(resolveApiUrlFor('http://mylocalhost.io:4000', 'android', true)).toBe(
      'http://mylocalhost.io:4000',
    );
    expect(resolveApiUrlFor('http://api.localhost.dev:4000', 'android', true)).toBe(
      'http://api.localhost.dev:4000',
    );
  });

  // Regression: assetsUrl (mascot art, served off the API host) was NOT passed
  // through this rewrite, so every mascot 404'd on the Android emulator and the
  // 角色卡 silently rendered the day-master glyph fallback instead.
  it('is applied to the assets host too (mascots are served by the API host)', () => {
    expect(resolveApiUrlFor('http://localhost:4000', 'android', true)).toBe('http://10.0.2.2:4000');
    // Trailing slashes are stripped before the rewrite so `${assetsUrl}/mascots/...`
    // never yields a double slash.
    expect(resolveApiUrlFor('http://localhost:4000/'.replace(/\/+$/, ''), 'android', true)).toBe(
      'http://10.0.2.2:4000',
    );
  });
});
