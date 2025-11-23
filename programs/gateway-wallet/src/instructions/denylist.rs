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

//! Denylist instruction handler

use {
    crate::{
        error::GatewayWalletError,
        events::Denylisted,
        seeds::{DENYLIST_SEED, GATEWAY_WALLET_SEED},
        state::{Denylist, GatewayWallet},
        utils,
    },
    anchor_lang::prelude::*,
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: DenylistParams)]
pub struct DenylistContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(address = gateway_wallet.denylister @ GatewayWalletError::InvalidAuthority)]
    pub denylister: Signer<'info>,

    #[account(
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = utils::DISCRIMINATOR_SIZE + Denylist::INIT_SPACE,
        seeds = [DENYLIST_SEED, params.account.as_ref()],
        bump
    )]
    pub denylist: Account<'info, Denylist>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone)]
pub struct DenylistParams {
    pub account: Pubkey,
}

pub fn denylist(ctx: Context<DenylistContext>, params: &DenylistParams) -> Result<()> {
    emit_cpi!(Denylisted {
        addr: params.account,
    });

    Ok(())
}
