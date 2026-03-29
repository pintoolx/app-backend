# Development Guide

<cite>
**Referenced Files in This Document**
- [package.json](file://package.json)
- [tsconfig.json](file://tsconfig.json)
- [.eslintrc.js](file://.eslintrc.js)
- [.prettierrc](file://.prettierrc)
- [nest-cli.json](file://nest-cli.json)
- [README.md](file://README.md)
- [SKILL.md](file://SKILL.md)
- [scripts/generate-node-docs.ts](file://scripts/generate-node-docs.ts)
- [scripts/full_system_test.ts](file://scripts/full_system_test.ts)
- [scripts/verify_api.ts](file://scripts/verify_api.ts)
- [src/web3/nodes/node-registry.ts](file://src/web3/nodes/node-registry.ts)
- [src/web3/workflow-types.ts](file://src/web3/workflow-types.ts)
- [src/web3/nodes/swap.node.ts](file://src/web3/nodes/swap.node.ts)
- [src/web3/nodes/transfer.node.ts](file://src/web3/nodes/transfer.node.ts)
- [src/web3/nodes/balance.node.ts](file://src/web3/nodes/balance.node.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This development guide provides a comprehensive overview of setting up the development environment, adhering to coding standards, and executing testing strategies for the backend service. It explains the development workflow using npm scripts, TypeScript configuration, ESLint and Prettier formatting, and the testing approach with unit, integration, and end-to-end tests. It also documents the codebase structure conventions, naming patterns, and architectural guidelines for extending the system, including adding new workflow nodes and integrating new DeFi protocols. Practical examples demonstrate running tests, generating documentation, and performing system verification. Finally, it covers debugging techniques, development server configuration, hot reload capabilities, continuous integration patterns, code quality checks, and contribution guidelines.

## Project Structure
The backend is a NestJS application written in TypeScript. The repository follows a feature-based structure with clear separation of concerns:
- src/ contains the application modules (agent, auth, crossmint, workflows, telegram, web3, database, common, config)
- scripts/ contains development and verification utilities
- supabase/ contains database migration files
- docs/ contains generated documentation (e.g., NODES_REFERENCE.md)

```mermaid
graph TB
A["Root"] --> B["src/"]
A --> C["scripts/"]
A --> D["supabase/"]
A --> E["docs/"]
B --> B1["agent/"]
B --> B2["auth/"]
B --> B3["crossmint/"]
B --> B4["workflows/"]
B --> B5["telegram/"]
B --> B6["web3/"]
B --> B7["database/"]
B --> B8["common/"]
B --> B9["config/"]
B6 --> B6a["nodes/"]
B6 --> B6b["services/"]
B6 --> B6c["types/"]
B6 --> B6d["utils/"]
C --> C1["generate-node-docs.ts"]
C --> C2["full_system_test.ts"]
C --> C3["verify_api.ts"]
```

**Diagram sources**
- [README.md:27-54](file://README.md#L27-L54)
- [src/web3/nodes/node-registry.ts:1-47](file://src/web3/nodes/node-registry.ts#L1-L47)

**Section sources**
- [README.md:27-54](file://README.md#L27-L54)

## Core Components
This section outlines the essential development tools and configurations used across the project.

- npm scripts
  - Build: nest build
  - Format: prettier --write "src/**/*.ts"
  - Start: nest start
  - Dev/watch: nest start --watch
  - Debug: nest start --debug --watch
  - Production: node dist/main
  - Lint: eslint "{src,apps,libs,test}/**/*.ts" --fix
  - Docs generation: ts-node -P tsconfig.json scripts/generate-node-docs.ts
  - Unit tests: jest
  - Watch tests: jest --watch
  - Coverage: jest --coverage
  - Debug tests: node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInWorker
  - E2E tests: jest --config ./test/jest-e2e.json

- TypeScript configuration
  - Target ES2021, source maps enabled, strictNullChecks disabled, skipLibCheck enabled
  - Path aliases configured for modular imports (@auth, @workflows, @telegram, @web3, @database, @common, @config)

- ESLint configuration
  - Uses @typescript-eslint parser and recommended rules
  - Extends plugin:prettier/recommended
  - Ignores database functions and linter config file
  - Rules tuned for developer productivity (e.g., no explicit-any, unused-vars warning with underscore ignore)

- Prettier configuration
  - Single quote, trailing comma, tab width 2, semicolons, print width 100, arrow parens always

- Nest CLI configuration
  - Source root set to src
  - Compiler options enable webpack and deleteOutDir

**Section sources**
- [package.json:8-22](file://package.json#L8-L22)
- [package.json:77-93](file://package.json#L77-L93)
- [tsconfig.json:1-55](file://tsconfig.json#L1-L55)
- [.eslintrc.js:1-29](file://.eslintrc.js#L1-L29)
- [.prettierrc:1-9](file://.prettierrc#L1-L9)
- [nest-cli.json:1-9](file://nest-cli.json#L1-L9)

## Architecture Overview
The backend is structured around NestJS modules and a Web3 workflow engine. The Web3 subsystem organizes DeFi operations as “nodes” that form Directed Acyclic Graphs (DAGs) in workflows. The node registry centralizes node registration and discovery. Services encapsulate Solana interactions, while controllers expose REST endpoints.

```mermaid
graph TB
subgraph "REST API Layer"
CTRL_AUTH["auth.controller.ts"]
CTRL_AGENT["agent.controller.ts"]
CTRL_CROSSMINT["crossmint.controller.ts"]
CTRL_WORKFLOWS["workflows.controller.ts"]
CTRL_ROOT["root.controller.ts"]
end
subgraph "Services"
SVC_AUTH["auth.service.ts"]
SVC_AGENT["agent.service.ts"]
SVC_CROSSMINT["crossmint.service.ts"]
SVC_WORKFLOWS["workflows.service.ts"]
SVC_LIFECYCLE["workflow-lifecycle.service.ts"]
SVC_WEB3["web3 services (e.g., agent-kit.service.ts)"]
end
subgraph "Web3 Engine"
REG["node-registry.ts"]
TYPES["workflow-types.ts"]
NODES["nodes/*.node.ts"]
end
CTRL_AUTH --> SVC_AUTH
CTRL_AGENT --> SVC_AGENT
CTRL_CROSSMINT --> SVC_CROSSMINT
CTRL_WORKFLOWS --> SVC_WORKFLOWS
SVC_WORKFLOWS --> SVC_LIFECYCLE
SVC_LIFECYCLE --> SVC_WEB3
SVC_WEB3 --> REG
REG --> NODES
NODES --> TYPES
```

**Diagram sources**
- [src/web3/nodes/node-registry.ts:1-47](file://src/web3/nodes/node-registry.ts#L1-L47)
- [src/web3/workflow-types.ts:1-91](file://src/web3/workflow-types.ts#L1-L91)

## Detailed Component Analysis

### Web3 Node System and Workflow Types
The Web3 subsystem defines a node abstraction with a standardized description and execution interface. Nodes declare inputs/outputs, groups, and parameters. The registry aggregates all nodes and exposes them for discovery and execution.

```mermaid
classDiagram
class INodeType {
+description : INodeDescription
+execute(context) : Promise<NodeExecutionData[][]>
}
class INodeDescription {
+displayName : string
+name : string
+group : string[]
+version : number
+description : string
+inputs : string[]
+outputs : string[]
+telegramNotify : boolean
+isTrigger : boolean
+properties : INodeProperty[]
}
class IExecuteContext {
+getNodeParameter(name, itemIndex, defaultValue?) : any
+getInputData(inputIndex?) : NodeExecutionData[]
+getWorkflowStaticData(type) : any
+helpers.returnJsonArray(jsonData[]) : NodeExecutionData[][]
+abortSignal? : AbortSignal
}
class NodeExecutionData {
+json : Record<string, any>
+binary? : Record<string, any>
}
class SwapNode {
+description : INodeDescription
+execute(context) : Promise<NodeExecutionData[][]>
}
class TransferNode {
+description : INodeDescription
+execute(context) : Promise<NodeExecutionData[][]>
}
class BalanceNode {
+description : INodeDescription
+execute(context) : Promise<NodeExecutionData[][]>
}
INodeType <|.. SwapNode
INodeType <|.. TransferNode
INodeType <|.. BalanceNode
IExecuteContext --> NodeExecutionData : "produces"
```

**Diagram sources**
- [src/web3/workflow-types.ts:12-56](file://src/web3/workflow-types.ts#L12-L56)
- [src/web3/nodes/swap.node.ts:49-100](file://src/web3/nodes/swap.node.ts#L49-L100)
- [src/web3/nodes/transfer.node.ts:15-58](file://src/web3/nodes/transfer.node.ts#L15-L58)
- [src/web3/nodes/balance.node.ts:15-66](file://src/web3/nodes/balance.node.ts#L15-L66)

**Section sources**
- [src/web3/workflow-types.ts:12-91](file://src/web3/workflow-types.ts#L12-L91)
- [src/web3/nodes/swap.node.ts:49-209](file://src/web3/nodes/swap.node.ts#L49-L209)
- [src/web3/nodes/transfer.node.ts:15-199](file://src/web3/nodes/transfer.node.ts#L15-L199)
- [src/web3/nodes/balance.node.ts:15-196](file://src/web3/nodes/balance.node.ts#L15-L196)

### Node Registration and Discovery
The node registry centralizes node registration and exposes a map of node types to factories. This enables dynamic discovery and documentation generation.

```mermaid
sequenceDiagram
participant GEN as "generate-node-docs.ts"
participant REG as "node-registry.ts"
participant NODE as "swap.node.ts"
GEN->>REG : getRegisteredNodes()
REG-->>GEN : Map<string, () => INodeType>
GEN->>NODE : factory() to get description
NODE-->>GEN : INodeDescription
GEN-->>GEN : Render markdown and write docs/NODES_REFERENCE.md
```

**Diagram sources**
- [scripts/generate-node-docs.ts:152-168](file://scripts/generate-node-docs.ts#L152-L168)
- [src/web3/nodes/node-registry.ts:19-47](file://src/web3/nodes/node-registry.ts#L19-L47)
- [src/web3/nodes/swap.node.ts:50-100](file://src/web3/nodes/swap.node.ts#L50-L100)

**Section sources**
- [src/web3/nodes/node-registry.ts:1-47](file://src/web3/nodes/node-registry.ts#L1-L47)
- [scripts/generate-node-docs.ts:1-168](file://scripts/generate-node-docs.ts#L1-L168)

### Testing Strategy
The project employs unit tests with Jest, watch mode, coverage reporting, and end-to-end tests. Integration tests are supported via script-based verification and a comprehensive system test harness.

- Unit tests
  - Jest configuration in package.json targets src and uses ts-jest transformer
  - Tests are colocated alongside source files with .spec.ts suffix
  - Coverage collected under coverage/

- Watch and debug
  - npm run test:watch for iterative TDD
  - npm run test:cov for coverage reports
  - npm run test:debug for inspector-based debugging

- End-to-end tests
  - npm run test:e2e with a dedicated jest-e2e.json configuration

- Integration tests
  - scripts/verify_api.ts performs a quick verification of Crossmint wallet initialization and deletion flows
  - scripts/full_system_test.ts orchestrates multi-module tests including authentication, Crossmint wallet lifecycle, database integrity, and security checks

```mermaid
flowchart TD
Start(["Start Development"]) --> Unit["Run Unit Tests<br/>npm run test"]
Unit --> Watch{"Watch Mode?"}
Watch --> |Yes| WatchMode["npm run test:watch"]
Watch --> |No| Coverage["npm run test:cov"]
Coverage --> E2E["npm run test:e2e"]
WatchMode --> E2E
E2E --> Integration["Integration Tests<br/>scripts/verify_api.ts"]
Integration --> FullSys["Full System Test<br/>scripts/full_system_test.ts"]
FullSys --> Done(["Verification Complete"])
```

**Diagram sources**
- [package.json:17-21](file://package.json#L17-L21)
- [scripts/verify_api.ts:1-85](file://scripts/verify_api.ts#L1-L85)
- [scripts/full_system_test.ts:1-280](file://scripts/full_system_test.ts#L1-L280)

**Section sources**
- [package.json:77-93](file://package.json#L77-L93)
- [scripts/verify_api.ts:1-85](file://scripts/verify_api.ts#L1-L85)
- [scripts/full_system_test.ts:1-280](file://scripts/full_system_test.ts#L1-L280)

### Documentation Generation
The documentation generator reads the node registry, builds a markdown reference, and writes docs/NODES_REFERENCE.md. It supports parameter rendering, option lists, and section IDs for navigation.

```mermaid
flowchart TD
A["generate-node-docs.ts"] --> B["Load registry from node-registry.ts"]
B --> C["Iterate entries and build NodeDoc[]"]
C --> D["Render markdown tables and sections"]
D --> E["Write docs/NODES_REFERENCE.md"]
E --> F["Console log summary"]
```

**Diagram sources**
- [scripts/generate-node-docs.ts:152-168](file://scripts/generate-node-docs.ts#L152-L168)
- [src/web3/nodes/node-registry.ts:19-47](file://src/web3/nodes/node-registry.ts#L19-L47)

**Section sources**
- [scripts/generate-node-docs.ts:1-168](file://scripts/generate-node-docs.ts#L1-L168)

### Development Workflow and Hot Reload
- Development server
  - npm run start:dev enables watch mode for rapid iteration
  - npm run start:debug launches with inspector support for breakpoints
- Formatting and linting
  - npm run format applies Prettier across TypeScript files
  - npm run lint runs ESLint with autofix
- Building and production
  - npm run build compiles TypeScript to dist
  - npm run start:prod serves the compiled application

**Section sources**
- [package.json:8-14](file://package.json#L8-L14)
- [.prettierrc:1-9](file://.prettierrc#L1-L9)
- [.eslintrc.js:1-29](file://.eslintrc.js#L1-L29)

### Coding Standards and Conventions
- Naming patterns
  - Node classes follow PascalCase (e.g., SwapNode)
  - Node types are lowercase with hyphens (e.g., jupiterSwap)
  - Interfaces prefixed with I (e.g., INodeType, IExecuteContext)
- File organization
  - Feature-based modules under src/
  - Path aliases simplify imports across modules
- Validation and safety
  - Parameters validated via class-validator and runtime checks
  - Error handling returns structured JSON with success/error fields

**Section sources**
- [src/web3/nodes/swap.node.ts:49-100](file://src/web3/nodes/swap.node.ts#L49-L100)
- [src/web3/workflow-types.ts:12-56](file://src/web3/workflow-types.ts#L12-L56)
- [tsconfig.json:20-48](file://tsconfig.json#L20-L48)

### Extending Workflow Nodes
To add a new node:
1. Create a new class implementing INodeType in src/web3/nodes/
2. Define description fields (displayName, name, group, inputs, outputs, properties)
3. Implement execute(context) to handle node logic
4. Register the node in src/web3/nodes/node-registry.ts using registerNode
5. Generate updated documentation with npm run docs:nodes

```mermaid
sequenceDiagram
participant Dev as "Developer"
participant Node as "MyNewNode.ts"
participant Reg as "node-registry.ts"
participant Gen as "generate-node-docs.ts"
Dev->>Node : Implement INodeType
Dev->>Reg : registerNode("myNewNode", () => new MyNewNode())
Dev->>Gen : npm run docs : nodes
Gen-->>Dev : Updated docs/NODES_REFERENCE.md
```

**Diagram sources**
- [src/web3/nodes/node-registry.ts:12-21](file://src/web3/nodes/node-registry.ts#L12-L21)
- [scripts/generate-node-docs.ts:152-168](file://scripts/generate-node-docs.ts#L152-L168)

**Section sources**
- [src/web3/nodes/node-registry.ts:12-21](file://src/web3/nodes/node-registry.ts#L12-L21)
- [scripts/generate-node-docs.ts:152-168](file://scripts/generate-node-docs.ts#L152-L168)

### Adding New DeFi Protocol Integrations
Follow the existing pattern used by nodes (e.g., SwapNode):
- Introduce a service in src/web3/services/ for protocol-specific logic
- Inject the service into nodes via IExecuteContext
- Add parameters to the node description for protocol configuration
- Register the node in the registry and regenerate docs

**Section sources**
- [src/web3/nodes/swap.node.ts:102-207](file://src/web3/nodes/swap.node.ts#L102-L207)

### Continuous Integration Patterns and Code Quality Checks
- Pre-commit checks
  - Run npm run lint and npm run format to ensure code quality
- Test coverage
  - Use npm run test:cov to measure coverage and enforce minimal thresholds
- E2E hygiene
  - Use npm run test:e2e for end-to-end scenarios aligned with jest-e2e.json
- Documentation maintenance
  - Keep docs/NODES_REFERENCE.md updated after node changes

**Section sources**
- [package.json:15-21](file://package.json#L15-L21)
- [package.json:77-93](file://package.json#L77-L93)

### Contribution Guidelines
- Branching and PRs
  - Create feature branches and open pull requests for review
- Commit hygiene
  - Keep commits small and focused; include rationale in PR descriptions
- Testing
  - Add unit tests for new features; include integration tests where applicable
- Documentation
  - Update docs/NODES_REFERENCE.md when introducing new nodes or changing parameters

## Dependency Analysis
The backend relies on NestJS for the framework, TypeScript for type safety, and a suite of Web3 and DeFi libraries. The dependency graph highlights core modules and their relationships.

```mermaid
graph TB
PKG["package.json"] --> NEST["@nestjs/*"]
PKG --> SOL["@solana/web3.js"]
PKG --> JUP["@jup-ag/api"]
PKG --> KAMINO["@kamino-finance/klend-sdk"]
PKG --> CROSSMINT["@crossmint/wallets-sdk"]
PKG --> SWAGGER["@nestjs/swagger"]
PKG --> TELEGRAM["typescript-telegram-bot-api"]
PKG --> DECIMAL["decimal.js"]
PKG --> AXIOS["axios"]
PKG --> RX["rxjs"]
PKG --> PG["pg"]
PKG --> SUPABASE["@supabase/supabase-js"]
```

**Diagram sources**
- [package.json:23-54](file://package.json#L23-L54)

**Section sources**
- [package.json:23-54](file://package.json#L23-L54)

## Performance Considerations
- Development performance
  - Use npm run start:dev for hot reload during development
  - Prefer incremental builds with tsconfig.json enabled
- Runtime performance
  - Minimize synchronous operations in nodes; leverage async/await
  - Cache frequently accessed data (RPC endpoints, token metadata) where safe
- Database performance
  - Ensure proper indexing on frequently queried columns (e.g., users.wallet_address)
  - Use Supabase migrations to evolve schema safely

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common development and runtime issues:

- Supabase configuration errors
  - Ensure SUPABASE_URL and SUPABASE_SERVICE_KEY are present in .env
- Telegram bot not responding
  - Verify TELEGRAM_BOT_TOKEN and check logs for startup confirmation
- Workflow execution failures
  - Confirm Solana RPC accessibility and sufficient SOL for fees
  - Validate Crossmint wallet initialization
- Crossmint wallet errors
  - Verify CROSSMINT_SERVER_API_KEY correctness and environment alignment
- Node documentation outdated
  - Run npm run docs:nodes to regenerate docs/NODES_REFERENCE.md

**Section sources**
- [README.md:287-306](file://README.md#L287-L306)

## Conclusion
This guide outlined the development environment setup, coding standards, testing strategies, and extension patterns for the backend. By leveraging npm scripts, TypeScript configuration, ESLint/Prettier, and the Web3 node system, contributors can efficiently build, test, and deploy new features. Following the documented conventions ensures maintainability and scalability as the platform evolves.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### Appendix A: Quick Commands Reference
- Development server: npm run start:dev
- Debug server: npm run start:debug
- Build: npm run build
- Format: npm run format
- Lint: npm run lint
- Unit tests: npm run test
- Watch tests: npm run test:watch
- Coverage: npm run test:cov
- Debug tests: npm run test:debug
- E2E tests: npm run test:e2e
- Generate docs: npm run docs:nodes
- Verify API: ts-node scripts/verify_api.ts
- Full system test: ts-node scripts/full_system_test.ts

**Section sources**
- [package.json:8-22](file://package.json#L8-L22)
- [scripts/verify_api.ts:1-85](file://scripts/verify_api.ts#L1-L85)
- [scripts/full_system_test.ts:1-280](file://scripts/full_system_test.ts#L1-L280)