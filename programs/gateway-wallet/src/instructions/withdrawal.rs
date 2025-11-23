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

//! Withdraw instruction handler

use {
    crate::{
        error::GatewayWalletError,
        events::WithdrawalCompleted,
        seeds::{GATEWAY_DEPOSIT_SEED, GATEWAY_WALLET_CUSTODY_SEED, GATEWAY_WALLET_SEED},
        state::{GatewayDeposit, GatewayWallet},
    },
    anchor_lang::prelude::*,
    anchor_spl::token::{Token, TokenAccount},
};

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawContext<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
        constraint = !gateway_wallet.paused @ GatewayWalletError::ProgramPaused
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,

    #[account(
        mut,
        token::authority = gateway_wallet,
        seeds = [GATEWAY_WALLET_CUSTODY_SEED, custody_token_account.mint.key().as_ref()],
        bump = gateway_wallet.get_custody_token_account_bump(custody_token_account.mint)?
    )]
    pub custody_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = custody_token_account.mint,
        token::authority = depositor
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [GATEWAY_DEPOSIT_SEED, deposit.token_mint.key().as_ref(), depositor.key().as_ref()],
        bump = deposit.bump,
        constraint = deposit.token_mint == custody_token_account.mint
    )]
    pub deposit: Account<'info, GatewayDeposit>,

    pub token_program: Program<'info, Token>,
}

pub fn withdraw(ctx: Context<WithdrawContext>) -> Result<()> {
    let deposit = &mut ctx.accounts.deposit;
    let gateway_wallet = &ctx.accounts.gateway_wallet;
    let token_mint = ctx.accounts.custody_token_account.mint;

    require_gt!(
        deposit.withdrawing_amount,
        0,
        GatewayWalletError::NoWithdrawalInProgress
    );

    let current_slot = Clock::get()?.slot;
    require_gte!(
        current_slot,
        deposit.withdrawal_block,
        GatewayWalletError::WithdrawalDelayNotElapsed
    );

    let signer_seeds: &[&[&[u8]]] = &[&[GATEWAY_WALLET_SEED, &[gateway_wallet.bump]]];

    let withdrawal_amount = deposit.complete_withdrawal(
        &ctx.accounts.token_program,
        &ctx.accounts.custody_token_account,
        &ctx.accounts.depositor_token_account,
        gateway_wallet,
        signer_seeds,
    )?;

    emit_cpi!(WithdrawalCompleted {
        token: token_mint,
        depositor: ctx.accounts.depositor.key(),
        value: withdrawal_amount,
    });

    Ok(())
}
