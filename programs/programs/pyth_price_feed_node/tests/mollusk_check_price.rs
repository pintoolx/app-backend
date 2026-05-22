//! Mollusk SVM tests for pyth_price_feed_node.
//!
//! Cases:
//! 1. `initialize_feed` successfully creates the PythFeedState PDA.
//! 2. `check_price` below target (condition=above) → triggered stays false.
//! 3. `check_price` above target (condition=above) → triggered flips to true.
//! 4. `check_price` after triggered → fails with `AlreadyTriggered`.
//!
//! NOTE: mirrors risk_guard_node's mollusk harness. Anchor 0.32.1 pulls older
//! `solana-instruction 2.x` so we hand-build AccountMetas + Anchor-compatible
//! discriminator + LE-encoded args instead of using `ToAccountMetas` /
//! `InstructionData`. Staleness is disabled (max_staleness_secs = 0) so the
//! tests don't depend on the SVM clock.

use anchor_lang::AccountDeserialize;
use mollusk_svm::{result::Check, Mollusk};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_sdk_ids::{native_loader, system_program};

use pyth_price_feed_node::state::PythFeedState;

const PROGRAM_NAME: &str = "pyth_price_feed_node";

const CONDITION_ABOVE: u8 = 0;

/// A deterministic 32-byte feed id for the tests (stand-in for SOL/USD).
const FEED_ID: [u8; 32] = [7u8; 32];

fn program_id() -> Pubkey {
    Pubkey::new_from_array(pyth_price_feed_node::ID.to_bytes())
}

fn feed_pda(creator: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"pyth_feed", creator.as_ref(), &FEED_ID], &program_id())
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

fn init_ix(
    creator: &Pubkey,
    target_price: i64,
    exponent: i32,
    condition: u8,
    max_staleness_secs: u32,
) -> Instruction {
    let (feed, _) = feed_pda(creator);
    let mut data = anchor_disc("initialize_feed").to_vec();
    data.extend_from_slice(&FEED_ID);
    data.extend_from_slice(&target_price.to_le_bytes());
    data.extend_from_slice(&exponent.to_le_bytes());
    data.push(condition);
    data.extend_from_slice(&max_staleness_secs.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*creator, true), // creator (signer, writable)
            AccountMeta::new(feed, false),    // feed PDA (writable)
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

fn check_ix(creator: &Pubkey, current_price: i64, publish_time: i64) -> Instruction {
    let (feed, _) = feed_pda(creator);
    let mut data = anchor_disc("check_price").to_vec();
    data.extend_from_slice(&current_price.to_le_bytes());
    data.extend_from_slice(&publish_time.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*creator, true), // caller (signer, readonly)
            AccountMeta::new(feed, false),             // feed (writable)
        ],
        data,
    }
}

fn anchor_pubkey_eq(a: &anchor_lang::prelude::Pubkey, b: &Pubkey) -> bool {
    a.to_bytes() == b.to_bytes()
}

#[test]
fn case_1_initialize_feed_creates_pda() {
    let mvk = mollusk();
    let creator = Pubkey::new_unique();
    let (feed, _) = feed_pda(&creator);
    let accounts = vec![
        fund(&creator, 5 * LAMPORTS_PER_SOL),
        empty(&feed),
        system_program_account(),
    ];
    let result = mvk.process_and_validate_instruction(
        &init_ix(&creator, 8_000_000_000, -8, CONDITION_ABOVE, 0),
        &accounts,
        &[Check::success()],
    );
    let feed_after = result
        .resulting_accounts
        .iter()
        .find(|(k, _)| *k == feed)
        .expect("feed account in result");
    let state =
        PythFeedState::try_deserialize(&mut feed_after.1.data.as_slice()).expect("decode state");
    assert!(anchor_pubkey_eq(&state.creator, &creator));
    assert_eq!(state.feed_id, FEED_ID);
    assert_eq!(state.target_price, 8_000_000_000);
    assert_eq!(state.exponent, -8);
    assert_eq!(state.condition, CONDITION_ABOVE);
    assert!(!state.triggered);
}

#[test]
fn case_2_check_below_target_keeps_triggered_false() {
    let mvk = mollusk();
    let creator = Pubkey::new_unique();
    let (feed, _) = feed_pda(&creator);
    let init_result = mvk.process_instruction(
        &init_ix(&creator, 8_000_000_000, -8, CONDITION_ABOVE, 0),
        &[
            fund(&creator, 5 * LAMPORTS_PER_SOL),
            empty(&feed),
            system_program_account(),
        ],
    );
    assert!(init_result.program_result.is_ok(), "init should succeed");
    let feed_acc = init_result
        .resulting_accounts
        .into_iter()
        .find(|(k, _)| *k == feed)
        .unwrap();
    // current 7.5 < target 8.0 (above) → no trigger.
    let result = mvk.process_and_validate_instruction(
        &check_ix(&creator, 7_500_000_000, 0),
        &[fund(&creator, 5 * LAMPORTS_PER_SOL), feed_acc],
        &[Check::success()],
    );
    let updated = result
        .resulting_accounts
        .iter()
        .find(|(k, _)| *k == feed)
        .unwrap();
    let state = PythFeedState::try_deserialize(&mut updated.1.data.as_slice()).unwrap();
    assert_eq!(state.last_price, 7_500_000_000);
    assert!(!state.triggered);
}

#[test]
fn case_3_check_above_target_triggers() {
    let mvk = mollusk();
    let creator = Pubkey::new_unique();
    let (feed, _) = feed_pda(&creator);
    let init_result = mvk.process_instruction(
        &init_ix(&creator, 8_000_000_000, -8, CONDITION_ABOVE, 0),
        &[
            fund(&creator, 5 * LAMPORTS_PER_SOL),
            empty(&feed),
            system_program_account(),
        ],
    );
    let feed_acc = init_result
        .resulting_accounts
        .into_iter()
        .find(|(k, _)| *k == feed)
        .unwrap();
    // current 8.5 > target 8.0 (above) → trigger.
    let result = mvk.process_and_validate_instruction(
        &check_ix(&creator, 8_500_000_000, 0),
        &[fund(&creator, 5 * LAMPORTS_PER_SOL), feed_acc],
        &[Check::success()],
    );
    let updated = result
        .resulting_accounts
        .iter()
        .find(|(k, _)| *k == feed)
        .unwrap();
    let state = PythFeedState::try_deserialize(&mut updated.1.data.as_slice()).unwrap();
    assert_eq!(state.last_price, 8_500_000_000);
    assert!(state.triggered, "feed should latch triggered once above target");
}

#[test]
fn case_4_check_after_triggered_fails() {
    let mvk = mollusk();
    let creator = Pubkey::new_unique();
    let (feed, _) = feed_pda(&creator);
    let init_result = mvk.process_instruction(
        &init_ix(&creator, 8_000_000_000, -8, CONDITION_ABOVE, 0),
        &[
            fund(&creator, 5 * LAMPORTS_PER_SOL),
            empty(&feed),
            system_program_account(),
        ],
    );
    let after_init = init_result
        .resulting_accounts
        .into_iter()
        .find(|(k, _)| *k == feed)
        .unwrap();
    let trip_result = mvk.process_instruction(
        &check_ix(&creator, 8_500_000_000, 0),
        &[fund(&creator, 5 * LAMPORTS_PER_SOL), after_init],
    );
    assert!(trip_result.program_result.is_ok(), "first check trips OK");
    let after_trip = trip_result
        .resulting_accounts
        .into_iter()
        .find(|(k, _)| *k == feed)
        .unwrap();
    let result = mvk.process_instruction(
        &check_ix(&creator, 7_000_000_000, 0),
        &[fund(&creator, 5 * LAMPORTS_PER_SOL), after_trip],
    );
    assert!(
        result.program_result.is_err(),
        "second check on a triggered feed must fail"
    );
}
