import { Injectable, Logger } from '@nestjs/common';
import { MagicBlockPrivatePaymentsClientService } from './magicblock-private-payments-client.service';
import {
  type MagicBlockPrivatePaymentsAdapterPort,
  type PrivatePaymentsBalanceParams,
  type PrivatePaymentsBalanceResult,
  type PrivatePaymentsDepositParams,
  type PrivatePaymentsTransferParams,
  type PrivatePaymentsUnsignedTx,
  type PrivatePaymentsWithdrawParams,
} from './magicblock.port';

interface PpRemoteUnsignedTx {
  kind?: string;
  version?: string;
  transactionBase64?: string;
  sendTo?: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  instructionCount?: number;
  requiredSigners?: string[];
}

interface PpRemoteBalance {
  balance?: string;
  decimals?: number;
}

@Injectable()
export class MagicBlockPrivatePaymentsRealAdapter implements MagicBlockPrivatePaymentsAdapterPort {
  private readonly logger = new Logger(MagicBlockPrivatePaymentsRealAdapter.name);

  constructor(private readonly client: MagicBlockPrivatePaymentsClientService) {}

  async deposit(params: PrivatePaymentsDepositParams): Promise<PrivatePaymentsUnsignedTx> {
    const body = this.buildBody(params);
    return this.dispatch('deposit', '/v1/spl/deposit', body, params.deploymentId);
  }

  async transfer(params: PrivatePaymentsTransferParams): Promise<PrivatePaymentsUnsignedTx> {
    const body = {
      owner: params.fromWallet,
      destination: params.toWallet,
      mint: params.mint,
      amount: this.parseAmount(params.amount),
    };
    return this.dispatch('transfer', '/v1/spl/transfer', body, params.deploymentId);
  }

  async withdraw(params: PrivatePaymentsWithdrawParams): Promise<PrivatePaymentsUnsignedTx> {
    // In PP API, withdraw sends tokens back to the owner's base-chain ATA.
    // toWallet is therefore the owner of the ephemeral tokens.
    const body = {
      owner: params.toWallet,
      mint: params.mint,
      amount: this.parseAmount(params.amount),
    };
    return this.dispatch('withdraw', '/v1/spl/withdraw', body, params.deploymentId);
  }

  async getBalance(params: PrivatePaymentsBalanceParams): Promise<PrivatePaymentsBalanceResult> {
    const remote = await this.client.get<PpRemoteBalance>('/v1/spl/balance', {
      owner: params.wallet,
      mint: params.mint,
    });
    return {
      balance: typeof remote?.balance === 'string' ? remote.balance : '0',
      decimals: typeof remote?.decimals === 'number' ? remote.decimals : 0,
    };
  }

  // ---------------- helpers ----------------

  private buildBody(params: PrivatePaymentsDepositParams | PrivatePaymentsWithdrawParams) {
    return {
      owner: 'fromWallet' in params ? params.fromWallet : params.toWallet,
      mint: params.mint,
      amount: this.parseAmount(params.amount),
    };
  }

  private parseAmount(amount: string): number {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
      throw new Error(`Invalid PP amount: ${amount} (must be a positive integer)`);
    }
    return n;
  }

  private async dispatch(
    op: string,
    path: string,
    body: Record<string, unknown>,
    deploymentId: string,
  ): Promise<PrivatePaymentsUnsignedTx> {
    const remote = await this.client.post<PpRemoteUnsignedTx>(path, body);
    this.logger.log(
      `pp.${op} deployment=${deploymentId} kind=${remote?.kind ?? 'unknown'} sendTo=${remote?.sendTo ?? 'unknown'}`,
    );
    const kind = (['deposit', 'transfer', 'withdraw'] as const).includes(
      remote?.kind as PrivatePaymentsUnsignedTx['kind'],
    )
      ? (remote?.kind as PrivatePaymentsUnsignedTx['kind'])
      : (op as PrivatePaymentsUnsignedTx['kind']);
    return {
      kind,
      version: (remote?.version as PrivatePaymentsUnsignedTx['version']) ?? 'legacy',
      transactionBase64: remote?.transactionBase64 ?? '',
      sendTo: (remote?.sendTo as PrivatePaymentsUnsignedTx['sendTo']) ?? 'base',
      recentBlockhash: remote?.recentBlockhash ?? '',
      lastValidBlockHeight: remote?.lastValidBlockHeight ?? 0,
      instructionCount: remote?.instructionCount ?? 0,
      requiredSigners: Array.isArray(remote?.requiredSigners) ? remote.requiredSigners : [],
    };
  }
}
