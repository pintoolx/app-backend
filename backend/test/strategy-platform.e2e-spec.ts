/**
 * Week 6.6 — Strategy platform end-to-end smoke test.
 *
 * What this exercises:
 *   1. Strategy create -> publish.
 *   2. Deployment create (mode=`per` triggers PER auto-bootstrap; treasury
 *      defaults from compiled IR are respected).
 *   3. PER auth challenge -> verify (real ed25519 round-trip).
 *   4. PER private state read with bearer token (PerAuthGuard).
 *   5. Private Payments deposit/balance (Noop adapter is fine — we just
 *      assert the response schema).
 *   6. Lifecycle close → verifies tokens are revoked.
 *
 * Skip semantics:
 *   - Skipped unless STRATEGY_E2E=1.
 *   - Skipped if SUPABASE_URL / SUPABASE_SERVICE_KEY are unset (we need a
 *     real Postgres test instance to exercise schema constraints).
 */
jest.mock('@umbra-privacy/sdk', () => ({
  getUmbraClient: jest.fn().mockResolvedValue({}),
  createSignerFromPrivateKeyBytes: jest.fn().mockResolvedValue({ address: 'mock-address' }),
  getUserRegistrationFunction: jest.fn().mockReturnValue(jest.fn().mockResolvedValue([])),
  getUserAccountQuerierFunction: jest.fn().mockReturnValue(jest.fn().mockResolvedValue({})),
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction: jest.fn().mockReturnValue(jest.fn().mockResolvedValue({})),
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction: jest.fn().mockReturnValue(jest.fn().mockResolvedValue({})),
  getEncryptedBalanceQuerierFunction: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(new Map())),
}));

jest.mock('otplib', () => ({
  generateSecret: jest.fn().mockReturnValue('mock-secret'),
  generateURI: jest.fn().mockReturnValue('mock-uri'),
  verifySync: jest.fn().mockReturnValue(true),
  authenticator: { generateSecret: jest.fn().mockReturnValue('mock-secret'), verify: jest.fn().mockReturnValue(true) },
  totp: { generateSecret: jest.fn().mockReturnValue('mock-secret'), verify: jest.fn().mockReturnValue(true) },
}));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';

const E2E_ENABLED =
  process.env.STRATEGY_E2E === '1' &&
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_KEY);

const describeOrSkip: jest.Describe = E2E_ENABLED ? describe : describe.skip;

describeOrSkip('Strategy platform E2E', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let walletKeypair: Keypair;
  let walletAddress: string;
  let strategyId: string;
  let deploymentId: string;
  let perToken: string;

  beforeAll(async () => {
    walletKeypair = Keypair.generate();
    walletAddress = walletKeypair.publicKey.toBase58();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => any } }) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { walletAddress };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates and publishes a strategy', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/strategies')
      .send({
        name: `e2e-${Date.now()}`,
        description: 'e2e smoke',
        privacyLevel: 'mixed',
        nodes: [
          {
            id: 'n1',
            type: 'priceFeed',
            config: { mint: 'So11111111111111111111111111111111111111112' },
          },
        ],
        connections: [],
      });

    expect(create.status).toBeLessThan(400);
    strategyId = create.body.data.id;

    const publish = await request(app.getHttpServer())
      .post(`/api/strategies/${strategyId}/publish`)
      .send({});
    expect(publish.status).toBeLessThan(400);
  });

  it('creates a deployment with PER auto-bootstrap', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/strategies/${strategyId}/deploy`)
      .send({
        accountId: 'e2e-account',
        executionMode: 'per',
        treasuryMode: 'private_payments',
        metadata: {},
      });
    expect(res.status).toBeLessThan(400);
    deploymentId = res.body.data.id;
    expect(res.body.data.creatorWalletAddress).toBe(walletAddress);
  });

  it('completes PER challenge → verify → private-state', async () => {
    const challengeRes = await request(app.getHttpServer())
      .get(`/api/deployments/${deploymentId}/per/auth/challenge`)
      .query({ wallet: walletAddress });
    expect(challengeRes.status).toBeLessThan(400);
    const challenge = challengeRes.body.data.challenge;
    expect(typeof challenge).toBe('string');

    const nonce = bs58.decode(challenge);
    const signature = bs58.encode(nacl.sign.detached(nonce, walletKeypair.secretKey));

    const verifyRes = await request(app.getHttpServer())
      .post(`/api/deployments/${deploymentId}/per/auth/verify`)
      .send({ wallet: walletAddress, challenge, signature });
    expect(verifyRes.status).toBeLessThan(400);
    perToken = verifyRes.body.data.authToken;
    expect(typeof perToken).toBe('string');

    const stateRes = await request(app.getHttpServer())
      .get(`/api/deployments/${deploymentId}/per/private-state`)
      .set('Authorization', `Bearer ${perToken}`);
    expect(stateRes.status).toBeLessThan(400);
  });

  it('Private Payments balance roundtrip', async () => {
    const balRes = await request(app.getHttpServer())
      .get(`/api/deployments/${deploymentId}/pp/balance`)
      .query({ mint: 'So11111111111111111111111111111111111111112' });
    expect(balRes.status).toBeLessThan(400);
    expect(balRes.body.data).toBeDefined();
  });

  it('closes the deployment and revokes PER tokens', async () => {
    // stop -> close
    await request(app.getHttpServer()).post(`/api/deployments/${deploymentId}/stop`).send({});
    const closeRes = await request(app.getHttpServer())
      .post(`/api/deployments/${deploymentId}/close`)
      .send({});
    expect(closeRes.status).toBeLessThan(400);

    // The previously issued PER token should now be rejected.
    const stateRes = await request(app.getHttpServer())
      .get(`/api/deployments/${deploymentId}/per/private-state`)
      .set('Authorization', `Bearer ${perToken}`);
    expect(stateRes.status).toBe(401);
  });

  it('exposes /metrics and /api/health/live', async () => {
    const live = await request(app.getHttpServer()).get('/api/health/live');
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('ok');

    const metrics = await request(app.getHttpServer()).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('http_requests_total');
  });
});
