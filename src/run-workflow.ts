import { WorkflowExecutor } from './workflow-executor';
import { PriceFeedNode } from './nodes/PriceFeedNode';
import { SwapNode } from './nodes/SwapNode';
import { KaminoNode } from './nodes/KaminoNode';
import { createTelegramNotifierFromEnv } from './telegram-notifier';
import { type WorkflowDefinition } from './web3-workflow-types';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

/**
 * 运行 Workflow
 */
async function runWorkflow(workflowPath: string) {
  console.log(`\n${'*'.repeat(80)}`);
  console.log(`正在加载 Workflow: ${workflowPath}`);
  console.log(`${'*'.repeat(80)}\n`);

  // 加载 workflow 定义
  const workflowJson = fs.readFileSync(workflowPath, 'utf-8');
  const workflow: WorkflowDefinition = JSON.parse(workflowJson);

  // 初始化 Telegram 通知（从环境变量）
  const telegramNotifier = createTelegramNotifierFromEnv();

  if (telegramNotifier.isEnabled()) {
    console.log('✓ Telegram 通知已启用\n');
  } else {
    console.log('ℹ Telegram 通知未启用\n');
  }

  // 创建执行器，传入 Telegram 通知器和 workflow 名称
  const workflowName = path.basename(workflowPath, '.json');
  const executor = new WorkflowExecutor(telegramNotifier, workflowName);

  // 注册所有节点类型
  executor.registerNodeType('pythPriceFeed', PriceFeedNode);
  executor.registerNodeType('jupiterSwap', SwapNode);
  executor.registerNodeType('kamino', KaminoNode);

  try {
    // 执行 workflow
    const results = await executor.execute(workflow);

    console.log('\n' + '*'.repeat(80));
    console.log('Workflow 执行完成！');
    console.log('*'.repeat(80));

    // 打印所有节点的最终结果
    console.log('\n所有节点的执行结果:');
    for (const [nodeId, data] of results.entries()) {
      console.log(`\n节点 ${nodeId}:`);
      console.log(JSON.stringify(data, null, 2));
    }

    return results;
  } catch (error) {
    console.error('\n' + '!'.repeat(80));
    console.error('Workflow 执行失败！');
    console.error('!'.repeat(80));
    console.error(error);
    throw error;
  }
}

// 主函数
async function main() {
  const workflowPath = process.argv[2] || path.join(__dirname, '../workflows/price-trigger-swap.json');

  if (!fs.existsSync(workflowPath)) {
    console.error(`错误: Workflow 文件不存在: ${workflowPath}`);
    console.error('\n用法: npm run workflow [workflow-path]');
    console.error('示例: npm run workflow ./workflows/price-trigger-swap.json');
    process.exit(1);
  }

  try {
    await runWorkflow(workflowPath);
    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

// 运行主函数
main();
