/**
 * The mobile app bundles its own copy of the AI-data disclosure and consent
 * version (1C item 2) — it shows that text in the consent sheet and sends that
 * version to `POST /users/me/ai-consent`. This pins the copy to the API's,
 * which is the one the privacy policy prints and the server accepts.
 *
 * Lives in apps/api because this suite runs in CI on every PR. The mobile module
 * has no React Native imports (asserted below), so ts-jest compiles it here.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_CONSENT_ACCEPTED_VERSIONS,
  AI_CONSENT_DISCLOSURE_SHA256,
  AI_CONSENT_VERSION,
  AI_DATA_DISCLOSURE_ZH,
  CONTACT_EMAIL,
} from '../src/legal/legal-constants';

const MOBILE_STATE = join(__dirname, '../../mobile/src/lib/ai-consent-state.ts');
const MOBILE_LINKS = join(__dirname, '../../mobile/src/lib/links.ts');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mobile = require(MOBILE_STATE) as { AI_CONSENT_VERSION: string; AI_DATA_DISCLOSURE_ZH: string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const links = require(MOBILE_LINKS) as { SUPPORT_EMAIL: string };

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('mobile AI-disclosure copy', () => {
  it('records a version the server accepts', () => {
    expect(mobile.AI_CONSENT_VERSION).toBe(AI_CONSENT_VERSION);
    expect(AI_CONSENT_ACCEPTED_VERSIONS).toContain(mobile.AI_CONSENT_VERSION);
  });

  it('shows exactly the text pinned for that version', () => {
    expect(sha256(mobile.AI_DATA_DISCLOSURE_ZH)).toBe(AI_CONSENT_DISCLOSURE_SHA256[mobile.AI_CONSENT_VERSION]);
    expect(mobile.AI_DATA_DISCLOSURE_ZH).toBe(AI_DATA_DISCLOSURE_ZH);
  });

  it('the mobile module stays free of React Native imports (so this test can load it)', () => {
    const src = readFileSync(MOBILE_STATE, 'utf8');
    expect(src).not.toMatch(/from ['"]react-native['"]/);
    expect(src).not.toMatch(/from ['"]expo/);
  });

  it('the support email matches the legal pages', () => {
    expect(links.SUPPORT_EMAIL).toBe(CONTACT_EMAIL);
  });
});
