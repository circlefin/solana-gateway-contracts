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

//! Remove delegate instruction handler

use {
    crate::{
        error::GatewayWalletError,
        events::DelegateRemoved,
        seeds::{DENYLIST_SEED, GATEWAY_DELEGATE_SEED, GATEWAY_WALLET_SEED},
        state::{DelegateStatus, GatewayDelegate, GatewayWallet},
        utils,
    },
    anchor_lang::prelude::*,
    anchor_spl::token::Mint,
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(delegate: Pubkey)]
pub struct RemoveDelegateContext<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
        constraint = !gateway_wallet.paused @ GatewayWalletError::ProgramPaused
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [
            GATEWAY_DELEGATE_SEED,
            token_mint.key().as_ref(),
            depositor.key().as_ref(),
            delegate.as_ref()
        ],
        bump
    )]
    pub delegate_account: Account<'info, GatewayDelegate>,

    /// CHECK: Depositor denylist PDA. Account is denylisted if it exists at the expected PDA.
    #[account(
        seeds = [DENYLIST_SEED, depositor.key().as_ref()],
        bump,
    )]
    pub depositor_denylist: UncheckedAccount<'info>,
}

pub fn remove_delegate(ctx: Context<RemoveDelegateContext>, delegate: Pubkey) -> Result<()> {
    // Ensure that the delegate is not the zero address
    require!(
        delegate != Pubkey::default(),
        GatewayWalletError::InvalidDelegate
    );

    // Verify depositor is not denylisted
    require!(
        !utils::is_account_denylisted(&ctx.accounts.depositor_denylist),
        GatewayWalletError::AccountDenylisted
    );

    // Verify the token is supported
    require!(
        ctx.accounts
            .gateway_wallet
            .is_token_supported(ctx.accounts.token_mint.key()),
        GatewayWalletError::TokenNotSupported
    );

    // Check the existing authorization status
    let existing_status = &ctx.accounts.delegate_account.status;

    // If the address has never been authorized or is already revoked, take no action
    if *existing_status == DelegateStatus::Unauthorized
        || *existing_status == DelegateStatus::Revoked
    {
        return Ok(());
    }

    // Otherwise, mark the authorization as revoked and emit an event
    ctx.accounts.delegate_account.status = DelegateStatus::Revoked;

    emit_cpi!(DelegateRemoved {
        token: ctx.accounts.token_mint.key(),
        depositor: ctx.accounts.depositor.key(),
        delegate,
    });

    Ok(())
}
