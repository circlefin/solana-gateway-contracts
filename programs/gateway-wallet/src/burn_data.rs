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

//! BurnData, BurnIntent, and TransferSpec
//!
//! This module implements encoding and decoding for BurnData messages.
//! All message encodings use **big-endian**.
//!
//! BurnData encapsulates the fee, user signature, and BurnIntent message and is signed by the burn signer.
//! The user signs the BurnIntent message, which consists of a 16-byte prefix and the BurnIntent.
//! The BurnIntent includes the expiration height, max fee, and TransferSpec.
//!
//! Constants:
//! - BurnIntent magic: `0x070afbc2` (bytes4(keccak256("circle.gateway.BurnIntent")))
//! - TransferSpec magic: `0xca85def7` (bytes4(keccak256("circle.gateway.TransferSpec")))
//! - BurnIntent message prefix: `0xff` followed by 15 zero bytes
//!
//! BurnData layout:
//! ```
//! offset  size  field
//! 0       8     fee (u64)
//! 8       64    user_signature
//! 72      16    burn_intent_message_prefix
//! 88      ?     burn_intent
//! ```
//!
//! BurnIntent layout:
//! ```
//! offset  size  field
//! 0       4     magic (0x070afbc2)
//! 4       32    max_block_height (u256, only last 8 bytes used as u64)
//! 36      32    max_fee (u256, only last 8 bytes used as u64)
//! 68      4     transfer_spec_length
//! 72      ?     transfer_spec
//! ```
//!
//! TransferSpec layout:
//! ```
//! offset  size  field
//! 0       4     magic (0xca85def7)
//! 4       4     version
//! 8       4     source_domain
//! 12      4     destination_domain
//! 16      32    source_contract
//! 48      32    destination_contract
//! 80      32    source_token
//! 112     32    destination_token
//! 144     32    source_depositor
//! 176     32    destination_recipient
//! 208     32    source_signer
//! 240     32    destination_caller
//! 272     32    value (u256, only last 8 bytes used as u64)
//! 304     32    salt
//! 336     4     hook_data_length
//! 340     N     hook_data
//! ```

use crate::error::GatewayWalletError;
use anchor_lang::{prelude::*, solana_program::keccak};

#[derive(Clone, Debug)]
pub struct BurnData<'a> {
    data: &'a [u8],
}

impl<'a> BurnData<'a> {
    pub const TRANSFER_SPEC_MAGIC: u32 = 0xca85def7; // bytes4(keccak256("circle.gateway.TransferSpec"))
    pub const BURN_INTENT_MAGIC: u32 = 0x070afbc2; // bytes4(keccak256("circle.gateway.BurnIntent"))
    pub const BURN_INTENT_MESSAGE_PREFIX: [u8; 16] =
        [0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    // BurnData offsets
    pub const BURN_DATA_FEE_OFFSET: usize = 0;
    pub const BURN_DATA_USER_SIGNATURE_OFFSET: usize = 8;
    pub const BURN_INTENT_MESSAGE_PREFIX_OFFSET: usize = 72;
    pub const BURN_INTENT_OFFSET: usize = 88;

    // BurnIntent offsets
    const MAGIC_OFFSET: usize = 88;
    const MAX_BLOCK_HEIGHT_OFFSET: usize = 92;
    const MAX_FEE_OFFSET: usize = 124;
    const TRANSFER_SPEC_LENGTH_OFFSET: usize = 156;
    const TRANSFER_SPEC_OFFSET: usize = 160;

    // TransferSpec field offsets
    const TS_MAGIC_OFFSET: usize = 160;
    const TS_VERSION_OFFSET: usize = 164;
    const TS_SOURCE_DOMAIN_OFFSET: usize = 168;
    const TS_DESTINATION_DOMAIN_OFFSET: usize = 172;
    const TS_SOURCE_CONTRACT_OFFSET: usize = 176;
    const TS_DESTINATION_CONTRACT_OFFSET: usize = 208;
    const TS_SOURCE_TOKEN_OFFSET: usize = 240;
    const TS_DESTINATION_TOKEN_OFFSET: usize = 272;
    const TS_SOURCE_DEPOSITOR_OFFSET: usize = 304;
    const TS_DESTINATION_RECIPIENT_OFFSET: usize = 336;
    pub const TS_SOURCE_SIGNER_OFFSET: usize = 368;
    const TS_DESTINATION_CALLER_OFFSET: usize = 400;
    const TS_VALUE_OFFSET: usize = 432;
    const TS_SALT_OFFSET: usize = 464;
    const TS_HOOK_DATA_LENGTH_OFFSET: usize = 496;
    const TS_HOOK_DATA_OFFSET: usize = 500;

    // EVM token amounts and block heights are 32 bytes while we use only 8 bytes on Solana.
    // Therefore we'll need to skip the first 24 bytes (BE) when reading these fields.
    const U256_TO_U64_OFFSET: usize = 24;

    pub fn new(message_bytes: &'a [u8]) -> Result<Self> {
        require_gte!(
            message_bytes.len(),
            Self::TS_HOOK_DATA_OFFSET,
            GatewayWalletError::BurnIntentLengthMismatch
        );

        let burn_data = Self {
            data: message_bytes,
        };

        // Ensure that the message prefix is the expected value
        if burn_data.burn_intent_message_prefix()? != Self::BURN_INTENT_MESSAGE_PREFIX {
            return Err(error!(GatewayWalletError::InvalidBurnIntentMessagePrefix));
        }

        require_eq!(
            burn_data.magic()?,
            Self::BURN_INTENT_MAGIC,
            GatewayWalletError::BurnIntentMagicMismatch
        );

        require_eq!(
            burn_data.transfer_spec_magic()?,
            Self::TRANSFER_SPEC_MAGIC,
            GatewayWalletError::TransferSpecMagicMismatch
        );

        // Check that the hook data length is set properly
        let hook_data_length = Self::u32_to_usize(burn_data.hook_data_length()?)?;
        let burn_data_length = Self::checked_add(Self::TS_HOOK_DATA_OFFSET, hook_data_length)?;
        require_eq!(
            burn_data.data.len(),
            burn_data_length,
            GatewayWalletError::BurnIntentLengthMismatch
        );

        // Validate that the transfer spec length matches the expected length
        let transfer_spec_length = Self::u32_to_usize(burn_data.transfer_spec_length()?)?;
        let actual_transfer_spec_length = Self::checked_add(
            Self::TS_HOOK_DATA_OFFSET - Self::TRANSFER_SPEC_OFFSET,
            hook_data_length,
        )?;
        require_eq!(
            actual_transfer_spec_length,
            transfer_spec_length,
            GatewayWalletError::BurnIntentLengthMismatch
        );

        // Check that the value is greater than 0
        require_gt!(
            burn_data.value()?,
            0,
            GatewayWalletError::InvalidBurnIntentValue
        );

        Ok(burn_data)
    }
}

impl<'a> BurnData<'a> {
    /// Returns the fee (u64 big-endian)
    pub fn fee(&self) -> Result<u64> {
        self.read_u64(Self::BURN_DATA_FEE_OFFSET)
    }

    /// Returns the 64-byte user signature
    pub fn user_signature(&self) -> Result<[u8; 64]> {
        self.read_bytes::<64>(Self::BURN_DATA_USER_SIGNATURE_OFFSET)
    }

    /// Returns the 16-byte burn intent message prefix
    pub fn burn_intent_message_prefix(&self) -> Result<[u8; 16]> {
        self.read_bytes::<16>(Self::BURN_INTENT_MESSAGE_PREFIX_OFFSET)
    }

    pub fn magic(&self) -> Result<u32> {
        self.read_u32(Self::MAGIC_OFFSET)
    }

    pub fn max_block_height(&self) -> Result<u64> {
        self.read_u64_with_data_offset(Self::MAX_BLOCK_HEIGHT_OFFSET, Self::U256_TO_U64_OFFSET)
    }

    pub fn max_fee(&self) -> Result<u64> {
        self.read_u64_with_data_offset(Self::MAX_FEE_OFFSET, Self::U256_TO_U64_OFFSET)
    }

    pub fn transfer_spec_length(&self) -> Result<u32> {
        self.read_u32(Self::TRANSFER_SPEC_LENGTH_OFFSET)
    }

    pub fn transfer_spec_magic(&self) -> Result<u32> {
        self.read_u32(Self::TS_MAGIC_OFFSET)
    }

    pub fn encoded_transfer_spec(&self) -> Result<&[u8]> {
        let transfer_spec_length = Self::u32_to_usize(self.transfer_spec_length()?)?;
        let start = Self::TRANSFER_SPEC_OFFSET;
        Ok(&self.data[start..start + transfer_spec_length])
    }

    pub fn transfer_spec_hash(&self) -> Result<[u8; 32]> {
        Ok(keccak::hash(self.encoded_transfer_spec()?).to_bytes())
    }

    pub fn version(&self) -> Result<u32> {
        self.read_u32(Self::TS_VERSION_OFFSET)
    }

    pub fn source_domain(&self) -> Result<u32> {
        self.read_u32(Self::TS_SOURCE_DOMAIN_OFFSET)
    }

    pub fn destination_domain(&self) -> Result<u32> {
        self.read_u32(Self::TS_DESTINATION_DOMAIN_OFFSET)
    }

    pub fn source_contract(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::TS_SOURCE_CONTRACT_OFFSET)
    }

    pub fn destination_contract(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::TS_DESTINATION_CONTRACT_OFFSET)
    }

    pub fn source_token(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::TS_SOURCE_TOKEN_OFFSET)
    }

    pub fn destination_token(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::TS_DESTINATION_TOKEN_OFFSET)
    }

    pub fn source_depositor(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::TS_SOURCE_DEPOSITOR_OFFSET)
    }

    pub fn destination_recipient(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::TS_DESTINATION_RECIPIENT_OFFSET)
    }

    pub fn source_signer(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::TS_SOURCE_SIGNER_OFFSET)
    }

    pub fn destination_caller(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::TS_DESTINATION_CALLER_OFFSET)
    }

    pub fn value(&self) -> Result<u64> {
        self.read_u64_with_data_offset(Self::TS_VALUE_OFFSET, Self::U256_TO_U64_OFFSET)
    }

    pub fn salt(&self) -> Result<[u8; 32]> {
        self.read_bytes::<32>(Self::TS_SALT_OFFSET)
    }

    pub fn hook_data_length(&self) -> Result<u32> {
        self.read_u32(Self::TS_HOOK_DATA_LENGTH_OFFSET)
    }

    /// Returns hook_data field
    pub fn hook_data(&self) -> Result<&[u8]> {
        let hook_data_length = Self::u32_to_usize(self.hook_data_length()?)?;
        Ok(&self.data[Self::TS_HOOK_DATA_OFFSET
            ..Self::checked_add(Self::TS_HOOK_DATA_OFFSET, hook_data_length)?])
    }

    // Returns the length of the burn intent message (the message signed by the user)
    // This includes the message prefix and full burn intent with hook data.
    pub fn burn_intent_message_length(&self) -> Result<usize> {
        Ok(self.data.len() - Self::BURN_INTENT_MESSAGE_PREFIX_OFFSET)
    }

    // Private helpers

    /// Reads u32 field at the given offset
    fn read_u32(&self, index: usize) -> Result<u32> {
        let end = Self::checked_add(index, 4)?;
        Ok(u32::from_be_bytes(
            self.data[index..end]
                .try_into()
                .map_err(|_| error!(GatewayWalletError::MalformedBurnData))?,
        ))
    }

    /// Reads u64 field at the given offset
    fn read_u64(&self, index: usize) -> Result<u64> {
        let end = Self::checked_add(index, 8)?;
        Ok(u64::from_be_bytes(
            self.data[index..end]
                .try_into()
                .map_err(|_| error!(GatewayWalletError::MalformedBurnData))?,
        ))
    }

    /// Reads u64 field at the given offset with data offset for EVM u256 to u64 conversion
    fn read_u64_with_data_offset(&self, index: usize, data_offset: usize) -> Result<u64> {
        let start_with_data_offset = Self::checked_add(index, data_offset)?;
        require!(
            self.data[index..start_with_data_offset]
                .iter()
                .all(|&x| x == 0),
            GatewayWalletError::InvalidU64HighBytes
        );
        let end = Self::checked_add(start_with_data_offset, 8)?;
        Ok(u64::from_be_bytes(
            self.data[start_with_data_offset..end]
                .try_into()
                .map_err(|_| error!(GatewayWalletError::MalformedBurnData))?,
        ))
    }

    /// Reads bytes field at the given offset
    fn read_bytes<const N: usize>(&self, index: usize) -> Result<[u8; N]> {
        self.data[index..Self::checked_add(index, N)?]
            .try_into()
            .map_err(|_| error!(GatewayWalletError::MalformedBurnData))
    }

    /// Reads pubkey field at the given offset
    fn read_pubkey(&self, index: usize) -> Result<Pubkey> {
        Pubkey::try_from(
            &self.data[index..Self::checked_add(index, std::mem::size_of::<Pubkey>())?],
        )
        .map_err(|_| error!(GatewayWalletError::MalformedBurnData))
    }

    /// Converts a u32 to a usize
    fn u32_to_usize(value: u32) -> Result<usize> {
        usize::try_from(value).map_err(|_| error!(GatewayWalletError::MalformedBurnData))
    }

    #[inline]
    fn checked_add(a: usize, b: usize) -> Result<usize> {
        a.checked_add(b)
            .ok_or_else(|| error!(GatewayWalletError::MalformedBurnData))
    }
}
