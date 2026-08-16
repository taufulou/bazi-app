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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
  });

  // Swagger API documentation — OPT-IN, not opt-out.
  //
  // ⚠️ This was `NODE_ENV !== 'production'`, which fails OPEN: an unset
  // NODE_ENV makes `undefined !== 'production'` true and publishes the full API
  // surface. It was held closed by a single `ENV NODE_ENV=production` line in
  // `docker/Dockerfile.api`, and there is no `railway.json` in the repo pinning
  // that Dockerfile as the builder — so a switch to Nixpacks, or any host that
  // does not set NODE_ENV, would silently expose it.
  //
  // It also carries the API's one accepted advisory: `@nestjs/swagger` pins
  // `js-yaml` at exactly 5.2.1 (a parsing-DoS advisory), and npm will not apply
  // a root `overrides` entry to a package nested inside a workspace, so no
  // override reaches it. The exposure is nil because the only call is
  // `jsyaml.dump` — serialization, never `.load` — and because this block never
  // runs in production. Making the gate fail CLOSED is what keeps that second
  // half true regardless of how the container is built.
  const swaggerEnabled =
    process.env.ENABLE_SWAGGER === 'true' || process.env.NODE_ENV === 'development';
  if (swaggerEnabled) {
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
  if (swaggerEnabled) {
    logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
  }
}
bootstrap();
