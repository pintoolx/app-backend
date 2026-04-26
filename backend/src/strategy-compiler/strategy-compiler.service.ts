import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  type INodeDescription,
  type WorkflowDefinition,
  type WorkflowNode,
} from '../web3/workflow-types';
import { getRegisteredNodes } from '../web3/nodes/node-registry';

export type StrategyNodeRole = 'trigger' | 'guard' | 'action' | 'query' | 'unknown';

export type StrategyExecutionPlane =
  | 'offchain_observer'
  | 'anchor_candidate'
  | 'hybrid_adapter'
  | 'offchain_runtime';

export type StrategyRiskLevel = 'low' | 'medium' | 'high';

/**
 * Parameter keys that must NEVER be exposed on the public strategy surface.
 * These are the strategy thresholds, allocation rules, and routing knobs
 * referenced in spec §7.2 (Private Data) and §11.1 (Privacy Rules).
 */
export const SENSITIVE_PARAMETER_KEYS = new Set<string>([
  'amount',
  'amounts',
  'condition',
  'maxAllocation',
  'minAllocation',
  'percentage',
  'priceTarget',
  'recipient',
  'recipients',
  'route',
  'slippageBps',
  'slippageTolerance',
  'targetPrice',
  'threshold',
  'thresholds',
  'tolerance',
  'walletAddress',
  'webhookUrl',
]);

export interface SanitizedStrategyNode {
  id: string;
  name: string;
  type: string;
  role: StrategyNodeRole;
  executionPlane: StrategyExecutionPlane;
  protocol: string;
  redactedParameterKeys: string[];
}

export interface PublicStrategyDefinition {
  strategyFormat: 'public-strategy.v1';
  nodes: SanitizedStrategyNode[];
  connectionEdgeCount: number;
}

export interface ExecutionRequirements {
  requiresVault: boolean;
  requiresOffchainTrigger: boolean;
  requiresAnchorCommit: boolean;
  requiresEr: boolean;
  requiresPer: boolean;
  requiresPrivatePayments: boolean;
  requiresUmbra: boolean;
}

export interface StrategyNodeClassification {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  displayName: string;
  role: StrategyNodeRole;
  executionPlane: StrategyExecutionPlane;
  publicExposure: 'metadata_only';
  protocol: string;
  reasons: string[];
}

export interface StrategyPublicMetadata {
  nodeCount: number;
  triggerKinds: string[];
  protocols: string[];
  strategyShape: {
    triggerCount: number;
    guardCount: number;
    actionCount: number;
  };
  executionSurface: {
    offchainObserverCount: number;
    anchorCandidateCount: number;
    hybridAdapterCount: number;
    offchainRuntimeCount: number;
  };
  privacyModel: {
    hidesImplementation: true;
    hidesPrivateBalances: true;
    hidesExecutionLogs: true;
  };
  riskProfile: {
    level: StrategyRiskLevel;
    reasons: string[];
  };
  publicMetadataHash: string;
}

export interface PrivateStrategyDefinition {
  definition: WorkflowDefinition;
  hiddenNodeIds: string[];
  sensitiveParameterKeys: Record<string, string[]>;
  privateDefinitionCommitment: string;
}

export interface CompiledStrategyIR {
  strategyFormat: 'strategy-ir.v1';
  nodeClassifications: StrategyNodeClassification[];
  publicMetadata: StrategyPublicMetadata;
  publicDefinition: PublicStrategyDefinition;
  privateDefinition: PrivateStrategyDefinition;
  executionRequirements: ExecutionRequirements;
  deploymentHints: {
    currentCompatibility: 'workflow_runtime';
    requiresVault: boolean;
    offchainObserverNodeIds: string[];
    anchorCandidateNodeIds: string[];
    hybridAdapterNodeIds: string[];
    recommendedExecutionLayer: 'offchain' | 'per';
    recommendedDelegationLayer: 'not_required' | 'er';
    recommendedTreasuryPrivacy: 'not_required' | 'private_payments_api';
    optionalBalancePrivacy: 'not_required' | 'umbra';
  };
}

const OFFCHAIN_OBSERVER_NODE_TYPES = new Set(['pythPriceFeed', 'heliusWebhook']);
const ANCHOR_CANDIDATE_NODE_TYPES = new Set(['getBalance', 'transfer']);
const HYBRID_ADAPTER_NODE_TYPES = new Set([
  'jupiterSwap',
  'jupiterLimitOrder',
  'kamino',
  'luloLend',
  'stakeSOL',
  'driftPerp',
  'sanctumLst',
]);
const HIGH_RISK_NODE_TYPES = new Set(['driftPerp', 'jupiterLimitOrder']);
const MEDIUM_RISK_NODE_TYPES = new Set([
  'jupiterSwap',
  'kamino',
  'luloLend',
  'stakeSOL',
  'sanctumLst',
  'transfer',
]);

@Injectable()
export class StrategyCompilerService {
  classifyNodes(definition: WorkflowDefinition): StrategyNodeClassification[] {
    return definition.nodes.map((node) => this.classifyNode(node));
  }

  extractPublicMetadata(definition: WorkflowDefinition): StrategyPublicMetadata {
    const classifications = this.classifyNodes(definition);
    const triggerCount = classifications.filter((node) => node.role === 'trigger').length;
    const guardCount = classifications.filter((node) => node.role === 'guard').length;
    const actionCount = classifications.filter((node) => node.role === 'action').length;

    const metadataWithoutHash = {
      nodeCount: classifications.length,
      triggerKinds: this.unique(
        classifications.filter((node) => node.role === 'trigger').map((node) => node.displayName),
      ),
      protocols: this.unique(classifications.map((node) => node.protocol).filter(Boolean)),
      strategyShape: {
        triggerCount,
        guardCount,
        actionCount,
      },
      executionSurface: {
        offchainObserverCount: classifications.filter(
          (node) => node.executionPlane === 'offchain_observer',
        ).length,
        anchorCandidateCount: classifications.filter(
          (node) => node.executionPlane === 'anchor_candidate',
        ).length,
        hybridAdapterCount: classifications.filter(
          (node) => node.executionPlane === 'hybrid_adapter',
        ).length,
        offchainRuntimeCount: classifications.filter(
          (node) => node.executionPlane === 'offchain_runtime',
        ).length,
      },
      privacyModel: {
        hidesImplementation: true as const,
        hidesPrivateBalances: true as const,
        hidesExecutionLogs: true as const,
      },
      riskProfile: this.buildRiskProfile(classifications),
    };

    return {
      ...metadataWithoutHash,
      publicMetadataHash: this.hashStable(metadataWithoutHash),
    };
  }

  /**
   * Build the sanitized "public definition" — node shape only, no parameters.
   * This is the public-safe surface that may be returned to discovery / viewer
   * APIs without leaking thresholds, slippage, recipients, etc.
   */
  buildPublicDefinition(definition: WorkflowDefinition): PublicStrategyDefinition {
    const classifications = this.classifyNodes(definition);
    const sanitizedNodes: SanitizedStrategyNode[] = definition.nodes.map((node) => {
      const classification = classifications.find((c) => c.nodeId === node.id);
      const redactedParameterKeys = Object.keys(node.parameters ?? {}).filter((key) =>
        SENSITIVE_PARAMETER_KEYS.has(key),
      );

      return {
        id: node.id,
        name: node.name,
        type: node.type,
        role: classification?.role ?? 'unknown',
        executionPlane: classification?.executionPlane ?? 'offchain_runtime',
        protocol: classification?.protocol ?? 'Custom',
        redactedParameterKeys,
      };
    });

    const connectionEdgeCount = Object.values(definition.connections ?? {}).reduce(
      (acc, conn) =>
        acc + (conn?.main ?? []).reduce((groupAcc, group) => groupAcc + (group?.length ?? 0), 0),
      0,
    );

    return {
      strategyFormat: 'public-strategy.v1',
      nodes: sanitizedNodes,
      connectionEdgeCount,
    };
  }

  extractPrivateDefinition(definition: WorkflowDefinition): PrivateStrategyDefinition {
    const sensitiveParameterKeys = Object.fromEntries(
      definition.nodes.map((node) => [
        node.id,
        Object.keys(node.parameters ?? {}).filter((key) => SENSITIVE_PARAMETER_KEYS.has(key)),
      ]),
    );

    return {
      definition,
      hiddenNodeIds: definition.nodes.map((node) => node.id),
      sensitiveParameterKeys,
      privateDefinitionCommitment: this.hashStable(definition),
    };
  }

  /**
   * Validate the workflow graph before compilation.
   * Throws Error on invalid structure; callers should map to BadRequest.
   */
  validateGraph(definition: WorkflowDefinition): void {
    if (!definition || !Array.isArray(definition.nodes) || definition.nodes.length === 0) {
      throw new Error('Strategy definition must contain at least one node');
    }

    const nodeIds = new Set<string>();
    for (const node of definition.nodes) {
      if (!node.id || typeof node.id !== 'string') {
        throw new Error('Each strategy node must have a non-empty string id');
      }
      if (nodeIds.has(node.id)) {
        throw new Error(`Duplicate strategy node id: ${node.id}`);
      }
      nodeIds.add(node.id);
    }

    for (const [sourceId, conn] of Object.entries(definition.connections ?? {})) {
      if (!nodeIds.has(sourceId)) {
        throw new Error(`Connection source node "${sourceId}" is not defined`);
      }
      for (const group of conn?.main ?? []) {
        for (const edge of group ?? []) {
          if (!nodeIds.has(edge.node)) {
            throw new Error(`Connection target node "${edge.node}" is not defined`);
          }
        }
      }
    }
  }

  /**
   * Compute the execution requirements that drive deployment-time decisions.
   */
  extractExecutionRequirements(definition: WorkflowDefinition): ExecutionRequirements {
    const classifications = this.classifyNodes(definition);
    const requiresVault = classifications.some((node) => node.role === 'action');
    const requiresAnchorCommit = classifications.some(
      (node) => node.executionPlane === 'anchor_candidate',
    );
    const requiresEr = classifications.some(
      (node) =>
        node.executionPlane === 'anchor_candidate' || node.executionPlane === 'hybrid_adapter',
    );

    return {
      requiresVault,
      requiresOffchainTrigger: classifications.some(
        (node) => node.executionPlane === 'offchain_observer',
      ),
      requiresAnchorCommit,
      requiresEr,
      requiresPer: requiresVault,
      requiresPrivatePayments: requiresVault,
      requiresUmbra: requiresVault,
    };
  }

  compileStrategyIR(definition: WorkflowDefinition): CompiledStrategyIR {
    this.validateGraph(definition);

    const nodeClassifications = this.classifyNodes(definition);
    const offchainObserverNodeIds = nodeClassifications
      .filter((node) => node.executionPlane === 'offchain_observer')
      .map((node) => node.nodeId);
    const anchorCandidateNodeIds = nodeClassifications
      .filter((node) => node.executionPlane === 'anchor_candidate')
      .map((node) => node.nodeId);
    const hybridAdapterNodeIds = nodeClassifications
      .filter((node) => node.executionPlane === 'hybrid_adapter')
      .map((node) => node.nodeId);
    const requirements = this.extractExecutionRequirements(definition);

    return {
      strategyFormat: 'strategy-ir.v1',
      nodeClassifications,
      publicMetadata: this.extractPublicMetadata(definition),
      publicDefinition: this.buildPublicDefinition(definition),
      privateDefinition: this.extractPrivateDefinition(definition),
      executionRequirements: requirements,
      deploymentHints: {
        currentCompatibility: 'workflow_runtime',
        requiresVault: requirements.requiresVault,
        offchainObserverNodeIds,
        anchorCandidateNodeIds,
        hybridAdapterNodeIds,
        recommendedExecutionLayer: requirements.requiresEr ? 'per' : 'offchain',
        recommendedDelegationLayer: requirements.requiresEr ? 'er' : 'not_required',
        recommendedTreasuryPrivacy: requirements.requiresVault
          ? 'private_payments_api'
          : 'not_required',
        optionalBalancePrivacy: requirements.requiresVault ? 'umbra' : 'not_required',
      },
    };
  }

  /**
   * Stable JSON hash used both for public_metadata_hash (commitment to public
   * surface) and for private_definition_commitment (binding to private IR).
   */
  private hashStable(value: unknown): string {
    return createHash('sha256').update(this.stableStringify(value)).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${this.stableStringify(v)}`).join(',')}}`;
  }

  private classifyNode(node: WorkflowNode): StrategyNodeClassification {
    const description = this.getNodeDescription(node.type);
    const role = this.resolveRole(node, description);
    const executionPlane = this.resolveExecutionPlane(node.type);
    const protocol = this.resolveProtocol(node.type, description);

    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      displayName: description?.displayName ?? node.type,
      role,
      executionPlane,
      publicExposure: 'metadata_only',
      protocol,
      reasons: this.buildReasons(node.type, role, executionPlane),
    };
  }

  private getNodeDescription(nodeType: string): INodeDescription | undefined {
    const factory = getRegisteredNodes().get(nodeType);
    return factory?.().description;
  }

  private resolveRole(node: WorkflowNode, description?: INodeDescription): StrategyNodeRole {
    if (description?.isTrigger) {
      return 'trigger';
    }

    if (node.type === 'getBalance') {
      return 'guard';
    }

    if (description?.group.includes('query')) {
      return 'query';
    }

    if (description?.group.length) {
      return 'action';
    }

    return 'unknown';
  }

  private resolveExecutionPlane(nodeType: string): StrategyExecutionPlane {
    if (OFFCHAIN_OBSERVER_NODE_TYPES.has(nodeType)) {
      return 'offchain_observer';
    }

    if (ANCHOR_CANDIDATE_NODE_TYPES.has(nodeType)) {
      return 'anchor_candidate';
    }

    if (HYBRID_ADAPTER_NODE_TYPES.has(nodeType)) {
      return 'hybrid_adapter';
    }

    return 'offchain_runtime';
  }

  private resolveProtocol(nodeType: string, description?: INodeDescription): string {
    const protocolByNodeType: Record<string, string> = {
      pythPriceFeed: 'Pyth',
      heliusWebhook: 'Helius',
      jupiterSwap: 'Jupiter',
      jupiterLimitOrder: 'Jupiter',
      stakeSOL: 'Jupiter',
      kamino: 'Kamino',
      luloLend: 'Lulo',
      driftPerp: 'Drift',
      sanctumLst: 'Sanctum',
      transfer: 'System',
      getBalance: 'System',
    };

    return protocolByNodeType[nodeType] ?? description?.group[0] ?? 'Custom';
  }

  private buildReasons(
    nodeType: string,
    role: StrategyNodeRole,
    executionPlane: StrategyExecutionPlane,
  ): string[] {
    const reasons: string[] = [];

    if (role === 'trigger') {
      reasons.push(
        'Trigger configuration depends on off-chain observation or external webhook delivery.',
      );
    }

    if (executionPlane === 'anchor_candidate') {
      reasons.push('This node maps cleanly to minimal on-chain guard or transfer semantics.');
    }

    if (executionPlane === 'hybrid_adapter') {
      reasons.push(
        'This node still relies on protocol-specific routing and should stay behind a relayer or keeper.',
      );
    }

    if (nodeType === 'getBalance') {
      reasons.push(
        'Balance checks are a good first candidate for authoritative strategy state and guard evaluation.',
      );
    }

    if (nodeType === 'transfer') {
      reasons.push(
        'Transfers fit the initial vault settlement surface described in the strategy migration spec.',
      );
    }

    if (reasons.length === 0) {
      reasons.push('This node remains compatible with the current off-chain workflow runtime.');
    }

    return reasons;
  }

  private buildRiskProfile(classifications: StrategyNodeClassification[]): {
    level: StrategyRiskLevel;
    reasons: string[];
  } {
    const highRiskNodes = classifications.filter((node) => HIGH_RISK_NODE_TYPES.has(node.nodeType));
    if (highRiskNodes.length > 0) {
      return {
        level: 'high',
        reasons: [
          'Uses leveraged or order-book style execution that benefits from tighter private controls.',
        ],
      };
    }

    const mediumRiskNodes = classifications.filter((node) =>
      MEDIUM_RISK_NODE_TYPES.has(node.nodeType),
    );
    if (mediumRiskNodes.length > 0) {
      return {
        level: 'medium',
        reasons: [
          'Moves funds across vault, swap, or protocol adapters and should expose only coarse public summaries.',
        ],
      };
    }

    return {
      level: 'low',
      reasons: ['Mostly observation or simple guard logic with limited direct protocol exposure.'],
    };
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values));
  }
}
