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
import { Public } from '../auth/public.decorator';

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

    await this.prisma.user.create({
      data: {
        clerkUserId: data.id,
        name,
        avatarUrl: data.image_url,
        subscriptionTier: 'FREE',
        credits: 0,
        languagePref: 'ZH_TW',
        freeReadingUsed: false,
      },
    });

    this.logger.log(`User created in DB: ${data.id}`);
  }

  private async handleUserUpdated(data: ClerkUserEventData) {
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;

    await this.prisma.user.upsert({
      where: { clerkUserId: data.id },
      update: {
        name,
        avatarUrl: data.image_url,
      },
      create: {
        clerkUserId: data.id,
        name,
        avatarUrl: data.image_url,
        subscriptionTier: 'FREE',
        credits: 0,
        languagePref: 'ZH_TW',
        freeReadingUsed: false,
      },
    });

    // Invalidate admin role cache so role changes take effect immediately
    await this.redis.del(`admin:role:${data.id}`);

    this.logger.log(`User updated in DB: ${data.id}`);
  }

  private async handleUserDeleted(data: ClerkUserEventData) {
    try {
      // Soft-delete: anonymize user data but preserve financial records
      // (subscriptions, transactions) for compliance and accounting
      await this.prisma.user.update({
        where: { clerkUserId: data.id },
        data: {
          name: '[deleted]',
          avatarUrl: null,
          clerkUserId: `deleted_${data.id}_${Date.now()}`, // Free up the original clerkUserId
          credits: 0,
          subscriptionTier: 'FREE',
        },
      });

      // Invalidate admin cache
      await this.redis.del(`admin:role:${data.id}`);

      this.logger.log(`User soft-deleted from DB: ${data.id}`);
    } catch (error) {
      // User may not exist in our DB yet
      this.logger.warn(`User not found for deletion: ${data.id}`);
    }
  }
}
