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

//! AcceptOwnership instruction handler for GatewayMinter

use {
    crate::{
        error::GatewayMinterError, events::OwnershipTransferred, seeds::GATEWAY_MINTER_SEED,
        state::GatewayMinter,
    },
    anchor_lang::prelude::*,
};

#[event_cpi]
#[derive(Accounts)]
pub struct AcceptOwnershipContext<'info> {
    pub pending_owner: Signer<'info>,

    #[account(
        mut,
        seeds = [GATEWAY_MINTER_SEED],
        bump = gateway_minter.bump,
        has_one = pending_owner @ GatewayMinterError::InvalidAuthority
    )]
    pub gateway_minter: Box<Account<'info, GatewayMinter>>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone)]
pub struct AcceptOwnershipParams {}

pub fn accept_ownership(
    ctx: Context<AcceptOwnershipContext>,
    _params: &AcceptOwnershipParams,
) -> Result<()> {
    let state = ctx.accounts.gateway_minter.as_mut();

    let previous_owner = state.owner;

    state.owner = state.pending_owner;
    state.pending_owner = Pubkey::default();

    emit_cpi!(OwnershipTransferred {
        previous_owner,
        new_owner: state.owner,
    });

    Ok(())
}
