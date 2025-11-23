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

//! UpdateFeeRecipient instruction handler

use {
    crate::{
        error::GatewayWalletError, events::FeeRecipientChanged, seeds::GATEWAY_WALLET_SEED,
        state::GatewayWallet,
    },
    anchor_lang::prelude::*,
};

#[event_cpi]
#[derive(Accounts)]
pub struct UpdateFeeRecipientContext<'info> {
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
pub struct UpdateFeeRecipientParams {
    pub new_fee_recipient: Pubkey,
}

pub fn update_fee_recipient(
    ctx: Context<UpdateFeeRecipientContext>,
    params: &UpdateFeeRecipientParams,
) -> Result<()> {
    let state = ctx.accounts.gateway_wallet.as_mut();

    require_keys_neq!(
        params.new_fee_recipient,
        Pubkey::default(),
        GatewayWalletError::InvalidAuthority
    );

    let old_fee_recipient = state.fee_recipient;
    state.fee_recipient = params.new_fee_recipient;

    emit_cpi!(FeeRecipientChanged {
        old_fee_recipient,
        new_fee_recipient: state.fee_recipient,
    });
    Ok(())
}
