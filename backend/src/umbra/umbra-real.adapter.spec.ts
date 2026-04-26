import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { UmbraRealAdapter } from './umbra-real.adapter';
import { UmbraDeploymentSignerService } from './umbra-deployment-signer.service';
import { Keypair } from '@solana/web3.js';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const buildSignerStub = () => {
  const ed = Keypair.generate();
  const x25519 = {
    publicKey: Uint8Array.from(Array(32).fill(7)),
    secretKey: Uint8Array.from(Array(32).fill(7)),
  };
  return {
    isConfigured: jest.fn(() => true),
    deriveForDeployment: jest.fn(async (deploymentId: string) => ({
      ed25519: ed,
      x25519,
      seedRef: `seedref-${deploymentId.slice(0, 8)}`,
    })),
    getMasterSeed: jest.fn(),
    getResolvedSource: jest.fn(() => 'env'),
  } as unknown as UmbraDeploymentSignerService;
};

const buildConfig = (env: Record<string, string | undefined>) =>
  ({ get: jest.fn((k: string) => env[k]) }) as unknown as ConfigService;

describe('UmbraRealAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation((v: unknown) =>
      Boolean((v as { isAxiosError?: boolean })?.isAxiosError),
    );
  });

  it('register operates in local-only mode without queue url', async () => {
    const signer = buildSignerStub();
    const adapter = new UmbraRealAdapter(buildConfig({}), signer);
    const res = await adapter.registerEncryptedUserAccount({
      walletAddress: 'walletA',
      mode: 'confidential',
      deploymentId: 'depl-1',
    } as any);

    expect(res.status).toBe('pending');
    expect(res.queueSignature).toBeNull();
    expect(res.encryptedUserAccount).toBeTruthy();
    expect(res.x25519PublicKey).toBeTruthy();
  });

  it('register posts to queue when configured', async () => {
    const signer = buildSignerStub();
    const httpInstance = {
      post: jest.fn().mockResolvedValue({ data: { signature: 'qsig' } }),
    } as unknown as ReturnType<typeof axios.create>;
    (mockedAxios.create as unknown as jest.Mock).mockReturnValue(httpInstance);

    const adapter = new UmbraRealAdapter(
      buildConfig({ UMBRA_QUEUE_URL: 'https://umbra-q.example' }),
      signer,
    );
    const res = await adapter.registerEncryptedUserAccount({
      walletAddress: 'walletA',
      mode: 'confidential',
      deploymentId: 'depl-1',
    } as any);

    expect(res.status).toBe('pending');
    expect(res.queueSignature).toBe('qsig');
    expect((httpInstance as unknown as { post: jest.Mock }).post).toHaveBeenCalledWith(
      '/v1/register',
      expect.objectContaining({
        deploymentId: 'depl-1',
        walletAddress: 'walletA',
        mode: 'confidential',
      }),
    );
  });

  it('treasury ops report failed when queue throws non-4xx', async () => {
    const signer = buildSignerStub();
    const httpInstance = {
      post: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ReturnType<typeof axios.create>;
    (mockedAxios.create as unknown as jest.Mock).mockReturnValue(httpInstance);

    const adapter = new UmbraRealAdapter(
      buildConfig({ UMBRA_QUEUE_URL: 'https://umbra-q.example' }),
      signer,
    );
    const res = await adapter.deposit({
      deploymentId: 'depl-1',
      fromWallet: 'walletA',
      mint: 'm1',
      amount: '100',
    });
    expect(res.status).toBe('failed');
    expect(res.queueSignature).toBeNull();
  });

  it('grantViewer returns deterministic id when no queue is set', async () => {
    const signer = buildSignerStub();
    const adapter = new UmbraRealAdapter(buildConfig({}), signer);
    const res = await adapter.grantViewer({
      deploymentId: 'depl-1',
      granteeWallet: 'walletGrantee123',
      mint: 'mint',
    });
    expect(res.grantId).toContain('umbra-grant-depl-1');
    expect(res.payload.granteeWallet).toBe('walletGrantee123');
  });

  it('getEncryptedBalance returns nulls without indexer url', async () => {
    const signer = buildSignerStub();
    const adapter = new UmbraRealAdapter(buildConfig({}), signer);
    const res = await adapter.getEncryptedBalance({
      deploymentId: 'depl-1',
      walletAddress: 'walletA',
      mint: 'm',
    });
    expect(res).toEqual({
      encryptedTokenAccount: null,
      ciphertext: null,
      decryptedAmount: null,
    });
  });
});
