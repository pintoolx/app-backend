import { Injectable, Logger } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import { wrap } from '@faremeter/fetch';
import { createLocalWallet } from '@faremeter/wallet-solana';
import { exact } from '@faremeter/payment-solana';
import { SupabaseService } from '../../database/supabase.service';
import { EncryptionService } from '../../encryption/encryption.service';

/**
 * X402 Client Service
 *
 * Handles calling x402-protected APIs using the faremeter client library.
 * Automatically manages payment flow by:
 * 1. Fetching encrypted wallet from database
 * 2. Creating faremeter wallet and payment handler
 * 3. Wrapping fetch to auto-handle 402 responses
 * 4. Making paid API calls transparently
 */
@Injectable()
export class X402ClientService {
    private readonly logger = new Logger(X402ClientService.name);

    constructor(
        private readonly supabaseService: SupabaseService,
        private readonly encryptionService: EncryptionService,
    ) { }

    /**
     * Fetch a paid API endpoint using x402 protocol
     * 
     * This method automatically handles the x402 payment flow:
     * - First request gets 402 with payment requirements
     * - Creates and signs transaction based on requirements
     * - Retries request with X-Payment header
     * - Returns the protected content
     *
     * @param apiUrl - The x402-protected API URL
     * @param accountId - Server-managed account ID
     * @param network - Solana network (devnet or mainnet-beta)
     * @returns API response data
     */
    async fetchWithPayment(
        apiUrl: string,
        accountId: string,
        network: 'devnet' | 'mainnet-beta' = 'devnet',
    ): Promise<any> {
        this.logger.log(`Fetching x402-protected API: ${apiUrl}`);
        this.logger.log(`  Using account: ${accountId}`);
        this.logger.log(`  Network: ${network}`);

        try {
            // 1. Get account from database
            const { data: account, error } = await this.supabaseService.client
                .from('accounts')
                .select('*')
                .eq('id', accountId)
                .single();

            if (error || !account) {
                throw new Error(`Account not found: ${accountId}`);
            }

            this.logger.log(`  ✓ Account loaded: ${account.account_address}`);

            // 2. Decrypt private key
            const privateKeyString = this.encryptionService.decrypt(account.encrypted_private_key);
            const privateKeyArray = JSON.parse(privateKeyString);
            const keypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));

            this.logger.log(`  ✓ Private key decrypted`);

            // 3. Create wallet using faremeter
            const wallet = await createLocalWallet(network, keypair);

            this.logger.log(`  ✓ Faremeter wallet created`);

            // 4. Create payment handler
            // For Solana, we need to provide a mint for token payments
            // If undefined/null, it should handle native SOL
            // The actual token will be determined from the 402 response
            const paymentHandler = exact.createPaymentHandler(wallet, null as any);

            this.logger.log(`  ✓ Payment handler created`);

            // 5. Wrap fetch with payment capability
            const fetchWithPayment = wrap(fetch, {
                handlers: [paymentHandler],
            });

            this.logger.log(`  → Calling API...`);

            // 6. Call API - automatically handles 402 payment!
            const response = await fetchWithPayment(apiUrl);

            this.logger.log(`  ✓ API response received: ${response.status}`);

            // 7. Parse and return response
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API call failed: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            this.logger.log(`  ✓ Payment completed successfully`);

            return data;
        } catch (error) {
            this.logger.error(`  ✗ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
            throw error;
        }
    }

    /**
     * Fetch with payment and return full response details
     * 
     * Similar to fetchWithPayment but returns more detailed information
     * including payment details if available
     */
    async fetchWithPaymentDetails(
        apiUrl: string,
        accountId: string,
        network: 'devnet' | 'mainnet-beta' = 'devnet',
    ): Promise<{
        data: any;
        status: number;
        url: string;
        accountUsed: string;
    }> {
        const data = await this.fetchWithPayment(apiUrl, accountId, network);

        // Get account address for response
        const { data: account } = await this.supabaseService.client
            .from('accounts')
            .select('account_address')
            .eq('id', accountId)
            .single();

        return {
            data,
            status: 200,
            url: apiUrl,
            accountUsed: account?.account_address || accountId,
        };
    }
}
