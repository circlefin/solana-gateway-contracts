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

//! Initialize instruction handler

use {
    crate::{
        events::GatewayMinterInitialized, seeds::GATEWAY_MINTER_SEED, state::GatewayMinter, utils,
    },
    anchor_lang::prelude::*,
};

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub upgrade_authority: Signer<'info>,

    /// GatewayMinter state account
    #[account(
        init,
        payer = payer,
        space = utils::DISCRIMINATOR_SIZE + GatewayMinter::INIT_SPACE,
        seeds = [GATEWAY_MINTER_SEED],
        bump
    )]
    pub gateway_minter: Box<Account<'info, GatewayMinter>>,

    // Ensure only upgrade_authority can call initialize
    #[account(
      constraint = gateway_minter_program_data.upgrade_authority_address == Some(upgrade_authority.key())
    )]
    pub gateway_minter_program_data: Account<'info, ProgramData>,

    // Ensure the specified program_data account is correct
    #[account(
      constraint = gateway_minter_program.programdata_address()? == Some(gateway_minter_program_data.key())
    )]
    pub gateway_minter_program: Program<'info, crate::program::GatewayMinter>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone)]
pub struct InitializeParams {
    pub local_domain: u32,
}

pub fn initialize(ctx: Context<InitializeContext>, params: &InitializeParams) -> Result<()> {
    let gateway_minter_state = &mut ctx.accounts.gateway_minter;
    let upgrade_authority = ctx.accounts.upgrade_authority.key();
    gateway_minter_state.bump = ctx.bumps.gateway_minter;
    gateway_minter_state.local_domain = params.local_domain;
    gateway_minter_state.version = 1;
    gateway_minter_state.owner = upgrade_authority;
    gateway_minter_state.pending_owner = Pubkey::default();
    gateway_minter_state.pauser = upgrade_authority;
    gateway_minter_state.token_controller = upgrade_authority;
    gateway_minter_state.paused = false;

    emit_cpi!(GatewayMinterInitialized {});

    Ok(())
}
