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

#![allow(unexpected_cfgs)]

//! GatewayMinter program entrypoint

pub mod attestation;
pub mod error;
pub mod events;
pub mod instructions;
pub mod seeds;
pub mod state;
pub mod utils;

use {anchor_lang::prelude::*, instructions::*};

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Gateway Minter",
    project_url: "https://github.com/circlefin/solana-gateway-contracts",
    contacts: "link:https://github.com/circlefin/solana-gateway-contracts/blob/master/SECURITY.md",
    policy: "https://github.com/circlefin/solana-gateway-contracts/blob/master/SECURITY.md"
}

declare_id!("dev7nrwT5HL2S1mdcmzgpUDfyEKZaQfZLRmNAhYZCVa");

#[program]
pub mod gateway_minter {
    use super::*;

    #[instruction(discriminator = [12, 0])]
    pub fn gateway_mint<'mint>(
        ctx: Context<'_, '_, 'mint, 'mint, GatewayMintContext<'mint>>,
        params: GatewayMintParams,
    ) -> Result<()> {
        instructions::gateway_mint(ctx, &params)
    }

    #[instruction(discriminator = [12, 1])]
    pub fn gateway_mint_with_params<'mint>(
        ctx: Context<'_, '_, 'mint, 'mint, GatewayMintContext<'mint>>,
        params: GatewayMintReconstructParams,
    ) -> Result<()> {
        instructions::gateway_mint_with_params(ctx, params)
    }

    #[instruction(discriminator = [12, 2])]
    pub fn initialize(ctx: Context<InitializeContext>, params: InitializeParams) -> Result<()> {
        instructions::initialize(ctx, &params)
    }

    #[instruction(discriminator = [12, 3])]
    pub fn transfer_ownership(
        ctx: Context<TransferOwnershipContext>,
        params: TransferOwnershipParams,
    ) -> Result<()> {
        instructions::transfer_ownership(ctx, &params)
    }

    #[instruction(discriminator = [12, 4])]
    pub fn accept_ownership(
        ctx: Context<AcceptOwnershipContext>,
        params: AcceptOwnershipParams,
    ) -> Result<()> {
        instructions::accept_ownership(ctx, &params)
    }

    #[instruction(discriminator = [12, 5])]
    pub fn update_pauser(
        ctx: Context<UpdatePauserContext>,
        params: UpdatePauserParams,
    ) -> Result<()> {
        instructions::update_pauser(ctx, &params)
    }

    #[instruction(discriminator = [12, 6])]
    pub fn update_token_controller(
        ctx: Context<UpdateTokenControllerContext>,
        params: UpdateTokenControllerParams,
    ) -> Result<()> {
        instructions::update_token_controller(ctx, &params)
    }

    #[instruction(discriminator = [12, 7])]
    pub fn add_attester(ctx: Context<AddAttesterContext>, params: AddAttesterParams) -> Result<()> {
        instructions::add_attester(ctx, &params)
    }

    #[instruction(discriminator = [12, 8])]
    pub fn remove_attester(
        ctx: Context<RemoveAttesterContext>,
        params: RemoveAttesterParams,
    ) -> Result<()> {
        instructions::remove_attester(ctx, &params)
    }

    #[instruction(discriminator = [12, 9])]
    pub fn add_token(ctx: Context<AddTokenContext>) -> Result<()> {
        instructions::add_token(ctx)
    }

    #[instruction(discriminator = [12, 10])]
    pub fn burn_token_custody(ctx: Context<BurnTokenCustodyContext>, amount: u64) -> Result<()> {
        instructions::burn_token_custody(ctx, amount)
    }

    #[instruction(discriminator = [12, 11])]
    pub fn pause(ctx: Context<PauseContext>) -> Result<()> {
        instructions::pause(ctx)
    }

    #[instruction(discriminator = [12, 12])]
    pub fn unpause(ctx: Context<UnpauseContext>) -> Result<()> {
        instructions::unpause(ctx)
    }
}
