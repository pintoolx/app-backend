import { StrategyCompilerService } from './strategy-compiler.service';
import { type WorkflowDefinition } from '../web3/workflow-types';

const sampleDefinition: WorkflowDefinition = {
  nodes: [
    {
      id: 'price-1',
      name: 'SOL Price Trigger',
      type: 'pythPriceFeed',
      parameters: { ticker: 'SOL', targetPrice: '100', condition: 'above' },
    },
    {
      id: 'guard-1',
      name: 'USDC Balance Guard',
      type: 'getBalance',
      parameters: { token: 'USDC', condition: 'gte', threshold: '1000' },
    },
    {
      id: 'transfer-1',
      name: 'Treasury Settlement',
      type: 'transfer',
      parameters: { token: 'USDC', amount: '500', recipient: 'wallet-1' },
    },
  ],
  connections: {
    'price-1': { main: [[{ node: 'guard-1', type: 'main', index: 0 }]] },
    'guard-1': { main: [[{ node: 'transfer-1', type: 'main', index: 0 }]] },
  },
};

describe('StrategyCompilerService', () => {
  it('classifies the current workflow graph into the strategy migration layers', () => {
    const service = new StrategyCompilerService();

    const compiled = service.compileStrategyIR(sampleDefinition);

    expect(compiled.strategyFormat).toBe('strategy-ir.v1');
    expect(compiled.nodeClassifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'price-1',
          executionPlane: 'offchain_observer',
          role: 'trigger',
        }),
        expect.objectContaining({
          nodeId: 'guard-1',
          executionPlane: 'anchor_candidate',
          role: 'guard',
        }),
        expect.objectContaining({
          nodeId: 'transfer-1',
          executionPlane: 'anchor_candidate',
          role: 'action',
        }),
      ]),
    );
    expect(compiled.publicMetadata.privacyModel).toEqual({
      hidesImplementation: true,
      hidesPrivateBalances: true,
      hidesExecutionLogs: true,
    });
    expect(compiled.deploymentHints).toEqual(
      expect.objectContaining({
        recommendedExecutionLayer: 'per',
        recommendedDelegationLayer: 'er',
        recommendedTreasuryPrivacy: 'private_payments_api',
        optionalBalancePrivacy: 'umbra',
      }),
    );
    expect(compiled.executionRequirements).toEqual(
      expect.objectContaining({
        requiresVault: true,
        requiresAnchorCommit: true,
        requiresEr: true,
        requiresPer: true,
        requiresPrivatePayments: true,
        requiresUmbra: true,
      }),
    );
  });

  it('produces a sanitized public definition that hides sensitive parameters', () => {
    const service = new StrategyCompilerService();

    const compiled = service.compileStrategyIR(sampleDefinition);
    const publicDefinition = compiled.publicDefinition;
    const publicJson = JSON.stringify(publicDefinition);

    expect(publicDefinition.strategyFormat).toBe('public-strategy.v1');
    expect(publicDefinition.nodes).toHaveLength(sampleDefinition.nodes.length);

    // Sensitive parameter values must never appear in the sanitized public definition.
    for (const sensitiveValue of ['1000', '500', '100', 'wallet-1']) {
      expect(publicJson).not.toContain(sensitiveValue);
    }

    // But the sensitive parameter keys must be reported as redacted to the viewer.
    const guardNode = publicDefinition.nodes.find((n) => n.id === 'guard-1');
    expect(guardNode?.redactedParameterKeys).toEqual(
      expect.arrayContaining(['threshold', 'condition']),
    );
    const transferNode = publicDefinition.nodes.find((n) => n.id === 'transfer-1');
    expect(transferNode?.redactedParameterKeys).toEqual(
      expect.arrayContaining(['amount', 'recipient']),
    );
  });

  it('emits stable hashes for public metadata and private definition', () => {
    const service = new StrategyCompilerService();
    const a = service.compileStrategyIR(sampleDefinition);
    const b = service.compileStrategyIR(sampleDefinition);

    expect(a.publicMetadata.publicMetadataHash).toBeTruthy();
    expect(a.publicMetadata.publicMetadataHash).toEqual(b.publicMetadata.publicMetadataHash);
    expect(a.privateDefinition.privateDefinitionCommitment).toEqual(
      b.privateDefinition.privateDefinitionCommitment,
    );
    // Public hash must not equal private commitment.
    expect(a.publicMetadata.publicMetadataHash).not.toEqual(
      a.privateDefinition.privateDefinitionCommitment,
    );
  });

  it('rejects malformed definitions during validation', () => {
    const service = new StrategyCompilerService();

    expect(() =>
      service.validateGraph({
        nodes: [{ id: 'a', name: 'A', type: 'transfer', parameters: {} }],
        connections: {
          a: { main: [[{ node: 'missing', type: 'main', index: 0 }]] },
        },
      } as WorkflowDefinition),
    ).toThrow('Connection target node "missing" is not defined');

    expect(() =>
      service.validateGraph({
        nodes: [
          { id: 'a', name: 'A', type: 'transfer', parameters: {} },
          { id: 'a', name: 'A2', type: 'transfer', parameters: {} },
        ],
        connections: {},
      } as WorkflowDefinition),
    ).toThrow('Duplicate strategy node id: a');
  });
});
