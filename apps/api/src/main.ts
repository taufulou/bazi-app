import * as Sentry from '@sentry/nestjs';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { scrubSentryEvent } from './common/sentry-scrub';
import { isSwaggerEnabled } from './common/swagger-gate';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from './common/validation-pipe-options';
import { resolveTrustProxyHops, TRUST_PROXY_ENV } from './common/trust-proxy';
import { reportWebOrigins, webOriginsFromEnv } from './payments/safe-redirect-url';

// Initialize Sentry before anything else
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    // C2 — this used to be the whole config. Every request to this API carries
    // birth data (date, time, city, coordinates, gender) in its body, so an
    // error report that attaches the request is an error report that ships the
    // most sensitive thing we hold to a third party.
    //
    // Two layers on purpose. `sendDefaultPii: false` is the SDK's own switch and
    // states the intent; `beforeSend` enforces it regardless of what any given
    // SDK version decides to attach by default — that behaviour has changed
    // across major versions, and "I read node_modules once" is not a control
    // that survives an upgrade.
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    // Transactions carry request context too.
    beforeSendTransaction: scrubSentryEvent,
  });
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Enable raw body for webhook signature verification (Svix/Clerk)
    rawBody: true,
  });

  // M1(b) — how much of X-Forwarded-For Express may believe.
  //
  // Read from the RAW env, not ConfigService: this decides whose address the
  // anonymous rate-limit bucket is keyed on, and `NODE_ENV` taught us that
  // anything Joi has defaulted is not the host's answer. See trust-proxy.ts for
  // why a hop COUNT and never `true`.
  const trustProxy = resolveTrustProxyHops(process.env[TRUST_PROXY_ENV]);
  if (trustProxy.rejected !== undefined) {
    logger.error(
      `${TRUST_PROXY_ENV}="${trustProxy.rejected}" is not a hop count and was IGNORED. ` +
        `Express's "trust proxy: true" would trust a client-supplied header, letting a ` +
        `caller mint a fresh rate-limit bucket per request. Set an integer.`,
    );
  }
  if (trustProxy.hops > 0) {
    app.set('trust proxy', trustProxy.hops);
    logger.log(`trust proxy = ${trustProxy.hops} hop(s)`);
  } else {
    logger.warn(
      `${TRUST_PROXY_ENV} is not set — req.ip is the socket peer, so behind a ` +
        `proxy EVERY anonymous caller shares one rate-limit bucket. Authenticated ` +
        `callers are keyed on their verified userId and are unaffected. Verify the ` +
        `real hop count against the edge and set it before launch.`,
    );
  }

  // M9 — announce the Stripe redirect allowlist once, at boot. A wrong value
  // here surfaces as "checkout returns 400", which is the loudest failure for a
  // customer and the quietest for us: no exception, no Sentry event, just a
  // declined payment. Say it out loud instead.
  reportWebOrigins(
    webOriginsFromEnv(),
    (msg) => logger.log(msg),
    (msg) => logger.warn(msg),
  );

  // Graceful shutdown
  app.enableShutdownHooks();

  // Security headers
  app.use(helmet());

  // Serve the day-master mascot art (apps/web/public/mascots) so the mobile app
  // loads it remotely via EXPO_PUBLIC_ASSETS_URL instead of bundling ~32MB into
  // the binary. cwd is apps/api in dev AND /app/apps/api in the Docker image, so
  // ../web/public/mascots resolves in both. Immutable: the art is content-stable.
  app.useStaticAssets(join(process.cwd(), '..', 'web', 'public', 'mascots'), {
    prefix: '/mascots',
    maxAge: '30d',
    immutable: true,
  });

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
  });

  // Swagger API documentation — OPT-IN. See `common/swagger-gate.ts` for why
  // this must not consult NODE_ENV (Joi defaults it to 'development' and writes
  // it back into process.env, so an unset NODE_ENV reads as development here).
  if (isSwaggerEnabled()) {
    const config = new DocumentBuilder()
      .setTitle('天命 API')
      .setDescription(
        '天命 API — AI-powered Chinese astrology & fortune analysis.\n\n' +
        '## Authentication\n' +
        'Most endpoints require a Clerk JWT token passed as `Bearer <token>` in the Authorization header.\n\n' +
        '## Rate Limiting\n' +
        '- General: 100 requests/min per IP\n' +
        '- Bazi readings: 10 requests/min per user\n' +
        '- AI interpretation: 3 requests/min per user',
      )
      .setVersion('1.0')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Clerk JWT token',
      })
      .addTag('Health', 'Health check endpoints')
      .addTag('Users', 'User profile and birth profiles management')
      .addTag('Bazi', 'Bazi reading and comparison services')
      .addTag('Payments', 'Subscription and payment management')
      .addTag('Admin', 'Admin dashboard and configuration')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`API server running on http://localhost:${port}`);
  // Same condition as the block that mounts it — this used to be a second,
  // independently-written `NODE_ENV !== 'production'`, so it would have
  // advertised a docs URL that no longer exists.
  if (isSwaggerEnabled()) {
    logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
  }
}
bootstrap();
