import {
  Controller,
  Post,
  Req,
  Res,
  Logger,
  HttpStatus,
  RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Webhook } from 'svix';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { Public } from '../auth/public.decorator';
import {
  isUniqueConstraintViolation,
  recordSignupBonusLedger,
  resolveSignupCredits,
} from '../common/signup-bonus';

interface ClerkEmailAddress {
  email_address: string;
  id: string;
}

interface ClerkUserEventData {
  id: string;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
  email_addresses: ClerkEmailAddress[];
  primary_email_address_id: string | null;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserEventData;
}

@SkipThrottle()
@Controller('api/webhooks')
export class ClerkWebhookController {
  private readonly logger = new Logger(ClerkWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    // C1 — the `user.deleted` handler must erase PII, not just anonymize.
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Post('clerk')
  async handleClerkWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    const webhookSecret = this.configService.get<string>('CLERK_WEBHOOK_SECRET');

    if (!webhookSecret) {
      this.logger.error('CLERK_WEBHOOK_SECRET not configured — rejecting webhook');
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Webhook secret not configured',
      });
    }

    // Get the headers
    const svixId = req.headers['svix-id'] as string;
    const svixTimestamp = req.headers['svix-timestamp'] as string;
    const svixSignature = req.headers['svix-signature'] as string;

    // Get the body
    const body = req.rawBody
      ? req.rawBody.toString()
      : JSON.stringify(req.body);

    let event: ClerkWebhookEvent;

    // Always verify webhook signature — no bypass in any environment
    try {
      const wh = new Webhook(webhookSecret);
      event = wh.verify(body, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as ClerkWebhookEvent;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Webhook verification failed: ${message}`);
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'Invalid webhook signature',
      });
    }

    this.logger.log(`Received Clerk webhook: ${event.type}`);

    try {
      switch (event.type) {
        case 'user.created':
          await this.handleUserCreated(event.data);
          break;
        case 'user.updated':
          await this.handleUserUpdated(event.data);
          break;
        case 'user.deleted':
          await this.handleUserDeleted(event.data);
          break;
        default:
          this.logger.log(`Unhandled webhook event type: ${event.type}`);
      }

      return res.status(HttpStatus.OK).json({ received: true });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      this.logger.error(`Error processing webhook: ${error.message}`, error.stack);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Webhook processing failed',
      });
    }
  }

  private async handleUserCreated(data: ClerkUserEventData) {
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
    // F1: 0 when this identity previously had a deleted account — deleteAccount
    // frees the clerkUserId by renaming, so a re-created identity must not
    // re-mint the bonus.
    const credits = await resolveSignupCredits(this.prisma, data.id);

    try {
      const created = await this.prisma.user.create({
        data: {
          clerkUserId: data.id,
          name,
          avatarUrl: data.image_url,
          subscriptionTier: 'FREE',
          credits,
          languagePref: 'ZH_TW',
        },
      });
      await recordSignupBonusLedger(this.prisma, created.id, credits);
      this.logger.log(`User created in DB: ${data.id}`);
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;
      // Another insert site won the race (`user.updated` arriving first, or
      // `ensureUser` auto-creating on a request that beat the webhook). The row
      // exists and the winner ledgered the grant, so there is nothing to do.
      //
      // Re-throwing here would 500 the webhook FOREVER rather than transiently:
      // Clerk's retry hits the same constraint, because the row it collides
      // with is not going away. Swallowing is what makes this self-healing.
      this.logger.warn(
        `User ${data.id} already existed on user.created — another path inserted ` +
          `it first. Not re-granting; the winner recorded the ledger row.`,
      );
    }
  }

  private async handleUserUpdated(data: ClerkUserEventData) {
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
    // F1: this path's insert branch is a third insert site and re-mints the
    // bonus just like the other two. Resolved even though this path usually
    // updates rather than creates — the insert branch is exactly the one that
    // fires for a re-created identity whose user.created webhook was missed.
    const profile = { name, avatarUrl: data.image_url };

    const existing = await this.prisma.user.findUnique({
      where: { clerkUserId: data.id },
      select: { id: true },
    });

    if (existing) {
      // The overwhelmingly common case: an ordinary profile edit. No grant —
      // an update leaves `credits` untouched, so ledgering here would invent a
      // grant on every name or avatar change.
      await this.prisma.user.update({ where: { clerkUserId: data.id }, data: profile });
    } else {
      // ⚠️ This used to be an `upsert` whose grant was gated on the `existing`
      // read above — check-then-act across two round-trips. The upsert itself is
      // atomic, so a concurrent `user.created` meant the read saw null while the
      // write resolved to UPDATE: credits correctly stayed at 3, but a SECOND
      // `signup_bonus` ledger row was written, breaking
      // `sum(CreditLedger.amount) == User.credits` — the invariant the whole
      // A6/A7/F7 ledger effort exists to establish.
      //
      // Now the database decides who inserted, not a read that can go stale.
      // Exactly one racer's `create` survives the `clerkUserId` unique
      // constraint, and only that one ledgers.
      const credits = await resolveSignupCredits(this.prisma, data.id);
      try {
        const created = await this.prisma.user.create({
          data: {
            clerkUserId: data.id,
            ...profile,
            subscriptionTier: 'FREE',
            credits,
            languagePref: 'ZH_TW',
          },
        });
        await recordSignupBonusLedger(this.prisma, created.id, credits);
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
        // Lost the race. The winner granted and ledgered; we owe only the
        // profile update this event was actually about.
        await this.prisma.user.update({ where: { clerkUserId: data.id }, data: profile });
      }
    }

    // Invalidate admin role cache so role changes take effect immediately
    await this.redis.del(`admin:role:${data.id}`);

    this.logger.log(`User updated in DB: ${data.id}`);
  }

  private async handleUserDeleted(data: ClerkUserEventData) {
    // ⚠️ Errors are NOT swallowed here, and that is deliberate. This whole body
    // used to sit in a `catch` that logged `User not found for deletion` for any
    // failure — after which the dispatcher returned 200 and Clerk never retried.
    // So a transaction timeout mid-erase (the 30s ceiling exists precisely
    // because heavy accounts approach it) left every birth profile, reading and
    // chat message in place, behind a log line naming a cause that was not the
    // cause. `UsersService.deleteAccount` states the opposing invariant outright
    // — erase is not best-effort — and the two doors had drifted apart.
    //
    // "No local user" is the one genuinely benign case, and it is now handled by
    // an explicit early return rather than by catching everything. Anything else
    // propagates to a 500 so Clerk retries.
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId: data.id },
      select: { id: true },
    });

    if (!user) {
      // Either the identity never had a local row, or `deleteAccount` already
      // ran and renamed `clerkUserId` — the idempotent re-delivery case.
      this.logger.log(`No local user for deletion (already anonymized or never existed): ${data.id}`);
      return;
    }

    // C1 — this path used to anonymize and stop, which is the exact defect
    // fixed in `UsersService.deleteAccount`: because no PII row was deleted,
    // none of the `onDelete: Cascade` relations ever fired, and every birth
    // profile, reading, comparison, chat message and fortune snapshot survived.
    // It is reachable two ways — a user deleting their identity in Clerk's
    // account portal, and an operator deleting them in the Dashboard — and,
    // since `deleteAccount` itself deletes the Clerk user, this handler ALSO
    // runs on every in-app deletion.
    await this.usersService.erasePersonalData(user.id);

    // Anonymize what is retained: the financial record and the row it hangs off.
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        name: '[deleted]',
        avatarUrl: null,
        clerkUserId: `deleted_${data.id}_${Date.now()}`, // Free up the original clerkUserId
        credits: 0,
        subscriptionTier: 'FREE',
        deviceFingerprint: null,
      },
    });

    // Cache invalidation is the one step allowed to fail quietly — a stale admin
    // role entry is a 5-minute annoyance, and failing the webhook over it would
    // make Clerk retry a deletion that has already succeeded.
    try {
      await this.redis.del(`admin:role:${data.id}`);
    } catch (err) {
      this.logger.warn(`admin role cache invalidation failed for ${data.id}: ${err}`);
    }

    this.logger.log(`User soft-deleted from DB: ${data.id}`);
  }
}
