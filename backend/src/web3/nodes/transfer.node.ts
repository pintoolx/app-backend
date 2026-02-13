import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { AgentKitService } from '../services/agent-kit.service';
import { TOKEN_ADDRESS } from '../constants';
import { PublicKey, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getMint } from '@solana/spl-token';

export type TokenTicker = keyof typeof TOKEN_ADDRESS;

/**
 * Transfer Node
 *
 * 轉帳 SOL 或 SPL Token 到指定地址
 * 使用 Crossmint 託管錢包
 */
export class TransferNode implements INodeType {
  description = {
    displayName: 'Transfer',
    name: 'transfer',
    group: ['transfer'],
    version: 1,
    description:
      'Transfer SOL or SPL tokens to a recipient address using Crossmint custodial wallet',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true,
    isTrigger: false,
    properties: [
      {
        displayName: 'Account ID',
        name: 'accountId',
        type: 'string' as const,
        default: '',
        description: 'Account ID to use for the transfer (uses Crossmint custodial wallet)',
      },
      {
        displayName: 'Recipient Address',
        name: 'recipient',
        type: 'string' as const,
        default: '',
        description: 'Recipient wallet address',
      },
      {
        displayName: 'Token',
        name: 'token',
        type: 'string' as const,
        default: 'SOL',
        description:
          'Token to transfer (e.g., SOL, USDC). See src/web3/constants.ts for available tokens.',
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: '',
        description: 'Amount to transfer (human readable, e.g., 1.5 SOL or 100 USDC)',
      },
    ],
  };

  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const items = context.getInputData();
    const returnData: NodeExecutionData[] = [];

    const agentKitService = context.getNodeParameter('agentKitService', 0) as AgentKitService;

    if (!agentKitService) {
      throw new Error('AgentKitService not available in execution context');
    }

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const accountId = context.getNodeParameter('accountId', itemIndex) as string;
        const recipient = context.getNodeParameter('recipient', itemIndex) as string;
        const token = context.getNodeParameter('token', itemIndex) as TokenTicker;
        const amount = parseFloat(context.getNodeParameter('amount', itemIndex) as string);

        if (!accountId) {
          throw new Error('Account ID is required');
        }
        if (!recipient) {
          throw new Error('Recipient address is required');
        }
        if (isNaN(amount) || amount <= 0) {
          throw new Error('Valid amount is required');
        }

        // 驗證地址格式
        try {
          new PublicKey(recipient);
        } catch {
          throw new Error(`Invalid recipient address: ${recipient}`);
        }

        console.log(`\nTransfer Node: Executing transfer via Crossmint wallet`);
        console.log(`  Account: ${accountId}`);
        console.log(`  To: ${recipient}`);
        console.log(`  Amount: ${amount} ${token}`);

        // 獲取錢包
        const wallet = await agentKitService.getWalletForAccount(accountId);
        const connection = new Connection(agentKitService.getRpcUrl());

        let signature: string;

        if (token === 'SOL') {
          // SOL 轉帳
          const { Transaction, SystemProgram } = await import('@solana/web3.js');

          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: new PublicKey(recipient),
              lamports: Math.round(amount * LAMPORTS_PER_SOL),
            }),
          );

          const { blockhash } = await connection.getLatestBlockhash();
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = wallet.publicKey;

          const result = await wallet.signAndSendTransaction(transaction);
          signature = result.signature;
        } else {
          // SPL Token 轉帳
          const tokenMint = TOKEN_ADDRESS[token];
          if (!tokenMint) {
            throw new Error(`Unknown token: ${token}`);
          }

          const { createTransferInstruction } = await import('@solana/spl-token');
          const { Transaction } = await import('@solana/web3.js');

          const mintPubkey = new PublicKey(tokenMint);
          const recipientPubkey = new PublicKey(recipient);

          // 獲取 token 精度
          const mintInfo = await getMint(connection, mintPubkey);
          const decimals = mintInfo.decimals;
          const tokenAmount = Math.round(amount * Math.pow(10, decimals));

          // 獲取源 token account
          const sourceTokenAccount = await getAssociatedTokenAddress(mintPubkey, wallet.publicKey);

          // 獲取目標 token account (可能需要創建)
          const destinationTokenAccount = await getAssociatedTokenAddress(
            mintPubkey,
            recipientPubkey,
          );

          // 創建轉帳指令
          const transaction = new Transaction().add(
            createTransferInstruction(
              sourceTokenAccount,
              destinationTokenAccount,
              wallet.publicKey,
              tokenAmount,
            ),
          );

          const { blockhash } = await connection.getLatestBlockhash();
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = wallet.publicKey;

          const result = await wallet.signAndSendTransaction(transaction);
          signature = result.signature;
        }

        console.log(`  Transfer completed: ${signature}`);

        returnData.push({
          json: {
            success: true,
            operation: 'transfer',
            signature,
            recipient,
            token,
            amount,
            accountId,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            error: errorMessage,
            operation: 'transfer',
            recipient: context.getNodeParameter('recipient', itemIndex),
            token: context.getNodeParameter('token', itemIndex),
            amount: context.getNodeParameter('amount', itemIndex),
          },
        });
      }
    }

    return [returnData];
  }
}
