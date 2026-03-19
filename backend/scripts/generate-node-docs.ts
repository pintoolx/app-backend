import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getRegisteredNodes } from '../src/web3/nodes/node-registry';
import type { INodeProperty, INodeType } from '../src/web3/workflow-types';

interface NodeDoc {
  type: string;
  node: INodeType;
}

const MAX_INLINE_OPTIONS = 20;

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
}

function formatScalar(value: unknown): string {
  if (value === undefined) {
    return '`undefined`';
  }

  if (value === null) {
    return '`null`';
  }

  if (typeof value === 'string') {
    if (value.length === 0) {
      return '`""`';
    }

    return `\`${escapeMarkdown(value)}\``;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `\`${String(value)}\``;
  }

  return `\`${escapeMarkdown(JSON.stringify(value))}\``;
}

function formatOptions(property: INodeProperty): string {
  if (!property.options?.length) {
    return '-';
  }

  const renderedOptions = property.options
    .map((option) => `\`${escapeMarkdown(String(option.value))}\` (${escapeMarkdown(option.name)})`)
    .slice(0, MAX_INLINE_OPTIONS);

  const output = renderedOptions.join('<br/>');

  if (property.options.length <= MAX_INLINE_OPTIONS) {
    return output;
  }

  const remaining = property.options.length - MAX_INLINE_OPTIONS;

  return `${output}<br/>... and ${remaining} more options`;
}

function renderParameters(properties: INodeProperty[]): string {
  if (!properties.length) {
    return 'No parameters.\n';
  }

  const rows = properties.map((property) => {
    const name = `\`${escapeMarkdown(property.name)}\``;
    const type = `\`${escapeMarkdown(property.type)}\``;
    const defaultValue = formatScalar(property.default);
    const description = escapeMarkdown(property.description || '-');
    const options = formatOptions(property);

    return `| ${name} | ${type} | ${defaultValue} | ${description} | ${options} |`;
  });

  return [
    '| Name | Type | Default | Description | Options |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function buildNodeIndexRows(nodes: NodeDoc[]): string[] {
  return nodes.map(({ type, node }) => {
    const description = node.description;
    const group = description.group.map((item) => `\`${escapeMarkdown(item)}\``).join(', ');
    const isTrigger = description.isTrigger ? 'Yes' : 'No';
    const telegramNotify = description.telegramNotify ? 'Yes' : 'No';
    const inputs = description.inputs.map((item) => `\`${escapeMarkdown(item)}\``).join(', ');
    const outputs = description.outputs.map((item) => `\`${escapeMarkdown(item)}\``).join(', ');
    const sectionId = toSectionId(type);

    return `| \`${escapeMarkdown(type)}\` | [${escapeMarkdown(description.displayName)}](#${sectionId}) | ${group || '-'} | ${isTrigger} | ${telegramNotify} | ${inputs || '-'} | ${outputs || '-'} |`;
  });
}

function toSectionId(type: string): string {
  return `node-${type.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

function buildMarkdown(nodes: NodeDoc[]): string {
  const indexRows = buildNodeIndexRows(nodes);
  const sections = nodes.map(({ type, node }) => {
    const description = node.description;
    const group = description.group.map((item) => `\`${escapeMarkdown(item)}\``).join(', ');
    const inputs = description.inputs.map((item) => `\`${escapeMarkdown(item)}\``).join(', ');
    const outputs = description.outputs.map((item) => `\`${escapeMarkdown(item)}\``).join(', ');
    const trigger = description.isTrigger ? 'Yes' : 'No';
    const telegramNotify = description.telegramNotify ? 'Yes' : 'No';
    const parametersTable = renderParameters(description.properties);
    const sectionId = toSectionId(type);

    return [
      `<a id="${sectionId}"></a>`,
      '',
      `## ${description.displayName} (\`${escapeMarkdown(type)}\`)`,
      '',
      `${escapeMarkdown(description.description)}`,
      '',
      `- Group: ${group || '-'}`,
      `- Trigger Node: ${trigger}`,
      `- Telegram Notify: ${telegramNotify}`,
      `- Inputs: ${inputs || '-'}`,
      `- Outputs: ${outputs || '-'}`,
      '',
      '### Parameters',
      '',
      parametersTable,
      '',
    ].join('\n');
  });

  return [
    '# Workflow Node Reference',
    '',
    '> This file is auto-generated from `backend/src/web3/nodes/node-registry.ts` and node `description` schemas.',
    '> Regenerate with `npm run docs:nodes` from the `backend/` directory.',
    '',
    `Total nodes: **${nodes.length}**`,
    '',
    '## Node Index',
    '',
    '| Type | Display Name | Group | Trigger | Telegram Notify | Inputs | Outputs |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...indexRows,
    '',
    ...sections,
  ].join('\n');
}

function main() {
  const registry = getRegisteredNodes();
  const nodes: NodeDoc[] = Array.from(registry.entries())
    .map(([type, factory]) => ({ type, node: factory() }))
    .sort((a, b) => a.type.localeCompare(b.type));

  const markdown = buildMarkdown(nodes);
  const outputPath = resolve(process.cwd(), 'docs/NODES_REFERENCE.md');

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown, 'utf-8');

  console.log(`Generated ${nodes.length} node docs at ${outputPath}`);
}

main();
