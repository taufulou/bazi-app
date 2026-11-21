/**
 * A RevenueCat event we could not apply, and must NOT acknowledge.
 *
 * Thrown from {@link RevenueCatService}; the webhook controller turns ANY throw
 * into a 500 and leaves the 48h idempotency key unset, so RevenueCat retries.
 * Before 1A-core (finding F14) these cases logged and returned, the controller
 * answered 200, and the event — plus any manual resend within 48h — was gone.
 *
 * `reason` is a stable machine-readable tag for logs and tests.
 */
export class RevenueCatEventNotProcessableError extends Error {
  constructor(
    readonly reason: 'unmapped_product' | 'unknown_app_user',
    message: string,
  ) {
    super(message);
    this.name = 'RevenueCatEventNotProcessableError';
  }
}
