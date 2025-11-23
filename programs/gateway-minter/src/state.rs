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

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::error::GatewayMinterError;
use crate::seeds::GATEWAY_MINTER_SEED;

pub const MAX_SUPPORTED_TOKENS: usize = 10;
pub const MAX_ATTESTERS: usize = 10;

#[account(discriminator = [11, 0])]
#[derive(Debug, InitSpace)]
/// Program state for the GatewayMinter program
pub struct GatewayMinter {
    pub bump: u8,
    pub owner: Pubkey,
    pub pending_owner: Pubkey,
    pub pauser: Pubkey,
    pub token_controller: Pubkey,
    pub paused: bool,
    #[max_len(MAX_ATTESTERS)]
    pub enabled_attesters: Vec<Pubkey>,
    pub local_domain: u32,
    pub version: u32,
    #[max_len(MAX_SUPPORTED_TOKENS)]
    pub supported_tokens: Vec<Pubkey>,
    #[max_len(MAX_SUPPORTED_TOKENS)]
    pub custody_token_account_bumps: Vec<u8>,
}

#[account(discriminator = [11, 1])]
/// Used transfer spec hash state for a transfer spec hash
pub struct UsedTransferSpecHash;

impl GatewayMinter {
    /// The length in bytes of attestation signature (64 bytes signature + 1 byte recovery id)
    const ATTESTATION_SIGNATURE_LENGTH: usize = 65;

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
            return err!(GatewayMinterError::MaxTokensSupported);
        }

        self.supported_tokens.push(token_mint);
        self.custody_token_account_bumps.push(bump);

        Ok(())
    }

    pub fn is_attester_enabled(&self, attester: Pubkey) -> bool {
        self.enabled_attesters.contains(&attester)
    }

    pub fn add_attester(&mut self, attester: Pubkey) -> Result<()> {
        if self.is_attester_enabled(attester) {
            return Ok(());
        }

        if self.enabled_attesters.len() >= MAX_ATTESTERS {
            return err!(GatewayMinterError::AttesterLimitExceeded);
        }

        self.enabled_attesters.push(attester);

        Ok(())
    }

    pub fn remove_attester(&mut self, attester: Pubkey) -> Result<()> {
        let index = self.enabled_attesters.iter().position(|a| a == &attester);
        if index.is_none() {
            return Ok(());
        }

        let index = index.unwrap();
        self.enabled_attesters.remove(index);

        Ok(())
    }

    pub fn burn_token_custody<'info>(
        &self,
        token_program: &Program<'info, Token>,
        mint: &Account<'info, Mint>,
        authority: &Account<'info, GatewayMinter>,
        authority_bump: u8,
        from: &Account<'info, TokenAccount>,
        amount: u64,
    ) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[GATEWAY_MINTER_SEED, &[authority_bump]]];
        let burn_ctx = CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Burn {
                mint: mint.to_account_info(),
                from: from.to_account_info(),
                authority: authority.to_account_info(),
            },
            authority_seeds,
        );

        token::burn(burn_ctx, amount)?;

        Ok(())
    }

    pub fn get_custody_token_account_bump(&self, token_mint: Pubkey) -> Result<u8> {
        let index = self.get_token_index(token_mint);
        if index.is_none() {
            return err!(GatewayMinterError::TokenNotSupported);
        }

        Ok(self.custody_token_account_bumps[index.unwrap()])
    }

    /// Mints tokens from the custody account to a destination account
    ///
    /// This function transfers tokens from a custody account controlled by the gateway
    /// to a specified destination account.
    ///
    /// # Arguments
    /// * `token_program` - The token program
    /// * `custody_account` - The custody token account to transfer from
    /// * `destination_account` - The destination token account to transfer to
    /// * `authority` - The authority account (gateway minter)
    /// * `authority_bump` - The authority PDA bump seed
    /// * `amount` - The amount to transfer
    ///
    /// # Errors
    /// Returns an error if the transfer fails or if any account constraints are violated
    pub fn mint_token<'info>(
        &self,
        token_program: &Program<'info, Token>,
        custody_account: &Account<'info, TokenAccount>,
        destination_account: &Account<'info, TokenAccount>,
        authority: &Account<'info, GatewayMinter>,
        authority_bump: u8,
        amount: u64,
    ) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[GATEWAY_MINTER_SEED, &[authority_bump]]];

        let transfer_ctx = CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: custody_account.to_account_info(),
                to: destination_account.to_account_info(),
                authority: authority.to_account_info(),
            },
            authority_seeds,
        );

        token::transfer(transfer_ctx, amount)?;

        Ok(())
    }

    /// Verifies attestation signatures against the message hash
    ///
    /// This function recovers the signer from each signature and verifies they are enabled attesters.
    /// It follows the CCTP pattern but simplified for single signature verification.
    ///
    /// # Arguments
    /// * `message_hash` - The hash of the message that was signed
    /// * `signature` - The signature bytes (65 bytes: 64 bytes signature + 1 byte recovery id)
    ///
    /// # Returns
    /// * `Ok(())` if signature is valid and signer is enabled
    /// * `Err(GatewayMinterError)` if validation fails
    pub fn verify_attestation_signature(
        &self,
        message_hash: &[u8],
        signature: &[u8],
    ) -> Result<()> {
        require_eq!(
            signature.len(),
            Self::ATTESTATION_SIGNATURE_LENGTH,
            GatewayMinterError::InvalidAttesterSignature
        );

        // Recover the signer from the signature using shared utility
        let recovered_signer = gateway_shared::recover_evm_signer(message_hash, signature)
            .map_err(|_| GatewayMinterError::InvalidAttesterSignature)?;

        // Check if the recovered signer is an enabled attester
        require!(
            self.is_attester_enabled(recovered_signer),
            GatewayMinterError::InvalidAttesterSignature
        );

        Ok(())
    }
}
