import { HttpException, HttpStatus } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

/**
 * Sentry was armed and receiving nothing but the spend messages.
 *
 * `Sentry.init()` runs in `main.ts`, but nothing wired the SDK into Nest's
 * exception pipeline — no `SentryModule`, no `SentryGlobalFilter`, no
 * `@SentryExceptionCaptured()` — and this `@Catch()` filter intercepts every
 * exception first. So `captureMessage` calls (the three `ai.spend.*` alerts)
 * arrived, and not one application error ever did.
 *
 * Found while trying to prove a freshly-set DSN worked by forcing a 500: a test
 * that could not have passed no matter which route was used.
 */
describe('AllExceptionsFilter — Sentry reporting', () => {
  const captureException = Sentry.captureException as jest.Mock;

  function run(exception: unknown) {
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: jest.fn().mockReturnValue({ json }) }),
        getRequest: () => ({ method: 'GET', url: '/api/x' }),
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new AllExceptionsFilter().catch(exception, host as any);
    return json;
  }

  beforeEach(() => captureException.mockClear());

  it('reports an unexpected error — the case that was invisible', () => {
    const boom = new Error('database exploded');
    run(boom);
    expect(captureException).toHaveBeenCalledWith(boom);
  });

  it('reports a deliberate 500', () => {
    run(new HttpException('nope', HttpStatus.INTERNAL_SERVER_ERROR));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('does NOT report a 401 — this API answers every anonymous request with one', () => {
    // Decorating `catch()` with @SentryExceptionCaptured would report these,
    // and real failures would be buried under client-error noise within a day.
    run(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does NOT report 4xx generally', () => {
    for (const s of [HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT]) {
      run(new HttpException('client', s));
    }
    expect(captureException).not.toHaveBeenCalled();
  });

  it('still returns a response body when reporting', () => {
    // Reporting must not replace the client's answer.
    const json = run(new Error('boom'));
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, path: '/api/x' }),
    );
  });
});
