import { StrategiesService } from './strategies.service';
import { StrategyCompilerService } from '../strategy-compiler/strategy-compiler.service';
import { type StrategyRow, type StrategiesRepository } from './strategies.repository';
import { type StrategyVersionsRepository } from './strategy-versions.repository';
import { type WorkflowDefinition } from '../web3/workflow-types';

const definition: WorkflowDefinition = {
  nodes: [
    {
      id: 'guard-1',
      name: 'Balance Guard',
      type: 'getBalance',
      parameters: { token: 'USDC', condition: 'gte', threshold: '1000' },
    },
    {
      id: 'transfer-1',
      name: 'Settlement',
      type: 'transfer',
      parameters: { token: 'USDC', amount: '500', recipient: 'super-secret-wallet' },
    },
  ],
  connections: {
    'guard-1': { main: [[{ node: 'transfer-1', type: 'main', index: 0 }]] },
  },
};

const compiler = new StrategyCompilerService();
const compiled = compiler.compileStrategyIR(definition);

const baseRow: StrategyRow = {
  id: 'strategy-1',
  creator_wallet_address: 'wallet-1',
  source_workflow_id: null,
  name: 'Guarded Strategy',
  description: 'desc',
  visibility_mode: 'public',
  lifecycle_state: 'published',
  current_version: 1,
  public_metadata: compiled.publicMetadata,
  compiled_ir: compiled,
  private_definition_ref: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

const buildVersionsRepoMock = () =>
  ({
    insertVersion: jest.fn().mockResolvedValue({
      id: 'version-row-1',
      strategy_id: baseRow.id,
      version: 2,
      public_metadata_hash: compiled.publicMetadata.publicMetadataHash,
      private_definition_commitment: compiled.privateDefinition.privateDefinitionCommitment,
      compiled_ir: compiled,
      status: 'published',
      published_at: '2026-01-02T00:00:00.000Z',
    }),
    getLatestPublished: jest.fn(),
    getById: jest.fn(),
  }) as unknown as StrategyVersionsRepository;

describe('StrategiesService', () => {
  it('returns only the public view (no private definition, no thresholds) for public discovery', async () => {
    const repository = {
      getStrategyById: jest.fn().mockResolvedValue(baseRow),
    } as unknown as StrategiesRepository;

    const service = new StrategiesService(compiler, repository, buildVersionsRepoMock());
    const result = await service.getPublicStrategy(baseRow.id);
    const resultJson = JSON.stringify(result);

    expect(result.visibilityMode).toBe('public');
    expect(result.publicMetadata.privacyModel.hidesImplementation).toBe(true);
    expect((result as any).privateDefinition).toBeUndefined();
    expect((result as any).compiledIr).toBeUndefined();

    // Sensitive parameter values must never leak through the public surface.
    for (const sensitiveValue of ['1000', '500', 'super-secret-wallet']) {
      expect(resultJson).not.toContain(sensitiveValue);
    }
  });

  it('returns the private compiled IR only to the owner', async () => {
    const repository = {
      getStrategyForCreator: jest.fn().mockResolvedValue(baseRow),
    } as unknown as StrategiesRepository;

    const service = new StrategiesService(compiler, repository, buildVersionsRepoMock());
    const result = await service.getStrategyForOwner(baseRow.id, baseRow.creator_wallet_address);

    expect(result.privateDefinition).toBeDefined();
    expect(result.privateDefinition.privateDefinitionCommitment).toEqual(
      compiled.privateDefinition.privateDefinitionCommitment,
    );
    expect(result.compiledIr.strategyFormat).toBe('strategy-ir.v1');
  });

  it('rejects publish attempts when compiled IR is missing', async () => {
    const repository = {
      getStrategyForCreator: jest.fn().mockResolvedValue({ ...baseRow, compiled_ir: null }),
    } as unknown as StrategiesRepository;

    const service = new StrategiesService(compiler, repository, buildVersionsRepoMock());
    await expect(
      service.publishStrategy(baseRow.id, baseRow.creator_wallet_address),
    ).rejects.toThrow('Strategy compiled IR is missing');
  });

  it('materialises a strategy_versions row when publishing', async () => {
    const updatedRow: StrategyRow = { ...baseRow, current_version: 2 };
    const repository = {
      getStrategyForCreator: jest.fn().mockResolvedValue(baseRow),
      updateStrategy: jest.fn().mockResolvedValue(updatedRow),
    } as unknown as StrategiesRepository;

    const versionsRepo = buildVersionsRepoMock();
    const service = new StrategiesService(compiler, repository, versionsRepo);

    const result = await service.publishStrategy(baseRow.id, baseRow.creator_wallet_address);

    expect(versionsRepo.insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyId: baseRow.id,
        version: baseRow.current_version + 1,
        publicMetadataHash: compiled.publicMetadata.publicMetadataHash,
        privateDefinitionCommitment: compiled.privateDefinition.privateDefinitionCommitment,
      }),
    );
    expect(repository.updateStrategy).toHaveBeenCalledWith(
      baseRow.id,
      baseRow.creator_wallet_address,
      expect.objectContaining({
        visibilityMode: 'public',
        lifecycleState: 'published',
        currentVersion: baseRow.current_version + 1,
      }),
    );
    expect(result.currentVersion).toBe(updatedRow.current_version);
  });
});
