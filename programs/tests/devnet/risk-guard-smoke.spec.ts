/**
 * Devnet smoke for risk_guard_node.
 *
 * Proves the freshly-deployed program at
 *   4JKazw3boeciANsXNDPk8eko2Q6RGBRNaDvUvShtodAQ
 * accepts all three instructions. Uses a *fresh* keypair for every run so
 * the per-creator GuardState PDA never collides with an earlier execution.
 *
 * Run with:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   yarn ts-mocha -p ./tsconfig.json -t 300000 tests/devnet/risk-guard-smoke.spec.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

// Resolve relative to the workspace root (`programs/`) — we run mocha from there.
const idl = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "target/idl/risk_guard_node.json"), "utf-8"),
);

const PROGRAM_ID = new PublicKey("4JKazw3boeciANsXNDPk8eko2Q6RGBRNaDvUvShtodAQ");
const GUARD_SEED = Buffer.from("risk_guard");
const IS_DEVNET = process.env.ANCHOR_PROVIDER_URL?.includes("devnet") ?? false;

function loadWallet(): Keypair {
  const p =
    process.env.ANCHOR_WALLET?.replace(/^~/, process.env.HOME ?? "") ??
    path.join(process.env.HOME ?? "", ".config/solana/id.json");
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

describe("risk_guard_node — Devnet Smoke", function () {
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

  // Per-test fresh creator so the (creator, GuardState) PDA never collides.
  const creator = Keypair.generate();
  let guardPda: PublicKey;
  let bump: number;

  before(async () => {
    [guardPda, bump] = PublicKey.findProgramAddressSync(
      [GUARD_SEED, creator.publicKey.toBuffer()],
      PROGRAM_ID,
    );

    // Fund the creator (~0.05 SOL is plenty for one PDA + a few txs).
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
    console.log(`creator ${creator.publicKey.toBase58()} funded; guard PDA ${guardPda.toBase58()}`);
  });

  it("initialize_guard creates the GuardState PDA", async () => {
    const sig = await program.methods
      .initializeGuard(1500)
      .accountsPartial({
        creator: creator.publicKey,
        guard: guardPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();
    console.log(`initialize_guard sig=${sig}`);

    const state = await (program.account as any).guardState.fetch(guardPda);
    expect(state.creator.toBase58()).to.equal(creator.publicKey.toBase58());
    expect(state.maxAllowedBps).to.equal(1500);
    expect(state.lastDrawdownBps).to.equal(0);
    expect(state.frozen).to.equal(false);
    expect(state.bump).to.equal(bump);
  });

  it("check_drawdown below threshold leaves frozen false", async () => {
    const sig = await program.methods
      .checkDrawdown(800)
      .accountsPartial({
        caller: creator.publicKey,
        guard: guardPda,
      })
      .signers([creator])
      .rpc();
    console.log(`check_drawdown(800) sig=${sig}`);

    const state = await (program.account as any).guardState.fetch(guardPda);
    expect(state.lastDrawdownBps).to.equal(800);
    expect(state.frozen).to.equal(false);
  });

  it("check_drawdown above threshold flips frozen", async () => {
    const sig = await program.methods
      .checkDrawdown(1700)
      .accountsPartial({
        caller: creator.publicKey,
        guard: guardPda,
      })
      .signers([creator])
      .rpc();
    console.log(`check_drawdown(1700) sig=${sig}`);

    const state = await (program.account as any).guardState.fetch(guardPda);
    expect(state.lastDrawdownBps).to.equal(1700);
    expect(state.frozen).to.equal(true);
  });

  it("subsequent check_drawdown after freeze fails with GuardFrozen", async () => {
    let threw = false;
    try {
      await program.methods
        .checkDrawdown(100)
        .accountsPartial({
          caller: creator.publicKey,
          guard: guardPda,
        })
        .signers([creator])
        .rpc();
    } catch (err) {
      threw = true;
      const msg = (err as Error).message ?? String(err);
      expect(msg.toLowerCase()).to.include("guardfrozen");
    }
    expect(threw, "expected the call to revert").to.equal(true);
  });

  it("reset_guard clears the frozen flag", async () => {
    const sig = await program.methods
      .resetGuard()
      .accountsPartial({
        creator: creator.publicKey,
        guard: guardPda,
      })
      .signers([creator])
      .rpc();
    console.log(`reset_guard sig=${sig}`);

    const state = await (program.account as any).guardState.fetch(guardPda);
    expect(state.frozen).to.equal(false);
    expect(state.lastDrawdownBps).to.equal(0);
  });
});
