import { Injectable, Logger } from '@nestjs/common';
import { MagicBlockPrivatePaymentsClientService } from './magicblock-private-payments-client.service';
import {
  type MagicBlockPrivatePaymentsAdapterPort,
  type PrivatePaymentsBalanceParams,
  type PrivatePaymentsDepositParams,
  type PrivatePaymentsResult,
  type PrivatePaymentsTransferParams,
  type PrivatePaymentsWithdrawParams,
} from './magicblock.port';

interface PpRemoteResult {
  signature?: string;
  status?: 'pending' | 'confirmed' | 'failed';
  encryptedBalanceRef?: string;
}

interface PpRemoteBalance {
  encryptedBalanceRef?: string;
  ciphertext?: string;
}

@Injectable()
export class MagicBlockPrivatePaymentsRealAdapter implements MagicBlockPrivatePaymentsAdapterPort {
  private readonly logger = new Logger(MagicBlockPrivatePaymentsRealAdapter.name);

  constructor(private readonly client: MagicBlockPrivatePaymentsClientService) {}

  async deposit(params: PrivatePaymentsDepositParams): Promise<PrivatePaymentsResult> {
    return this.dispatch('deposit', '/v1/deposit', { ...params });
  }

  async transfer(params: PrivatePaymentsTransferParams): Promise<PrivatePaymentsResult> {
    return this.dispatch('transfer', '/v1/transfer', { ...params });
  }

  async withdraw(params: PrivatePaymentsWithdrawParams): Promise<PrivatePaymentsResult> {
    return this.dispatch('withdraw', '/v1/withdraw', { ...params });
  }

  async getBalance(
    params: PrivatePaymentsBalanceParams,
  ): Promise<{ encryptedBalanceRef: string | null; ciphertext: string | null }> {
    const remote = await this.client.get<PpRemoteBalance>('/v1/balance', {
      deploymentId: params.deploymentId,
      wallet: params.wallet,
      mint: params.mint,
    });
    return {
      encryptedBalanceRef:
        typeof remote?.encryptedBalanceRef === 'string' ? remote.encryptedBalanceRef : null,
      ciphertext: typeof remote?.ciphertext === 'string' ? remote.ciphertext : null,
    };
  }

  private async dispatch(
    op: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<PrivatePaymentsResult> {
    try {
      const remote = await this.client.post<PpRemoteResult>(path, body);
      this.logger.log(
        `pp.${op} deployment=${body.deploymentId} signature=${remote?.signature ?? 'null'} status=${remote?.status ?? 'pending'}`,
      );
      return {
        signature: remote?.signature ?? null,
        status: remote?.status ?? 'pending',
        encryptedBalanceRef: remote?.encryptedBalanceRef ?? null,
      };
    } catch (err) {
      this.logger.error(
        `pp.${op} failed for deployment=${body.deploymentId}: ${err instanceof Error ? err.message : err}`,
      );
      return { signature: null, status: 'failed', encryptedBalanceRef: null };
    }
  }
}
