//! Mollusk SVM tests for risk_guard_node.
//!
//! Cases:
//! 1. `initialize_guard` successfully creates the GuardState PDA.
//! 2. `check_drawdown` with value <= max → frozen stays false.
//! 3. `check_drawdown` with value > max → frozen flips to true.
//! 4. `check_drawdown` after frozen → fails with `GuardFrozen`.
//!
//! NOTE: Anchor 0.32.1 still pulls older `solana-instruction 2.x` so we
//! cannot use `ToAccountMetas` / `InstructionData` here — Mollusk needs the
//! 3.x types. We hand-build AccountMetas + Anchor-compatible discriminator
//! + LE-encoded args directly.

use anchor_lang::AccountDeserialize;
use mollusk_svm::{result::Check, Mollusk};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_sdk_ids::{native_loader, system_program};

use risk_guard_node::state::GuardState;

const PROGRAM_NAME: &str = "risk_guard_node";

fn program_id() -> Pubkey {
    // anchor-lang's Pubkey is solana-pubkey 4.x compatible at the byte level;
    // re-pack via to_bytes to dodge nominal-type mismatch.
    Pubkey::new_from_array(risk_guard_node::ID.to_bytes())
}

fn guard_pda(creator: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"risk_guard", creator.as_ref()], &program_id())
}

fn mollusk() -> Mollusk {
    Mollusk::new(&program_id(), PROGRAM_NAME)
}

fn fund(pk: &Pubkey, lamports: u64) -> (Pubkey, Account) {
    (
        *pk,
        Account {
            lamports,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
}

fn empty(pk: &Pubkey) -> (Pubkey, Account) {
    (
        *pk,
        Account {
            lamports: 0,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
}

fn system_program_account() -> (Pubkey, Account) {
    (
        system_program::ID,
        Account {
            lamports: 1,
            data: vec![],
            owner: native_loader::ID,
            executable: true,
            rent_epoch: 0,
        },
    )
}

/// Anchor method discriminator = sha256("global:<snake_case>")[..8].
fn anchor_disc(name: &str) -> [u8; 8] {
    let h = Sha256::digest(format!("global:{name}").as_bytes());
    let mut out = [0u8; 8];
    out.copy_from_slice(&h[..8]);
    out
}

fn init_ix(creator: &Pubkey, max_allowed_bps: u16) -> Instruction {
    let (guard, _) = guard_pda(creator);
    let mut data = anchor_disc("initialize_guard").to_vec();
    data.extend_from_slice(&max_allowed_bps.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*creator, true),         // creator (signer, writable)
            AccountMeta::new(guard, false),           // guard PDA (writable)
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

fn check_ix(creator: &Pubkey, current_drawdown_bps: u16) -> Instruction {
    let (guard, _) = guard_pda(creator);
    let mut data = anchor_disc("check_drawdown").to_vec();
    data.extend_from_slice(&current_drawdown_bps.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*creator, true), // caller (signer, readonly)
            AccountMeta::new(guard, false),            // guard (writable)
        ],
        data,
    }
}

fn anchor_pubkey_eq(a: &anchor_lang::prelude::Pubkey, b: &Pubkey) -> bool {
    a.to_bytes() == b.to_bytes()
}

#[test]
fn case_1_initialize_guard_creates_pda() {
    let mvk = mollusk();
    let creator = Pubkey::new_unique();
    let (guard, _) = guard_pda(&creator);
    let accounts = vec![
        fund(&creator, 5 * LAMPORTS_PER_SOL),
        empty(&guard),
        system_program_account(),
    ];
    let result = mvk.process_and_validate_instruction(
        &init_ix(&creator, 1500),
        &accounts,
        &[Check::success()],
    );
    let guard_after = result
        .resulting_accounts
        .iter()
        .find(|(k, _)| *k == guard)
        .expect("guard account in result");
    let state = GuardState::try_deserialize(&mut guard_after.1.data.as_slice())
        .expect("decode GuardState");
    assert!(anchor_pubkey_eq(&state.creator, &creator));
    assert_eq!(state.max_allowed_bps, 1500);
    assert_eq!(state.last_drawdown_bps, 0);
    assert!(!state.frozen);
}

#[test]
fn case_2_check_below_threshold_keeps_frozen_false() {
    let mvk = mollusk();
    let creator = Pubkey::new_unique();
    let (guard, _) = guard_pda(&creator);
    let init_result = mvk.process_instruction(
        &init_ix(&creator, 1500),
        &[
            fund(&creator, 5 * LAMPORTS_PER_SOL),
            empty(&guard),
            system_program_account(),
        ],
    );
    assert!(init_result.program_result.is_ok(), "init should succeed");

    let guard_acc = init_result
        .resulting_accounts
        .into_iter()
        .find(|(k, _)| *k == guard)
        .unwrap();
    let result = mvk.process_and_validate_instruction(
        &check_ix(&creator, 800),
        &[fund(&creator, 5 * LAMPORTS_PER_SOL), guard_acc],
        &[Check::success()],
    );
    let updated = result
        .resulting_accounts
        .iter()
        .find(|(k, _)| *k == guard)
        .unwrap();
    let state = GuardState::try_deserialize(&mut updated.1.data.as_slice()).unwrap();
    assert_eq!(state.last_drawdown_bps, 800);
    assert!(!state.frozen);
}

#[test]
fn case_3_check_above_threshold_freezes_guard() {
    let mvk = mollusk();
    let creator = Pubkey::new_unique();
    let (guard, _) = guard_pda(&creator);
    let init_result = mvk.process_instruction(
        &init_ix(&creator, 1500),
        &[
            fund(&creator, 5 * LAMPORTS_PER_SOL),
            empty(&guard),
            system_program_account(),
        ],
    );
    let guard_acc = init_result
        .resulting_accounts
        .into_iter()
        .find(|(k, _)| *k == guard)
        .unwrap();
    let result = mvk.process_and_validate_instruction(
        &check_ix(&creator, 1600),
        &[fund(&creator, 5 * LAMPORTS_PER_SOL), guard_acc],
        &[Check::success()],
    );
    let updated = result
        .resulting_accounts
        .iter()
        .find(|(k, _)| *k == guard)
        .unwrap();
    let state = GuardState::try_deserialize(&mut updated.1.data.as_slice()).unwrap();
    assert_eq!(state.last_drawdown_bps, 1600);
    assert!(state.frozen, "guard should be frozen after exceeding threshold");
}

#[test]
fn case_4_check_after_frozen_fails() {
    let mvk = mollusk();
    let creator = Pubkey::new_unique();
    let (guard, _) = guard_pda(&creator);

    let init_result = mvk.process_instruction(
        &init_ix(&creator, 1500),
        &[
            fund(&creator, 5 * LAMPORTS_PER_SOL),
            empty(&guard),
            system_program_account(),
        ],
    );
    let after_init = init_result
        .resulting_accounts
        .into_iter()
        .find(|(k, _)| *k == guard)
        .unwrap();
    let trip_result = mvk.process_instruction(
        &check_ix(&creator, 1600),
        &[fund(&creator, 5 * LAMPORTS_PER_SOL), after_init],
    );
    assert!(trip_result.program_result.is_ok(), "first check trips OK");
    let after_trip = trip_result
        .resulting_accounts
        .into_iter()
        .find(|(k, _)| *k == guard)
        .unwrap();
    let result = mvk.process_instruction(
        &check_ix(&creator, 100),
        &[fund(&creator, 5 * LAMPORTS_PER_SOL), after_trip],
    );
    assert!(
        result.program_result.is_err(),
        "second check on frozen guard must fail"
    );
}
