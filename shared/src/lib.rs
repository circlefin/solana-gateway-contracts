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

//! Shared utilities for Gateway programs.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{keccak::hash, secp256k1_recover::secp256k1_recover};
use libsecp256k1::Signature as EVMSignature;

pub const DISCRIMINATOR_SIZE: usize = 2;

/// Errors that can occur during EVM signature recovery
#[derive(Debug, Clone, Copy)]
pub enum EvmSignatureError {
    InvalidMessageHash,
    InvalidSignatureLength,
    InvalidRecoveryId,
    InvalidSignature,
    InvalidSignatureSValue,
}

/// Space required for UsedTransferSpecHash account (only discriminator)
pub const USED_TRANSFER_SPEC_HASH_ACCOUNT_SPACE: usize = DISCRIMINATOR_SIZE;

/// Seed prefix for used transfer spec hash PDA
pub const USED_TRANSFER_SPEC_HASH_SEED_PREFIX: &[u8] = b"used_transfer_spec_hash";

/// Checks if a transfer spec hash account has already been used
pub fn is_transfer_spec_hash_used(account_data: &[u8], discriminator: &[u8]) -> Result<bool> {
    Ok(account_data.len() >= DISCRIMINATOR_SIZE
        && &account_data[..DISCRIMINATOR_SIZE] == discriminator)
}

/// Creates and initializes a used transfer spec hash account to prevent replay attacks.
///
/// This function:
/// 1. Verifies the account hasn't been used already
/// 2. Creates/initializes the account with proper rent and ownership
/// 3. Writes the discriminator to mark the transfer spec hash as used
///
/// # Arguments
///
/// * `hash_account` - The account info for the used transfer spec hash PDA
/// * `transfer_spec_hash` - The 32-byte hash to be marked as used
/// * `bump` - The bump seed for the PDA
/// * `payer` - The account that pays for the account creation
/// * `system_program` - The system program account info
/// * `program_id` - The program ID that will own the account
/// * `discriminator` - The discriminator to write to the account
///
/// # Returns
///
/// Returns `Ok(())` on success, or an error if:
/// - The transfer spec hash has already been used
/// - Account creation/initialization fails
pub fn create_used_transfer_spec_hash_account<'info>(
    hash_account: &AccountInfo<'info>,
    transfer_spec_hash: &[u8; 32],
    bump: u8,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    program_id: &Pubkey,
    discriminator: &[u8],
) -> Result<()> {
    // Calculate required rent
    let required_rent = Rent::get()?.minimum_balance(USED_TRANSFER_SPEC_HASH_ACCOUNT_SPACE);
    let current_lamports = hash_account.lamports();

    // Replicate Anchor logic for creating accounts
    // https://github.com/solana-foundation/anchor/blob/d5d7eb97979234eb1e9e32fcef66ce171a928b62/lang/syn/src/codegen/accounts/constraints.rs#L1626-L1679
    if current_lamports == 0 {
        // Account doesn't exist, create it
        anchor_lang::system_program::create_account(
            CpiContext::new_with_signer(
                system_program.clone(),
                anchor_lang::system_program::CreateAccount {
                    from: payer.clone(),
                    to: hash_account.clone(),
                },
                &[&[
                    USED_TRANSFER_SPEC_HASH_SEED_PREFIX,
                    transfer_spec_hash,
                    &[bump],
                ]],
            ),
            required_rent,
            USED_TRANSFER_SPEC_HASH_ACCOUNT_SPACE as u64,
            program_id,
        )?;
    } else {
        // If the account has less than the required rent, top it up
        if current_lamports < required_rent {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    system_program.clone(),
                    anchor_lang::system_program::Transfer {
                        from: payer.clone(),
                        to: hash_account.clone(),
                    },
                ),
                required_rent - current_lamports,
            )?;
        }

        // Allocate space for the account to the required size
        anchor_lang::system_program::allocate(
            CpiContext::new_with_signer(
                system_program.clone(),
                anchor_lang::system_program::Allocate {
                    account_to_allocate: hash_account.clone(),
                },
                &[&[
                    USED_TRANSFER_SPEC_HASH_SEED_PREFIX,
                    transfer_spec_hash,
                    &[bump],
                ]],
            ),
            USED_TRANSFER_SPEC_HASH_ACCOUNT_SPACE as u64,
        )?;

        // Assign the account to our program
        anchor_lang::system_program::assign(
            CpiContext::new_with_signer(
                system_program.clone(),
                anchor_lang::system_program::Assign {
                    account_to_assign: hash_account.clone(),
                },
                &[&[
                    USED_TRANSFER_SPEC_HASH_SEED_PREFIX,
                    transfer_spec_hash,
                    &[bump],
                ]],
            ),
            program_id,
        )?;
    }

    // Write the discriminator to mark this transfer spec hash as used
    let mut account_data = hash_account.try_borrow_mut_data()?;
    account_data[..DISCRIMINATOR_SIZE].copy_from_slice(discriminator);

    Ok(())
}

const ETHEREUM_SIGNED_MSG_INPUT_HASH_LEN: usize = 32;
const SIGNATURE_LENGTH: usize = 65;

/// Returns keccak256 of "\x19Ethereum Signed Message:\n32" + hash
///
/// This function creates the EIP-191 "Ethereum Signed Message" hash format.
/// It's used to match the signature format expected by Ethereum wallets and KMS.
///
/// # Arguments
/// * `input_hash` - The 32-byte hash to be signed
///
/// # Returns
/// The 32-byte EIP-191 formatted hash
pub fn ethereum_signed_message_hash(
    input_hash: &[u8; ETHEREUM_SIGNED_MSG_INPUT_HASH_LEN],
) -> [u8; 32] {
    const PREFIX: &[u8] = b"\x19Ethereum Signed Message:\n32";
    const PREFIX_LEN: usize = PREFIX.len();
    let mut message = [0u8; PREFIX_LEN + ETHEREUM_SIGNED_MSG_INPUT_HASH_LEN];
    message[..PREFIX_LEN].copy_from_slice(PREFIX);
    message[PREFIX_LEN..].copy_from_slice(input_hash);
    hash(&message).0
}

/// Recovers the EVM signer's public key from the message hash and signature
///
/// This function uses secp256k1_recover to extract the public key that signed the message,
/// then converts it to an EVM address format (last 20 bytes of keccak256(pubkey), with first
/// 12 bytes zeroed to fit Solana's Pubkey format).
///
/// # Arguments
/// * `message_hash` - The 32-byte hash that was signed (should be Ethereum Signed Message hash)
/// * `signature` - The 65-byte signature (64 bytes signature + 1 byte recovery id)
///
/// # Returns
/// * `Ok(Pubkey)` - The recovered signer's public key in EVM address format
/// * `Err(EvmSignatureError)` - Specific error indicating what went wrong
///
/// # Errors
/// Returns an error if:
/// - Message hash is not exactly 32 bytes
/// - Signature is not exactly 65 bytes
/// - Recovery ID is not in valid range (27-28)
/// - Signature has high-s value (malleability protection)
/// - secp256k1_recover fails
pub fn recover_evm_signer(
    message_hash: &[u8],
    signature: &[u8],
) -> core::result::Result<Pubkey, EvmSignatureError> {
    // secp256k1_recover doesn't validate input parameters lengths, so manual check is needed
    if message_hash.len() != 32 {
        return Err(EvmSignatureError::InvalidMessageHash);
    }
    if signature.len() != SIGNATURE_LENGTH {
        return Err(EvmSignatureError::InvalidSignatureLength);
    }

    // Extract recovery id from the signature
    let recovery_id = signature[SIGNATURE_LENGTH - 1];
    if recovery_id != 27 && recovery_id != 28 {
        return Err(EvmSignatureError::InvalidRecoveryId);
    }

    // Reject high-s value signatures to prevent malleability
    let sig = match EVMSignature::parse_standard_slice(&signature[0..SIGNATURE_LENGTH - 1]) {
        Ok(s) => s,
        Err(_) => return Err(EvmSignatureError::InvalidSignature),
    };
    if sig.s.is_high() {
        return Err(EvmSignatureError::InvalidSignatureSValue);
    }

    // Recover signer's public key using secp256k1_recover
    let pubkey = match secp256k1_recover(
        message_hash,
        recovery_id - 27,
        &signature[0..SIGNATURE_LENGTH - 1],
    ) {
        Ok(pk) => pk,
        Err(_) => return Err(EvmSignatureError::InvalidSignature),
    };

    // Hash public key and return last 20 bytes as Pubkey (following EVM address format)
    let mut address = hash(pubkey.to_bytes().as_slice()).0;
    address[0..12].iter_mut().for_each(|x| *x = 0);

    Ok(Pubkey::new_from_array(address))
}
