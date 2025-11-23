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
        error::GatewayMinterError,
        events::TokenSupported,
        seeds::{GATEWAY_MINTER_CUSTODY_SEED, GATEWAY_MINTER_SEED},
        state::GatewayMinter,
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
        seeds = [GATEWAY_MINTER_SEED],
        bump = gateway_minter.bump,
        has_one = token_controller @ GatewayMinterError::InvalidAuthority
    )]
    pub gateway_minter: Box<Account<'info, GatewayMinter>>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = payer,
        token::mint = token_mint,
        token::authority = gateway_minter,
        seeds = [
            GATEWAY_MINTER_CUSTODY_SEED,
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
    ctx.accounts.gateway_minter.add_token(
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
