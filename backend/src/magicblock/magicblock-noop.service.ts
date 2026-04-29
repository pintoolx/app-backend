import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  type ErCommitAndUndelegateParams,
  type ErDelegateParams,
  type ErDelegateResult,
  type ErRouteParams,
  type ErRouteResult,
  type MagicBlockErAdapterPort,
  type MagicBlockPerAdapterPort,
  type MagicBlockPrivatePaymentsAdapterPort,
  type PerAuthChallenge,
  type PerAuthChallengeParams,
  type PerAuthVerifyParams,
  type PerAuthVerifyResult,
  type PerCreateGroupParams,
  type PerCreateGroupResult,
  type PerPrivateStateParams,
  type PerPrivateStateResult,
  type PerReadFollowerStateParams,
  type PerReadFollowerStateResult,
  type PerWriteFollowerStateParams,
  type PerWriteFollowerStateResult,
  type PrivatePaymentsBalanceParams,
  type PrivatePaymentsDepositParams,
  type PrivatePaymentsTransferParams,
  type PrivatePaymentsUnsignedTx,
  type PrivatePaymentsWithdrawParams,
} from './magicblock.port';

const noopId = (prefix: string) => `${prefix}-noop-${randomBytes(6).toString('hex')}`;

@Injectable()
export class MagicBlockErNoopAdapter implements MagicBlockErAdapterPort {
  private readonly logger = new Logger('MagicBlockErNoopAdapter');

  async delegateAccount(params: ErDelegateParams): Promise<ErDelegateResult> {
    const sessionId = noopId('er-session');
    this.logger.debug(
      `[noop] er.delegateAccount deployment=${params.deploymentId} account=${params.accountPubkey} session=${sessionId}`,
    );
    return { sessionId, signature: null };
  }

  async route(params: ErRouteParams): Promise<ErRouteResult> {
    this.logger.debug(`[noop] er.route deployment=${params.deploymentId}`);
    return { signature: null, routedThrough: 'noop' };
  }

  async commitAndUndelegate(
    params: ErCommitAndUndelegateParams,
  ): Promise<{ signature: string | null }> {
    this.logger.debug(
      `[noop] er.commitAndUndelegate deployment=${params.deploymentId} account=${params.accountPubkey}`,
    );
    return { signature: null };
  }
}

@Injectable()
export class MagicBlockPerNoopAdapter implements MagicBlockPerAdapterPort {
  private readonly logger = new Logger('MagicBlockPerNoopAdapter');

  async createPermissionGroup(params: PerCreateGroupParams): Promise<PerCreateGroupResult> {
    const groupId = noopId('per-group');
    this.logger.debug(
      `[noop] per.createPermissionGroup deployment=${params.deploymentId} members=${params.members.length} group=${groupId}`,
    );
    return { groupId, signature: null };
  }

  async requestAuthChallenge(params: PerAuthChallengeParams): Promise<PerAuthChallenge> {
    const challenge = `per-challenge-${randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    this.logger.debug(
      `[noop] per.requestAuthChallenge deployment=${params.deploymentId} wallet=${params.walletAddress}`,
    );
    return { challenge, expiresAt };
  }

  async verifyAuthSignature(params: PerAuthVerifyParams): Promise<PerAuthVerifyResult> {
    this.logger.debug(
      `[noop] per.verifyAuthSignature deployment=${params.deploymentId} wallet=${params.walletAddress}`,
    );
    return {
      authToken: `per-token-${randomBytes(16).toString('hex')}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  async getPrivateState(params: PerPrivateStateParams): Promise<PerPrivateStateResult> {
    this.logger.debug(`[noop] per.getPrivateState deployment=${params.deploymentId}`);
    return { state: null, logs: [] };
  }

  async writeFollowerPrivateState(
    params: PerWriteFollowerStateParams,
  ): Promise<PerWriteFollowerStateResult> {
    this.logger.debug(
      `[noop] per.writeFollowerPrivateState deployment=${params.deploymentId} cycle=${params.cycleId} vault=${params.followerVaultId}`,
    );
    // Noop deliberately reports `applied` so the cycle scaffold can advance
    // receipt status under tests / dev environments without a live PER.
    return { signature: null, privateStateRevision: 1, status: 'applied' };
  }

  async readFollowerPrivateState(
    params: PerReadFollowerStateParams,
  ): Promise<PerReadFollowerStateResult> {
    this.logger.debug(
      `[noop] per.readFollowerPrivateState deployment=${params.deploymentId} subscription=${params.subscriptionId} vault=${params.followerVaultId}`,
    );
    // Noop returns an empty sanitized envelope so callers can exercise the
    // controller / service plumbing without a live PER.
    return { state: null, logs: [], privateStateRevision: null };
  }
}

@Injectable()
export class MagicBlockPrivatePaymentsNoopAdapter implements MagicBlockPrivatePaymentsAdapterPort {
  private readonly logger = new Logger('MagicBlockPrivatePaymentsNoopAdapter');

  async deposit(params: PrivatePaymentsDepositParams): Promise<PrivatePaymentsUnsignedTx> {
    this.logger.debug(
      `[noop] pp.deposit deployment=${params.deploymentId} mint=${params.mint} amount=${params.amount}`,
    );
    return {
      kind: 'deposit',
      version: 'legacy',
      transactionBase64: '',
      sendTo: 'base',
      recentBlockhash: '',
      lastValidBlockHeight: 0,
      instructionCount: 0,
      requiredSigners: [],
    };
  }

  async transfer(params: PrivatePaymentsTransferParams): Promise<PrivatePaymentsUnsignedTx> {
    this.logger.debug(`[noop] pp.transfer deployment=${params.deploymentId}`);
    return {
      kind: 'transfer',
      version: 'legacy',
      transactionBase64: '',
      sendTo: 'base',
      recentBlockhash: '',
      lastValidBlockHeight: 0,
      instructionCount: 0,
      requiredSigners: [],
    };
  }

  async withdraw(params: PrivatePaymentsWithdrawParams): Promise<PrivatePaymentsUnsignedTx> {
    this.logger.debug(`[noop] pp.withdraw deployment=${params.deploymentId}`);
    return {
      kind: 'withdraw',
      version: 'legacy',
      transactionBase64: '',
      sendTo: 'base',
      recentBlockhash: '',
      lastValidBlockHeight: 0,
      instructionCount: 0,
      requiredSigners: [],
    };
  }

  async getBalance(params: PrivatePaymentsBalanceParams) {
    this.logger.debug(`[noop] pp.getBalance deployment=${params.deploymentId}`);
    return { balance: '0', decimals: 0 };
  }
}
