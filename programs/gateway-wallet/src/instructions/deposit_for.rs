/*
 * Copyright (c) 2025, Circle Internet Financial LTD All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

//! Deposit for another user instruction handler

use {
    crate::{
        error::GatewayWalletError,
        events::Deposited,
        seeds::{
            DENYLIST_SEED, GATEWAY_DEPOSIT_SEED, GATEWAY_WALLET_CUSTODY_SEED, GATEWAY_WALLET_SEED,
        },
        state::{GatewayDeposit, GatewayWallet},
        utils,
    },
    anchor_lang::prelude::*,
    anchor_spl::token::{Token, TokenAccount},
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(amount: u64, depositor: Pubkey)]
pub struct DepositForContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub owner: Signer<'info>,

    #[account(
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
        constraint = !gateway_wallet.paused @ GatewayWalletError::ProgramPaused
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,

    #[account(
        mut,
        token::mint = custody_token_account.mint,
        token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::authority = gateway_wallet,
        seeds = [GATEWAY_WALLET_CUSTODY_SEED, custody_token_account.mint.key().as_ref()],
        bump = gateway_wallet.get_custody_token_account_bump(custody_token_account.mint)?
    )]
    pub custody_token_account: Account<'info, TokenAccount>,

    // The deposit account for the specified depositor
    #[account(
        init_if_needed,
        payer = payer,
        space = utils::DISCRIMINATOR_SIZE + GatewayDeposit::INIT_SPACE,
        seeds = [GATEWAY_DEPOSIT_SEED, custody_token_account.mint.key().as_ref(), depositor.as_ref()],
        bump
    )]
    pub deposit: Account<'info, GatewayDeposit>,

    /// CHECK: Sender denylist PDA. Account is denylisted if it exists at the expected PDA.
    #[account(
        seeds = [DENYLIST_SEED, owner.key().as_ref()],
        bump,
    )]
    pub sender_denylist: UncheckedAccount<'info>,

    /// CHECK: Depositor denylist PDA. Account is denylisted if it exists at the expected PDA.
    #[account(
        seeds = [DENYLIST_SEED, depositor.as_ref()],
        bump,
    )]
    pub depositor_denylist: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

pub fn deposit_for(ctx: Context<DepositForContext>, amount: u64, depositor: Pubkey) -> Result<()> {
    require_keys_neq!(
        depositor,
        Pubkey::default(),
        GatewayWalletError::InvalidDepositor
    );

    // Verify sender is not denylisted
    require!(
        !utils::is_account_denylisted(&ctx.accounts.sender_denylist),
        GatewayWalletError::AccountDenylisted
    );

    // Verify depositor is not denylisted
    require!(
        !utils::is_account_denylisted(&ctx.accounts.depositor_denylist),
        GatewayWalletError::AccountDenylisted
    );

    ctx.accounts.deposit.initialize_if_needed(
        ctx.bumps.deposit,
        depositor,
        ctx.accounts.custody_token_account.mint,
    );

    ctx.accounts.deposit.deposit(
        &ctx.accounts.token_program,
        &ctx.accounts.owner_token_account,
        &ctx.accounts.custody_token_account,
        &ctx.accounts.owner,
        amount,
    )?;

    emit_cpi!(Deposited {
        token: ctx.accounts.custody_token_account.mint,
        depositor,
        sender: ctx.accounts.owner.key(),
        value: amount,
    });

    Ok(())
}
