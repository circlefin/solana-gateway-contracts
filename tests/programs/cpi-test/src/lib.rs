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

//! CPI Test Program
//!
//! This program exists solely for testing CPI rejection in gateway_burn.
//! It attempts to call gateway_burn via CPI, which should fail because
//! gateway_burn validates that it is called as a top-level instruction.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("cpiRNFnzqmBEe1AxU3SjZJzh2L3LeLhtZ2UaGx41n8u");

#[program]
pub mod cpi_test {
    use super::*;

    #[instruction(discriminator = [0, 0])]
    pub fn cpi_gateway_burn<'info>(
        ctx: Context<'_, '_, '_, 'info, CpiGatewayBurnContext<'info>>,
        params: gateway_wallet::instructions::GatewayBurnParams,
    ) -> Result<()> {
        // Build the CPI context
        let cpi_program = ctx.accounts.gateway_wallet_program.to_account_info();
        let cpi_accounts = gateway_wallet::cpi::accounts::GatewayBurnContext {
            payer: ctx.accounts.payer.to_account_info(),
            gateway_wallet: ctx.accounts.gateway_wallet.to_account_info(),
            token_mint: ctx.accounts.token_mint.to_account_info(),
            custody_token_account: ctx.accounts.custody_token_account.to_account_info(),
            fee_recipient_token_account: ctx.accounts.fee_recipient_token_account.to_account_info(),
            deposit: ctx.accounts.deposit.to_account_info(),
            delegate_account: Some(ctx.accounts.delegate_account.to_account_info()),
            token_program: ctx.accounts.token_program.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            event_authority: ctx.accounts.event_authority.to_account_info(),
            program: ctx.accounts.gateway_wallet_program.to_account_info(),
            instructions_sysvar: ctx.accounts.instructions_sysvar.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts)
            .with_remaining_accounts(ctx.remaining_accounts.to_vec());

        gateway_wallet::cpi::gateway_burn(cpi_ctx, params)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CpiGatewayBurnContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Passed through to gateway_burn
    pub gateway_wallet: UncheckedAccount<'info>,

    /// CHECK: Passed through to gateway_burn
    #[account(mut)]
    pub token_mint: UncheckedAccount<'info>,

    /// CHECK: Passed through to gateway_burn
    #[account(mut)]
    pub custody_token_account: UncheckedAccount<'info>,

    /// CHECK: Passed through to gateway_burn
    #[account(mut)]
    pub fee_recipient_token_account: UncheckedAccount<'info>,

    /// CHECK: Passed through to gateway_burn
    #[account(mut)]
    pub deposit: UncheckedAccount<'info>,

    /// CHECK: Passed through to gateway_burn
    pub delegate_account: UncheckedAccount<'info>,

    /// CHECK: Gateway wallet program
    pub gateway_wallet_program: UncheckedAccount<'info>,

    /// CHECK: Token program
    pub token_program: UncheckedAccount<'info>,

    /// CHECK: Associated token program
    pub associated_token_program: UncheckedAccount<'info>,

    /// CHECK: Instructions sysvar
    pub instructions_sysvar: UncheckedAccount<'info>,

    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,

    /// CHECK: Event authority
    pub event_authority: UncheckedAccount<'info>,
}
