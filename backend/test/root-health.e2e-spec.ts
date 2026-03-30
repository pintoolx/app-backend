import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppController } from '../src/app.controller';
import { RootController } from '../src/root.controller';

describe('Root and health routes', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RootController, AppController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', {
      exclude: ['/', 'favicon.ico'],
    });
    await app.listen(0);

    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the root guide response', async () => {
    const response = await fetch(`${baseUrl}/`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      message: 'Welcome to the API',
      documentation: '/api/docs',
      health: '/api/health',
    });
  });

  it('serves the health endpoint under /api', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
  });
});
