import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  BadRequestException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  getMint,
  createTransferInstruction,
  createCloseAccountInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { createCrossmint, CrossmintWallets, SolanaWallet } from '@crossmint/wallets-sdk';
import { SupabaseService } from '../database/supabase.service';
import { CrossmintWalletAdapter } from './crossmint-wallet.adapter';
import { WorkflowLifecycleManager } from '../workflows/workflow-lifecycle.service';

/**
 * Crossmint Service
 *
 * 負責管理 Crossmint 託管錢包的創建和獲取
 * 使用 Crossmint Server API 進行所有錢包操作
 */
@Injectable()
export class CrossmintService implements OnModuleInit {
  private readonly logger = new Logger(CrossmintService.name);
  private apiKey: string;
  private signerSecret: string;
  private wallets: CrossmintWallets;

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    @Inject(forwardRef(() => WorkflowLifecycleManager))
    private lifecycleManager: WorkflowLifecycleManager,
  ) {}

  onModuleInit() {
    this.apiKey = this.configService.get<string>('crossmint.serverApiKey');
    this.signerSecret = this.configService.get<string>('crossmint.signerSecret');

    if (!this.apiKey) {
      this.logger.warn('CROSSMINT_SERVER_API_KEY is not configured');
      return;
    }

    if (!this.signerSecret) {
      this.logger.warn('CROSSMINT_SIGNER_SECRET is not configured');
      return;
    }

    const crossmint = createCrossmint({ apiKey: this.apiKey });
    this.wallets = CrossmintWallets.from(crossmint);

    const environment = this.configService.get<string>('crossmint.environment') || 'production';
    this.logger.log(`Crossmint service initialized with SDK (${environment})`);
  }

  /**
   * 為用戶創建新的 Crossmint 錢包
   *
   * @param userId - 用戶 ID
   * @param accountIndex - 帳戶索引（用於區分同一用戶的多個錢包）
   * @returns 錢包的 locator 和地址
   */
  async createWalletForUser(
    userId: string,
    accountIndex: number = 0,
  ): Promise<{
    locator: string;
    address: string;
  }> {
    const owner = `userId:${userId}:solana:mpc:${accountIndex}`;

    this.logger.log(`Creating Crossmint wallet for user: ${userId}, index: ${accountIndex}`);

    try {
      const wallet = await this.wallets.createWallet({
        chain: 'solana',
        signer: { type: 'server', secret: this.signerSecret },
        owner,
      });

      this.logger.log(`Crossmint wallet created: ${wallet.address}`);

      return {
        locator: owner,
        address: wallet.address,
      };
    } catch (error) {
      this.logger.error(`Failed to create Crossmint wallet: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to create Crossmint wallet: ${error.message}`,
      );
    }
  }

  /**
   * 獲取 account 的 Crossmint 錢包
   *
   * @param accountId - Account ID (UUID)
   * @returns CrossmintWalletAdapter 實例
   */
  async getWalletForAccount(accountId: string): Promise<CrossmintWalletAdapter> {
    const { data: account, error } = await this.supabaseService.client
      .from('accounts')
      .select('crossmint_wallet_locator, crossmint_wallet_address')
      .eq('id', accountId)
      .single();

    if (error || !account) {
      throw new NotFoundException(`Account not found: ${accountId}`);
    }

    const locator = account.crossmint_wallet_locator || account.crossmint_wallet_address;

    if (!locator) {
      throw new BadRequestException(`Account ${accountId} has no Crossmint wallet configured`);
    }

    try {
      const wallet = SolanaWallet.from(
        await this.wallets.getWallet(locator, {
          chain: 'solana',
          signer: { type: 'server', secret: this.signerSecret },
        }),
      );

      return new CrossmintWalletAdapter(wallet);
    } catch (error) {
      this.logger.error(`Failed to get wallet for account ${accountId}: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to get wallet for account ${accountId}: ${error.message}`,
      );
    }
  }

  /**
   * 創建 account 並自動創建 Crossmint 錢包
   *
   * @param ownerWalletAddress - 用戶錢包地址
   * @param accountName - Account 名稱
   * @returns 新創建的 account
   */
  async createAccountWithWallet(
    ownerWalletAddress: string,
    accountName: string,
    workflowId?: string,
  ): Promise<{
    id: string;
    name: string;
    crossmint_wallet_locator: string;
    crossmint_wallet_address: string;
  }> {
    // 使用隨機 index 避免併發建立時的 race condition
    const accountIndex = randomBytes(4).readUInt32BE(0);

    // 創建 Crossmint 錢包 (使用 owner wallet address 作為 userId)
    const wallet = await this.createWalletForUser(ownerWalletAddress, accountIndex);

    // 創建 account 記錄
    const { data: account, error } = await this.supabaseService.client
      .from('accounts')
      .insert({
        owner_wallet_address: ownerWalletAddress,
        name: accountName,
        crossmint_wallet_locator: wallet.locator,
        crossmint_wallet_address: wallet.address,
        current_workflow_id: workflowId || null,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create account: ${error.message}`);
      throw new InternalServerErrorException(`Failed to create account: ${error.message}`);
    }

    this.logger.log(`Account created with Crossmint wallet: ${account.id}`);

    this.lifecycleManager.startWorkflowForAccount(account.id).catch((err) => {
      this.logger.error(`Failed to start workflow for account ${account.id}`, err);
    });

    return account;
  }

  /**
   * Withdraw all assets (SPL tokens + SOL) from the Crossmint wallet back to the owner wallet
   */
  async withdrawAllAssets(
    accountId: string,
    ownerWalletAddress: string,
  ): Promise<{
    transfers: Array<{ token: string; amount: number; signature: string }>;
    errors: string[];
  }> {
    const transfers: Array<{ token: string; amount: number; signature: string }> = [];
    const errors: string[] = [];

    // 1. Get the Crossmint wallet for this account
    const wallet = await this.getWalletForAccount(accountId);

    // 2. Get RPC connection
    const rpcUrl = this.configService.get<string>('solana.rpcUrl');
    const connection = new Connection(rpcUrl);
    const ownerPubkey = new PublicKey(ownerWalletAddress);

    // 3. Get ALL SPL token accounts owned by this wallet
    const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });

    // 4. For each SPL token account with balance > 0, transfer and close
    for (const { pubkey, account } of tokenAccounts.value) {
      try {
        const tokenAccountInfo = await getAccount(connection, pubkey);
        const balance = tokenAccountInfo.amount;
        const mint = tokenAccountInfo.mint;

        if (balance <= 0n) {
          // No balance, just close the account to reclaim rent
          const closeIx = createCloseAccountInstruction(
            pubkey,
            wallet.publicKey,
            wallet.publicKey,
          );
          const tx = new Transaction().add(closeIx);
          tx.feePayer = wallet.publicKey;
          tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

          try {
            await wallet.signAndSendTransaction(tx);
          } catch (closeErr) {
            errors.push(`Failed to close empty token account ${pubkey.toBase58()}: ${closeErr.message}`);
          }
          continue;
        }

        const mintInfo = await getMint(connection, mint);
        const humanAmount = Number(balance) / 10 ** mintInfo.decimals;

        // Get or create the owner's associated token account
        const ownerAta = getAssociatedTokenAddressSync(mint, ownerPubkey);

        const tx = new Transaction();

        // Check if owner's ATA exists, if not create it
        const ownerAtaInfo = await connection.getAccountInfo(ownerAta);
        if (!ownerAtaInfo) {
          tx.add(
            createAssociatedTokenAccountInstruction(
              wallet.publicKey,
              ownerAta,
              ownerPubkey,
              mint,
            ),
          );
        }

        // Transfer all tokens
        tx.add(
          createTransferInstruction(
            pubkey,
            ownerAta,
            wallet.publicKey,
            balance,
          ),
        );

        // Close the now-empty token account to reclaim rent
        tx.add(
          createCloseAccountInstruction(
            pubkey,
            wallet.publicKey,
            wallet.publicKey,
          ),
        );

        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        const result = await wallet.signAndSendTransaction(tx);
        transfers.push({
          token: mint.toBase58(),
          amount: humanAmount,
          signature: result.signature,
        });
      } catch (err) {
        errors.push(`Failed to transfer token account ${pubkey.toBase58()}: ${err.message}`);
      }
    }

    // 5. LAST: Transfer remaining SOL (after all SPL transfers, so we have SOL for gas)
    try {
      const solBalance = await connection.getBalance(wallet.publicKey);
      // Reserve enough for tx fee + priority fee buffer
      const minReserve = 100_000; // 0.0001 SOL — conservative buffer for fees

      if (solBalance > minReserve) {
        const transferAmount = solBalance - minReserve;
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: ownerPubkey,
            lamports: transferAmount,
          }),
        );
        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        const result = await wallet.signAndSendTransaction(tx);
        transfers.push({
          token: 'SOL',
          amount: transferAmount / LAMPORTS_PER_SOL,
          signature: result.signature,
        });
      } else {
        this.logger.log(`SOL balance too low to transfer (${solBalance} lamports), skipping`);
      }
    } catch (err) {
      errors.push(`Failed to transfer SOL: ${err.message}`);
    }

    return { transfers, errors };
  }

  /**
   * Delete (Archive) an account's wallet
   */
  async deleteWallet(
    accountId: string,
    ownerWalletAddress: string,
  ): Promise<{
    withdrawResult: { transfers: any[]; errors: string[] };
  }> {
    await this.assertAccountOwnership(accountId, ownerWalletAddress);
    this.lifecycleManager.stopWorkflowForAccount(accountId);
    const withdrawResult = await this.withdrawAllAssets(accountId, ownerWalletAddress);

    const { error: deleteError } = await this.supabaseService.client
      .from('accounts')
      .update({ status: 'closed' })
      .eq('id', accountId);

    if (deleteError) {
      throw new InternalServerErrorException(`Failed to delete account: ${deleteError.message}`);
    }

    this.logger.log(`Account soft deleted: ${accountId} by owner ${ownerWalletAddress}`);

    return { withdrawResult };
  }

  async withdrawSol(
    accountId: string,
    ownerWalletAddress: string,
    amountSol: number,
  ): Promise<{ amount: number; signature: string }> {
    await this.assertAccountOwnership(accountId, ownerWalletAddress);

    const wallet = await this.getWalletForAccount(accountId);
    const rpcUrl = this.configService.get<string>('solana.rpcUrl');
    const connection = new Connection(rpcUrl);
    const ownerPubkey = new PublicKey(ownerWalletAddress);

    const solBalance = await connection.getBalance(wallet.publicKey);
    const lamportsToSend = Math.round(amountSol * LAMPORTS_PER_SOL);
    const feeReserve = 10_000; // 0.00001 SOL for tx fee

    if (lamportsToSend <= 0) {
      throw new BadRequestException('Withdraw amount must be greater than 0');
    }

    if (lamportsToSend + feeReserve > solBalance) {
      const available = Math.max(0, solBalance - feeReserve) / LAMPORTS_PER_SOL;
      throw new BadRequestException(
        `Insufficient SOL balance. Available: ${available} SOL, requested: ${amountSol} SOL`,
      );
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: ownerPubkey,
        lamports: lamportsToSend,
      }),
    );
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const result = await wallet.signAndSendTransaction(tx);
    this.logger.log(`SOL withdrawn for account ${accountId}: ${amountSol} SOL, tx: ${result.signature}`);

    return { amount: amountSol, signature: result.signature };
  }

  private async assertAccountOwnership(accountId: string, ownerWalletAddress: string): Promise<void> {
    const { data: account, error } = await this.supabaseService.client
      .from('accounts')
      .select('owner_wallet_address')
      .eq('id', accountId)
      .single();

    if (error || !account) {
      throw new NotFoundException('Account not found');
    }

    if (account.owner_wallet_address !== ownerWalletAddress) {
      throw new ForbiddenException('Unauthorized: Ownership verification failed');
    }
  }
}
