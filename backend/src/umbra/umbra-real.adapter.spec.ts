import { type UmbraAdapterPort } from './umbra.port';
import { type UmbraZkProverProviderPort } from './umbra-zk-prover.port';

const mockClient = {
  signer: { address: 'MOCK_SIGNER_ADDRESS' },
};

const mockClientService = {
  getClient: jest.fn().mockResolvedValue(mockClient),
  withSigner: jest.fn(async (_secretKey: Uint8Array, fn: (c: unknown) => Promise<unknown>) =>
    fn(mockClient),
  ),
  isEnabled: jest.fn().mockReturnValue(true),
};

// Phase-5 mocks for claimable-UTXO factories. Each factory receives args/deps
// and returns the actual SDK function which we mock per-test below.
const mockCreateTransferIntentFn = jest.fn().mockResolvedValue({
  queueSignature: 'transferQueueSig',
  callbackSignature: 'transferCbSig',
  callbackStatus: 'finalized',
});
const mockClaimFn = jest.fn().mockResolvedValue({
  batches: new Map([
    [
      0,
      {
        requestId: 'req-1',
        status: 'completed',
        txSignature: 'claimQueueSig',
        callbackSignature: 'claimCbSig',
      },
    ],
  ]),
});
const mockScannerFn = jest
  .fn()
  .mockResolvedValue({ receiver: [{ id: 'utxo-1' }], ephemeral: [] });

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
  getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction: jest.fn(
    () => mockCreateTransferIntentFn,
  ),
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction: jest.fn(() => mockClaimFn),
  getClaimableUtxoScannerFunction: jest.fn(() => mockScannerFn),
}));

const makeProverProvider = (
  overrides?: Partial<UmbraZkProverProviderPort>,
): UmbraZkProverProviderPort => ({
  getZkProverSuite: jest.fn().mockResolvedValue({
    utxoReceiverClaimable: { prove: jest.fn() },
    claimReceiverClaimableIntoEncryptedBalance: { prove: jest.fn() },
  }),
  getRelayer: jest.fn().mockResolvedValue({
    apiEndpoint: 'https://relayer.test',
    getFeePayer: jest.fn(),
    getRelayerAddress: jest.fn(),
    getSupportedMints: jest.fn(),
    submitClaim: jest.fn(),
    pollClaimStatus: jest.fn(),
  }),
  ...overrides,
});

const makeConfig = (overrides: Record<string, string | undefined> = {}) => ({
  get: jest.fn((key: string) => overrides[key]),
});

describe('UmbraRealAdapter', () => {
  let adapter: UmbraAdapterPort;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockClientService.withSigner.mockImplementation(
      async (_secretKey: Uint8Array, fn: (c: unknown) => Promise<unknown>) => fn(mockClient),
    );
    mockCreateTransferIntentFn.mockResolvedValue({
      queueSignature: 'transferQueueSig',
      callbackSignature: 'transferCbSig',
      callbackStatus: 'finalized',
    });
    mockClaimFn.mockResolvedValue({
      batches: new Map([
        [
          0,
          {
            requestId: 'req-1',
            status: 'completed',
            txSignature: 'claimQueueSig',
            callbackSignature: 'claimCbSig',
          },
        ],
      ]),
    });
    mockScannerFn.mockResolvedValue({ receiver: [{ id: 'utxo-1' }], ephemeral: [] });
    const { UmbraRealAdapter } = await import('./umbra-real.adapter');
    adapter = new UmbraRealAdapter(mockClientService as any);
  });

  const buildAdapterWithFlag = async (
    enabled: boolean,
    proverOverrides?: Partial<UmbraZkProverProviderPort>,
  ): Promise<UmbraAdapterPort> => {
    const { UmbraRealAdapter } = await import('./umbra-real.adapter');
    return new UmbraRealAdapter(
      mockClientService as any,
      makeConfig({ UMBRA_TRANSFER_ENABLED: enabled ? 'true' : undefined }) as any,
      makeProverProvider(proverOverrides),
    );
  };

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

  describe('createEncryptedTransferIntent', () => {
    const params = {
      deploymentId: 'dep-1',
      fromSigner: { secretKey: new Uint8Array(64), pubkey: 'sender-pk' },
      toRecipientPubkey: 'recipient-pk',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '1000000',
    };

    it('returns failed when feature flag is disabled', async () => {
      const a = await buildAdapterWithFlag(false);
      const result = await a.createEncryptedTransferIntent(params);
      expect(result.status).toBe('failed');
      expect(mockCreateTransferIntentFn).not.toHaveBeenCalled();
    });

    it('returns failed when zkProver suite is missing', async () => {
      const a = await buildAdapterWithFlag(true, {
        getZkProverSuite: jest.fn().mockResolvedValue(null),
      });
      const result = await a.createEncryptedTransferIntent(params);
      expect(result.status).toBe('failed');
      expect(result.claimableUtxoRef).toBeNull();
      expect(mockCreateTransferIntentFn).not.toHaveBeenCalled();
    });

    it('publishes claimable UTXO and maps SDK queue signature to ref + status', async () => {
      const a = await buildAdapterWithFlag(true);
      const result = await a.createEncryptedTransferIntent(params);
      expect(mockClientService.withSigner).toHaveBeenCalledTimes(1);
      expect(mockCreateTransferIntentFn).toHaveBeenCalledWith({
        amount: 1_000_000n,
        destinationAddress: 'recipient-pk',
        mint: params.mint,
      });
      expect(result.queueSignature).toBe('transferQueueSig');
      expect(result.callbackSignature).toBe('transferCbSig');
      expect(result.claimableUtxoRef).toBe('transferQueueSig');
      expect(result.status).toBe('confirmed');
    });

    it('downgrades to pending when SDK callback has not finalised', async () => {
      mockCreateTransferIntentFn.mockResolvedValueOnce({
        queueSignature: 'q',
        callbackSignature: undefined,
        callbackStatus: undefined,
      });
      const a = await buildAdapterWithFlag(true);
      const result = await a.createEncryptedTransferIntent(params);
      expect(result.status).toBe('pending');
      expect(result.queueSignature).toBe('q');
      expect(result.callbackSignature).toBeNull();
    });

    it('catches SDK errors and returns failed', async () => {
      mockCreateTransferIntentFn.mockRejectedValueOnce(new Error('boom'));
      const a = await buildAdapterWithFlag(true);
      const result = await a.createEncryptedTransferIntent(params);
      expect(result.status).toBe('failed');
    });
  });

  describe('claimEncryptedTransfer', () => {
    const params = {
      recipientSigner: { secretKey: new Uint8Array(64), pubkey: 'recipient-pk' },
    };

    it('returns failed when feature flag is disabled', async () => {
      const a = await buildAdapterWithFlag(false);
      const result = await a.claimEncryptedTransfer(params);
      expect(result.status).toBe('failed');
      expect(result.unavailableReason).toBe('feature-flag-disabled');
    });

    it('returns failed when relayer is missing', async () => {
      const a = await buildAdapterWithFlag(true, {
        getRelayer: jest.fn().mockResolvedValue(null),
      });
      const result = await a.claimEncryptedTransfer(params);
      expect(result.status).toBe('failed');
      expect(result.unavailableReason).toBe('relayer-not-configured');
    });

    it('confirms when scanner returns no UTXOs (idempotent)', async () => {
      mockScannerFn.mockResolvedValueOnce({ receiver: [], ephemeral: [] });
      const a = await buildAdapterWithFlag(true);
      const result = await a.claimEncryptedTransfer(params);
      expect(result.status).toBe('confirmed');
      expect(result.claimedCount).toBe(0);
      expect(mockClaimFn).not.toHaveBeenCalled();
    });

    it('claims scanned receiver UTXOs and reports succeeded batches', async () => {
      const a = await buildAdapterWithFlag(true);
      const result = await a.claimEncryptedTransfer(params);
      expect(mockScannerFn).toHaveBeenCalled();
      expect(mockClaimFn).toHaveBeenCalledWith([{ id: 'utxo-1' }]);
      expect(result.status).toBe('confirmed');
      expect(result.queueSignature).toBe('claimQueueSig');
      expect(result.callbackSignature).toBe('claimCbSig');
      expect(result.claimedCount).toBe(1);
    });

    it('marks status pending when batches are still in flight', async () => {
      mockClaimFn.mockResolvedValueOnce({
        batches: new Map([
          [0, { requestId: 'r', status: 'submitted' }],
        ]),
      });
      const a = await buildAdapterWithFlag(true);
      const result = await a.claimEncryptedTransfer(params);
      expect(result.status).toBe('pending');
    });
  });

  describe('scanClaimableUtxos', () => {
    const params = {
      recipientSigner: { secretKey: new Uint8Array(64), pubkey: 'recipient-pk' },
    };

    it('reports unavailable when feature flag is disabled', async () => {
      const a = await buildAdapterWithFlag(false);
      const result = await a.scanClaimableUtxos(params);
      expect(result.unavailable).toBe(true);
      expect(result.unavailableReason).toBe('feature-flag-disabled');
    });

    it('returns counts from the SDK scanner', async () => {
      mockScannerFn.mockResolvedValueOnce({
        receiver: [{ id: 'a' }, { id: 'b' }],
        ephemeral: [{ id: 'c' }],
      });
      const a = await buildAdapterWithFlag(true);
      const result = await a.scanClaimableUtxos(params);
      expect(result.unavailable).toBe(false);
      expect(result.receiverCount).toBe(2);
      expect(result.ephemeralCount).toBe(1);
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
