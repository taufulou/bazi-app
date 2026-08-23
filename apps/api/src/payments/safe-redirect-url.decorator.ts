/**
 * `@SafeRedirectUrl()` — the DTO-level half of M9's redirect allowlist.
 *
 * Composes two steps that must agree, so they share one implementation
 * (`resolveRedirectUrl`) rather than two that can drift:
 *
 *   1. `@Transform` rewrites the value to the RESOLVED absolute URL, so the
 *      controller and Stripe see `https://ours.com/store?x=1` even when the
 *      browser sent `/store?x=1`. Stripe requires an absolute URL; before this,
 *      relative values passed validation and then failed at Stripe.
 *   2. `@Validate` rejects anything that does not resolve into the allowlist.
 *
 * The transform deliberately leaves an UNRESOLVABLE value untouched, so the
 * validation error quotes what the caller actually sent.
 *
 * The allowlist is read from `process.env` per request rather than captured at
 * decoration time. Decorators evaluate at module load, which for tests can be
 * before the env is arranged; the validate/transform bodies run per request,
 * long after boot. Parsing a short string is negligible next to the Stripe
 * round-trip it guards, and skipping the cache removes a class of test
 * pollution outright.
 */
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { resolveRedirectUrl, webOriginsFromEnv } from './safe-redirect-url';

function IsSafeRedirectUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyKey: string | symbol): void {
    registerDecorator({
      name: 'isSafeRedirectUrl',
      target: object.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return resolveRedirectUrl(value, webOriginsFromEnv()).ok;
        },
        defaultMessage(args: ValidationArguments): string {
          const result = resolveRedirectUrl(args.value, webOriginsFromEnv());
          const reason = result.ok ? 'is not allowed' : result.reason;
          return `${args.property} ${reason} (must be a relative path or an allowlisted origin)`;
        },
      },
    });
  };
}

export function SafeRedirectUrl(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => {
      const result = resolveRedirectUrl(value, webOriginsFromEnv());
      return result.ok ? result.url : value;
    }),
    IsSafeRedirectUrl(),
  );
}
