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

//! Burn token custody instruction handler

use {
    crate::{
        error::GatewayMinterError,
        events::TokenCustodyBurned,
        seeds::{GATEWAY_MINTER_CUSTODY_SEED, GATEWAY_MINTER_SEED},
        state::GatewayMinter,
    },
    anchor_lang::prelude::*,
    anchor_spl::token::{Mint, Token, TokenAccount},
};

#[event_cpi]
#[derive(Accounts)]
pub struct BurnTokenCustodyContext<'info> {
    #[account(mut)]
    pub token_controller: Signer<'info>,

    #[account(
        seeds = [GATEWAY_MINTER_SEED],
        bump = gateway_minter.bump,
        has_one = token_controller @ GatewayMinterError::InvalidAuthority
    )]
    pub gateway_minter: Box<Account<'info, GatewayMinter>>,

    #[account(mut)]
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = gateway_minter,
        seeds = [
            GATEWAY_MINTER_CUSTODY_SEED,
            token_mint.key().as_ref()
        ],
        bump = gateway_minter.get_custody_token_account_bump(token_mint.key())?
    )]
    pub custody_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn burn_token_custody(ctx: Context<BurnTokenCustodyContext>, amount: u64) -> Result<()> {
    // Check that the burn amount is valid
    require_neq!(amount, 0, GatewayMinterError::InvalidBurnAmount);

    // Burn up to the total amount in the custody account
    let burn_amount = if ctx.accounts.custody_token_account.amount > amount {
        amount
    } else {
        ctx.accounts.custody_token_account.amount
    };
    ctx.accounts.gateway_minter.burn_token_custody(
        &ctx.accounts.token_program,
        &ctx.accounts.token_mint,
        &ctx.accounts.gateway_minter,
        ctx.accounts.gateway_minter.bump,
        &ctx.accounts.custody_token_account,
        burn_amount,
    )?;

    // Emit TokenCustodyBurned event
    emit_cpi!(TokenCustodyBurned {
        token: ctx.accounts.token_mint.key(),
        custody_token_account: ctx.accounts.custody_token_account.key(),
        amount: burn_amount,
    });

    Ok(())
}
