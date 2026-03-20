import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ReferralService } from './referral.service';

const buildSupabaseMock = () => {
  const usersSingle = jest.fn();
  const usersEq = jest.fn(() => ({ single: usersSingle }));
  const usersSelect = jest.fn(() => ({ eq: usersEq }));
  const usersUpsert = jest.fn().mockResolvedValue({ error: null });

  const quotasSingle = jest.fn();
  const quotasSelect = jest.fn(() => ({ single: quotasSingle }));
  const quotasUpsert = jest.fn(() => ({ select: quotasSelect }));

  const referralInsertSelect = jest.fn();
  const referralInsert = jest.fn(() => ({ select: referralInsertSelect }));
  const referralMaybeSingle = jest.fn();
  const referralEq = jest.fn(() => ({ maybeSingle: referralMaybeSingle }));
  const referralSelect = jest.fn(() => ({ eq: referralEq }));
  const referralUpdateSingle = jest.fn();
  const referralUpdateSelect = jest.fn(() => ({ single: referralUpdateSingle }));
  const referralUpdateEq = jest.fn(() => ({ select: referralUpdateSelect }));
  const referralUpdate = jest.fn(() => ({ eq: referralUpdateEq }));

  const from = jest.fn((table: string) => {
    if (table === 'users') {
      return {
        upsert: usersUpsert,
        select: usersSelect,
      };
    }

    if (table === 'referral_user_quotas') {
      return {
        upsert: quotasUpsert,
      };
    }

    if (table === 'referral_codes') {
      return {
        insert: referralInsert,
        select: referralSelect,
        update: referralUpdate,
      };
    }

    return {};
  });

  const rpc = jest.fn();

  return {
    client: { from, rpc },
    mocks: {
      usersSingle,
      usersUpsert,
      quotasSingle,
      referralInsertSelect,
      referralMaybeSingle,
      referralUpdateSingle,
      rpc,
    },
  };
};

const validRow = {
  id: 'id-1',
  code: 'REF-ABC12345',
  created_by_wallet: 'admin-wallet',
  created_for_wallet: 'target-wallet',
  source_type: 'admin',
  status: 'active',
  max_uses: 1,
  used_count: 0,
  used_by_wallet: null,
  used_at: null,
  expires_at: null,
  metadata: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('ReferralService', () => {
  const authService = {
    verifyAndConsumeChallenge: jest.fn(),
  };
  const generator = {
    generate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets quota when admin signature and role are valid', async () => {
    const { client, mocks } = buildSupabaseMock();
    const service = new ReferralService(authService as any, { client } as any, generator as any);

    authService.verifyAndConsumeChallenge.mockResolvedValue(true);
    mocks.usersSingle.mockResolvedValue({ data: { app_role: 'admin' }, error: null });
    mocks.quotasSingle.mockResolvedValue({
      data: {
        wallet_address: 'target-wallet',
        max_codes: 20,
        issued_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });

    const result = await service.setUserQuota('admin-wallet', 'sig', 'target-wallet', 20);

    expect(result.max_codes).toBe(20);
  });

  it('rejects user generation when quota reserve fails', async () => {
    const { client, mocks } = buildSupabaseMock();
    const service = new ReferralService(authService as any, { client } as any, generator as any);

    authService.verifyAndConsumeChallenge.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(
      service.userGenerateCodes({
        walletAddress: 'user-wallet',
        signature: 'sig',
        count: 2,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('releases quota when insert fails after reserve', async () => {
    const { client, mocks } = buildSupabaseMock();
    const service = new ReferralService(authService as any, { client } as any, generator as any);

    authService.verifyAndConsumeChallenge.mockResolvedValue(true);
    generator.generate.mockResolvedValue(['REF-AAA11111']);
    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.referralInsertSelect.mockResolvedValue({
      data: null,
      error: { code: '99999', message: 'insert failed' },
    });

    await expect(
      service.userGenerateCodes({
        walletAddress: 'user-wallet',
        signature: 'sig',
        count: 1,
      }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'release_referral_quota', {
      p_wallet: 'user-wallet',
      p_count: 1,
    });
  });

  it('returns redeemed row when consume_referral_code succeeds', async () => {
    const { client, mocks } = buildSupabaseMock();
    const service = new ReferralService(authService as any, { client } as any, generator as any);

    authService.verifyAndConsumeChallenge.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({
      data: [{ ...validRow, status: 'used', used_count: 1 }],
      error: null,
    });

    const result = await service.redeemCode('target-wallet', 'sig', 'ref-abc12345');

    expect(result.status).toBe('used');
    expect(mocks.rpc).toHaveBeenCalledWith('consume_referral_code', {
      p_code: 'REF-ABC12345',
      p_wallet: 'target-wallet',
    });
  });

  it('throws bad request when code cannot be redeemed', async () => {
    const { client, mocks } = buildSupabaseMock();
    const service = new ReferralService(authService as any, { client } as any, generator as any);

    authService.verifyAndConsumeChallenge.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.referralMaybeSingle.mockResolvedValue({
      data: {
        code: 'REF-ABC12345',
        status: 'used',
        used_count: 1,
        max_uses: 1,
        expires_at: null,
        created_for_wallet: 'target-wallet',
      },
      error: null,
    });

    await expect(service.redeemCode('target-wallet', 'sig', 'REF-ABC12345')).rejects.toThrow(
      BadRequestException,
    );
  });
});
