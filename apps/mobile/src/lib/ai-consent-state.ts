/**
 * AI-data consent — the ENFORCEMENT layer (1C item 2, layer 1).
 *
 * App Store guideline 5.1.2(i): personal data (birth date/time, gender, the chart)
 * may not reach a third-party AI until the user agrees. Every function in
 * `src/lib` that calls the AI, or charges for an AI result, checks this module
 * first, so no ordering mistake in a screen can send the request. The sheet that
 * ASKS lives in `ai-consent.tsx` (layer 2); this module never shows UI.
 *
 * ⚠️ No React Native / Expo imports here. `apps/api/test/ai-disclosure-mobile-parity.spec.ts`
 * `require`s this file to pin the disclosure text against the API's copy.
 */
import { ApiError } from './api-error';

/**
 * Byte copy of `AI_CONSENT_VERSION` in `apps/api/src/legal/legal-constants.ts`.
 * The server refuses (409) a version outside its accepted list.
 */
export const AI_CONSENT_VERSION = 'ai-2026-11-21';

/**
 * Byte copy of `AI_DATA_DISCLOSURE_ZH` in `apps/api/src/legal/legal-constants.ts` —
 * exactly what the user agrees to. Pinned by sha256 in the API test suite: change
 * a character and you need a new `AI_CONSENT_VERSION` on BOTH sides.
 */
export const AI_DATA_DISCLOSURE_ZH =
  '為產生命理解讀與運勢分析，本服務會將下列資料傳送至第三方 AI 服務 Anthropic：' +
  '您的出生日期、出生時間、性別，及據此計算之八字命盤與分析資料；' +
  '使用「合盤」功能時，另含您所輸入之對方的出生日期、出生時間、性別及其命盤資料；' +
  '使用 AI 對話時，另含您在對話中輸入的文字。' +
  '我們不會傳送您的姓名、電子郵件或出生地點。';

/**
 * - `unknown`: not loaded yet for this user.
 * - `granted`: the server holds a consent to a still-accepted disclosure.
 * - `missing`: no consent (or withdrawn) — the sheet may be shown.
 * - `outdated`: this build's disclosure is no longer accepted by the server —
 *   the sheet must not be shown; the user is asked to update the app.
 * - `error`: the load failed (offline / 5xx). Treated as not granted.
 */
export type AiConsentStatus = 'unknown' | 'granted' | 'missing' | 'outdated' | 'error';

let status: AiConsentStatus = 'unknown';

export function getAiConsentStatus(): AiConsentStatus {
  return status;
}

/**
 * Written ONLY by `AiConsentProvider`, and synchronously before it resolves a
 * consent request — so a guarded call on the very next line sees `granted`.
 */
export function setAiConsentStatus(next: AiConsentStatus): void {
  status = next;
}

/** Test-only: put the enforcement layer in a known state for a suite. */
export function __setAiConsentStatusForTest(next: AiConsentStatus): void {
  status = next;
}

export const AI_CONSENT_REQUIRED_CODE = 'AI_CONSENT_REQUIRED';

/** Thrown / passed to `onError` when an AI call is attempted without consent. */
export class AiConsentRequiredError extends ApiError {
  constructor() {
    // 428 Precondition Required — never sent over the wire; it marks a refusal
    // made on the device before any request.
    super('請先同意 AI 解讀資料說明', 428, AI_CONSENT_REQUIRED_CODE);
    this.name = 'AiConsentRequiredError';
  }
}

export function isAiConsentRequiredError(e: unknown): boolean {
  return (
    e instanceof AiConsentRequiredError ||
    (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === AI_CONSENT_REQUIRED_CODE)
  );
}

/** For `async` functions: throws (→ the promise rejects) unless consent is granted. */
export function assertAiConsent(): void {
  if (status !== 'granted') throw new AiConsentRequiredError();
}

/**
 * For non-`async` functions that return a Promise: a rejected promise when
 * consent is missing, else null. (A synchronous throw from a promise-returning
 * function would escape callers' `.catch`.)
 */
export function aiConsentRejection<T>(): Promise<T> | null {
  return status === 'granted' ? null : Promise.reject(new AiConsentRequiredError());
}

/** The consent fields of `GET /api/users/me`. */
export interface ServerConsentFields {
  aiConsentVersion?: string | null;
  aiConsentAcceptedVersions?: string[] | null;
}

/**
 * Status from the server's answer. Set membership only — versions are not
 * ordered (1B item 3).
 *
 * A user whose recorded version is still accepted is granted even if THIS build's
 * version is not: what they agreed to is still true. Only a user with no valid
 * consent on an outdated build is `outdated`.
 *
 * An API predating 1B sends no accepted list; treat this build's version as the
 * only accepted one (recording consent will then fail and say so).
 */
export function statusFromServer(fields: ServerConsentFields): AiConsentStatus {
  const accepted = fields.aiConsentAcceptedVersions ?? [AI_CONSENT_VERSION];
  if (fields.aiConsentVersion && accepted.includes(fields.aiConsentVersion)) return 'granted';
  if (!accepted.includes(AI_CONSENT_VERSION)) return 'outdated';
  return 'missing';
}
