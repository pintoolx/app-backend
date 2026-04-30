import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Connection, Transaction } from '@solana/web3.js';
import { FundIntentSubmissionService } from './fund-intent-submission.service';
import { StrategySubscriptionsRepository } from './subscriptions.repository';
import { ConfigService } from '@nestjs/config';

jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      sendRawTransaction: jest.fn(),
      confirmTransaction: jest.fn(),
    })),
    Transaction: {
      from: jest.fn().mockReturnValue({
        instructions: [{ programId: { toBase58: () => '11111111111111111111111111111111' } }],
        serialize: jest.fn().mockReturnValue(Buffer.from('serialized')),
      }),
    },
  };
});

describe('FundIntentSubmissionService', () => {
  let service: FundIntentSubmissionService;
  let subscriptionsRepository: jest.Mocked<Partial<StrategySubscriptionsRepository>>;
  let configService: jest.Mocked<Partial<ConfigService>>;

  beforeEach(async () => {
    subscriptionsRepository = {
      getById: jest.fn(),
    };

    configService = {
      get: jest.fn().mockReturnValue('https://api.devnet.solana.com'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FundIntentSubmissionService,
        { provide: StrategySubscriptionsRepository, useValue: subscriptionsRepository },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<FundIntentSubmissionService>(FundIntentSubmissionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('submits a signed transaction and returns signature', async () => {
    const mockSub = {
      id: 'sub-123',
      deployment_id: 'dep-123',
      follower_wallet: '0xabc',
      vault_authority_pda: 'vault-auth-123',
    };
    subscriptionsRepository.getById!.mockResolvedValue(mockSub as any);

    (Connection as jest.Mock).mockImplementation(() => ({
      sendRawTransaction: jest.fn().mockResolvedValue('sig-123'),
      confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
    }));

    const result = await service.submitFundIntent(
      'dep-123',
      'sub-123',
      '0xabc',
      'BASE64TX==',
    );

    expect(result.signature).toBe('sig-123');
    expect(result.confirmed).toBe(true);
    expect(result.vaultAuthorityPda).toBe('vault-auth-123');
  });

  it('throws when subscription not found', async () => {
    subscriptionsRepository.getById!.mockResolvedValue(null as any);

    await expect(
      service.submitFundIntent('dep-123', 'sub-123', '0xabc', 'BASE64TX=='),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when wallet does not own subscription', async () => {
    const mockSub = {
      id: 'sub-123',
      deployment_id: 'dep-123',
      follower_wallet: '0xother',
      vault_authority_pda: 'vault-auth-123',
    };
    subscriptionsRepository.getById!.mockResolvedValue(mockSub as any);

    await expect(
      service.submitFundIntent('dep-123', 'sub-123', '0xabc', 'BASE64TX=='),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when vault authority PDA is missing', async () => {
    const mockSub = {
      id: 'sub-123',
      deployment_id: 'dep-123',
      follower_wallet: '0xabc',
      vault_authority_pda: null,
    };
    subscriptionsRepository.getById!.mockResolvedValue(mockSub as any);

    await expect(
      service.submitFundIntent('dep-123', 'sub-123', '0xabc', 'BASE64TX=='),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns confirmed=false when transaction fails on-chain', async () => {
    const mockSub = {
      id: 'sub-123',
      deployment_id: 'dep-123',
      follower_wallet: '0xabc',
      vault_authority_pda: 'vault-auth-123',
    };
    subscriptionsRepository.getById!.mockResolvedValue(mockSub as any);

    (Connection as jest.Mock).mockImplementation(() => ({
      sendRawTransaction: jest.fn().mockResolvedValue('sig-fail'),
      confirmTransaction: jest.fn().mockResolvedValue({
        value: { err: 'SomeError' },
      }),
    }));

    const result = await service.submitFundIntent(
      'dep-123',
      'sub-123',
      '0xabc',
      'BASE64TX==',
    );

    expect(result.signature).toBe('sig-fail');
    expect(result.confirmed).toBe(false);
  });

  it('returns confirmed=false when confirmation times out', async () => {
    const mockSub = {
      id: 'sub-123',
      deployment_id: 'dep-123',
      follower_wallet: '0xabc',
      vault_authority_pda: 'vault-auth-123',
    };
    subscriptionsRepository.getById!.mockResolvedValue(mockSub as any);

    (Connection as jest.Mock).mockImplementation(() => ({
      sendRawTransaction: jest.fn().mockResolvedValue('sig-timeout'),
      confirmTransaction: jest.fn().mockRejectedValue(new Error('timeout')),
    }));

    const result = await service.submitFundIntent(
      'dep-123',
      'sub-123',
      '0xabc',
      'BASE64TX==',
    );

    expect(result.signature).toBe('sig-timeout');
    expect(result.confirmed).toBe(false);
  });

  it('throws on invalid base64 transaction', async () => {
    // Restore real Transaction.from for this test
    const { Transaction: RealTx } = jest.requireActual('@solana/web3.js');
    (Transaction as any).from = RealTx.from;

    const mockSub = {
      id: 'sub-123',
      deployment_id: 'dep-123',
      follower_wallet: '0xabc',
      vault_authority_pda: 'vault-auth-123',
    };
    subscriptionsRepository.getById!.mockResolvedValue(mockSub as any);

    await expect(
      service.submitFundIntent('dep-123', 'sub-123', '0xabc', '!!!invalid!!!'),
    ).rejects.toThrow(BadRequestException);

    // Re-mock for subsequent tests
    (Transaction as any).from = jest.fn().mockReturnValue({
      instructions: [{ programId: { toBase58: () => '11111111111111111111111111111111' } }],
      serialize: jest.fn().mockReturnValue(Buffer.from('serialized')),
    });
  });
});
