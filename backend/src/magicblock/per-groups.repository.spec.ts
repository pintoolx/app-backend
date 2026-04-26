import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PerGroupsRepository, type PerGroupRow } from './per-groups.repository';
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
    single: jest.fn(async () => lastChain),
    maybeSingle: jest.fn(async () => lastChain),
  };
  const client = {
    from: jest.fn(() => chain),
  };
  return { client, chain };
};

const groupRow: PerGroupRow = {
  id: 'g-uuid',
  deployment_id: 'd1',
  group_id: 'per-test',
  creator_wallet: 'creator',
  members: [{ wallet: 'creator', role: 'creator' }],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('PerGroupsRepository', () => {
  it('createGroup inserts and returns the new row', async () => {
    const { client } = buildSupabaseClientStub({ insert: { data: groupRow, error: null } });
    const repo = new PerGroupsRepository({ client } as unknown as SupabaseService);
    const res = await repo.createGroup({
      deploymentId: 'd1',
      groupId: 'per-test',
      creatorWallet: 'creator',
      members: [{ wallet: 'creator', role: 'creator' }],
    });
    expect(res).toEqual(groupRow);
  });

  it('getByDeploymentOrThrow throws NotFoundException when missing', async () => {
    const { client } = buildSupabaseClientStub({ select: { data: null, error: null } });
    const repo = new PerGroupsRepository({ client } as unknown as SupabaseService);
    await expect(repo.getByDeploymentOrThrow('d1')).rejects.toThrow(NotFoundException);
  });

  it('replaceMembers throws ForbiddenException when requester is not the creator', async () => {
    // First call: getByDeployment returns the row (treated as a select)
    // Then update would happen but we expect early throw before that.
    const { client } = buildSupabaseClientStub({ select: { data: groupRow, error: null } });
    const repo = new PerGroupsRepository({ client } as unknown as SupabaseService);
    await expect(
      repo.replaceMembers('d1', 'someone-else', [{ wallet: 'x', role: 'viewer' }]),
    ).rejects.toThrow(ForbiddenException);
  });

  it('findMembership filters out expired memberships', async () => {
    const expiredRow: PerGroupRow = {
      ...groupRow,
      members: [
        { wallet: 'creator', role: 'creator' },
        { wallet: 'expired', role: 'viewer', expiresAt: '2000-01-01T00:00:00.000Z' },
      ],
    };
    const { client } = buildSupabaseClientStub({ select: { data: expiredRow, error: null } });
    const repo = new PerGroupsRepository({ client } as unknown as SupabaseService);
    const member = await repo.findMembership('d1', 'expired');
    expect(member).toBeNull();
  });

  it('findMembership returns the member when found', async () => {
    const { client } = buildSupabaseClientStub({ select: { data: groupRow, error: null } });
    const repo = new PerGroupsRepository({ client } as unknown as SupabaseService);
    const member = await repo.findMembership('d1', 'creator');
    expect(member).toEqual({ wallet: 'creator', role: 'creator' });
  });
});
