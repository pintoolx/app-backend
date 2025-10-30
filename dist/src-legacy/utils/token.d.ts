import { Connection } from '@solana/web3.js';
export declare function getTokenDecimals(connection: Connection, mint: string): Promise<number>;
export declare function toTokenAmount(connection: Connection, mint: string, humanAmount: number): Promise<number>;
export declare function fromTokenAmount(connection: Connection, mint: string, baseAmount: number | string): Promise<number>;
export declare function formatTokenAmount(connection: Connection, mint: string, baseAmount: number | string, maxDecimals?: number): Promise<string>;
