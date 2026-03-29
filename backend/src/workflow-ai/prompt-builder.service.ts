import { Injectable } from '@nestjs/common';
import { getRegisteredNodes } from '../web3/nodes/node-registry';
import { INodeDescription, INodeProperty } from '../web3/workflow-types';

interface NodeCatalogEntry {
  typeName: string;
  displayName: string;
  description: string;
  isTrigger: boolean;
  inputs: string[];
  outputs: string[];
  properties: INodeProperty[];
}

@Injectable()
export class PromptBuilderService {
  private cachedSystemPrompt: string | null = null;
  private nodeCatalog: NodeCatalogEntry[] = [];

  /**
   * Build the node catalog by iterating over all registered nodes
   */
  buildCatalog(): NodeCatalogEntry[] {
    const registry = getRegisteredNodes();
    this.nodeCatalog = [];

    for (const [typeName, factory] of registry.entries()) {
      const nodeInstance = factory();
      const desc: INodeDescription = nodeInstance.description;

      this.nodeCatalog.push({
        typeName,
        displayName: desc.displayName,
        description: desc.description,
        isTrigger: desc.isTrigger ?? false,
        inputs: desc.inputs,
        outputs: desc.outputs,
        properties: desc.properties,
      });
    }

    // Invalidate cached prompt when catalog is rebuilt
    this.cachedSystemPrompt = null;

    return this.nodeCatalog;
  }

  /**
   * Format a single property for the catalog text
   */
  private formatProperty(prop: INodeProperty): string {
    let propText = `      - ${prop.name} (${prop.type})`;
    if (prop.default !== undefined && prop.default !== '') {
      propText += ` [default: ${JSON.stringify(prop.default)}]`;
    }
    propText += `\n        Description: ${prop.description}`;

    if (prop.type === 'options' && prop.options && prop.options.length > 0) {
      const optionsList = prop.options.map((o) => `"${o.value}"`).join(', ');
      propText += `\n        Options: ${optionsList}`;
    }

    return propText;
  }

  /**
   * Build the node catalog text for the system prompt
   */
  private buildCatalogText(): string {
    if (this.nodeCatalog.length === 0) {
      this.buildCatalog();
    }

    const lines: string[] = ['## Available Node Types\n'];

    for (const node of this.nodeCatalog) {
      lines.push(`### ${node.typeName}`);
      lines.push(`- Display Name: ${node.displayName}`);
      lines.push(`- Description: ${node.description}`);
      lines.push(`- Is Trigger: ${node.isTrigger}`);
      lines.push(`- Inputs: [${node.inputs.join(', ')}]`);
      lines.push(`- Outputs: [${node.outputs.join(', ')}]`);

      if (node.properties.length > 0) {
        lines.push('- Parameters:');
        for (const prop of node.properties) {
          lines.push(this.formatProperty(prop));
        }
      } else {
        lines.push('- Parameters: None');
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get the full system prompt including role, catalog, schema, rules, and instructions
   */
  getSystemPrompt(): string {
    if (this.cachedSystemPrompt) {
      return this.cachedSystemPrompt;
    }

    const catalogText = this.buildCatalogText();

    const systemPrompt = `# Role

You are a Solana DeFi workflow builder assistant. You help users create automated workflows by understanding their requirements and generating valid workflow definitions.

# Node Catalog

${catalogText}

# WorkflowDefinition JSON Schema

A WorkflowDefinition has:
- nodes: Array of WorkflowNode objects, each with:
  - id (string): A unique identifier for the node (e.g., "node_1", "price_trigger", "swap_usdc_sol")
  - name (string): A human-readable display name for the node
  - type (string): Must be one of the registered node types listed in the catalog above
  - parameters (object): An object containing parameter values matching the node's property schema
  - position (optional [x, y] tuple): Optional position coordinates for visual layout

- connections: Object keyed by source node ID. Each value has a "main" property which is a 2D array of NodeConnection objects. Each NodeConnection has:
  - node (string): The target node ID that this connection points to
  - type (string): Connection type, always "main"
  - index (number): 0-based output index from the source node

Example structure:
\`\`\`json
{
  "nodes": [
    {
      "id": "trigger_1",
      "name": "Price Monitor",
      "type": "pythPriceFeed",
      "parameters": {
        "ticker": "SOL",
        "targetPrice": "150",
        "condition": "above"
      }
    },
    {
      "id": "swap_1",
      "name": "Swap SOL to USDC",
      "type": "jupiterSwap",
      "parameters": {
        "accountId": "user_account",
        "inputToken": "SOL",
        "outputToken": "USDC",
        "amount": "1",
        "slippageBps": "50"
      }
    }
  ],
  "connections": {
    "trigger_1": {
      "main": [[{ "node": "swap_1", "type": "main", "index": 0 }]]
    }
  }
}
\`\`\`

# Rules

You MUST follow these rules when generating workflow definitions:

1. **Only use registered node types**: Every node's \`type\` field must exactly match one of the node type names listed in the catalog (e.g., "pythPriceFeed", "jupiterSwap", "transfer").

2. **Valid connection references**: All connection source keys must reference existing node IDs. All connection target \`node\` values must reference existing node IDs in the workflow.

3. **Trigger node placement**: Trigger nodes (where isTrigger=true in the catalog) must be start nodes with no incoming connections from other nodes.

4. **Single trigger limit**: At most one trigger node is allowed per workflow.

5. **Parameter type matching**: Parameter values must match the expected types from the catalog:
   - "string" type: Use string values
   - "number" type: Use numeric values
   - "boolean" type: Use true or false
   - "options" type: Use one of the allowed option values listed

6. **Unique node IDs**: Each node must have a unique \`id\` within the workflow. Use descriptive IDs like "price_trigger", "swap_step", "transfer_out".

7. **Complete parameters**: Include all required parameters for each node. Refer to the default values in the catalog when appropriate.

# Instructions

Follow this conversation flow when helping users:

1. **Understand requirements**: First, discuss the user's requirements and ask clarifying questions to fully understand what they want to automate. Questions might include:
   - What should trigger the workflow?
   - Which tokens are involved?
   - What account/wallet should be used?
   - Are there specific price targets or conditions?

2. **Generate the workflow**: When you have enough information, generate the complete WorkflowDefinition JSON inside a \`\`\`json code block. Ensure the JSON is valid and follows all the rules above.

3. **Explain the workflow**: After the JSON, provide a brief summary explaining:
   - What the workflow does step by step
   - How the nodes connect together
   - Any important parameters or conditions

4. **Handle modifications**: If the user wants changes, regenerate the full JSON with the requested modifications. Always output the complete workflow definition, not partial updates.
`;

    this.cachedSystemPrompt = systemPrompt;
    return this.cachedSystemPrompt;
  }

  /**
   * Get the list of available node types (useful for validation)
   */
  getAvailableNodeTypes(): string[] {
    if (this.nodeCatalog.length === 0) {
      this.buildCatalog();
    }
    return this.nodeCatalog.map((n) => n.typeName);
  }

  /**
   * Get catalog entry for a specific node type
   */
  getNodeCatalogEntry(typeName: string): NodeCatalogEntry | undefined {
    if (this.nodeCatalog.length === 0) {
      this.buildCatalog();
    }
    return this.nodeCatalog.find((n) => n.typeName === typeName);
  }

  /**
   * Invalidate the cached system prompt (call when nodes are updated)
   */
  invalidateCache(): void {
    this.cachedSystemPrompt = null;
    this.nodeCatalog = [];
  }
}
