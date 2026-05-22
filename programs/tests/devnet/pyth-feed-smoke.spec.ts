/**
 * Devnet smoke for pyth_price_feed_node.
 *
 * Proves the freshly-deployed program at
 *   Cu4NttQKr68uxKpy5V2iMecj5EscruaBMZc9D8sbAMcN
 * accepts all three instructions. Uses a *fresh* keypair for every run so the
 * per-(creator, feed_id) PythFeedState PDA never collides with an earlier run.
 *
 * Run with:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   yarn ts-mocha -p ./tsconfig.json -t 300000 tests/devnet/pyth-feed-smoke.spec.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

// Resolve relative to the workspace root (`programs/`) — we run mocha from there.
const idl = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "target/idl/pyth_price_feed_node.json"), "utf-8"),
);

const PROGRAM_ID = new PublicKey("Cu4NttQKr68uxKpy5V2iMecj5EscruaBMZc9D8sbAMcN");
const PYTH_FEED_SEED = Buffer.from("pyth_feed");
const IS_DEVNET = process.env.ANCHOR_PROVIDER_URL?.includes("devnet") ?? false;

const CONDITION_ABOVE = 0;
// SOL/USD feed id (32-byte hex) — used purely as a PDA seed in this smoke.
const FEED_ID = Array.from(
  Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex"),
);

function loadWallet(): Keypair {
  const p =
    process.env.ANCHOR_WALLET?.replace(/^~/, process.env.HOME ?? "") ??
    path.join(process.env.HOME ?? "", ".config/solana/id.json");
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

describe("pyth_price_feed_node — Devnet Smoke", function () {
  this.timeout(300000);

  if (!IS_DEVNET) {
    before(function () {
      console.log("Skipping — set ANCHOR_PROVIDER_URL to a devnet RPC to enable.");
      this.skip();
    });
    return;
  }

  const payer = loadWallet();
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL!,
    "confirmed",
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = new anchor.Program(idl as anchor.Idl, provider);

  // Per-run fresh creator so the (creator, feed_id) PDA never collides.
  const creator = Keypair.generate();
  let feedPda: PublicKey;
  let bump: number;

  before(async () => {
    [feedPda, bump] = PublicKey.findProgramAddressSync(
      [PYTH_FEED_SEED, creator.publicKey.toBuffer(), Buffer.from(FEED_ID)],
      PROGRAM_ID,
    );

    const fundSig = await connection.sendTransaction(
      new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: creator.publicKey,
          lamports: 0.05 * LAMPORTS_PER_SOL,
        }),
      ),
      [payer],
    );
    await connection.confirmTransaction(fundSig, "confirmed");
    console.log(`creator ${creator.publicKey.toBase58()} funded; feed PDA ${feedPda.toBase58()}`);
  });

  it("initialize_feed creates the PythFeedState PDA", async () => {
    const sig = await program.methods
      .initializeFeed(FEED_ID, new anchor.BN("8000000000"), -8, CONDITION_ABOVE, 0)
      .accountsPartial({
        creator: creator.publicKey,
        feed: feedPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();
    console.log(`initialize_feed sig=${sig}`);

    const state = await (program.account as any).pythFeedState.fetch(feedPda);
    expect(state.creator.toBase58()).to.equal(creator.publicKey.toBase58());
    expect(state.targetPrice.toString()).to.equal("8000000000");
    expect(state.exponent).to.equal(-8);
    expect(state.condition).to.equal(CONDITION_ABOVE);
    expect(state.triggered).to.equal(false);
    expect(state.bump).to.equal(bump);
  });

  it("check_price below target leaves triggered false", async () => {
    const sig = await program.methods
      .checkPrice(new anchor.BN("7500000000"), new anchor.BN(0))
      .accountsPartial({
        caller: creator.publicKey,
        feed: feedPda,
      })
      .signers([creator])
      .rpc();
    console.log(`check_price(7.5) sig=${sig}`);

    const state = await (program.account as any).pythFeedState.fetch(feedPda);
    expect(state.lastPrice.toString()).to.equal("7500000000");
    expect(state.triggered).to.equal(false);
  });

  it("check_price above target flips triggered", async () => {
    const sig = await program.methods
      .checkPrice(new anchor.BN("8500000000"), new anchor.BN(0))
      .accountsPartial({
        caller: creator.publicKey,
        feed: feedPda,
      })
      .signers([creator])
      .rpc();
    console.log(`check_price(8.5) sig=${sig}`);

    const state = await (program.account as any).pythFeedState.fetch(feedPda);
    expect(state.lastPrice.toString()).to.equal("8500000000");
    expect(state.triggered).to.equal(true);
  });

  it("subsequent check_price after trigger fails with AlreadyTriggered", async () => {
    let threw = false;
    try {
      await program.methods
        .checkPrice(new anchor.BN("7000000000"), new anchor.BN(0))
        .accountsPartial({
          caller: creator.publicKey,
          feed: feedPda,
        })
        .signers([creator])
        .rpc();
    } catch (err) {
      threw = true;
      const msg = (err as Error).message ?? String(err);
      expect(msg.toLowerCase()).to.include("alreadytriggered");
    }
    expect(threw, "expected the call to revert").to.equal(true);
  });

  it("reset_trigger clears the latched flag", async () => {
    const sig = await program.methods
      .resetTrigger()
      .accountsPartial({
        creator: creator.publicKey,
        feed: feedPda,
      })
      .signers([creator])
      .rpc();
    console.log(`reset_trigger sig=${sig}`);

    const state = await (program.account as any).pythFeedState.fetch(feedPda);
    expect(state.triggered).to.equal(false);
    expect(state.lastPrice.toString()).to.equal("0");
  });
});
