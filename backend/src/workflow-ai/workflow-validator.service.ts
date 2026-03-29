import { Injectable } from '@nestjs/common';
import { getRegisteredNodes } from '../web3/nodes/node-registry';
import {
  WorkflowDefinition,
  WorkflowNode,
  INodeDescription,
  INodeProperty,
} from '../web3/workflow-types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

@Injectable()
export class WorkflowValidatorService {
  /**
   * Validate a WorkflowDefinition
   * Returns all errors found (doesn't short-circuit on first error)
   */
  validate(definition: WorkflowDefinition): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const registry = getRegisteredNodes();

    // Build a map of node descriptions for validation
    const nodeDescriptions = new Map<string, INodeDescription>();
    for (const [typeName, factory] of registry.entries()) {
      const instance = factory();
      nodeDescriptions.set(typeName, instance.description);
    }

    // 1. Required fields validation
    this.validateRequiredFields(definition.nodes, errors);

    // 2. Unique IDs validation
    const nodeIds = this.validateUniqueIds(definition.nodes, errors);

    // 3. Node type check
    this.validateNodeTypes(definition.nodes, registry, errors);

    // 4. Parameter validation
    this.validateParameters(definition.nodes, nodeDescriptions, errors, warnings);

    // 5. Connection integrity
    this.validateConnections(definition, nodeIds, errors);

    // 6. DAG check (cycle detection)
    this.validateNoCycles(definition, nodeIds, errors);

    // 7. Trigger rules
    this.validateTriggerRules(definition, nodeDescriptions, nodeIds, errors);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 1. Validate required fields: id, name, type must be non-empty strings
   */
  private validateRequiredFields(nodes: WorkflowNode[], errors: string[]): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const nodeRef = `Node at index ${i}`;

      if (!node.id || typeof node.id !== 'string' || node.id.trim() === '') {
        errors.push(`${nodeRef}: Missing or invalid 'id' (must be a non-empty string)`);
      }

      if (!node.name || typeof node.name !== 'string' || node.name.trim() === '') {
        errors.push(
          `${node.id ? `Node "${node.id}"` : nodeRef}: Missing or invalid 'name' (must be a non-empty string)`,
        );
      }

      if (!node.type || typeof node.type !== 'string' || node.type.trim() === '') {
        errors.push(
          `${node.id ? `Node "${node.id}"` : nodeRef}: Missing or invalid 'type' (must be a non-empty string)`,
        );
      }
    }
  }

  /**
   * 2. Validate unique IDs
   */
  private validateUniqueIds(nodes: WorkflowNode[], errors: string[]): Set<string> {
    const nodeIds = new Set<string>();
    const duplicates = new Set<string>();

    for (const node of nodes) {
      if (node.id) {
        if (nodeIds.has(node.id)) {
          duplicates.add(node.id);
        }
        nodeIds.add(node.id);
      }
    }

    for (const duplicateId of duplicates) {
      errors.push(`Duplicate node ID: "${duplicateId}"`);
    }

    return nodeIds;
  }

  /**
   * 3. Validate node types exist in registry
   */
  private validateNodeTypes(
    nodes: WorkflowNode[],
    registry: Map<string, () => any>,
    errors: string[],
  ): void {
    const registeredTypes = Array.from(registry.keys());

    for (const node of nodes) {
      if (node.type && !registry.has(node.type)) {
        errors.push(
          `Node "${node.id}": Unknown node type "${node.type}". Available types: ${registeredTypes.join(', ')}`,
        );
      }
    }
  }

  /**
   * 4. Validate parameters against node description properties
   */
  private validateParameters(
    nodes: WorkflowNode[],
    nodeDescriptions: Map<string, INodeDescription>,
    errors: string[],
    warnings: string[],
  ): void {
    for (const node of nodes) {
      const desc = nodeDescriptions.get(node.type);
      if (!desc) {
        // Type validation already handles this
        continue;
      }

      const propertyMap = new Map<string, INodeProperty>();
      for (const prop of desc.properties) {
        propertyMap.set(prop.name, prop);
      }

      const params = node.parameters || {};

      // Check for unrecognized parameters (warning only)
      for (const paramKey of Object.keys(params)) {
        if (!propertyMap.has(paramKey)) {
          warnings.push(
            `Node "${node.id}": Unknown parameter "${paramKey}" (not defined in node schema)`,
          );
        }
      }

      // Check parameter type compatibility
      for (const [paramName, paramValue] of Object.entries(params)) {
        const propDef = propertyMap.get(paramName);
        if (!propDef) {
          continue; // Already warned above
        }

        this.validateParameterType(node.id, paramName, paramValue, propDef, errors);
      }
    }
  }

  /**
   * Validate a single parameter's type compatibility
   */
  private validateParameterType(
    nodeId: string,
    paramName: string,
    paramValue: any,
    propDef: INodeProperty,
    errors: string[],
  ): void {
    if (paramValue === null || paramValue === undefined) {
      // Missing optional parameters are OK
      return;
    }

    switch (propDef.type) {
      case 'number':
        if (typeof paramValue !== 'number' && isNaN(Number(paramValue))) {
          errors.push(
            `Node "${nodeId}": Parameter "${paramName}" should be a number, got ${typeof paramValue}`,
          );
        }
        break;

      case 'boolean':
        if (typeof paramValue !== 'boolean' && paramValue !== 'true' && paramValue !== 'false') {
          errors.push(
            `Node "${nodeId}": Parameter "${paramName}" should be a boolean, got ${typeof paramValue}`,
          );
        }
        break;

      case 'string':
        // Strings can accept most values (they get converted)
        if (typeof paramValue !== 'string' && typeof paramValue !== 'number') {
          errors.push(
            `Node "${nodeId}": Parameter "${paramName}" should be a string, got ${typeof paramValue}`,
          );
        }
        break;

      case 'options':
        if (propDef.options && propDef.options.length > 0) {
          const validValues = propDef.options.map((o) => o.value);
          if (!validValues.includes(paramValue)) {
            errors.push(
              `Node "${nodeId}": Parameter "${paramName}" has invalid value "${paramValue}". Must be one of: ${validValues.map((v) => `"${v}"`).join(', ')}`,
            );
          }
        }
        break;
    }
  }

  /**
   * 5. Validate connection integrity
   */
  private validateConnections(
    definition: WorkflowDefinition,
    nodeIds: Set<string>,
    errors: string[],
  ): void {
    const connections = definition.connections || {};

    for (const [sourceNodeId, connectionData] of Object.entries(connections)) {
      // Check source node exists
      if (!nodeIds.has(sourceNodeId)) {
        errors.push(`Connection source "${sourceNodeId}" does not reference a valid node ID`);
        continue;
      }

      if (!connectionData.main || !Array.isArray(connectionData.main)) {
        errors.push(`Connection from "${sourceNodeId}": Invalid format, missing "main" array`);
        continue;
      }

      // Check each connection target
      for (let outputIdx = 0; outputIdx < connectionData.main.length; outputIdx++) {
        const outputConnections = connectionData.main[outputIdx];
        if (!Array.isArray(outputConnections)) {
          continue;
        }

        for (let connIdx = 0; connIdx < outputConnections.length; connIdx++) {
          const conn = outputConnections[connIdx];
          if (!conn.node) {
            errors.push(
              `Connection from "${sourceNodeId}"[${outputIdx}][${connIdx}]: Missing target node`,
            );
          } else if (!nodeIds.has(conn.node)) {
            errors.push(
              `Connection from "${sourceNodeId}" to "${conn.node}": Target node does not exist`,
            );
          }
        }
      }
    }
  }

  /**
   * 6. DAG check - detect cycles using DFS
   */
  private validateNoCycles(
    definition: WorkflowDefinition,
    nodeIds: Set<string>,
    errors: string[],
  ): void {
    // Build adjacency list
    const adjacencyList = new Map<string, string[]>();
    for (const nodeId of nodeIds) {
      adjacencyList.set(nodeId, []);
    }

    const connections = definition.connections || {};
    for (const [sourceNodeId, connectionData] of Object.entries(connections)) {
      if (!connectionData.main || !adjacencyList.has(sourceNodeId)) {
        continue;
      }

      for (const outputConnections of connectionData.main) {
        if (!Array.isArray(outputConnections)) continue;
        for (const conn of outputConnections) {
          if (conn.node && adjacencyList.has(conn.node)) {
            adjacencyList.get(sourceNodeId)!.push(conn.node);
          }
        }
      }
    }

    // DFS cycle detection
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cyclePath: string[] = [];

    const hasCycle = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      cyclePath.push(nodeId);

      const neighbors = adjacencyList.get(nodeId) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) {
            return true;
          }
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle
          cyclePath.push(neighbor);
          return true;
        }
      }

      cyclePath.pop();
      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of nodeIds) {
      if (!visited.has(nodeId)) {
        cyclePath.length = 0;
        if (hasCycle(nodeId)) {
          // Find the start of the cycle in the path
          const cycleStart = cyclePath[cyclePath.length - 1];
          const cycleStartIdx = cyclePath.indexOf(cycleStart);
          const cycleNodes = cyclePath.slice(cycleStartIdx);
          errors.push(`Workflow contains a cycle: ${cycleNodes.join(' -> ')}`);
          break; // Report first cycle found
        }
      }
    }
  }

  /**
   * 7. Validate trigger rules
   */
  private validateTriggerRules(
    definition: WorkflowDefinition,
    nodeDescriptions: Map<string, INodeDescription>,
    nodeIds: Set<string>,
    errors: string[],
  ): void {
    // Find trigger nodes
    const triggerNodes: WorkflowNode[] = [];

    for (const node of definition.nodes) {
      const desc = nodeDescriptions.get(node.type);
      if (desc?.isTrigger) {
        triggerNodes.push(node);
      }
    }

    // At most one trigger node allowed
    if (triggerNodes.length > 1) {
      const triggerIds = triggerNodes.map((n) => n.id).join(', ');
      errors.push(
        `Workflow has ${triggerNodes.length} trigger nodes (${triggerIds}), but at most 1 is allowed`,
      );
    }

    // Trigger nodes must not have incoming connections
    const nodesWithIncoming = this.getNodesWithIncomingConnections(definition);

    for (const triggerNode of triggerNodes) {
      if (nodesWithIncoming.has(triggerNode.id)) {
        errors.push(
          `Trigger node "${triggerNode.id}" has incoming connections, but trigger nodes must be start nodes`,
        );
      }
    }
  }

  /**
   * Get set of node IDs that have incoming connections
   */
  private getNodesWithIncomingConnections(definition: WorkflowDefinition): Set<string> {
    const nodesWithIncoming = new Set<string>();
    const connections = definition.connections || {};

    for (const connectionData of Object.values(connections)) {
      if (!connectionData.main) continue;

      for (const outputConnections of connectionData.main) {
        if (!Array.isArray(outputConnections)) continue;
        for (const conn of outputConnections) {
          if (conn.node) {
            nodesWithIncoming.add(conn.node);
          }
        }
      }
    }

    return nodesWithIncoming;
  }
}
