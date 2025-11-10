import {
  type INodeType,
  type IExecuteContext,
  type NodeExecutionData,
} from "../web3-workflow-types";
import {
  type X402PaymentRequirements,
  type X402PaymentProof,
  type X402Response,
  type X402Network,
} from "../types/x402-types";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import fetch from "node-fetch";
import { readFileSync } from "fs";

/**
 * X402 Payment Node
 *
 * This node implements the x402 payment protocol for accessing paid content/APIs.
 * Flow:
 * 1. Requests content from target URL
 * 2. If 402 response, parses payment requirements
 * 3. Creates and signs Solana SPL Token transfer transaction
 * 4. Retries request with X-Payment header containing signed transaction
 * 5. Server validates and submits transaction, then returns content
 */
export class X402PaymentNode implements INodeType {
  description = {
    displayName: "X402 Payment",
    name: "x402Payment",
    group: ["payment"],
    version: 1,
    description:
      "Make payment-required requests using x402 protocol (Solana USDC payments)",
    inputs: ["main"],
    outputs: ["main"],
    telegramNotify: true,
    properties: [
      {
        displayName: "Target URL",
        name: "targetUrl",
        type: "string" as const,
        default: "http://localhost:3001/api/x402/premium",
        description:
          "URL of the x402-protected endpoint you want to access (user can customize)",
      },
      {
        displayName: "Network",
        name: "network",
        type: "options" as const,
        options: [
          { name: "Devnet", value: "devnet" },
          { name: "Mainnet", value: "mainnet" },
        ],
        default: "devnet",
        description: "Solana network to use for payment",
      },
      {
        displayName: "Keypair Path",
        name: "keypairPath",
        type: "string" as const,
        default: "./pay-in-usdc/client.json",
        description: "Path to the wallet keypair JSON file for making payment",
      },
      {
        displayName: "Max Payment Amount (USDC)",
        name: "maxPaymentAmount",
        type: "string" as const,
        default: "1.0",
        description:
          "Maximum USDC amount you're willing to pay (safety limit)",
      },
      {
        displayName: "Token Mint",
        name: "tokenMint",
        type: "string" as const,
        default: "",
        description:
          "Token mint address (leave empty to use default USDC mint for the network)",
      },
      {
        displayName: "RPC Endpoint",
        name: "rpcEndpoint",
        type: "string" as const,
        default: "",
        description:
          "Custom RPC endpoint (leave empty to use default public endpoints)",
      },
      {
        displayName: "Request Method",
        name: "method",
        type: "options" as const,
        options: [
          { name: "GET", value: "GET" },
          { name: "POST", value: "POST" },
        ],
        default: "GET",
        description: "HTTP method to use for the request",
      },
      {
        displayName: "Request Body (JSON)",
        name: "requestBody",
        type: "string" as const,
        default: "",
        description: "Request body for POST requests (JSON string)",
      },
    ],
  };

  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const items = context.getInputData();
    const returnData: NodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        // Get parameters
        const targetUrl = context.getNodeParameter(
          "targetUrl",
          itemIndex
        ) as string;
        const network = context.getNodeParameter(
          "network",
          itemIndex
        ) as "devnet" | "mainnet";
        const keypairPath = context.getNodeParameter(
          "keypairPath",
          itemIndex
        ) as string;
        const maxPaymentAmountStr = context.getNodeParameter(
          "maxPaymentAmount",
          itemIndex
        ) as string;
        const maxPaymentAmount = parseFloat(maxPaymentAmountStr);
        const customTokenMint = context.getNodeParameter(
          "tokenMint",
          itemIndex
        ) as string;
        const customRpcEndpoint = context.getNodeParameter(
          "rpcEndpoint",
          itemIndex
        ) as string;
        const method = context.getNodeParameter("method", itemIndex) as string;
        const requestBody = context.getNodeParameter(
          "requestBody",
          itemIndex
        ) as string;

        console.log("=== X402 Payment Node Execution ===");
        console.log(`Target URL: ${targetUrl}`);
        console.log(`Network: ${network}`);
        console.log(`Max Payment: ${maxPaymentAmount} USDC`);

        // Default USDC mint addresses
        const defaultUSDCMint =
          network === "devnet"
            ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" // Devnet USDC
            : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Mainnet USDC

        const tokenMint = customTokenMint || defaultUSDCMint;

        // Default RPC endpoints
        const defaultRpcEndpoint =
          network === "devnet"
            ? "https://api.devnet.solana.com"
            : "https://api.mainnet-beta.solana.com";

        const rpcEndpoint = customRpcEndpoint || defaultRpcEndpoint;
        const connection = new Connection(rpcEndpoint, "confirmed");

        // Load keypair
        console.log(`Loading keypair from: ${keypairPath}`);
        const keypairData = JSON.parse(readFileSync(keypairPath, "utf-8"));
        const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
        console.log(`Payer wallet: ${payer.publicKey.toBase58()}`);

        // Step 1: Initial request to get payment requirements
        console.log("\nStep 1: Requesting resource (expecting 402)...");
        const initialRequestOptions: any = {
          method,
          headers: {
            "Content-Type": "application/json",
          },
        };

        if (method === "POST" && requestBody) {
          initialRequestOptions.body = requestBody;
        }

        const quoteResponse = await fetch(targetUrl, initialRequestOptions);

        // Check if payment is required
        if (quoteResponse.status !== 402) {
          // No payment required, return response directly
          const data = await quoteResponse.json();
          console.log("✓ No payment required, received direct response");

          returnData.push({
            json: {
              success: true,
              operation: "x402-request",
              paymentRequired: false,
              data,
              statusCode: quoteResponse.status,
            },
          });
          continue;
        }

        // Parse payment requirements
        const paymentReqs =
          (await quoteResponse.json()) as X402PaymentRequirements;
        const recipientTokenAccount = new PublicKey(
          paymentReqs.payment.tokenAccount
        );
        const mint = new PublicKey(paymentReqs.payment.mint);
        const amount = paymentReqs.payment.amount;
        const amountUSDC = paymentReqs.payment.amountUSDC;

        console.log("\n✓ Payment Required (402):");
        console.log(`  Recipient: ${paymentReqs.payment.tokenAccount}`);
        console.log(`  Mint: ${paymentReqs.payment.mint}`);
        console.log(`  Amount: ${amountUSDC} USDC (${amount} smallest units)`);

        // Validate payment amount
        if (amountUSDC > maxPaymentAmount) {
          throw new Error(
            `Payment amount ${amountUSDC} USDC exceeds maximum ${maxPaymentAmount} USDC`
          );
        }

        // Step 2: Get or create payer's token account
        console.log("\nStep 2: Checking/creating payer token account...");
        const payerTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          payer,
          mint,
          payer.publicKey
        );

        console.log(
          `  Payer Token Account: ${payerTokenAccount.address.toBase58()}`
        );

        // Check balance
        const balance = await connection.getTokenAccountBalance(
          payerTokenAccount.address
        );
        console.log(`  Current Balance: ${balance.value.uiAmountString} USDC`);

        if (Number(balance.value.amount) < amount) {
          throw new Error(
            `Insufficient USDC balance. Have: ${balance.value.uiAmountString}, Need: ${amountUSDC}`
          );
        }

        // Step 3: Check if recipient token account exists
        console.log("\nStep 3: Checking recipient token account...");
        let recipientAccountExists = false;
        try {
          await getAccount(connection, recipientTokenAccount);
          recipientAccountExists = true;
          console.log("  ✓ Recipient token account exists");
        } catch (error) {
          console.log(
            "  ⚠ Recipient token account doesn't exist, will create it"
          );
        }

        // Step 4: Create and sign transaction
        console.log("\nStep 4: Creating payment transaction...");
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash();
        const tx = new Transaction({
          feePayer: payer.publicKey,
          blockhash,
          lastValidBlockHeight,
        });

        // Add create account instruction if needed
        if (!recipientAccountExists) {
          // Get recipient wallet from payment requirements
          const recipientWallet = paymentReqs.payment.recipientWallet
            ? new PublicKey(paymentReqs.payment.recipientWallet)
            : null;

          if (!recipientWallet) {
            throw new Error(
              "Recipient token account doesn't exist and recipientWallet not provided in payment requirements"
            );
          }

          const createAccountIx = createAssociatedTokenAccountInstruction(
            payer.publicKey,
            recipientTokenAccount,
            recipientWallet,
            mint
          );
          tx.add(createAccountIx);
          console.log("  + Added create token account instruction");
        }

        // Add transfer instruction
        const transferIx = createTransferInstruction(
          payerTokenAccount.address,
          recipientTokenAccount,
          payer.publicKey,
          amount
        );
        tx.add(transferIx);

        // Sign transaction
        tx.sign(payer);
        const serializedTx = tx.serialize().toString("base64");

        console.log("  ✓ Transaction created and signed");
        console.log(`  Instructions: ${tx.instructions.length}`);

        // Step 5: Create payment proof
        const x402Network: X402Network =
          network === "devnet" ? "solana-devnet" : "solana-mainnet";

        const paymentProof: X402PaymentProof = {
          x402Version: 1,
          scheme: "exact",
          network: x402Network,
          payload: {
            serializedTransaction: serializedTx,
          },
        };

        const xPaymentHeader = Buffer.from(
          JSON.stringify(paymentProof)
        ).toString("base64");

        // Step 6: Retry request with payment proof
        console.log("\nStep 5: Sending payment proof to server...");
        const paymentRequestOptions: any = {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Payment": xPaymentHeader,
          },
        };

        if (method === "POST" && requestBody) {
          paymentRequestOptions.body = requestBody;
        }

        const paidResponse = await fetch(targetUrl, paymentRequestOptions);

        if (!paidResponse.ok && paidResponse.status !== 200) {
          const errorText = await paidResponse.text();
          throw new Error(
            `Payment failed: ${paidResponse.status} - ${errorText}`
          );
        }

        const result = (await paidResponse.json()) as X402Response;

        // Check for error response
        if ("error" in result) {
          throw new Error(`Server error: ${result.error}`);
        }

        console.log("\n✓ Payment successful!");
        if (result.paymentDetails?.explorerUrl) {
          console.log(`  Explorer: ${result.paymentDetails.explorerUrl}`);
        }

        // Return success result
        returnData.push({
          json: {
            success: true,
            operation: "x402-payment",
            paymentRequired: true,
            data: result.data,
            paymentDetails: result.paymentDetails,
            paymentAmount: amountUSDC,
            paymentAmountSmallestUnits: amount,
            network: x402Network,
          },
        });

        console.log("===========================");
      } catch (error) {
        // Error handling
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`\n❌ X402 Payment Error: ${errorMessage}`);

        returnData.push({
          json: {
            success: false,
            error: errorMessage,
            operation: "x402-payment",
            targetUrl: context.getNodeParameter("targetUrl", itemIndex),
            network: context.getNodeParameter("network", itemIndex),
          },
        });
      }
    }

    return [returnData];
  }
}
