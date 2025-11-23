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

//! Undenylist instruction handler

use {
    crate::{
        error::GatewayWalletError,
        events::UnDenylisted,
        seeds::{DENYLIST_SEED, GATEWAY_WALLET_SEED},
        state::{Denylist, GatewayWallet},
    },
    anchor_lang::prelude::*,
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: UndenylistParams)]
pub struct UndenylistContext<'info> {
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
        mut,
        seeds = [DENYLIST_SEED, params.account.key().as_ref()],
        bump,
        close = payer
    )]
    pub denylist: Account<'info, Denylist>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone)]
pub struct UndenylistParams {
    pub account: Pubkey,
}

pub fn undenylist(ctx: Context<UndenylistContext>, params: &UndenylistParams) -> Result<()> {
    emit_cpi!(UnDenylisted {
        addr: params.account,
    });

    Ok(())
}
