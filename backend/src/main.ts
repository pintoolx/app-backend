import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix
  app.setGlobalPrefix('api', {
    exclude: ['/', 'favicon.ico'],
  });

  // Enable CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
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
      '- Wallet-based authentication\n' +
      '- Workflow management and execution\n' +
      '- Telegram bot integration\n' +
      '- Web3 operations (Jupiter swap, Kamino vaults, Pyth price feeds) - Available as Workflow Nodes',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token obtained from /auth/verify endpoint',
      },
      'JWT-auth',
    )
    .addTag('Auth', 'Wallet signature authentication endpoints')
    .addTag('Workflows', 'Workflow CRUD and execution endpoints')
    .addTag('Telegram', 'Telegram bot management endpoints')
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
