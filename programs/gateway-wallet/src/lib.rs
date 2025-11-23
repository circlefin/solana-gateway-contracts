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

//! GatewayWallet program entrypoint

pub mod burn_data;
pub mod ed25519;
pub mod error;
pub mod events;
pub mod instructions;
pub mod seeds;
pub mod state;
pub mod utils;

use {anchor_lang::prelude::*, instructions::*};

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Gateway Wallet",
    project_url: "https://github.com/circlefin/solana-gateway-contracts",
    contacts: "link:https://github.com/circlefin/solana-gateway-contracts/blob/master/SECURITY.md",
    policy: "https://github.com/circlefin/solana-gateway-contracts/blob/master/SECURITY.md"
}

declare_id!("devN7ZZFhGVTgwoKHaDDTFFgrhRzSGzuC6hgVFPrxbs");

#[program]
pub mod gateway_wallet {
    use super::*;

    #[instruction(discriminator = [22, 0])]
    pub fn deposit(ctx: Context<DepositContext>, amount: u64) -> Result<()> {
        instructions::deposit(ctx, amount)
    }

    #[instruction(discriminator = [22, 1])]
    pub fn deposit_for(
        ctx: Context<DepositForContext>,
        amount: u64,
        depositor: Pubkey,
    ) -> Result<()> {
        instructions::deposit_for(ctx, amount, depositor)
    }

    #[instruction(discriminator = [22, 2])]
    pub fn gateway_burn<'burn>(
        ctx: Context<'_, '_, '_, 'burn, GatewayBurnContext<'burn>>,
        params: GatewayBurnParams,
    ) -> Result<()> {
        instructions::gateway_burn(ctx, &params)
    }

    #[instruction(discriminator = [22, 3])]
    pub fn withdraw(ctx: Context<WithdrawContext>) -> Result<()> {
        instructions::withdraw(ctx)
    }

    #[instruction(discriminator = [22, 4])]
    pub fn initiate_withdrawal(ctx: Context<InitiateWithdrawalContext>, amount: u64) -> Result<()> {
        instructions::initiate_withdrawal(ctx, amount)
    }

    #[instruction(discriminator = [22, 5])]
    pub fn initialize(ctx: Context<InitializeContext>, params: InitializeParams) -> Result<()> {
        instructions::initialize(ctx, &params)
    }

    #[instruction(discriminator = [22, 6])]
    pub fn transfer_ownership(
        ctx: Context<TransferOwnershipContext>,
        params: TransferOwnershipParams,
    ) -> Result<()> {
        instructions::transfer_ownership(ctx, &params)
    }

    #[instruction(discriminator = [22, 7])]
    pub fn accept_ownership(
        ctx: Context<AcceptOwnershipContext>,
        params: AcceptOwnershipParams,
    ) -> Result<()> {
        instructions::accept_ownership(ctx, &params)
    }

    #[instruction(discriminator = [22, 8])]
    pub fn update_pauser(
        ctx: Context<UpdatePauserContext>,
        params: UpdatePauserParams,
    ) -> Result<()> {
        instructions::update_pauser(ctx, &params)
    }

    #[instruction(discriminator = [22, 9])]
    pub fn update_denylister(
        ctx: Context<UpdateDenylisterContext>,
        params: UpdateDenylisterParams,
    ) -> Result<()> {
        instructions::update_denylister(ctx, &params)
    }

    #[instruction(discriminator = [22, 10])]
    pub fn update_token_controller(
        ctx: Context<UpdateTokenControllerContext>,
        params: UpdateTokenControllerParams,
    ) -> Result<()> {
        instructions::update_token_controller(ctx, &params)
    }

    #[instruction(discriminator = [22, 11])]
    pub fn update_withdrawal_delay(
        ctx: Context<UpdateWithdrawalDelayContext>,
        params: UpdateWithdrawalDelayParams,
    ) -> Result<()> {
        instructions::update_withdrawal_delay(ctx, &params)
    }

    #[instruction(discriminator = [22, 12])]
    pub fn add_token(ctx: Context<AddTokenContext>) -> Result<()> {
        instructions::add_token(ctx)
    }

    #[instruction(discriminator = [22, 13])]
    pub fn add_burn_signer(
        ctx: Context<AddBurnSignerContext>,
        params: AddBurnSignerParams,
    ) -> Result<()> {
        instructions::add_burn_signer(ctx, &params)
    }

    #[instruction(discriminator = [22, 14])]
    pub fn remove_burn_signer(
        ctx: Context<RemoveBurnSignerContext>,
        params: RemoveBurnSignerParams,
    ) -> Result<()> {
        instructions::remove_burn_signer(ctx, &params)
    }

    #[instruction(discriminator = [22, 15])]
    pub fn add_delegate(ctx: Context<AddDelegateContext>, delegate: Pubkey) -> Result<()> {
        instructions::add_delegate(ctx, delegate)
    }

    #[instruction(discriminator = [22, 16])]
    pub fn remove_delegate(ctx: Context<RemoveDelegateContext>, delegate: Pubkey) -> Result<()> {
        instructions::remove_delegate(ctx, delegate)
    }

    #[instruction(discriminator = [22, 17])]
    pub fn denylist(ctx: Context<DenylistContext>, params: DenylistParams) -> Result<()> {
        instructions::denylist(ctx, &params)
    }

    #[instruction(discriminator = [22, 18])]
    pub fn undenylist(ctx: Context<UndenylistContext>, params: UndenylistParams) -> Result<()> {
        instructions::undenylist(ctx, &params)
    }

    #[instruction(discriminator = [22, 19])]
    pub fn pause(ctx: Context<PauseContext>) -> Result<()> {
        instructions::pause(ctx)
    }

    #[instruction(discriminator = [22, 20])]
    pub fn unpause(ctx: Context<UnpauseContext>) -> Result<()> {
        instructions::unpause(ctx)
    }

    #[instruction(discriminator = [22, 21])]
    pub fn update_fee_recipient(
        ctx: Context<UpdateFeeRecipientContext>,
        params: UpdateFeeRecipientParams,
    ) -> Result<()> {
        instructions::update_fee_recipient(ctx, &params)
    }
}
