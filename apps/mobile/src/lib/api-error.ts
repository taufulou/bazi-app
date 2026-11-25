/**
 * The mobile API's typed error. In its own module, with no React Native imports,
 * so pure modules (and the API test suite, which `require`s
 * `ai-consent-state.ts`) can depend on it without pulling in the app runtime.
 * `api.ts` re-exports it — existing `import { ApiError } from './api'` keeps working.
 */

/** Typed API error carrying the HTTP status + the NestJS error `code` when present. */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
