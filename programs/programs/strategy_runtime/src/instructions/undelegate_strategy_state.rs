use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke_signed,
    system_instruction,
};

use crate::constants::STRATEGY_STATE_SEED;

/// MagicBlock Delegation Program ID.
const DELEGATION_PROGRAM_ID: Pubkey =
    pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/// Arguments passed by the delegation program in the undelegate callback.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UndelegateArgs {
    pub pda_seeds: Vec<Vec<u8>>,
}

#[derive(Accounts)]
pub struct UndelegateStrategyState<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The delegated strategy_state PDA — ownership was transferred to
    /// the delegation program during delegate.  We restore it here.
    #[account(mut)]
    pub strategy_state: AccountInfo<'info>,

    /// CHECK: Delegation buffer PDA that holds the original data.
    #[account(mut)]
    pub delegation_buffer: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<UndelegateStrategyState>, args: UndelegateArgs) -> Result<()> {
    let strategy_state_key = ctx.accounts.strategy_state.key();
    let buffer = &ctx.accounts.delegation_buffer;

    // 1. Verify the buffer is owned by the delegation program (sanity check)
    require_eq!(
        buffer.owner,
        &DELEGATION_PROGRAM_ID,
        crate::errors::StrategyRuntimeError::InvalidDelegationBuffer
    );

    // 2. Build seeds for invoke_signed
    let seeds_refs: Vec<&[u8]> = args.pda_seeds.iter().map(|s| s.as_slice()).collect();
    let seeds_slice: &[&[u8]] = &seeds_refs;

    let (_, bump) = Pubkey::find_program_address(seeds_slice, &crate::ID);
    let bump_slice: &[u8] = &[bump];
    let signer_seeds: &[&[&[u8]]] = &[&[seeds_refs[0], seeds_refs[1], bump_slice]];

    let buffer_data_len = buffer.data_len();
    let payer = ctx.accounts.payer.key();

    // 3. Re-create the original PDA if it has no lamports (was closed).
    // During delegation the account is typically NOT closed — only ownership
    // changes and data is zeroed — so this branch is a safety net.
    if ctx.accounts.strategy_state.lamports() == 0 {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(buffer_data_len);

        invoke_signed(
            &system_instruction::create_account(
                &payer,
                &strategy_state_key,
                lamports,
                buffer_data_len as u64,
                &crate::ID,
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.strategy_state.to_account_info(),
            ],
            signer_seeds,
        )?;
    } else {
        // Ensure the account is large enough (should already be, but be safe).
        // Since AccountInfo doesn't expose realloc in this Anchor version,
        // we use a system-program allocate CPI when needed.
        let current_data_len = ctx.accounts.strategy_state.data_len();
        if current_data_len < buffer_data_len {
            let rent = Rent::get()?;
            let new_lamports = rent.minimum_balance(buffer_data_len);
            let current_lamports = ctx.accounts.strategy_state.lamports();
            if new_lamports > current_lamports {
                invoke_signed(
                    &system_instruction::transfer(
                        &payer,
                        &strategy_state_key,
                        new_lamports - current_lamports,
                    ),
                    &[
                        ctx.accounts.payer.to_account_info(),
                        ctx.accounts.strategy_state.to_account_info(),
                    ],
                    signer_seeds,
                )?;
            }
            invoke_signed(
                &system_instruction::allocate(&strategy_state_key, buffer_data_len as u64),
                &[ctx.accounts.strategy_state.to_account_info()],
                signer_seeds,
            )?;
        }
    }

    // 4. Assign ownership back to this program
    if ctx.accounts.strategy_state.owner != &crate::ID {
        invoke_signed(
            &system_instruction::assign(&strategy_state_key, &crate::ID),
            &[ctx.accounts.strategy_state.to_account_info()],
            signer_seeds,
        )?;
    }

    // 5. Copy data from buffer back to strategy_state
    {
        let buffer_data = buffer.try_borrow_data()?;
        let mut state_data = ctx.accounts.strategy_state.try_borrow_mut_data()?;
        let len = std::cmp::min(buffer_data_len, state_data.len());
        state_data[..len].copy_from_slice(&buffer_data[..len]);
    }

    msg!(
        "strategy_state undelegated: account={}, data_len={}",
        strategy_state_key,
        buffer_data_len
    );
    Ok(())
}
