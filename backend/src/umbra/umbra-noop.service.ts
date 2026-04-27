import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  type UmbraAdapterPort,
  type UmbraDepositParams,
  type UmbraEncryptedBalance,
  type UmbraEncryptedBalanceParams,
  type UmbraGrantResult,
  type UmbraGrantViewerParams,
  type UmbraRegisterParams,
  type UmbraRegisterResult,
  type UmbraTransferParams,
  type UmbraTreasuryResult,
  type UmbraWithdrawParams,
} from './umbra.port';

const noopId = (prefix: string) => `${prefix}-noop-${randomBytes(6).toString('hex')}`;

@Injectable()
export class UmbraNoopAdapter implements UmbraAdapterPort {
  private readonly logger = new Logger('UmbraNoopAdapter');

  async registerEncryptedUserAccount(params: UmbraRegisterParams): Promise<UmbraRegisterResult> {
    this.logger.debug(`[noop] umbra.register wallet=${params.walletAddress} mode=${params.mode}`);
    return {
      encryptedUserAccount: noopId('umbra-eua'),
      x25519PublicKey: noopId('umbra-x25519'),
      txSignatures: [],
      status: 'confirmed',
    };
  }

  async deposit(params: UmbraDepositParams): Promise<UmbraTreasuryResult> {
    this.logger.debug(
      `[noop] umbra.deposit deployment=${params.deploymentId} mint=${params.mint} amount=${params.amount}`,
    );
    return { queueSignature: null, callbackSignature: null, status: 'pending' };
  }

  async withdraw(params: UmbraWithdrawParams): Promise<UmbraTreasuryResult> {
    this.logger.debug(
      `[noop] umbra.withdraw deployment=${params.deploymentId} mint=${params.mint} amount=${params.amount}`,
    );
    return { queueSignature: null, callbackSignature: null, status: 'pending' };
  }

  async transfer(params: UmbraTransferParams): Promise<UmbraTreasuryResult> {
    this.logger.debug(`[noop] umbra.transfer deployment=${params.deploymentId}`);
    return { queueSignature: null, callbackSignature: null, status: 'pending' };
  }

  async getEncryptedBalance(params: UmbraEncryptedBalanceParams): Promise<UmbraEncryptedBalance> {
    this.logger.debug(
      `[noop] umbra.getEncryptedBalance deployment=${params.deploymentId} wallet=${params.walletAddress}`,
    );
    return { encryptedTokenAccount: null, ciphertext: null, decryptedAmount: null };
  }

  async grantViewer(params: UmbraGrantViewerParams): Promise<UmbraGrantResult> {
    this.logger.debug(
      `[noop] umbra.grantViewer deployment=${params.deploymentId} grantee=${params.granteeWallet}`,
    );
    return {
      grantId: noopId('umbra-grant'),
      payload: { mint: params.mint, expiresAt: params.expiresAt ?? null },
    };
  }
}
