import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { MagicBlockPerRealAdapter } from './magicblock-per-real.adapter';
import { MagicBlockPerClientService } from './magicblock-per-client.service';
import { PerGroupsRepository, type PerGroupRow } from './per-groups.repository';
import { PerAuthTokensRepository, type PerAuthTokenRow } from './per-auth-tokens.repository';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const buildPerClientStub = () =>
  ({
    post: jest.fn(),
    get: jest.fn(),
  }) as unknown as MagicBlockPerClientService & {
    post: jest.Mock;
    get: jest.Mock;
  };

const buildGroupsRepoStub = () =>
  ({
    createGroup: jest.fn(),
    getByDeployment: jest.fn(),
    getByDeploymentOrThrow: jest.fn(),
    replaceMembers: jest.fn(),
    findMembership: jest.fn(),
  }) as unknown as PerGroupsRepository & {
    getByDeployment: jest.Mock;
    findMembership: jest.Mock;
  };

const buildTokensRepoStub = () =>
  ({
    insertChallenge: jest.fn(),
    insertActive: jest.fn(),
    getByToken: jest.fn(),
    getActiveOrThrow: jest.fn(),
    promoteChallenge: jest.fn(),
    revokeToken: jest.fn(),
    revokeAllForDeployment: jest.fn(),
  }) as unknown as PerAuthTokensRepository & {
    insertChallenge: jest.Mock;
    insertActive: jest.Mock;
    getByToken: jest.Mock;
    getActiveOrThrow: jest.Mock;
  };

const config = (env: Record<string, string | undefined>) =>
  ({ get: jest.fn((k: string) => env[k]) }) as unknown as ConfigService;

describe('MagicBlockPerRealAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('createPermissionGroup posts to PER and returns groupId/signature', async () => {
    const client = buildPerClientStub();
    client.post.mockResolvedValue({ groupId: 'g1', signature: 'sig1' });
    const adapter = new MagicBlockPerRealAdapter(
      config({}),
      client,
      buildGroupsRepoStub(),
      buildTokensRepoStub(),
    );
    const res = await adapter.createPermissionGroup({
      deploymentId: 'd1',
      members: [{ wallet: 'w1', role: 'creator' }],
    });
    expect(res).toEqual({ groupId: 'g1', signature: 'sig1' });
    expect(client.post).toHaveBeenCalledWith('/v1/groups', {
      deploymentId: 'd1',
      members: [{ wallet: 'w1', role: 'creator' }],
    });
  });

  it('requestAuthChallenge proxies to TEE /auth/challenge', async () => {
    mockedAxios.get.mockResolvedValue({ data: { challenge: 'tee-challenge-123' } });
    const tokens = buildTokensRepoStub();
    const groups = buildGroupsRepoStub();
    groups.getByDeployment.mockResolvedValue({ group_id: 'g1' } as unknown as PerGroupRow);

    const adapter = new MagicBlockPerRealAdapter(
      config({ MAGICBLOCK_PER_ENDPOINT: 'https://devnet-tee.magicblock.app' }),
      buildPerClientStub(),
      groups,
      tokens,
    );

    const res = await adapter.requestAuthChallenge({ deploymentId: 'd1', walletAddress: 'w1' });
    expect(res.challenge).toBe('tee-challenge-123');
    expect(res.teeUrl).toBe('https://devnet-tee.magicblock.app');
    expect(tokens.insertChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'd1',
        wallet: 'w1',
        groupId: 'g1',
        scopes: ['per:auth-challenge'],
      }),
    );
  });

  it('requestAuthChallenge throws when TEE returns an error', async () => {
    mockedAxios.get.mockResolvedValue({ data: { error: 'pubkey banned' } });
    const adapter = new MagicBlockPerRealAdapter(
      config({ MAGICBLOCK_PER_ENDPOINT: 'https://devnet-tee.magicblock.app' }),
      buildPerClientStub(),
      buildGroupsRepoStub(),
      buildTokensRepoStub(),
    );
    await expect(
      adapter.requestAuthChallenge({ deploymentId: 'd1', walletAddress: 'w1' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('verifyAuthSignature proxies to TEE /auth/login and stores the token', async () => {
    const tokens = buildTokensRepoStub();
    const groups = buildGroupsRepoStub();

    tokens.getByToken.mockResolvedValue({
      token: 'tee-challenge-123',
      deployment_id: 'd1',
      wallet: 'w1',
      group_id: 'g1',
      status: 'challenge',
      scopes: [],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    } as PerAuthTokenRow);
    groups.findMembership.mockResolvedValue({ wallet: 'w1', role: 'creator' });
    mockedAxios.post.mockResolvedValue({
      data: { token: 'tee-token-abc', expiresAt: '2026-01-01T00:00:00Z' },
    });

    const adapter = new MagicBlockPerRealAdapter(
      config({ MAGICBLOCK_PER_ENDPOINT: 'https://devnet-tee.magicblock.app' }),
      buildPerClientStub(),
      groups,
      tokens,
    );

    const res = await adapter.verifyAuthSignature({
      deploymentId: 'd1',
      walletAddress: 'w1',
      challenge: 'tee-challenge-123',
      signature: 'sig123',
    });

    expect(res.authToken).toBe('tee-token-abc');
    expect(res.expiresAt).toBe('2026-01-01T00:00:00Z');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://devnet-tee.magicblock.app/auth/login',
      {
        pubkey: 'w1',
        challenge: 'tee-challenge-123',
        signature: 'sig123',
      },
      expect.any(Object),
    );
    expect(tokens.insertActive).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'tee-token-abc',
        deploymentId: 'd1',
        wallet: 'w1',
        scopes: ['per:private-state'],
      }),
    );
  });

  it('verifyAuthSignature rejects when TEE login fails', async () => {
    const tokens = buildTokensRepoStub();
    const groups = buildGroupsRepoStub();

    tokens.getByToken.mockResolvedValue({
      token: 'c1',
      deployment_id: 'd1',
      wallet: 'w1',
      group_id: 'g1',
      status: 'challenge',
      scopes: [],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    } as PerAuthTokenRow);
    groups.findMembership.mockResolvedValue({ wallet: 'w1', role: 'creator' });
    mockedAxios.post.mockRejectedValue(new Error('network'));

    const adapter = new MagicBlockPerRealAdapter(
      config({ MAGICBLOCK_PER_ENDPOINT: 'https://devnet-tee.magicblock.app' }),
      buildPerClientStub(),
      groups,
      tokens,
    );

    await expect(
      adapter.verifyAuthSignature({
        deploymentId: 'd1',
        walletAddress: 'w1',
        challenge: 'c1',
        signature: 'sig',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('getPrivateState returns state when token is active and bound to deployment', async () => {
    const tokens = buildTokensRepoStub();
    tokens.getActiveOrThrow.mockResolvedValue({
      token: 't1',
      deployment_id: 'd1',
      wallet: 'w1',
      group_id: 'g1',
      status: 'active',
      scopes: [],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    } as PerAuthTokenRow);
    const client = buildPerClientStub();
    client.get.mockResolvedValue({ state: { foo: 'bar' }, logs: [] });
    const adapter = new MagicBlockPerRealAdapter(
      config({}),
      client,
      buildGroupsRepoStub(),
      tokens,
    );
    const res = await adapter.getPrivateState({ deploymentId: 'd1', authToken: 't1' });
    expect(res.state).toEqual({ foo: 'bar' });
    expect(res.logs).toEqual([]);
  });

  it('getPrivateState rejects token bound to a different deployment', async () => {
    const tokens = buildTokensRepoStub();
    tokens.getActiveOrThrow.mockResolvedValue({
      token: 't1',
      deployment_id: 'd2',
      wallet: 'w1',
      group_id: 'g1',
      status: 'active',
      scopes: [],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    } as PerAuthTokenRow);
    const adapter = new MagicBlockPerRealAdapter(
      config({}),
      buildPerClientStub(),
      buildGroupsRepoStub(),
      tokens,
    );
    await expect(adapter.getPrivateState({ deploymentId: 'd1', authToken: 't1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
