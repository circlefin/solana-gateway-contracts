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

//! UpdateTokenController instruction handler

use {
    crate::{
        error::GatewayWalletError, events::TokenControllerUpdated, seeds::GATEWAY_WALLET_SEED,
        state::GatewayWallet,
    },
    anchor_lang::prelude::*,
};

#[event_cpi]
#[derive(Accounts)]
pub struct UpdateTokenControllerContext<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
        has_one = owner @ GatewayWalletError::InvalidAuthority
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone)]
pub struct UpdateTokenControllerParams {
    pub new_token_controller: Pubkey,
}

pub fn update_token_controller(
    ctx: Context<UpdateTokenControllerContext>,
    params: &UpdateTokenControllerParams,
) -> Result<()> {
    let state = ctx.accounts.gateway_wallet.as_mut();

    require_keys_neq!(
        params.new_token_controller,
        Pubkey::default(),
        GatewayWalletError::InvalidTokenController
    );

    let previous_token_controller = state.token_controller;
    state.token_controller = params.new_token_controller;

    emit_cpi!(TokenControllerUpdated {
        previous_token_controller,
        new_token_controller: state.token_controller,
    });
    Ok(())
}
