import { type UmbraAdapterPort, type UmbraTreasuryResult } from './umbra.port';

const mockClient = {
  signer: { address: 'MOCK_SIGNER_ADDRESS' },
};

const mockClientService = {
  getClient: jest.fn().mockResolvedValue(mockClient),
  isEnabled: jest.fn().mockReturnValue(true),
};

// Mock SDK modules before importing the adapter
jest.mock('@umbra-privacy/sdk', () => ({
  getUserRegistrationFunction: jest.fn(() =>
    jest.fn().mockResolvedValue(['sig1', 'sig2']),
  ),
  getUserAccountQuerierFunction: jest.fn(() =>
    jest.fn().mockResolvedValue({
      x25519PublicKey: 'mockX25519PubkeyBase58',
      userCommitment: 'mockCommitment',
      generationIndex: 1,
      statusFlags: { isConfidential: true, isAnonymous: false },
    }),
  ),
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction: jest.fn(() =>
    jest.fn().mockResolvedValue({
      queueSignature: 'mockQueueSig',
      callbackSignature: 'mockCallbackSig',
    }),
  ),
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction: jest.fn(() =>
    jest.fn().mockResolvedValue({
      queueSignature: 'mockQueueSig',
      callbackSignature: 'mockCallbackSig',
    }),
  ),
  getEncryptedBalanceQuerierFunction: jest.fn(() =>
    jest.fn().mockResolvedValue({
      encryptedTokenAccount: 'mockEta',
      ciphertext: 'mockCiphertext',
      decryptedAmount: '1000000',
    }),
  ),
  getComplianceGrantIssuerFunction: jest.fn(() =>
    jest.fn().mockResolvedValue({ grantId: 'mockGrantId' }),
  ),
  getComplianceGrantRevokerFunction: jest.fn(() => jest.fn().mockResolvedValue(undefined)),
}));

describe('UmbraRealAdapter', () => {
  let adapter: UmbraAdapterPort;

  beforeEach(async () => {
    jest.clearAllMocks();
    const { UmbraRealAdapter } = await import('./umbra-real.adapter');
    adapter = new UmbraRealAdapter(mockClientService as any);
  });

  describe('registerEncryptedUserAccount', () => {
    it('should register and return account details', async () => {
      const result = await adapter.registerEncryptedUserAccount({
        walletAddress: 'wallet123',
        mode: 'confidential',
      } as Parameters<typeof adapter.registerEncryptedUserAccount>[0]);

      expect(result.status).toBe('confirmed');
      expect(result.x25519PublicKey).toBe('mockX25519PubkeyBase58');
      expect(result.txSignatures).toEqual(['sig1', 'sig2']);
    });
  });

  describe('deposit', () => {
    it('should deposit and return queue signature', async () => {
      const result = await adapter.deposit({
        deploymentId: 'dep-1',
        fromWallet: 'wallet123',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
      });

      expect(result.status).toBe('confirmed');
      expect(result.queueSignature).toBe('mockQueueSig');
    });
  });

  describe('withdraw', () => {
    it('should withdraw and return queue signature', async () => {
      const result = await adapter.withdraw({
        deploymentId: 'dep-1',
        toWallet: 'wallet123',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
      });

      expect(result.status).toBe('confirmed');
      expect(result.queueSignature).toBe('mockQueueSig');
    });
  });

  describe('transfer', () => {
    it('should return failed for unimplemented transfers', async () => {
      const result = await adapter.transfer({
        deploymentId: 'dep-1',
        fromWallet: 'wallet123',
        toWallet: 'wallet456',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
      });

      expect(result.status).toBe('failed');
    });
  });

  describe('getEncryptedBalance', () => {
    it('should query and return encrypted balance', async () => {
      const result = await adapter.getEncryptedBalance({
        deploymentId: 'dep-1',
        walletAddress: 'wallet123',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      });

      expect(result.encryptedTokenAccount).toBe('mockEta');
      expect(result.decryptedAmount).toBe('1000000');
    });
  });

  describe('grantViewer', () => {
    it('should return a deterministic grantId (compliance grants deferred)', async () => {
      const result = await adapter.grantViewer({
        deploymentId: 'dep-1',
        granteeWallet: 'grantee123',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      });

      expect(result.grantId).toBe('umbra-grant-dep-1-grantee1');
      expect(result.payload).toBeDefined();
    });
  });
});
