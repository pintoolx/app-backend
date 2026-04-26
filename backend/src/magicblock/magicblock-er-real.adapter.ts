import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import {
  type ErCommitAndUndelegateParams,
  type ErDelegateParams,
  type ErDelegateResult,
  type ErRouteParams,
  type ErRouteResult,
  type MagicBlockErAdapterPort,
} from './magicblock.port';
import { MagicBlockClientService } from './magicblock-client.service';

/**
 * Real ER adapter — Week 4 router-based implementation.
 *
 * Design notes:
 *   - We do not depend on the `ephemeral-rollups-sdk` Rust crate (incompatible
 *     with our current Solana 3.1.x platform-tools). Instead, the strategy
 *     deployment flow expects the client (or a service-built helper TX) to
 *     deliver an already-signed delegate / undelegate transaction targeting
 *     MagicBlock's delegation program. This adapter forwards those raw
 *     transactions through Magic Router and records the resulting signature.
 *   - For day-to-day execution (`route`), we forward arbitrary user
 *     transactions through Magic Router. The Router transparently picks ER
 *     vs mainnet based on which accounts touch a delegated state. The
 *     `routedThrough` field is a best-effort heuristic: when the router
 *     confirms with no error we tag it "er" if the deployment is currently
 *     marked active (caller's job), otherwise "mainnet". Adapter always
 *     returns the actual signature.
 *   - Errors are surfaced as BadRequestException so controllers can map them
 *     to 4xx without bleeding internal error chains.
 */
@Injectable()
export class MagicBlockErRealAdapter implements MagicBlockErAdapterPort {
  private readonly logger = new Logger(MagicBlockErRealAdapter.name);

  constructor(private readonly client: MagicBlockClientService) {}

  /**
   * Records a delegate session for the deployment. Expects the caller to
   * have prepared and signed a `delegate_account` transaction targeting the
   * MagicBlock delegation program. The base64 payload is delivered via
   * deployment metadata: `metadata.erDelegateBase64Tx`.
   *
   * If no payload is present we fall back to "advisory" mode: log the intent,
   * return a sessionId derived from the deployment id, and do nothing on
   * chain. This keeps the lifecycle non-blocking when the user has not yet
   * uploaded a signed delegation tx.
   */
  async delegateAccount(
    params: ErDelegateParams & { signedTxBase64?: string },
  ): Promise<ErDelegateResult> {
    if (!params.signedTxBase64) {
      this.logger.warn(
        `er.delegateAccount deployment=${params.deploymentId} called without signed tx; advisory mode`,
      );
      return { sessionId: `er-advisory-${params.deploymentId}`, signature: null };
    }
    const sig = await this.client.submitBase64Transaction(params.signedTxBase64);
    this.logger.log(
      `er.delegateAccount deployment=${params.deploymentId} account=${params.accountPubkey} signature=${sig}`,
    );
    return { sessionId: sig, signature: sig };
  }

  /**
   * Forwards a raw user-signed transaction through Magic Router. The
   * `routedThrough` flag is informational only.
   */
  async route(params: ErRouteParams): Promise<ErRouteResult> {
    if (!params.base64Tx || params.base64Tx.length === 0) {
      throw new BadRequestException('route requires a non-empty base64Tx');
    }
    const sig = await this.client.submitBase64Transaction(params.base64Tx);
    this.logger.log(`er.route deployment=${params.deploymentId} signature=${sig}`);
    return { signature: sig, routedThrough: 'er' };
  }

  /**
   * Records a commit-and-undelegate. Like `delegateAccount`, the caller must
   * supply a signed transaction (e.g. a `commit_and_undelegate_accounts` ix
   * built on the client side) via metadata. Without one we log the intent
   * and return a null signature so the lifecycle transition still proceeds.
   */
  async commitAndUndelegate(
    params: ErCommitAndUndelegateParams & { signedTxBase64?: string },
  ): Promise<{ signature: string | null }> {
    if (!params.signedTxBase64) {
      this.logger.warn(
        `er.commitAndUndelegate deployment=${params.deploymentId} called without signed tx; advisory mode`,
      );
      return { signature: null };
    }
    const sig = await this.client.submitBase64Transaction(params.signedTxBase64);
    this.logger.log(
      `er.commitAndUndelegate deployment=${params.deploymentId} account=${params.accountPubkey} signature=${sig}`,
    );
    return { signature: sig };
  }
}
