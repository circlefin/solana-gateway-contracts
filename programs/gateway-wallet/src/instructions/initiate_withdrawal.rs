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

//! Initiate withdrawal instruction handler

use {
    crate::{
        error::GatewayWalletError,
        events::WithdrawalInitiated,
        seeds::{GATEWAY_DEPOSIT_SEED, GATEWAY_WALLET_SEED},
        state::{GatewayDeposit, GatewayWallet},
    },
    anchor_lang::prelude::*,
};

#[event_cpi]
#[derive(Accounts)]
pub struct InitiateWithdrawalContext<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
        constraint = !gateway_wallet.paused @ GatewayWalletError::ProgramPaused
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,

    #[account(
        mut,
        seeds = [GATEWAY_DEPOSIT_SEED, deposit.token_mint.key().as_ref(), depositor.key().as_ref()],
        bump = deposit.bump
    )]
    pub deposit: Account<'info, GatewayDeposit>,
}

pub fn initiate_withdrawal(ctx: Context<InitiateWithdrawalContext>, amount: u64) -> Result<()> {
    let token_mint = ctx.accounts.deposit.token_mint;

    let (remaining_available, total_withdrawing, withdrawal_block) =
        ctx.accounts.deposit.initiate_withdrawal(
            amount,
            ctx.accounts.gateway_wallet.withdrawal_delay,
            &ctx.accounts.gateway_wallet,
            token_mint,
        )?;

    emit_cpi!(WithdrawalInitiated {
        token: token_mint,
        depositor: ctx.accounts.depositor.key(),
        value: amount,
        remaining_available,
        total_withdrawing,
        withdrawal_block,
    });

    Ok(())
}
