import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import * as nacl from 'tweetnacl';
import { MagicBlockPerRealAdapter } from './magicblock-per-real.adapter';
import { MagicBlockPerClientService } from './magicblock-per-client.service';
import { PerGroupsRepository, type PerGroupRow } from './per-groups.repository';
import { PerAuthTokensRepository, type PerAuthTokenRow } from './per-auth-tokens.repository';

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
    getByToken: jest.Mock;
    getActiveOrThrow: jest.Mock;
    promoteChallenge: jest.Mock;
  };

const config = (env: Record<string, string | undefined>) =>
  ({ get: jest.fn((k: string) => env[k]) }) as unknown as ConfigService;

describe('MagicBlockPerRealAdapter', () => {
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

  it('requestAuthChallenge persists a challenge token row and returns the nonce', async () => {
    const tokens = buildTokensRepoStub();
    const groups = buildGroupsRepoStub();
    groups.getByDeployment.mockResolvedValue({ group_id: 'g1' } as unknown as PerGroupRow);
    const adapter = new MagicBlockPerRealAdapter(config({}), buildPerClientStub(), groups, tokens);
    const res = await adapter.requestAuthChallenge({ deploymentId: 'd1', walletAddress: 'w1' });
    expect(res.challenge).toBeTruthy();
    expect(typeof res.expiresAt).toBe('string');
    expect(tokens.insertChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'd1',
        wallet: 'w1',
        groupId: 'g1',
        scopes: ['per:auth-challenge'],
      }),
    );
  });

  it('verifyAuthSignature promotes the challenge after a valid signature', async () => {
    const tokens = buildTokensRepoStub();
    const groups = buildGroupsRepoStub();

    const wallet = Keypair.generate();
    const walletAddress = wallet.publicKey.toBase58();

    // Generate a 32-byte challenge nonce, base58-encode and sign
    const nonce = nacl.randomBytes(32);
    const challenge = bs58.encode(nonce);
    const sig = nacl.sign.detached(nonce, wallet.secretKey);
    const signature = bs58.encode(sig);

    tokens.getByToken.mockResolvedValue({
      token: challenge,
      deployment_id: 'd1',
      wallet: walletAddress,
      group_id: 'g1',
      status: 'challenge',
      scopes: [],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    } as PerAuthTokenRow);
    groups.findMembership.mockResolvedValue({ wallet: walletAddress, role: 'creator' });
    tokens.promoteChallenge.mockResolvedValue({
      token: challenge,
      deployment_id: 'd1',
      wallet: walletAddress,
      group_id: 'g1',
      status: 'active',
      scopes: [],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    } as PerAuthTokenRow);

    const adapter = new MagicBlockPerRealAdapter(config({}), buildPerClientStub(), groups, tokens);

    const res = await adapter.verifyAuthSignature({
      deploymentId: 'd1',
      walletAddress,
      challenge,
      signature,
    });
    expect(res.authToken).toBe(challenge);
    expect(typeof res.expiresAt).toBe('string');
  });

  it('verifyAuthSignature rejects an invalid signature', async () => {
    const tokens = buildTokensRepoStub();
    const groups = buildGroupsRepoStub();
    const wallet = Keypair.generate();
    const walletAddress = wallet.publicKey.toBase58();
    const nonce = nacl.randomBytes(32);
    const challenge = bs58.encode(nonce);

    tokens.getByToken.mockResolvedValue({
      token: challenge,
      deployment_id: 'd1',
      wallet: walletAddress,
      group_id: 'g1',
      status: 'challenge',
      scopes: [],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    } as PerAuthTokenRow);

    const adapter = new MagicBlockPerRealAdapter(config({}), buildPerClientStub(), groups, tokens);

    const otherKp = Keypair.generate();
    const sig = nacl.sign.detached(nacl.randomBytes(32), otherKp.secretKey);
    await expect(
      adapter.verifyAuthSignature({
        deploymentId: 'd1',
        walletAddress,
        challenge,
        signature: bs58.encode(sig),
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('verifyAuthSignature rejects when wallet is not a member', async () => {
    const tokens = buildTokensRepoStub();
    const groups = buildGroupsRepoStub();
    const wallet = Keypair.generate();
    const walletAddress = wallet.publicKey.toBase58();
    const nonce = nacl.randomBytes(32);
    const challenge = bs58.encode(nonce);
    const signature = bs58.encode(nacl.sign.detached(nonce, wallet.secretKey));

    tokens.getByToken.mockResolvedValue({
      token: challenge,
      deployment_id: 'd1',
      wallet: walletAddress,
      group_id: 'g1',
      status: 'challenge',
      scopes: [],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    } as PerAuthTokenRow);
    groups.findMembership.mockResolvedValue(null);

    const adapter = new MagicBlockPerRealAdapter(config({}), buildPerClientStub(), groups, tokens);
    await expect(
      adapter.verifyAuthSignature({
        deploymentId: 'd1',
        walletAddress,
        challenge,
        signature,
      }),
    ).rejects.toThrow('not a member');
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
    const adapter = new MagicBlockPerRealAdapter(config({}), client, buildGroupsRepoStub(), tokens);
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
