import { addSignersToTransactionMessage, appendTransactionMessageInstructions, compileTransaction, compressTransactionMessageUsingAddressLookupTables, createTransactionMessage, getBase64EncodedWireTransaction, getSignatureFromTransaction, pipe, sendAndConfirmTransactionFactory, setTransactionMessageFeePayer, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, } from '@solana/kit';
import { fetchAllAddressLookupTable } from '@solana-program/address-lookup-table';
export const INVALID_BUT_SUFFICIENT_FOR_COMPILATION_BLOCKHASH = {
    blockhash: '11111111111111111111111111111111',
    lastValidBlockHeight: 0n,
    slot: 0n,
};
export async function sendAndConfirmTx({ rpc, wsRpc }, payer, ixs, signers = [], luts = [], withDescription = '') {
    const blockhash = await fetchBlockhash(rpc);
    const lutsByAddress = {};
    if (luts.length > 0) {
        const lutAccs = await fetchAllAddressLookupTable(rpc, luts);
        for (const acc of lutAccs) {
            lutsByAddress[acc.address] = acc.data.addresses;
        }
    }
    const tx = await pipe(createTransactionMessage({ version: 0 }), (tx) => appendTransactionMessageInstructions(ixs, tx), (tx) => setTransactionMessageFeePayerSigner(payer, tx), (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx), (tx) => compressTransactionMessageUsingAddressLookupTables(tx, lutsByAddress), (tx) => addSignersToTransactionMessage(signers, tx), (tx) => signTransactionMessageWithSigners(tx));
    const sig = getSignatureFromTransaction(tx);
    try {
        await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: wsRpc })(tx, {
            commitment: 'processed',
            preflightCommitment: 'processed',
            skipPreflight: true,
        });
        console.log(`(${withDescription}) Transaction Hash: ${sig}`);
    }
    catch (e) {
        console.error(`(${withDescription}) Transaction ${sig} failed:`, e);
        let tx;
        try {
            tx = await rpc
                .getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed', encoding: 'json' })
                .send();
        }
        catch (e2) {
            console.log(`(${withDescription}) Error fetching transaction logs:`, e2);
            throw e;
        }
        if (tx && tx.meta?.logMessages) {
            console.log(`(${withDescription}) Transaction logs:`, tx.meta.logMessages);
        }
        else {
            console.log(`(${withDescription}) Transaction logs not found`);
        }
        throw e;
    }
    return sig;
}
export async function simulateTx(rpc, payer, ixs, luts) {
    const lutsByAddress = {};
    if (luts.length > 0) {
        for (const acc of luts) {
            lutsByAddress[acc.address] = acc.data.addresses;
        }
    }
    const transactionMessage = pipe(createTransactionMessage({ version: 0 }), (tx) => setTransactionMessageFeePayer(payer, tx), (tx) => appendTransactionMessageInstructions(ixs, tx), (tx) => compressTransactionMessageUsingAddressLookupTables(tx, lutsByAddress), (tx) => setTransactionMessageLifetimeUsingBlockhash(INVALID_BUT_SUFFICIENT_FOR_COMPILATION_BLOCKHASH, tx));
    const compiledTransaction = compileTransaction(transactionMessage);
    const wireTransactionBytes = getBase64EncodedWireTransaction(compiledTransaction);
    const res = await rpc
        .simulateTransaction(wireTransactionBytes, {
        encoding: 'base64',
        replaceRecentBlockhash: true,
        sigVerify: false,
    })
        .send();
    return res;
}
export async function fetchBlockhash(rpc) {
    const res = await rpc.getLatestBlockhash({ commitment: 'finalized' }).send();
    return {
        blockhash: res.value.blockhash,
        lastValidBlockHeight: res.value.lastValidBlockHeight,
        slot: res.context.slot,
    };
}
//# sourceMappingURL=tx.js.map