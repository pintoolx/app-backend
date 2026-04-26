import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { makeLogger } from './observability/json-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: makeLogger(),
  });
  const configService = app.get(ConfigService);

  // Week 6.4 — security headers (CSP defaults loosened for Swagger UI).
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  // Global prefix
  app.setGlobalPrefix('api', {
    exclude: ['/', 'favicon.ico'],
  });

  // Enable CORS
  const corsOrigin = configService.get<string>('corsOrigin');
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  if (corsOrigin === '*' && process.env.NODE_ENV === 'production') {
    console.warn(
      '⚠️  CORS_ORIGIN is set to "*" in production. Consider restricting to specific origins.',
    );
  }

  // Global pipes (Week 6.4 — strict whitelist + reject unknown fields).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filters
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('PinTool API')
    .setDescription(
      'PinTool Web3 Workflow Automation API Documentation\n\n' +
        'This API provides endpoints for:\n' +
        '- Wallet signature challenge flows and Supabase Bearer authentication\n' +
        '- Referral code generation, quota management, and redemption (Bearer protected)\n' +
        '- Workflow management and execution\n' +
        '- Workflow AI conversations (Bearer protected, single-instance memory store)\n' +
        '- Telegram bot integration\n' +
        '- Web3 operations (Jupiter swap, Kamino vaults, Pyth price feeds) - Available as Workflow Nodes',
    )
    .setVersion('1.0')
    .addTag('Auth', 'Wallet signature challenge verification endpoints')
    .addTag(
      'Referrals',
      'Bearer-protected referral code generation, quota, and redemption endpoints',
    )
    .addTag('Workflows', 'Workflow CRUD and execution endpoints')
    .addTag('Telegram', 'Telegram bot management endpoints')
    .addTag('Workflow AI', 'Bearer-protected AI workflow generation and conversation endpoints')
    .addTag('Admin Auth', 'Admin login (email + password + TOTP), token refresh and logout')
    .addTag('Admin Overview', 'Admin dashboard KPI snapshot and adapter matrix')
    .addTag('Admin Users', 'Admin views over end-user wallets and accounts')
    .addTag('Admin Strategies', 'Admin views over strategies and version history')
    .addTag('Admin Deployments', 'Admin views over strategy deployments and recent runs')
    .addTag('Admin System', 'Adapter matrix, readiness probe, keeper status')
    .addTag(
      'Admin Privacy',
      'Privacy and encryption observability: PER tokens, public snapshots, Umbra registrations, key inventory',
    )
    .addTag('Admin Audit', 'Append-only admin action audit log')
    .addTag(
      'Admin Ops · Deployments',
      'Lifecycle write operations: pause / resume / stop / force-close',
    )
    .addTag('Admin Ops · Privacy', 'PER token revoke (single + bulk by deployment)')
    .addTag('Admin Ops · Executions', 'Kill running workflow_executions')
    .addTag('Admin Ops · Users', 'Wallet ban / unban (superadmin)')
    .addTag('Admin Ops · System', 'Maintenance mode toggle (superadmin) — affects user routes only')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'PinTool API Docs',
    customfavIcon: 'https://nestjs.com/img/logo-small.svg',
    customCss: '.swagger-ui .topbar { display: none }',
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log('');
  console.log('🚀 ============================================');
  console.log('🚀 PinTool Backend Server Started');
  console.log('🚀 ============================================');
  console.log(`🚀 Server running on: http://localhost:${port}`);
  console.log(`🚀 API endpoint: http://localhost:${port}/api`);
  console.log(`📚 API docs: http://localhost:${port}/api/docs`);
  console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('🚀 ============================================');
  console.log('');
}

bootstrap();
