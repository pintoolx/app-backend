import { InternalServerErrorException } from '@nestjs/common';
import { AuthService } from './auth.service';

const buildSupabaseClient = (rows: any[] = []) => {
  const authTable: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ data: rows, error: null }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    delete: jest.fn((options?: any) => {
      if (options?.count) {
        return {
          lt: jest.fn().mockResolvedValue({ error: null, count: 0 }),
        };
      }
      return {
        eq: jest.fn().mockResolvedValue({}),
      };
    }),
  };

  const usersTable = {
    upsert: jest.fn().mockResolvedValue({ error: null }),
  };

  const from = jest.fn((table: string) => {
    if (table === 'auth_challenges') return authTable;
    if (table === 'users') return usersTable;
    return {};
  });

  return { from, authTable, usersTable };
};

describe('AuthService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('generates and stores challenge', async () => {
    const { from, authTable } = buildSupabaseClient();
    const service = new AuthService({ client: { from } } as any);
    const challenge = await service.generateChallenge('wallet-1');

    expect(challenge).toContain('wallet-1');
    expect(authTable.upsert).toHaveBeenCalled();
  });

  it('throws when challenge storage fails', async () => {
    const { from, authTable } = buildSupabaseClient();
    authTable.upsert.mockResolvedValue({ error: new Error('fail') });
    const service = new AuthService({ client: { from } } as any);

    await expect(service.generateChallenge('wallet-1')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('returns false when no challenge found', async () => {
    const { from } = buildSupabaseClient([]);
    const service = new AuthService({ client: { from } } as any);

    const result = await service.verifyAndConsumeChallenge('wallet-1', 'sig');

    expect(result).toBe(false);
  });

  it('returns false when challenge expired and deletes it', async () => {
    const expired = {
      challenge: 'msg',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };
    const { from } = buildSupabaseClient([expired]);
    const service = new AuthService({ client: { from } } as any);
    const deleteSpy = jest.spyOn(service as any, 'deleteChallenge').mockResolvedValue(undefined);

    const result = await service.verifyAndConsumeChallenge('wallet-1', 'sig');

    expect(result).toBe(false);
    expect(deleteSpy).toHaveBeenCalledWith('wallet-1');
  });

  it('returns true when signature valid and consumes challenge', async () => {
    const valid = {
      challenge: 'msg',
      expires_at: new Date(Date.now() + 1000).toISOString(),
    };
    const { from } = buildSupabaseClient([valid]);
    const service = new AuthService({ client: { from } } as any);
    jest.spyOn(service as any, 'verifyWalletSignature').mockReturnValue(true);
    const deleteSpy = jest.spyOn(service as any, 'deleteChallenge').mockResolvedValue(undefined);
    const createSpy = jest.spyOn(service as any, 'createOrUpdateUser').mockResolvedValue(undefined);

    const result = await service.verifyAndConsumeChallenge(' wallet-1 ', 'sig');

    expect(result).toBe(true);
    expect(createSpy).toHaveBeenCalledWith('wallet-1');
    expect(deleteSpy).toHaveBeenCalledWith(' wallet-1 ');
  });

  it('returns false when signature invalid', async () => {
    const valid = {
      challenge: 'msg',
      expires_at: new Date(Date.now() + 1000).toISOString(),
    };
    const { from } = buildSupabaseClient([valid]);
    const service = new AuthService({ client: { from } } as any);
    jest.spyOn(service as any, 'verifyWalletSignature').mockReturnValue(false);
    const deleteSpy = jest.spyOn(service as any, 'deleteChallenge').mockResolvedValue(undefined);

    const result = await service.verifyAndConsumeChallenge('wallet-1', 'sig');

    expect(result).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
