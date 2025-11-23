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

//! Add token instruction handler

use {
    crate::{
        error::GatewayWalletError,
        events::TokenSupported,
        seeds::{GATEWAY_WALLET_CUSTODY_SEED, GATEWAY_WALLET_SEED},
        state::GatewayWallet,
    },
    anchor_lang::prelude::*,
    anchor_spl::token::{Mint, Token, TokenAccount},
};

#[event_cpi]
#[derive(Accounts)]
pub struct AddTokenContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_controller: Signer<'info>,

    #[account(
        mut,
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
        has_one = token_controller @ GatewayWalletError::InvalidAuthority
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = payer,
        token::mint = token_mint,
        token::authority = gateway_wallet,
        seeds = [
            GATEWAY_WALLET_CUSTODY_SEED,
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub custody_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

pub fn add_token(ctx: Context<AddTokenContext>) -> Result<()> {
    // Add the token and custody bump to the supported list
    ctx.accounts.gateway_wallet.add_token(
        ctx.accounts.token_mint.key(),
        ctx.bumps.custody_token_account,
    )?;

    // Emit TokenSupported event
    emit_cpi!(TokenSupported {
        token: ctx.accounts.token_mint.key(),
        custody_token_account: ctx.accounts.custody_token_account.key()
    });

    Ok(())
}
