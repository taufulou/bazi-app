/**
 * Legal facts shared by the public legal pages (`legal.controller.ts`) and the
 * AI-consent endpoints (`users`). In their own module so a service never
 * imports a controller (1B design, round-2 L2).
 */

export const CONTACT_EMAIL = 'TAPPER.FUN@gmail.com';
export const LEGAL_ENTITY = 'Roger Lim Shau Xiong';
export const JURISDICTION = '馬來西亞';
export const APP_NAME = '天命';

/**
 * Shown on all three pages. Bump it for ANY change to their text — and note
 * that bumping it does NOT change the AI consent version below.
 */
export const EFFECTIVE_DATE = '2026年11月21日';

/**
 * EXACTLY what is sent to the AI provider — the disclosure a user consents to.
 *
 * Verified against the prompt templates (`ai/prompts.ts`): birth date, birth
 * time and gender go into every reading prompt; 合盤 adds the other person's;
 * chat adds the user's own text. Names, email and birth city are NOT sent.
 *
 * ⚠️ The privacy page interpolates this constant, and the mobile app's consent
 * sheet bundles the same text for the version it sends. Changing a single
 * character requires a NEW `AI_CONSENT_VERSION` and a new entry in
 * `AI_CONSENT_DISCLOSURE_SHA256` — the pin test fails otherwise.
 */
export const AI_DATA_DISCLOSURE_ZH =
  '為產生命理解讀與運勢分析，本服務會將下列資料傳送至第三方 AI 服務 Anthropic：' +
  '您的出生日期、出生時間、性別，及據此計算之八字命盤與分析資料；' +
  '使用「合盤」功能時，另含您所輸入之對方的出生日期、出生時間、性別及其命盤資料；' +
  '使用 AI 對話時，另含您在對話中輸入的文字。' +
  '我們不會傳送您的姓名、電子郵件或出生地點。';

/**
 * The AI consent version a client must record. Its OWN constant, deliberately
 * not `EFFECTIVE_DATE`: a typo fix or a new support FAQ must not invalidate
 * every installed app's consent (1B design, round-2 H1).
 *
 * Bump ONLY when the AI disclosure materially changes — the data list, the
 * provider, or the purpose — and add the new hash below.
 */
export const AI_CONSENT_VERSION = 'ai-2026-11-21';

/**
 * Versions the server still accepts. A build showing an older but still TRUE
 * disclosure may keep recording consent. Remove a version ONLY when its
 * disclosure has become false (e.g. a provider was added) — the one case where
 * stranding old builds is correct.
 */
export const AI_CONSENT_ACCEPTED_VERSIONS: readonly string[] = [AI_CONSENT_VERSION];

/**
 * sha256 (hex) of `AI_DATA_DISCLOSURE_ZH` for each version. A MAP rather than a
 * single hash, so editing the text forces a new key — a new version — instead
 * of letting someone paste a new hash over the old one.
 */
export const AI_CONSENT_DISCLOSURE_SHA256: Readonly<Record<string, string>> = {
  'ai-2026-11-21': '03301f97a1d7cc3429a99f48eacfabed7fdec2ba75c3f52178ba4038c2e3512d',
};
