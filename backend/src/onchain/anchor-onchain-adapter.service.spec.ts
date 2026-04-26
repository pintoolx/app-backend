import { Keypair, PublicKey } from '@solana/web3.js';
import { AnchorOnchainAdapterService } from './anchor-onchain-adapter.service';
import { AnchorClientService } from './anchor-client.service';

const PROGRAM_ID = new PublicKey('FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF');
const DEPLOYMENT_UUID = '11111111-2222-3333-4444-555555555555';
const STRATEGY_UUID = '99999999-8888-7777-6666-aaaaaaaaaaaa';
const HASH_HEX = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

interface MethodCall {
  name: string;
  args: unknown[];
  accounts: Record<string, unknown> | null;
}

function makeProgramStub() {
  const calls: MethodCall[] = [];
  const sequence: Array<'ok' | 'already-exists' | 'fail'> = [];

  const builder =
    (name: string) =>
    (...args: unknown[]) => {
      const call: MethodCall = { name, args, accounts: null };
      const chain = {
        accountsPartial(accounts: Record<string, unknown>) {
          call.accounts = accounts;
          return chain;
        },
        async rpc() {
          calls.push(call);
          const policy = sequence.shift() ?? 'ok';
          if (policy === 'already-exists') {
            throw new Error('Account already in use');
          }
          if (policy === 'fail') {
            throw new Error('forced failure');
          }
          return `sig-${calls.length}`;
        },
      };
      return chain;
    };

  return {
    calls,
    setSequence: (seq: Array<'ok' | 'already-exists' | 'fail'>) => sequence.push(...seq),
    methods: {
      initializeStrategyVersion: builder('initializeStrategyVersion'),
      initializeDeployment: builder('initializeDeployment'),
      initializeVaultAuthority: builder('initializeVaultAuthority'),
      initializeStrategyState: builder('initializeStrategyState'),
      setLifecycleStatus: builder('setLifecycleStatus'),
      commitState: builder('commitState'),
      setPublicSnapshot: builder('setPublicSnapshot'),
      closeDeployment: builder('closeDeployment'),
    },
  };
}

function makeClientStub() {
  const wallet = { publicKey: Keypair.generate().publicKey };
  const program = makeProgramStub();
  const client = {
    getProgramId: jest.fn().mockReturnValue(PROGRAM_ID),
    getProgram: jest.fn().mockResolvedValue(program),
    getProvider: jest.fn().mockResolvedValue({ wallet }),
  } as unknown as AnchorClientService;
  return { client, program };
}

describe('AnchorOnchainAdapterService', () => {
  it('initializeDeployment runs the 4-ix bootstrap and returns PDAs', async () => {
    const { client, program } = makeClientStub();
    const service = new AnchorOnchainAdapterService(client);

    const result = await service.initializeDeployment({
      deploymentId: DEPLOYMENT_UUID,
      strategyId: STRATEGY_UUID,
      strategyVersion: 1,
      creatorWallet: 'wallet-1',
      vaultOwnerHint: 'account-1',
      publicMetadataHash: HASH_HEX,
      privateDefinitionCommitment: HASH_HEX,
      executionMode: 'offchain',
    });

    expect(result.deploymentAccount).toEqual(expect.any(String));
    expect(result.vaultAuthorityAccount).toEqual(expect.any(String));
    expect(result.strategyStateAccount).toEqual(expect.any(String));
    expect(result.publicSnapshotAccount).toEqual(expect.any(String));
    expect(result.signature).toBeDefined();

    const order = program.calls.map((c) => c.name);
    expect(order).toEqual([
      'initializeStrategyVersion',
      'initializeDeployment',
      'initializeVaultAuthority',
      'initializeStrategyState',
      'setLifecycleStatus',
    ]);

    // setLifecycleStatus must transition to deployed (code 1).
    const setLifecycleCall = program.calls.find((c) => c.name === 'setLifecycleStatus');
    expect(setLifecycleCall?.args[0]).toBe(1);
  });

  it('initializeDeployment skips strategy version when already registered', async () => {
    const { client, program } = makeClientStub();
    const service = new AnchorOnchainAdapterService(client);
    program.setSequence(['already-exists']);

    await service.initializeDeployment({
      deploymentId: DEPLOYMENT_UUID,
      strategyId: STRATEGY_UUID,
      strategyVersion: 2,
      creatorWallet: 'wallet-1',
      vaultOwnerHint: null,
      publicMetadataHash: HASH_HEX,
      privateDefinitionCommitment: HASH_HEX,
      executionMode: 'offchain',
    });

    // Initial strategy version call should still be recorded but did not
    // abort the rest of the bootstrap.
    expect(program.calls.length).toBe(5);
    const order = program.calls.map((c) => c.name);
    expect(order[0]).toBe('initializeStrategyVersion');
    expect(order[order.length - 1]).toBe('setLifecycleStatus');
  });

  it('commitState forwards expected revision and returns next revision', async () => {
    const { client, program } = makeClientStub();
    const service = new AnchorOnchainAdapterService(client);

    const out = await service.commitState({
      deploymentId: DEPLOYMENT_UUID,
      expectedRevision: 7,
      newPrivateStateCommitment: HASH_HEX,
      lastResultCode: 200,
    });

    expect(out.newStateRevision).toBe(8);
    expect(out.signature).toEqual(expect.any(String));
    expect(program.calls).toHaveLength(1);
    expect(program.calls[0].name).toBe('commitState');
    expect(program.calls[0].args[0]).toBe(7);
    expect(program.calls[0].args[2]).toBe(200);
  });

  it('setPublicSnapshot maps risk band and status strings to codes', async () => {
    const { client, program } = makeClientStub();
    const service = new AnchorOnchainAdapterService(client);

    const out = await service.setPublicSnapshot({
      deploymentId: DEPLOYMENT_UUID,
      expectedSnapshotRevision: 5,
      status: 'paused',
      pnlSummaryBps: -42,
      riskBand: 'medium',
      publicMetricsHash: HASH_HEX,
    });

    expect(out.signature).toEqual(expect.any(String));
    expect(out.newStateRevision).toBe(5);

    const call = program.calls[0];
    expect(call.name).toBe('setPublicSnapshot');
    expect(call.args[0]).toBe(5); // expected revision
    expect(call.args[1]).toBe(1); // paused = 1
    expect(call.args[2]).toBe(2); // risk medium = 2
    expect(call.args[3]).toBe(-42);
  });

  it('setLifecycleStatus accepts each lifecycle code', async () => {
    const { client, program } = makeClientStub();
    const service = new AnchorOnchainAdapterService(client);

    await service.setLifecycleStatus({ deploymentId: DEPLOYMENT_UUID, newStatus: 'paused' });
    await service.setLifecycleStatus({ deploymentId: DEPLOYMENT_UUID, newStatus: 'deployed' });
    await service.setLifecycleStatus({ deploymentId: DEPLOYMENT_UUID, newStatus: 'stopped' });
    await service.setLifecycleStatus({ deploymentId: DEPLOYMENT_UUID, newStatus: 'closed' });

    expect(program.calls.map((c) => c.args[0])).toEqual([2, 1, 3, 4]);
  });

  it('closeDeployment submits close ix and returns signature', async () => {
    const { client, program } = makeClientStub();
    const service = new AnchorOnchainAdapterService(client);

    const out = await service.closeDeployment({ deploymentId: DEPLOYMENT_UUID });

    expect(out.signature).toEqual(expect.any(String));
    expect(program.calls).toHaveLength(1);
    expect(program.calls[0].name).toBe('closeDeployment');
  });

  it('surfaces RPC failures as InternalServerError', async () => {
    const { client, program } = makeClientStub();
    const service = new AnchorOnchainAdapterService(client);
    program.setSequence(['fail']);

    await expect(
      service.commitState({
        deploymentId: DEPLOYMENT_UUID,
        expectedRevision: 0,
        newPrivateStateCommitment: HASH_HEX,
        lastResultCode: 0,
      }),
    ).rejects.toThrow(/onchain commitState failed/);
  });
});
