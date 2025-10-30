import { Account, Address, Blockhash, GetLatestBlockhashApi, GetMultipleAccountsApi, Instruction, Rpc, Signature, SimulateTransactionApi, TransactionSigner } from '@solana/kit';
import { AddressLookupTable } from '@solana-program/address-lookup-table';
import { ConnectionPool } from './connection';
export type SimulationResponse = ReturnType<SimulateTransactionApi['simulateTransaction']>;
export declare const INVALID_BUT_SUFFICIENT_FOR_COMPILATION_BLOCKHASH: BlockhashWithHeight;
export declare function sendAndConfirmTx({ rpc, wsRpc }: ConnectionPool, payer: TransactionSigner, ixs: Instruction[], signers?: TransactionSigner[], luts?: Address[], withDescription?: string): Promise<Signature>;
export type BlockhashWithHeight = {
    blockhash: Blockhash;
    lastValidBlockHeight: bigint;
    slot: bigint;
};
export declare function simulateTx(rpc: Rpc<GetMultipleAccountsApi & SimulateTransactionApi>, payer: Address, ixs: Instruction[], luts: Account<AddressLookupTable>[]): Promise<SimulationResponse>;
export declare function fetchBlockhash(rpc: Rpc<GetLatestBlockhashApi>): Promise<BlockhashWithHeight>;
