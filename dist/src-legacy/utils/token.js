import { PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
// 常見代幣 decimals 緩存
const DECIMALS_CACHE = new Map();
export async function getTokenDecimals(connection, mint) {
    if (DECIMALS_CACHE.has(mint)) {
        return DECIMALS_CACHE.get(mint);
    }
    const mintInfo = await getMint(connection, new PublicKey(mint));
    DECIMALS_CACHE.set(mint, mintInfo.decimals);
    return mintInfo.decimals;
}
export async function toTokenAmount(connection, mint, humanAmount) {
    const decimals = await getTokenDecimals(connection, mint);
    return Math.floor(humanAmount * Math.pow(10, decimals));
}
export async function fromTokenAmount(connection, mint, baseAmount) {
    const decimals = await getTokenDecimals(connection, mint);
    const amount = typeof baseAmount === 'string' ? parseInt(baseAmount) : baseAmount;
    return amount / Math.pow(10, decimals);
}
export async function formatTokenAmount(connection, mint, baseAmount, maxDecimals = 6) {
    const humanAmount = await fromTokenAmount(connection, mint, baseAmount);
    return humanAmount.toFixed(maxDecimals);
}
//# sourceMappingURL=token.js.map