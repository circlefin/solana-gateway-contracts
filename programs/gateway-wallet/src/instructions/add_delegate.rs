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

//! Add delegate instruction handler

use {
    crate::{
        error::GatewayWalletError,
        events::DelegateAdded,
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
pub struct AddDelegateContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub depositor: Signer<'info>,

    #[account(
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
        constraint = !gateway_wallet.paused @ GatewayWalletError::ProgramPaused
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = payer,
        space = utils::DISCRIMINATOR_SIZE + GatewayDelegate::INIT_SPACE,
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

    /// CHECK: Delegate denylist PDA. Account is denylisted if it exists at the expected PDA.
    #[account(
        seeds = [DENYLIST_SEED, delegate.as_ref()],
        bump,
    )]
    pub delegate_denylist: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn add_delegate(ctx: Context<AddDelegateContext>, delegate: Pubkey) -> Result<()> {
    require!(
        delegate != Pubkey::default(),
        GatewayWalletError::InvalidDelegate
    );

    require!(
        delegate != ctx.accounts.depositor.key(),
        GatewayWalletError::CannotDelegateToSelf
    );

    // Verify depositor is not denylisted
    require!(
        !utils::is_account_denylisted(&ctx.accounts.depositor_denylist),
        GatewayWalletError::AccountDenylisted
    );

    // Verify delegate is not denylisted
    require!(
        !utils::is_account_denylisted(&ctx.accounts.delegate_denylist),
        GatewayWalletError::AccountDenylisted
    );

    require!(
        ctx.accounts
            .gateway_wallet
            .is_token_supported(ctx.accounts.token_mint.key()),
        GatewayWalletError::TokenNotSupported
    );

    // Store the authorization and emit an event
    ctx.accounts.delegate_account.bump = ctx.bumps.delegate_account;
    ctx.accounts.delegate_account.status = DelegateStatus::Authorized;
    ctx.accounts.delegate_account.closeable_at_block = 0; // Currently unused
    ctx.accounts.delegate_account.token = ctx.accounts.token_mint.key();
    ctx.accounts.delegate_account.depositor = ctx.accounts.depositor.key();
    ctx.accounts.delegate_account.delegate = delegate;

    emit_cpi!(DelegateAdded {
        token: ctx.accounts.token_mint.key(),
        depositor: ctx.accounts.depositor.key(),
        delegate,
    });

    Ok(())
}
