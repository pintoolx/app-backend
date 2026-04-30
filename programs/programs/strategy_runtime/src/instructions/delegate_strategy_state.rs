use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    system_instruction,
};
use anchor_lang::AnchorSerialize;

use crate::constants::STRATEGY_STATE_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::StrategyDeployment;

/// MagicBlock Delegation Program ID.
const DELEGATION_PROGRAM_ID: Pubkey =
    pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/// Discriminator for the `delegate` instruction in the delegation program.
/// 8 bytes: first byte = 0 (Delegate), remaining 7 bytes = 0.
const DELEGATE_DISCRIMINATOR: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];

/// Borsh-serializable args matching `dlp_api::args::DelegateArgs`.
#[derive(AnchorSerialize, AnchorDeserialize)]
struct DelegateArgs {
    commit_frequency_ms: u32,
    seeds: Vec<Vec<u8>>,
    validator: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct DelegateStrategyState<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    /// CHECK: The strategy_state account — will be assigned to delegation program.
    /// We use AccountInfo because the owner changes during this instruction.
    #[account(
        mut,
        seeds = [STRATEGY_STATE_SEED, deployment.key().as_ref()],
        bump,
    )]
    pub strategy_state: AccountInfo<'info>,

    /// CHECK: Delegation buffer PDA — derived under owner program.
    #[account(mut)]
    pub delegation_buffer: AccountInfo<'info>,

    /// CHECK: Delegation record PDA — derived under delegation program.
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,

    /// CHECK: Delegation metadata PDA — derived under delegation program.
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,

    /// CHECK: The MagicBlock delegation program.
    #[account(address = DELEGATION_PROGRAM_ID)]
    pub delegation_program: AccountInfo<'info>,

    /// CHECK: Owner program (this program) — required by delegation program CPI.
    #[account(address = crate::ID)]
    pub owner_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,

    /// Optional: validator pubkey to delegate to.
    pub validator: Option<AccountInfo<'info>>,
}

pub fn handler(ctx: Context<DelegateStrategyState>) -> Result<()> {
    let deployment_key = ctx.accounts.deployment.key();
    let strategy_state_key = ctx.accounts.strategy_state.key();

    // Calculate strategy_state PDA bump
    let (_expected_strategy_state, strategy_state_bump) =
        Pubkey::find_program_address(
            &[STRATEGY_STATE_SEED, deployment_key.as_ref()],
            &crate::ID,
        );
    assert_eq!(_expected_strategy_state, strategy_state_key);

    // PDA signer seeds for strategy_state
    let strategy_state_seeds: &[&[u8]] = &[
        STRATEGY_STATE_SEED,
        deployment_key.as_ref(),
        &[strategy_state_bump],
    ];
    let pda_signer_seeds: &[&[&[u8]]] = &[strategy_state_seeds];

    // Calculate buffer PDA bump
    let buffer_seeds: &[&[u8]] = &[
        b"buffer",
        strategy_state_key.as_ref(),
    ];
    let (_expected_buffer, buffer_bump) = Pubkey::find_program_address(
        buffer_seeds,
        &crate::ID,
    );
    assert_eq!(_expected_buffer, ctx.accounts.delegation_buffer.key());

    let buffer_signer_seeds: &[&[u8]] = &[
        b"buffer",
        strategy_state_key.as_ref(),
        &[buffer_bump],
    ];
    let buffer_signer_seeds_arr: &[&[&[u8]]] = &[buffer_signer_seeds];

    let data_len = ctx.accounts.strategy_state.data_len();

    // 1. Create delegation buffer with same size as strategy_state
    let rent = Rent::get()?;
    let buffer_lamports = rent.minimum_balance(data_len);

    invoke_signed(
        &system_instruction::create_account(
            ctx.accounts.creator.key,
            ctx.accounts.delegation_buffer.key,
            buffer_lamports,
            data_len as u64,
            &crate::ID,
        ),
        &[
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.delegation_buffer.to_account_info(),
        ],
        buffer_signer_seeds_arr,
    )?;

    // 2. Copy strategy_state data -> buffer
    {
        let pda_data = ctx.accounts.strategy_state.try_borrow_data()?;
        let mut buf_data = ctx.accounts.delegation_buffer.try_borrow_mut_data()?;
        buf_data.copy_from_slice(&pda_data);
    }

    // 3. Zero strategy_state data
    {
        let mut pda_data = ctx.accounts.strategy_state.try_borrow_mut_data()?;
        for byte in pda_data.iter_mut() {
            *byte = 0;
        }
    }

    // 4. Assign strategy_state to system program first (direct assign)
    if ctx.accounts.strategy_state.owner != &system_program::ID {
        ctx.accounts.strategy_state.assign(&system_program::ID);
    }

    // 5. Then CPI to system program to assign to delegation program
    if ctx.accounts.strategy_state.owner != &DELEGATION_PROGRAM_ID {
        invoke_signed(
            &system_instruction::assign(
                &strategy_state_key,
                &DELEGATION_PROGRAM_ID,
            ),
            &[
                ctx.accounts.strategy_state.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            pda_signer_seeds,
        )?;
    }

    // 6. Build delegation instruction data
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
    let args = DelegateArgs {
        commit_frequency_ms: 30_000,
        seeds: vec![
            STRATEGY_STATE_SEED.to_vec(),
            deployment_key.to_bytes().to_vec(),
        ],
        validator,
    };

    let mut data = DELEGATE_DISCRIMINATOR.to_vec();
    args.serialize(&mut data)?;

    let ix = Instruction {
        program_id: DELEGATION_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ctx.accounts.creator.key(), true),
            AccountMeta::new(strategy_state_key, true), // PDA signer
            AccountMeta::new_readonly(crate::ID, false),
            AccountMeta::new(ctx.accounts.delegation_buffer.key(), false),
            AccountMeta::new(ctx.accounts.delegation_record.key(), false),
            AccountMeta::new(ctx.accounts.delegation_metadata.key(), false),
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        ],
        data,
    };

    // 7. CPI to delegation program
    invoke_signed(
        &ix,
        &[
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.strategy_state.to_account_info(),
            ctx.accounts.owner_program.to_account_info(),
            ctx.accounts.delegation_buffer.to_account_info(),
            ctx.accounts.delegation_record.to_account_info(),
            ctx.accounts.delegation_metadata.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        pda_signer_seeds,
    )?;

    // 8. Close buffer: transfer lamports back to payer and zero data
    {
        let mut buffer_lamports = ctx.accounts.delegation_buffer.lamports.borrow_mut();
        let mut creator_lamports = ctx.accounts.creator.lamports.borrow_mut();
        **creator_lamports += **buffer_lamports;
        **buffer_lamports = 0;

        let mut buffer_data = ctx.accounts.delegation_buffer.try_borrow_mut_data()?;
        for byte in buffer_data.iter_mut() {
            *byte = 0;
        }
    }

    msg!(
        "strategy_state delegated: deployment={}, validator={:?}",
        deployment_key,
        validator
    );
    Ok(())
}
