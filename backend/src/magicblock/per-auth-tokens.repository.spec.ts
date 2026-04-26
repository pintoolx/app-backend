import { UnauthorizedException } from '@nestjs/common';
import { PerAuthTokensRepository, type PerAuthTokenRow } from './per-auth-tokens.repository';
import type { SupabaseService } from '../database/supabase.service';

const buildSupabaseClientStub = (
  responses: Partial<Record<'insert' | 'select' | 'update', { data: unknown; error: unknown }>>,
) => {
  const lastChain: { data: unknown; error: unknown } = { data: null, error: null };
  const chain = {
    insert: jest.fn(() => {
      Object.assign(lastChain, responses.insert ?? { data: null, error: null });
      return chain;
    }),
    select: jest.fn(() => {
      if (responses.select && !responses.insert && !responses.update) {
        Object.assign(lastChain, responses.select);
      }
      return chain;
    }),
    update: jest.fn(() => {
      Object.assign(lastChain, responses.update ?? { data: null, error: null });
      return chain;
    }),
    eq: jest.fn(() => chain),
    neq: jest.fn(() => chain),
    single: jest.fn(async () => lastChain),
    maybeSingle: jest.fn(async () => lastChain),
  };
  const client = { from: jest.fn(() => chain) };
  return { client };
};

const activeRow: PerAuthTokenRow = {
  token: 'tok',
  deployment_id: 'd1',
  wallet: 'w1',
  group_id: 'g1',
  status: 'active',
  scopes: ['per:read'],
  issued_at: '2026-01-01T00:00:00.000Z',
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  revoked_at: null,
};

const expiredRow: PerAuthTokenRow = {
  ...activeRow,
  expires_at: '2000-01-01T00:00:00.000Z',
};

const revokedRow: PerAuthTokenRow = {
  ...activeRow,
  status: 'revoked',
  revoked_at: '2026-01-01T01:00:00.000Z',
};

describe('PerAuthTokensRepository', () => {
  it('insertChallenge persists with status=challenge', async () => {
    const { client } = buildSupabaseClientStub({
      insert: { data: { ...activeRow, status: 'challenge' }, error: null },
    });
    const repo = new PerAuthTokensRepository({ client } as unknown as SupabaseService);
    const res = await repo.insertChallenge({
      token: 'tok',
      deploymentId: 'd1',
      wallet: 'w1',
      groupId: 'g1',
      expiresAt: activeRow.expires_at,
      scopes: ['per:auth-challenge'],
    });
    expect(res.status).toBe('challenge');
  });

  it('getActiveOrThrow returns row when active and not expired', async () => {
    const { client } = buildSupabaseClientStub({ select: { data: activeRow, error: null } });
    const repo = new PerAuthTokensRepository({ client } as unknown as SupabaseService);
    const res = await repo.getActiveOrThrow('tok');
    expect(res).toEqual(activeRow);
  });

  it('getActiveOrThrow throws when expired', async () => {
    const { client } = buildSupabaseClientStub({ select: { data: expiredRow, error: null } });
    const repo = new PerAuthTokensRepository({ client } as unknown as SupabaseService);
    await expect(repo.getActiveOrThrow('tok')).rejects.toThrow(UnauthorizedException);
  });

  it('getActiveOrThrow throws when revoked', async () => {
    const { client } = buildSupabaseClientStub({ select: { data: revokedRow, error: null } });
    const repo = new PerAuthTokensRepository({ client } as unknown as SupabaseService);
    await expect(repo.getActiveOrThrow('tok')).rejects.toThrow(/revoked/i);
  });

  it('getActiveOrThrow throws when missing', async () => {
    const { client } = buildSupabaseClientStub({ select: { data: null, error: null } });
    const repo = new PerAuthTokensRepository({ client } as unknown as SupabaseService);
    await expect(repo.getActiveOrThrow('tok')).rejects.toThrow(/not found/i);
  });

  it('promoteChallenge fails if no row updated (already used)', async () => {
    const { client } = buildSupabaseClientStub({
      update: { data: null, error: { message: 'no rows' } },
    });
    const repo = new PerAuthTokensRepository({ client } as unknown as SupabaseService);
    await expect(
      repo.promoteChallenge('tok', new Date(Date.now() + 60_000).toISOString()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('promoteChallenge returns the new active row on success', async () => {
    const { client } = buildSupabaseClientStub({
      update: { data: activeRow, error: null },
    });
    const repo = new PerAuthTokensRepository({ client } as unknown as SupabaseService);
    const res = await repo.promoteChallenge('tok', activeRow.expires_at);
    expect(res.status).toBe('active');
  });
});
