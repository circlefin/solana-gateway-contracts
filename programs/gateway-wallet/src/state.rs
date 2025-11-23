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

use crate::error::GatewayWalletError;
use crate::seeds::GATEWAY_WALLET_SEED;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

/// Delegate status for GatewayDelegate account
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, InitSpace)]
pub enum DelegateStatus {
    /// The delegate has never been authorized
    Unauthorized,
    /// The delegate is currently authorized to transfer on behalf of the depositor for the token
    Authorized,
    /// The delegate was previously authorized, but the authorization has been revoked.
    Revoked,
}

pub const MAX_SUPPORTED_TOKENS: usize = 10;
pub const MAX_BURN_SIGNERS: usize = 10;

#[account(discriminator = [21, 0])]
#[derive(Debug, InitSpace)]
/// Program state for the GatewayWallet program
pub struct GatewayWallet {
    pub bump: u8,
    pub owner: Pubkey,
    pub pending_owner: Pubkey,
    pub pauser: Pubkey,
    pub denylister: Pubkey,
    pub token_controller: Pubkey,
    pub fee_recipient: Pubkey,
    pub local_domain: u32,
    pub version: u32,
    pub withdrawal_delay: u64,
    pub paused: bool,
    #[max_len(MAX_SUPPORTED_TOKENS)]
    pub supported_tokens: Vec<Pubkey>,
    #[max_len(MAX_SUPPORTED_TOKENS)]
    pub custody_token_account_bumps: Vec<u8>,
    #[max_len(MAX_BURN_SIGNERS)]
    pub burn_signers: Vec<Pubkey>,
}

#[account(discriminator = [21, 1])]
#[derive(Debug, InitSpace)]
/// Program state for an individual depositor
pub struct GatewayDeposit {
    pub bump: u8,
    pub depositor: Pubkey,
    pub token_mint: Pubkey,
    pub available_amount: u64,
    pub withdrawing_amount: u64,
    pub withdrawal_block: u64,
}

#[account(discriminator = [21, 2])]
#[derive(Debug, InitSpace)]
/// Program state for delegate accounts
pub struct GatewayDelegate {
    /// The bump of the delegate account
    pub bump: u8,
    /// Represents the current status of the delegate
    pub status: DelegateStatus,
    /// CURRENTLY UNUSED
    /// In the future, we may support fully closing a delegate account with the `Revoked`
    /// status. Revoking a delegate should set this field, after which the account can be
    /// closed and the rent deposit transferred back to the depositor. A time delay will be
    /// enforced, to give time for the Gateway API to execute any pending burns authorized
    /// by the delegate.
    pub closeable_at_block: u64,

    /// The token mint key
    pub token: Pubkey,
    /// The depositor key
    pub depositor: Pubkey,
    /// The delegate key
    pub delegate: Pubkey,
}

impl GatewayDelegate {
    /// Check if an address has ever been authorized to transfer tokens on behalf of a depositor. This
    /// includes both currently-valid and revoked authorizations.
    ///
    /// @param depositor   The depositor to check against  
    /// @param addr        The address to check
    /// @return            `true` if the address has ever been authorized, `false` otherwise
    pub fn was_ever_authorized_for_balance(&self, depositor: Pubkey, addr: Pubkey) -> bool {
        // A depositor is always authorized for its own balance
        if addr == depositor {
            return true;
        }

        // Otherwise, check that the stored authorization status is either `Authorized` or `Revoked`
        self.status != DelegateStatus::Unauthorized
    }
}

#[account(discriminator = [21, 3])]
#[derive(Debug, InitSpace)]
/// Denylist state for an individual account
pub struct Denylist {}

#[account(discriminator = [21, 4])]
/// Used transfer spec hash state for a transfer spec hash
pub struct UsedTransferSpecHash;

impl GatewayWallet {
    const BURN_SIGNATURE_LENGTH: usize = 65;

    pub fn is_token_supported(&self, token_mint: Pubkey) -> bool {
        self.supported_tokens.contains(&token_mint)
    }

    pub fn get_token_index(&self, token_mint: Pubkey) -> Option<usize> {
        self.supported_tokens
            .iter()
            .position(|token| token == &token_mint)
    }

    pub fn add_token(&mut self, token_mint: Pubkey, bump: u8) -> Result<()> {
        if self.is_token_supported(token_mint) {
            return Ok(());
        }

        if self.supported_tokens.len() >= MAX_SUPPORTED_TOKENS {
            return err!(GatewayWalletError::MaxTokensSupported);
        }

        self.supported_tokens.push(token_mint);
        self.custody_token_account_bumps.push(bump);

        Ok(())
    }

    pub fn get_custody_token_account_bump(&self, token_mint: Pubkey) -> Result<u8> {
        let index = self.get_token_index(token_mint);
        if index.is_none() {
            return err!(GatewayWalletError::TokenNotSupported);
        }

        Ok(self.custody_token_account_bumps[index.unwrap()])
    }

    pub fn is_burn_signer(&self, signer: Pubkey) -> bool {
        self.burn_signers.contains(&signer)
    }

    pub fn add_burn_signer(&mut self, signer: Pubkey) -> Result<()> {
        if self.is_burn_signer(signer) {
            return Ok(());
        }

        if self.burn_signers.len() >= MAX_BURN_SIGNERS {
            return err!(GatewayWalletError::BurnSignerLimitExceeded);
        }

        self.burn_signers.push(signer);

        Ok(())
    }

    pub fn remove_burn_signer(&mut self, signer: Pubkey) -> Result<()> {
        let index = self.burn_signers.iter().position(|s| s == &signer);
        if index.is_none() {
            return Ok(());
        }

        let index = index.unwrap();
        self.burn_signers.remove(index);

        Ok(())
    }

    /// Verifies burn signatures against the message hash
    ///
    /// This function recovers the signer from the signature and verifies they are enabled burn signers.
    ///
    /// # Arguments
    /// * `message_hash` - The hash of the message that was signed
    /// * `signature` - The signature bytes (65 bytes: 64 bytes signature + 1 byte recovery id)
    ///
    /// # Returns
    /// * `Ok(())` if signature is valid and signer is enabled
    /// * `Err(GatewayWalletError)` if validation fails
    pub fn verify_burn_signature(&self, message_hash: &[u8], signature: &[u8]) -> Result<()> {
        require_eq!(
            signature.len(),
            Self::BURN_SIGNATURE_LENGTH,
            GatewayWalletError::InvalidBurnSignerSignature
        );

        // Recover the signer from the signature using shared utility
        let recovered_signer = gateway_shared::recover_evm_signer(message_hash, signature)
            .map_err(|_| GatewayWalletError::InvalidBurnSignerSignature)?;

        // Check if the recovered signer is an enabled burn signer
        require!(
            self.is_burn_signer(recovered_signer),
            GatewayWalletError::BurnSignerNotAuthorized
        );

        Ok(())
    }

    /// Burn tokens from custody
    ///
    /// # Arguments
    /// * `token_program` - The token program
    /// * `mint` - The token mint account
    /// * `custody_account` - The custody token account to burn from
    /// * `authority` - The authority account (gateway wallet)
    /// * `authority_bump` - The authority PDA bump seed
    /// * `amount` - The amount to burn
    ///
    /// # Returns
    /// * `Ok(())` if the burn is successful
    /// * `Err(GatewayWalletError)` if the burn fails
    pub fn burn_token<'info>(
        &self,
        token_program: &Program<'info, Token>,
        mint: &Account<'info, Mint>,
        custody_account: &Account<'info, TokenAccount>,
        authority: &Account<'info, GatewayWallet>,
        authority_bump: u8,
        amount: u64,
    ) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[GATEWAY_WALLET_SEED, &[authority_bump]]];
        let burn_ctx = CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Burn {
                mint: mint.to_account_info(),
                from: custody_account.to_account_info(),
                authority: authority.to_account_info(),
            },
            authority_seeds,
        );

        token::burn(burn_ctx, amount)?;

        Ok(())
    }
}

impl GatewayDeposit {
    pub fn initialize_if_needed(&mut self, bump: u8, depositor: Pubkey, token_mint: Pubkey) {
        if self.bump == 0 {
            self.bump = bump;
            self.depositor = depositor;
            self.token_mint = token_mint;
        }
    }

    pub fn deposit<'info>(
        &mut self,
        token_program: &Program<'info, Token>,
        from_account: &Account<'info, TokenAccount>,
        to_account: &Account<'info, TokenAccount>,
        authority: &Signer<'info>,
        amount: u64,
    ) -> Result<()> {
        require_gt!(amount, 0, GatewayWalletError::InvalidDepositAmount);

        let transfer_ctx = CpiContext::new(
            token_program.to_account_info(),
            token::Transfer {
                from: from_account.to_account_info(),
                to: to_account.to_account_info(),
                authority: authority.to_account_info(),
            },
        );

        token::transfer(transfer_ctx, amount)?;

        self.available_amount += amount;

        Ok(())
    }

    pub fn initiate_withdrawal(
        &mut self,
        amount: u64,
        withdrawal_delay: u64,
        gateway_wallet: &GatewayWallet,
        token_mint: Pubkey,
    ) -> Result<(u64, u64, u64)> {
        require!(amount > 0, GatewayWalletError::InvalidWithdrawalAmount);
        require!(
            gateway_wallet.is_token_supported(token_mint),
            GatewayWalletError::TokenNotSupported
        );
        require!(
            amount <= self.available_amount,
            GatewayWalletError::InsufficientDepositBalance
        );

        self.available_amount -= amount;
        self.withdrawing_amount += amount;

        let current_slot = Clock::get()?.slot;
        self.withdrawal_block = current_slot + withdrawal_delay;

        Ok((
            self.available_amount,
            self.withdrawing_amount,
            self.withdrawal_block,
        ))
    }

    pub fn complete_withdrawal<'info>(
        &mut self,
        token_program: &Program<'info, Token>,
        from_account: &Account<'info, TokenAccount>,
        to_account: &Account<'info, TokenAccount>,
        authority: &Account<'info, GatewayWallet>,
        signer_seeds: &[&[&[u8]]],
    ) -> Result<u64> {
        let withdrawal_amount = self.withdrawing_amount;
        self.withdrawing_amount = 0;
        self.withdrawal_block = 0;

        let transfer_ctx = CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: from_account.to_account_info(),
                to: to_account.to_account_info(),
                authority: authority.to_account_info(),
            },
            signer_seeds,
        );

        token::transfer(transfer_ctx, withdrawal_amount)?;

        Ok(withdrawal_amount)
    }

    /// Reduces a depositor's balances by a specified value, prioritizing the available balance
    ///
    /// # Arguments
    /// * `value` - The amount to be reduced
    ///
    /// # Returns
    /// * `Ok((from_available, from_withdrawing))` - The amounts deducted from each balance type
    ///   If insufficient balance exists, returns the maximum that could be deducted (partial amount).
    /// * `Err(GatewayWalletError::InvalidBalanceReductionAmount)` - If value is not positive
    pub fn reduce_balance(&mut self, value: u64) -> Result<(u64, u64)> {
        require_gt!(value, 0, GatewayWalletError::InvalidBalanceReductionAmount);

        let available = self.available_amount;
        let mut needed = value;

        // If there is enough in the available balance, deduct from it and return
        if available >= needed {
            self.available_amount -= needed;
            return Ok((needed, 0));
        }

        // Otherwise, take it all from available and continue for the rest
        self.available_amount = 0;
        needed -= available;

        let withdrawing = self.withdrawing_amount;

        // If there is enough in the withdrawing balance, deduct from it and return
        if withdrawing >= needed {
            self.withdrawing_amount -= needed;
            return Ok((available, needed));
        }

        // Otherwise, take it all from withdrawing
        self.withdrawing_amount = 0;

        Ok((available, withdrawing))
    }
}
