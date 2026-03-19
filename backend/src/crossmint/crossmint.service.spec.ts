import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CrossmintService } from './crossmint.service';

// Mock @crossmint/wallets-sdk
const mockCreateWallet = jest.fn();
const mockGetWallet = jest.fn();
const mockGetOrCreateWallet = jest.fn();

jest.mock('@crossmint/wallets-sdk', () => ({
  createCrossmint: jest.fn(() => ({ apiKey: 'test-key' })),
  CrossmintWallets: {
    from: jest.fn(() => ({
      createWallet: mockCreateWallet,
      getWallet: mockGetWallet,
      getOrCreateWallet: mockGetOrCreateWallet,
    })),
  },
  SolanaWallet: {
    from: jest.fn((wallet) => ({
      address: wallet.address,
      sendTransaction: jest.fn(),
    })),
  },
}));

const buildSupabaseClient = () => {
  const accountsTable: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
  };

  return {
    from: jest.fn(() => accountsTable),
    accountsTable,
  };
};

const buildConfigService = (overrides: Record<string, any> = {}) => {
  const defaults: Record<string, any> = {
    'crossmint.serverApiKey': 'sk_test_key',
    'crossmint.signerSecret': 'xmsk1_0000000000000000000000000000000000000000000000000000000000000000',
    'crossmint.environment': 'staging',
    'solana.rpcUrl': 'https://api.devnet.solana.com',
  };
  return {
    get: jest.fn((key: string) =>
      key in overrides ? overrides[key] : defaults[key],
    ),
  };
};

const buildLifecycleManager = () => ({
  startWorkflowForAccount: jest.fn().mockResolvedValue(undefined),
  stopWorkflowForAccount: jest.fn(),
});

describe('CrossmintService', () => {
  let service: CrossmintService;
  let supabaseClient: ReturnType<typeof buildSupabaseClient>;
  let configService: ReturnType<typeof buildConfigService>;
  let lifecycleManager: ReturnType<typeof buildLifecycleManager>;

  beforeEach(() => {
    jest.clearAllMocks();

    supabaseClient = buildSupabaseClient();
    configService = buildConfigService();
    lifecycleManager = buildLifecycleManager();

    service = new CrossmintService(
      configService as any,
      { client: supabaseClient } as any,
      lifecycleManager as any,
    );

    // Trigger SDK initialization
    service.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('initializes SDK when API key is present', () => {
      const { createCrossmint, CrossmintWallets } = require('@crossmint/wallets-sdk');
      expect(createCrossmint).toHaveBeenCalledWith({ apiKey: 'sk_test_key' });
      expect(CrossmintWallets.from).toHaveBeenCalled();
    });

    it('does not initialize SDK when API key is missing', () => {
      const noKeyConfig = buildConfigService({ 'crossmint.serverApiKey': undefined });
      const svc = new CrossmintService(
        noKeyConfig as any,
        { client: supabaseClient } as any,
        lifecycleManager as any,
      );
      svc.onModuleInit();

      // wallets should remain undefined — SDK was not initialized
      expect((svc as any).wallets).toBeUndefined();
    });
  });

  describe('createWalletForUser', () => {
    it('creates a wallet using SDK and returns locator + address', async () => {
      mockCreateWallet.mockResolvedValue({ address: 'SoLAddr123' });

      const result = await service.createWalletForUser('user-1', 0);

      expect(mockCreateWallet).toHaveBeenCalledWith({
        chain: 'solana',
        signer: { type: 'server', secret: expect.stringContaining('xmsk1_') },
        owner: 'userId:user-1:solana:mpc:0',
      });
      expect(result).toEqual({
        locator: 'userId:user-1:solana:mpc:0',
        address: 'SoLAddr123',
      });
    });

    it('uses custom accountIndex in owner locator', async () => {
      mockCreateWallet.mockResolvedValue({ address: 'SoLAddr456' });

      await service.createWalletForUser('user-2', 42);

      expect(mockCreateWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'userId:user-2:solana:mpc:42',
        }),
      );
    });

    it('throws InternalServerErrorException on SDK failure', async () => {
      mockCreateWallet.mockRejectedValue(new Error('SDK error'));

      await expect(service.createWalletForUser('user-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('getWalletForAccount', () => {
    // Use a valid base58-encoded 32-byte Solana public key for tests
    const VALID_SOL_ADDR = '11111111111111111111111111111111';

    it('returns CrossmintWalletAdapter for valid account', async () => {
      supabaseClient.accountsTable.single.mockResolvedValue({
        data: {
          crossmint_wallet_locator: 'userId:user-1:solana:mpc:0',
          crossmint_wallet_address: VALID_SOL_ADDR,
        },
        error: null,
      });

      mockGetWallet.mockResolvedValue({ address: VALID_SOL_ADDR });

      const adapter = await service.getWalletForAccount('account-uuid');

      expect(mockGetWallet).toHaveBeenCalledWith('userId:user-1:solana:mpc:0', {
        chain: 'solana',
        signer: { type: 'server', secret: expect.stringContaining('xmsk1_') },
      });
      expect(adapter.address).toBe(VALID_SOL_ADDR);
      expect(adapter.publicKey).toBeDefined();
    });

    it('falls back to wallet address when locator is missing', async () => {
      supabaseClient.accountsTable.single.mockResolvedValue({
        data: {
          crossmint_wallet_locator: null,
          crossmint_wallet_address: VALID_SOL_ADDR,
        },
        error: null,
      });

      mockGetWallet.mockResolvedValue({ address: VALID_SOL_ADDR });

      await service.getWalletForAccount('account-uuid');

      expect(mockGetWallet).toHaveBeenCalledWith(VALID_SOL_ADDR, {
        chain: 'solana',
        signer: { type: 'server', secret: expect.stringContaining('xmsk1_') },
      });
    });

    it('throws NotFoundException when account does not exist', async () => {
      supabaseClient.accountsTable.single.mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      });

      await expect(service.getWalletForAccount('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when account has no wallet', async () => {
      supabaseClient.accountsTable.single.mockResolvedValue({
        data: {
          crossmint_wallet_locator: null,
          crossmint_wallet_address: null,
        },
        error: null,
      });

      await expect(service.getWalletForAccount('no-wallet')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws InternalServerErrorException on SDK getWallet failure', async () => {
      supabaseClient.accountsTable.single.mockResolvedValue({
        data: {
          crossmint_wallet_locator: 'userId:u:solana:mpc:0',
          crossmint_wallet_address: 'SoLAddr',
        },
        error: null,
      });

      mockGetWallet.mockRejectedValue(new Error('network error'));

      await expect(service.getWalletForAccount('acc')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('createAccountWithWallet', () => {
    it('creates wallet then inserts account record', async () => {
      mockCreateWallet.mockResolvedValue({ address: 'NewAddr' });

      supabaseClient.accountsTable.single.mockResolvedValue({
        data: {
          id: 'new-account-id',
          name: 'My Account',
          crossmint_wallet_locator: 'userId:owner:solana:mpc:123',
          crossmint_wallet_address: 'NewAddr',
        },
        error: null,
      });

      const result = await service.createAccountWithWallet('ownerPubkey', 'My Account');

      expect(mockCreateWallet).toHaveBeenCalled();
      expect(supabaseClient.from).toHaveBeenCalledWith('accounts');
      expect(result.id).toBe('new-account-id');
      expect(result.crossmint_wallet_address).toBe('NewAddr');
      expect(lifecycleManager.startWorkflowForAccount).toHaveBeenCalledWith('new-account-id');
    });

    it('throws on DB insert failure', async () => {
      mockCreateWallet.mockResolvedValue({ address: 'Addr' });

      supabaseClient.accountsTable.single.mockResolvedValue({
        data: null,
        error: { message: 'duplicate key' },
      });

      await expect(
        service.createAccountWithWallet('owner', 'name'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
