import { Prisma } from '@prisma/client';

/**
 * True for Prisma's unique-constraint violation (P2002).
 *
 * Used across the payment webhooks as an idempotency primitive: every provider
 * (Stripe, RevenueCat) can redeliver the same event, and several of our writes
 * are gated on a UNIQUE column precisely so a duplicate delivery collides instead
 * of double-granting. Callers catch this and CONTINUE — a conflict means the row
 * already exists, which is success, not failure.
 *
 * Duck-typed as well as `instanceof`-checked on purpose: the `instanceof` arm is
 * the real runtime path, while the shape check keeps unit tests able to simulate
 * a rejection with a plain `{ code: 'P2002' }` object instead of constructing a
 * PrismaClientKnownRequestError (which needs a clientVersion + meta).
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002';
  }
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
