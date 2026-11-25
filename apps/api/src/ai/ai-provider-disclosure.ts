import { AIProvider } from '@prisma/client';

/**
 * AI providers the PUBLISHED privacy policy names (`legal/legal.controller.ts`,
 * §3). Since 1B the policy names Anthropic only — the owner confirmed on
 * 2026-11-21 that neither OPENAI_API_KEY nor GEMINI_API_KEY is set in
 * production, so the GPT/Gemini fallbacks never run.
 *
 * Setting either key would silently start sending birth data to a company the
 * policy does not mention. Before setting one: add the provider to the AI
 * disclosure text (`AI_DATA_DISCLOSURE_ZH` in `legal/legal-constants.ts`), bump
 * `AI_CONSENT_VERSION` with a new pinned hash, REMOVE the old version from
 * `AI_CONSENT_ACCEPTED_VERSIONS` (its disclosure is now false, so builds showing
 * it must not record consent), then add the provider here.
 */
export const PROVIDERS_NAMED_IN_PRIVACY_POLICY: readonly AIProvider[] = [AIProvider.CLAUDE];

/** Configured providers the privacy policy does not name. Empty = consistent. */
export function providersMissingFromPrivacyPolicy(configured: readonly AIProvider[]): AIProvider[] {
  return configured.filter((p) => !PROVIDERS_NAMED_IN_PRIVACY_POLICY.includes(p));
}
