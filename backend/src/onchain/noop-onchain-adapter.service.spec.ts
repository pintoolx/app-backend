import { NoopOnchainAdapter } from './noop-onchain-adapter.service';

describe('NoopOnchainAdapter', () => {
  const adapter = new NoopOnchainAdapter();

  it('returns null accounts and signature on initializeDeployment', async () => {
    const result = await adapter.initializeDeployment({
      deploymentId: 'd1',
      strategyId: 's1',
      strategyVersion: 1,
      creatorWallet: 'wallet-1',
      vaultOwnerHint: null,
      publicMetadataHash: 'hash-public',
      privateDefinitionCommitment: 'hash-private',
      executionMode: 'offchain',
    });
    expect(result).toEqual({
      deploymentAccount: null,
      vaultAuthorityAccount: null,
      strategyStateAccount: null,
      publicSnapshotAccount: null,
      signature: null,
    });
  });

  it('returns monotonic revision on commitState and setPublicSnapshot', async () => {
    const c = await adapter.commitState({
      deploymentId: 'd1',
      expectedRevision: 3,
      newPrivateStateCommitment: 'priv',
      lastResultCode: 0,
    });
    expect(c.newStateRevision).toBe(4);

    const s = await adapter.setPublicSnapshot({
      deploymentId: 'd1',
      expectedSnapshotRevision: 5,
      status: 'ok',
      pnlSummaryBps: null,
      riskBand: 'low',
      publicMetricsHash: 'mh',
    });
    expect(s.newStateRevision).toBe(6);
  });

  it('returns null signatures on setLifecycleStatus and closeDeployment', async () => {
    expect(await adapter.setLifecycleStatus({ deploymentId: 'd1', newStatus: 'paused' })).toEqual({
      signature: null,
    });
    expect(await adapter.closeDeployment({ deploymentId: 'd1' })).toEqual({
      signature: null,
    });
  });
});
