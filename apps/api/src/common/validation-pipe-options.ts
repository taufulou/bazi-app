import { ValidationPipeOptions } from '@nestjs/common';

/**
 * The global `ValidationPipe` configuration, in one place so a test can use the
 * REAL one.
 *
 * These options are load-bearing beyond type coercion. M9's
 * `@SafeRedirectUrl()` rewrites a relative `successUrl` into the absolute URL
 * Stripe requires, and that rewrite reaches the controller only because the
 * pipe returns the transformed object rather than the raw body.
 *
 * The exact condition is narrower than it looks, and was established by running
 * the pipe rather than by reading it — an earlier version of this comment said
 * `transform: true` alone was the trigger, and a mutation test disproved it.
 * `ValidationPipe.transform` returns:
 *
 *   transform: true                          → the class instance   (rewrite kept)
 *   transform: false + any validatorOptions  → classToPlain(entity) (rewrite kept)
 *   transform: false + NO validatorOptions   → the raw input        (rewrite LOST)
 *
 * So the rewrite survives on two of three paths, and the one that loses it is a
 * bare `new ValidationPipe()`. `safe-redirect-url.spec.ts` imports this object
 * and asserts the resolved URL comes out, so degrading to that third case fails
 * a test instead of quietly handing Stripe a URL it rejects. A test with its own
 * hardcoded copy of these options could not catch that.
 */
export const GLOBAL_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};
