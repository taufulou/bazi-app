/**
 * 1B items 1–2 — the public legal pages: one source of text, served on the API
 * host and proxied on tianmingapp.com (the URLs App Store Connect gets).
 */
import { createHash } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../src/auth/public.decorator';
import { LegalController } from '../src/legal/legal.controller';
import {
  AI_CONSENT_ACCEPTED_VERSIONS,
  AI_CONSENT_DISCLOSURE_SHA256,
  AI_CONSENT_VERSION,
  AI_DATA_DISCLOSURE_ZH,
  CONTACT_EMAIL,
} from '../src/legal/legal-constants';

describe('LegalController', () => {
  const controller = new LegalController();
  const realOrigins = process.env.WEB_ORIGINS;

  beforeEach(() => {
    process.env.WEB_ORIGINS = 'https://tianmingapp.com,https://bazi-web.up.railway.app';
  });
  afterAll(() => {
    process.env.WEB_ORIGINS = realOrigins;
  });

  // Calling the methods directly cannot catch a missing @Public(): the
  // decorator is per-method, and without it the global Clerk guard 401s — the
  // website would then serve its fallback page forever.
  it.each(['privacy', 'terms', 'support'] as const)('%s is @Public()', (method) => {
    const handler = LegalController.prototype[method];
    expect(new Reflector().get(IS_PUBLIC_KEY, handler)).toBe(true);
  });

  describe('privacy', () => {
    const html = () => controller.privacy();

    it('discloses exactly what goes to the AI provider (the pinned constant)', () => {
      expect(html()).toContain(AI_DATA_DISCLOSURE_ZH);
      expect(AI_DATA_DISCLOSURE_ZH).toContain('出生日期、出生時間、性別');
      expect(AI_DATA_DISCLOSURE_ZH).toContain('合盤');
      expect(AI_DATA_DISCLOSURE_ZH).toContain('對話中輸入的文字');
      expect(AI_DATA_DISCLOSURE_ZH).toContain('不會傳送您的姓名、電子郵件或出生地點');
    });

    it('names Anthropic as the only AI provider (owner decision 2026-11-21)', () => {
      expect(html()).toContain('Anthropic');
      for (const other of ['OpenAI', 'GPT', 'Gemini']) expect(html()).not.toContain(other);
    });

    it('describes consent per channel, and how to withdraw it', () => {
      expect(html()).toContain('首次使用 AI 功能前會先徵求您的同意');
      expect(html()).toContain('在網站上使用 AI 功能');
      expect(html()).toContain('撤回同意');
    });

    it('names Stripe, Sign in with Apple, and cross-border processing', () => {
      expect(html()).toContain('Stripe');
      expect(html()).toContain('使用 Apple 登入');
      expect(html()).toContain('包括美國');
    });
  });

  it('terms cover website purchases through Stripe', () => {
    expect(controller.terms()).toContain('在網站上的購買與訂閱透過 Stripe 完成');
  });

  describe('support', () => {
    it('gives the contact email and links the other two pages', () => {
      const html = controller.support();
      expect(html).toContain(CONTACT_EMAIL);
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/terms"');
    });

    it('links website-only routes ABSOLUTELY from the canonical (first) WEB_ORIGINS entry', () => {
      const html = controller.support();
      expect(html).toContain('href="https://tianmingapp.com/sign-in"');
      expect(html).toContain('href="https://tianmingapp.com/dashboard/subscription"');
      expect(html).not.toContain('href="/sign-in"');
      expect(html).not.toContain('bazi-web.up.railway.app/sign-in');
    });

    it('says "your name", not the retired "Apple ID"', () => {
      expect(controller.support()).not.toContain('Apple ID');
    });
  });

  it.each(['privacy', 'terms', 'support'] as const)('%s names its canonical copy on the website', (method) => {
    expect(controller[method]()).toContain(`<link rel="canonical" href="https://tianmingapp.com/${method}">`);
  });

  it.each(['privacy', 'terms', 'support'] as const)('%s no longer says 「BaziApp」', (method) => {
    expect(controller[method]()).not.toContain('BaziApp');
  });

  describe('AI consent version pin', () => {
    const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

    it('the disclosure text matches the hash pinned for the CURRENT version', () => {
      // Fails when the disclosure changes without a new version: add a new
      // AI_CONSENT_VERSION and a new map entry instead of editing in place.
      expect(sha256(AI_DATA_DISCLOSURE_ZH)).toBe(AI_CONSENT_DISCLOSURE_SHA256[AI_CONSENT_VERSION]);
    });

    it('every accepted version has a pinned hash', () => {
      for (const v of AI_CONSENT_ACCEPTED_VERSIONS) expect(AI_CONSENT_DISCLOSURE_SHA256[v]).toMatch(/^[0-9a-f]{64}$/);
    });

    it('the current version is accepted', () => {
      expect(AI_CONSENT_ACCEPTED_VERSIONS).toContain(AI_CONSENT_VERSION);
    });
  });
});
