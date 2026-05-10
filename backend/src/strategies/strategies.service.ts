import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  PublicKey,
  Transaction,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  StrategyCompilerService,
  type CompiledStrategyIR,
  type PrivateStrategyDefinition,
  type PublicStrategyDefinition,
  type StrategyPublicMetadata,
} from '../strategy-compiler/strategy-compiler.service';
import { type WorkflowDefinition } from '../web3/workflow-types';
import { type CreateStrategyDto } from './dto/create-strategy.dto';
import { type UpdateStrategyDto } from './dto/update-strategy.dto';
import {
  StrategiesRepository,
  type StrategyLifecycleState,
  type StrategyRow,
  type StrategyVisibilityMode,
} from './strategies.repository';
import {
  StrategyVersionsRepository,
  type StrategyVersionRow,
} from './strategy-versions.repository';
import {
  StrategyPurchasesRepository,
  type StrategyPurchaseRow,
} from './strategy-purchases.repository';
import { CreatorSubscriptionsService } from '../creator-subscriptions/creator-subscriptions.service';

export interface StrategyPublicView {
  id: string;
  ownerWalletAddress: string;
  name: string;
  description: string | null;
  visibilityMode: StrategyVisibilityMode;
  lifecycleState: StrategyLifecycleState;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  publicMetadata: StrategyPublicMetadata;
  publicDefinition: PublicStrategyDefinition;
}

export interface StrategyPrivateView extends StrategyPublicView {
  sourceWorkflowId: string | null;
  privateDefinition: PrivateStrategyDefinition;
  compiledIr: CompiledStrategyIR;
}

export interface MarketplaceStrategyView extends StrategyPublicView {
  /** Subscriber count is keyed on the *creator*, not the strategy — one
   *  subscription unlocks every strategy the creator has published. */
  creatorSubscriberCount: number;
  creatorVerified: boolean;
  creatorDisplayName: string | null;
  creatorMonthlyPriceAmount: string | null;
  creatorPaymentMint: string | null;
  /** Per-strategy one-time buyout fields. `forSaleOneTime` derived from price ≠ NULL. */
  forSaleOneTime: boolean;
  purchasePriceAmount: string | null;
  purchasePaymentMint: string | null;
}

export interface StrategyPurchaseQuoteView {
  strategyId: string;
  priceAmount: string | null;
  paymentMint: string | null;
  payoutWallet: string | null;
  alreadyOwned: boolean;
}

export interface StrategyPurchaseView {
  id: string;
  strategyId: string;
  buyerWallet: string;
  priceAmount: string;
  paymentMint: string;
  payoutWallet: string;
  paymentTxSignature: string;
  createdAt: string;
}

export type MarketplaceSort = 'recent' | 'trending';

@Injectable()
export class StrategiesService {
  private readonly logger = new Logger(StrategiesService.name);

  constructor(
    private readonly strategyCompilerService: StrategyCompilerService,
    private readonly strategiesRepository: StrategiesRepository,
    private readonly strategyVersionsRepository: StrategyVersionsRepository,
    private readonly strategyPurchasesRepository: StrategyPurchasesRepository,
    private readonly configService: ConfigService,
    @Optional()
    private readonly creatorSubscriptionsService?: CreatorSubscriptionsService,
  ) {}

  async createStrategy(
    walletAddress: string,
    dto: CreateStrategyDto,
  ): Promise<StrategyPrivateView> {
    const definition = await this.resolveDefinitionFromInput(walletAddress, dto);
    this.validateStrategyDefinition(definition);

    if (dto.telegramChatId) {
      await this.strategiesRepository.upsertTelegramMapping(walletAddress, dto.telegramChatId);
    }

    const compiled = this.strategyCompilerService.compileStrategyIR(definition);
    this.assertNativeOnchainStrategy(compiled);
    const visibilityMode = dto.visibilityMode ?? 'private';

    const row = await this.strategiesRepository.insertStrategy({
      creatorWalletAddress: walletAddress,
      sourceWorkflowId: dto.sourceWorkflowId ?? null,
      name: dto.name,
      description: dto.description ?? null,
      visibilityMode,
      publicMetadata: compiled.publicMetadata,
      compiledIr: compiled,
    });

    return this.toPrivateView(row, compiled);
  }

  async listPublicStrategies(): Promise<StrategyPublicView[]> {
    const rows = await this.strategiesRepository.listPublicStrategies();
    return rows.map((row) => this.toPublicView(row));
  }

  /**
   * Public marketplace listing — every published strategy with creator-level
   * denorm fields (verified flag, display name, subscriber count, plan
   * price). Per-strategy PnL is not bundled here; clients call
   * `GET /strategies/:id/pnl` for the chart-ready timeseries.
   *
   * `recent` orders by `updated_at desc` (matches the underlying repo).
   * `trending` re-sorts in-memory by subscriber_count desc, ties broken by
   * recency. Limit is clamped 1..100.
   */
  async listMarketplaceStrategies(
    opts: {
      sort?: MarketplaceSort;
      limit?: number;
    } = {},
  ): Promise<MarketplaceStrategyView[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 100));
    const sort = opts.sort ?? 'recent';
    const rows = await this.strategiesRepository.listPublicStrategies();
    const creatorWallets = Array.from(new Set(rows.map((r) => r.creator_wallet_address)));
    const [plans, counts] = this.creatorSubscriptionsService
      ? await Promise.all([
          this.creatorSubscriptionsService.listPlansByWallets(creatorWallets),
          this.creatorSubscriptionsService.countActiveSubscribersByCreator(creatorWallets),
        ])
      : [new Map<string, never>(), new Map<string, number>(creatorWallets.map((w) => [w, 0]))];
    const enriched: MarketplaceStrategyView[] = rows.map((row) => {
      const plan = plans.get(row.creator_wallet_address) as
        | {
            verified: boolean;
            display_name: string | null;
            monthly_price_amount: string;
            payment_mint: string;
          }
        | undefined;
      return {
        ...this.toPublicView(row),
        creatorSubscriberCount: counts.get(row.creator_wallet_address) ?? 0,
        creatorVerified: plan?.verified ?? false,
        creatorDisplayName: plan?.display_name ?? null,
        creatorMonthlyPriceAmount: plan?.monthly_price_amount ?? null,
        creatorPaymentMint: plan?.payment_mint ?? null,
        forSaleOneTime: row.purchase_price_amount !== null,
        purchasePriceAmount: row.purchase_price_amount,
        purchasePaymentMint: row.purchase_payment_mint,
      };
    });
    if (sort === 'trending') {
      enriched.sort((a, b) => {
        const delta = b.creatorSubscriberCount - a.creatorSubscriberCount;
        if (delta !== 0) return delta;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
    }
    return enriched.slice(0, limit);
  }

  async listSubscribedPublishedStrategies(walletAddress: string): Promise<StrategyPublicView[]> {
    if (!this.creatorSubscriptionsService) {
      throw new BadRequestException('Creator subscriptions are not available');
    }
    const subscriptions = await this.creatorSubscriptionsService.listMine(walletAddress);
    const activeCreatorWallets = subscriptions
      .filter(
        (sub) =>
          sub.status === 'active' &&
          sub.currentPeriodEnd !== null &&
          new Date(sub.currentPeriodEnd) > new Date(),
      )
      .map((sub) => sub.creatorWallet);
    const rows =
      await this.strategiesRepository.listPublishedStrategiesForCreators(activeCreatorWallets);
    return rows.map((row) => this.toPublicView(row));
  }

  /**
   * Strategy-level PnL timeseries. Public — anyone can read, since the
   * underlying snapshots are explicitly the marketplace surface. The
   * default window is 30 days; clamped to 1..90.
   */
  async getStrategyPnl(strategyId: string, opts: { days?: number } = {}) {
    const days = Math.max(1, Math.min(opts.days ?? 30, 90));
    // Existence check — surfaces a clean 404 when the strategy is unknown.
    const strategy = await this.strategiesRepository.getStrategyById(strategyId);
    const points = await this.strategiesRepository.listStrategyPnlTimeseries(strategy.id, days);
    const latest = points.length > 0 ? points[points.length - 1] : null;
    return {
      strategyId: strategy.id,
      windowDays: days,
      latestPnlSummaryBps: latest?.pnlSummaryBps ?? null,
      latestRiskBand: latest?.riskBand ?? null,
      pointCount: points.length,
      points,
    };
  }

  async listStrategiesForOwner(walletAddress: string): Promise<StrategyPrivateView[]> {
    const rows = await this.strategiesRepository.listStrategiesForCreator(walletAddress);
    return rows.map((row) => {
      const compiled = this.requireCompiledIr(row);
      return this.toPrivateView(row, compiled);
    });
  }

  async getPublicStrategy(id: string): Promise<StrategyPublicView> {
    const row = await this.strategiesRepository.getStrategyById(id);
    if (row.visibility_mode !== 'public' || row.lifecycle_state !== 'published') {
      throw new BadRequestException('Strategy is not published');
    }
    return this.toPublicView(row);
  }

  async getStrategyForViewer(id: string, walletAddress: string): Promise<StrategyPublicView> {
    const row = await this.strategiesRepository.getStrategyById(id);
    if (row.creator_wallet_address === walletAddress) {
      const compiled = this.requireCompiledIr(row);
      return this.toPrivateView(row, compiled);
    }
    if (row.visibility_mode !== 'public' || row.lifecycle_state !== 'published') {
      throw new BadRequestException('Strategy is not published');
    }
    // Buyout takes precedence over creator subscription as a private-view
    // unlock: it's a one-time grant scoped to this strategy.
    const purchase = await this.strategyPurchasesRepository.getByStrategyAndBuyer(
      row.id,
      walletAddress,
    );
    if (purchase) {
      const compiled = this.requireCompiledIr(row);
      return this.toPrivateView(row, compiled);
    }
    if (!this.creatorSubscriptionsService) {
      throw new BadRequestException('Creator subscriptions are not available');
    }
    await this.creatorSubscriptionsService.assertActiveSubscription(
      row.creator_wallet_address,
      walletAddress,
    );
    return this.toPublicView(row);
  }

  async getStrategyForOwner(id: string, walletAddress: string): Promise<StrategyPrivateView> {
    const row = await this.strategiesRepository.getStrategyForCreator(id, walletAddress);
    const compiled = this.requireCompiledIr(row);
    return this.toPrivateView(row, compiled);
  }

  async updateStrategy(
    id: string,
    walletAddress: string,
    dto: UpdateStrategyDto,
  ): Promise<StrategyPrivateView> {
    // Ownership check; throws NotFound if the wallet doesn't own this strategy.
    await this.strategiesRepository.getStrategyForCreator(id, walletAddress);

    let recompiled: CompiledStrategyIR | undefined;

    if (dto.definition !== undefined) {
      const definition = dto.definition as WorkflowDefinition;
      this.validateStrategyDefinition(definition);
      recompiled = this.strategyCompilerService.compileStrategyIR(definition);
      this.assertNativeOnchainStrategy(recompiled);
    }

    if (dto.telegramChatId) {
      await this.strategiesRepository.upsertTelegramMapping(walletAddress, dto.telegramChatId);
    }

    const updated = await this.strategiesRepository.updateStrategy(id, walletAddress, {
      name: dto.name,
      description: dto.description ?? undefined,
      visibilityMode: dto.visibilityMode,
      publicMetadata: recompiled?.publicMetadata,
      compiledIr: recompiled,
    });

    return this.toPrivateView(updated, recompiled ?? this.requireCompiledIr(updated));
  }

  async compileStrategy(id: string, walletAddress: string): Promise<CompiledStrategyIR> {
    const row = await this.strategiesRepository.getStrategyForCreator(id, walletAddress);
    return this.requireCompiledIr(row);
  }

  async publishStrategy(id: string, walletAddress: string): Promise<StrategyPrivateView> {
    const existing = await this.strategiesRepository.getStrategyForCreator(id, walletAddress);
    const compiled = this.requireCompiledIr(existing);
    this.assertNativeOnchainStrategy(compiled);
    const nextVersion = existing.current_version + 1;

    const versionRow = await this.strategyVersionsRepository.insertVersion({
      strategyId: id,
      version: nextVersion,
      publicMetadataHash: compiled.publicMetadata.publicMetadataHash,
      privateDefinitionCommitment: compiled.privateDefinition.privateDefinitionCommitment,
      compiledIr: compiled,
    });

    this.logger.log(
      `Strategy ${id} published as version ${versionRow.version} (id=${versionRow.id})`,
    );

    const updated = await this.strategiesRepository.updateStrategy(id, walletAddress, {
      visibilityMode: 'public',
      lifecycleState: 'published',
      publicMetadata: compiled.publicMetadata,
      compiledIr: compiled,
      currentVersion: nextVersion,
    });

    return this.toPrivateView(updated, compiled);
  }

  async getLatestPublishedVersion(strategyId: string): Promise<StrategyVersionRow> {
    return this.strategyVersionsRepository.getLatestPublished(strategyId);
  }

  // ---------------- Strategy buyout (one-time per-strategy purchase) ----------

  /**
   * Owner sets or unsets a one-time buyout price. Pass `priceAmount: null`
   * (with paymentMint also null) to take the strategy off-sale.
   */
  async setPurchasePrice(
    id: string,
    walletAddress: string,
    params: { priceAmount: string | null; paymentMint: string | null },
  ): Promise<StrategyPublicView> {
    if ((params.priceAmount === null) !== (params.paymentMint === null)) {
      throw new BadRequestException(
        'Both priceAmount and paymentMint must be provided together (or both null to unset)',
      );
    }
    if (params.priceAmount !== null) {
      try {
        if (BigInt(params.priceAmount) <= 0n) {
          throw new BadRequestException('priceAmount must be greater than zero');
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw new BadRequestException('priceAmount must be a non-negative integer string');
      }
    }
    // Ownership check
    await this.strategiesRepository.getStrategyForCreator(id, walletAddress);
    const updated = await this.strategiesRepository.updateStrategy(id, walletAddress, {
      purchasePriceAmount: params.priceAmount,
      purchasePaymentMint: params.paymentMint,
    });
    return this.toPublicView(updated);
  }

  /**
   * Public quote for the buyout modal. Returns the listed price + the
   * creator's payout wallet (sourced from the creator subscription plan), and
   * a hint whether the caller already owns the strategy.
   */
  async getPurchaseQuote(
    id: string,
    walletAddress: string | null,
  ): Promise<StrategyPurchaseQuoteView> {
    const row = await this.strategiesRepository.getStrategyById(id);
    if (row.purchase_price_amount === null || row.purchase_payment_mint === null) {
      return {
        strategyId: row.id,
        priceAmount: null,
        paymentMint: null,
        payoutWallet: null,
        alreadyOwned: false,
      };
    }
    const payoutWallet = await this.resolveCreatorPayoutWallet(row.creator_wallet_address);
    let alreadyOwned = false;
    if (walletAddress) {
      const purchase = await this.strategyPurchasesRepository.getByStrategyAndBuyer(
        row.id,
        walletAddress,
      );
      alreadyOwned = Boolean(purchase) || row.creator_wallet_address === walletAddress;
    }
    return {
      strategyId: row.id,
      priceAmount: row.purchase_price_amount,
      paymentMint: row.purchase_payment_mint,
      payoutWallet,
      alreadyOwned,
    };
  }

  /**
   * Build an unsigned SPL transfer transaction the buyer signs to purchase
   * the strategy. Uses the same idempotent-ATA pattern as creator subscription
   * payments.
   */
  async buildPurchaseIntent(
    id: string,
    walletAddress: string,
  ): Promise<{
    strategyId: string;
    priceAmount: string;
    paymentMint: string;
    payoutWallet: string;
    onchainPayment: {
      transactionBase64: string;
      recentBlockhash: string;
      lastValidBlockHeight: number;
      feePayer: string;
      sourceTokenAccount: string;
      destinationTokenAccount: string;
    };
  }> {
    const row = await this.strategiesRepository.getStrategyById(id);
    if (row.purchase_price_amount === null || row.purchase_payment_mint === null) {
      throw new BadRequestException('Strategy is not for sale');
    }
    if (row.creator_wallet_address === walletAddress) {
      throw new BadRequestException('Creators do not need to buy their own strategies');
    }
    const existing = await this.strategyPurchasesRepository.getByStrategyAndBuyer(
      row.id,
      walletAddress,
    );
    if (existing) {
      throw new BadRequestException('Strategy already purchased by this wallet');
    }
    const payoutWallet = await this.resolveCreatorPayoutWallet(row.creator_wallet_address);
    if (!payoutWallet) {
      throw new BadRequestException(
        'Creator has not configured a payout wallet (no creator subscription plan)',
      );
    }

    const connection = new Connection(this.getRpcUrl(), 'confirmed');
    const buyer = new PublicKey(walletAddress);
    const payout = new PublicKey(payoutWallet);
    const mint = new PublicKey(row.purchase_payment_mint);
    const decimals = this.getPaymentMintDecimals();
    const sourceTokenAccount = getAssociatedTokenAddressSync(mint, buyer);
    const destinationTokenAccount = getAssociatedTokenAddressSync(mint, payout);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    const tx = new Transaction({ feePayer: buyer, recentBlockhash: blockhash }).add(
      createAssociatedTokenAccountIdempotentInstruction(
        buyer,
        destinationTokenAccount,
        payout,
        mint,
      ),
      createTransferCheckedInstruction(
        sourceTokenAccount,
        mint,
        destinationTokenAccount,
        buyer,
        BigInt(row.purchase_price_amount),
        decimals,
      ),
    );
    return {
      strategyId: row.id,
      priceAmount: row.purchase_price_amount,
      paymentMint: row.purchase_payment_mint,
      payoutWallet,
      onchainPayment: {
        transactionBase64: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString('base64'),
        recentBlockhash: blockhash,
        lastValidBlockHeight,
        feePayer: buyer.toBase58(),
        sourceTokenAccount: sourceTokenAccount.toBase58(),
        destinationTokenAccount: destinationTokenAccount.toBase58(),
      },
    };
  }

  /**
   * Verify the on-chain SPL transfer matches the listed price/mint/payout
   * and record the purchase. Idempotent via the UNIQUE
   * `strategy_purchases.payment_tx_signature` constraint — re-confirming with
   * the same signature returns 400 instead of double-charging access.
   */
  async confirmPurchase(
    id: string,
    walletAddress: string,
    txSignature: string,
  ): Promise<StrategyPurchaseView> {
    if (!txSignature) {
      throw new BadRequestException('txSignature is required');
    }
    const row = await this.strategiesRepository.getStrategyById(id);
    if (row.purchase_price_amount === null || row.purchase_payment_mint === null) {
      throw new BadRequestException('Strategy is not for sale');
    }
    const existing = await this.strategyPurchasesRepository.getByStrategyAndBuyer(
      row.id,
      walletAddress,
    );
    if (existing) {
      throw new BadRequestException('Strategy already purchased by this wallet');
    }
    if (await this.strategyPurchasesRepository.txSignatureExists(txSignature)) {
      throw new BadRequestException('Payment transaction has already been used');
    }

    const payoutWallet = await this.resolveCreatorPayoutWallet(row.creator_wallet_address);
    if (!payoutWallet) {
      throw new BadRequestException(
        'Creator has not configured a payout wallet (no creator subscription plan)',
      );
    }

    await this.verifyPaymentTransaction({
      txSignature,
      buyerWallet: walletAddress,
      payoutWallet,
      paymentMint: row.purchase_payment_mint,
      amount: row.purchase_price_amount,
    });

    const inserted = await this.strategyPurchasesRepository.insert({
      strategyId: row.id,
      buyerWallet: walletAddress,
      priceAmount: row.purchase_price_amount,
      paymentMint: row.purchase_payment_mint,
      paymentTxSignature: txSignature,
      payoutWallet,
    });
    return this.toPurchaseView(inserted);
  }

  async listPurchasesForBuyer(walletAddress: string): Promise<StrategyPurchaseView[]> {
    const rows = await this.strategyPurchasesRepository.listByBuyer(walletAddress);
    return rows.map((row) => this.toPurchaseView(row));
  }

  // ---------------- Strategy buyout helpers --------------------------------

  private async resolveCreatorPayoutWallet(creatorWallet: string): Promise<string | null> {
    if (!this.creatorSubscriptionsService) return null;
    const plans = await this.creatorSubscriptionsService.listPlansByWallets([creatorWallet]);
    const plan = plans.get(creatorWallet);
    return plan?.payout_wallet ?? null;
  }

  /**
   * Verify the on-chain SPL transfer mint/amount/destination match the
   * expected buyout. Mirrors the verification used by
   * CreatorSubscriptionsService — kept inline here because the buyout flow
   * uses a different lookup key (strategy_purchases) and we want a tight
   * audit log scoped to the purchase.
   */
  private async verifyPaymentTransaction(params: {
    txSignature: string;
    buyerWallet: string;
    payoutWallet: string;
    paymentMint: string;
    amount: string;
  }): Promise<void> {
    const connection = new Connection(this.getRpcUrl(), 'confirmed');
    const tx = await connection.getParsedTransaction(params.txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) {
      throw new BadRequestException('Payment transaction not found or not confirmed');
    }
    if (tx.meta?.err) {
      throw new BadRequestException('Payment transaction failed on-chain');
    }
    const matched = this.findMatchingTokenTransfer(tx, params);
    if (!matched) {
      throw new BadRequestException(
        'Payment transaction does not contain the required SPL transfer for this purchase',
      );
    }
    const destinationOwner = await this.resolveTokenAccountOwner(
      connection,
      tx,
      matched.destination,
    );
    if (destinationOwner !== params.payoutWallet) {
      throw new BadRequestException('Payment recipient does not match creator payout wallet');
    }
  }

  private findMatchingTokenTransfer(
    tx: ParsedTransactionWithMeta,
    params: { buyerWallet: string; paymentMint: string; amount: string },
  ): { authority: string; destination: string } | null {
    const topLevel = tx.transaction.message.instructions;
    const inner = (tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions);
    for (const ix of [...topLevel, ...inner]) {
      if (!('parsed' in ix)) continue;
      const parsedIx = ix as ParsedInstruction;
      if (parsedIx.program !== 'spl-token') continue;
      const info = parsedIx.parsed?.info as Record<string, any> | undefined;
      const type = parsedIx.parsed?.type;
      const amount = info?.tokenAmount?.amount ?? info?.amount;
      const authority = info?.authority ?? info?.multisigAuthority;
      if (
        (type === 'transfer' || type === 'transferChecked') &&
        info?.mint === params.paymentMint &&
        amount === params.amount &&
        authority === params.buyerWallet &&
        typeof info?.destination === 'string'
      ) {
        return { authority, destination: info.destination };
      }
    }
    return null;
  }

  private async resolveTokenAccountOwner(
    connection: Connection,
    tx: ParsedTransactionWithMeta,
    tokenAccount: string,
  ): Promise<string | null> {
    const idx = tx.transaction.message.accountKeys.findIndex(
      (k) => k.pubkey.toBase58() === tokenAccount,
    );
    const balanceOwner = [
      ...(tx.meta?.postTokenBalances ?? []),
      ...(tx.meta?.preTokenBalances ?? []),
    ].find((b) => b.accountIndex === idx && b.owner)?.owner;
    if (balanceOwner) return balanceOwner;
    try {
      const account = await connection.getParsedAccountInfo(
        new PublicKey(tokenAccount),
        'confirmed',
      );
      const value = account.value?.data;
      if (value && typeof value === 'object' && 'parsed' in value) {
        return (value.parsed as any)?.info?.owner ?? null;
      }
    } catch (err) {
      this.logger.warn(
        `confirmPurchase: failed to resolve token account owner for ${tokenAccount}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    return null;
  }

  private getRpcUrl(): string {
    const rpcUrl = this.configService.get<string>('SOLANA_RPC_URL');
    if (!rpcUrl) {
      throw new InternalServerErrorException('SOLANA_RPC_URL env var not configured');
    }
    return rpcUrl;
  }

  private getPaymentMintDecimals(): number {
    const raw = this.configService.get<string>('CREATOR_SUBSCRIPTION_USDC_DECIMALS') ?? '6';
    const decimals = Number(raw);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new InternalServerErrorException('Invalid CREATOR_SUBSCRIPTION_USDC_DECIMALS env var');
    }
    return decimals;
  }

  private toPurchaseView(row: StrategyPurchaseRow): StrategyPurchaseView {
    return {
      id: row.id,
      strategyId: row.strategy_id,
      buyerWallet: row.buyer_wallet,
      priceAmount: row.price_amount,
      paymentMint: row.payment_mint,
      payoutWallet: row.payout_wallet,
      paymentTxSignature: row.payment_tx_signature,
      createdAt: row.created_at,
    };
  }

  private async resolveDefinitionFromInput(
    walletAddress: string,
    dto: CreateStrategyDto,
  ): Promise<WorkflowDefinition> {
    if (dto.definition) {
      return dto.definition as WorkflowDefinition;
    }
    if (dto.sourceWorkflowId) {
      const workflow = await this.strategiesRepository.getWorkflowForCreator(
        dto.sourceWorkflowId,
        walletAddress,
      );
      return workflow.definition;
    }
    throw new BadRequestException(
      'Strategy creation requires either definition or sourceWorkflowId',
    );
  }

  private validateStrategyDefinition(definition: any): asserts definition is WorkflowDefinition {
    try {
      this.strategyCompilerService.validateGraph(definition);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid strategy definition',
      );
    }
  }

  private assertNativeOnchainStrategy(compiled: CompiledStrategyIR): void {
    const unsupportedNodes = compiled.nodeClassifications.filter(
      (node) => node.executionPlane !== 'anchor_candidate',
    );
    if (unsupportedNodes.length > 0) {
      const nodeList = unsupportedNodes
        .map((node) => `${node.nodeName || node.nodeId} (${node.nodeType})`)
        .join(', ');
      throw new BadRequestException(
        `Only native on-chain strategy nodes are supported right now. Unsupported nodes: ${nodeList}`,
      );
    }
  }

  private toPublicView(row: StrategyRow): StrategyPublicView {
    const compiled = this.requireCompiledIr(row);
    return {
      id: row.id,
      ownerWalletAddress: row.creator_wallet_address,
      name: row.name,
      description: row.description,
      visibilityMode: row.visibility_mode,
      lifecycleState: row.lifecycle_state,
      currentVersion: row.current_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publicMetadata: compiled.publicMetadata,
      publicDefinition: compiled.publicDefinition,
    };
  }

  private toPrivateView(row: StrategyRow, compiled: CompiledStrategyIR): StrategyPrivateView {
    return {
      ...this.toPublicView(row),
      sourceWorkflowId: row.source_workflow_id,
      privateDefinition: compiled.privateDefinition,
      compiledIr: compiled,
    };
  }

  private requireCompiledIr(row: StrategyRow): CompiledStrategyIR {
    if (row.compiled_ir) {
      return row.compiled_ir as CompiledStrategyIR;
    }
    this.logger.warn(`Strategy ${row.id} missing compiled_ir; recompiling on the fly`);
    throw new BadRequestException(
      'Strategy compiled IR is missing; recompile via POST /strategies/:id/compile',
    );
  }
}
