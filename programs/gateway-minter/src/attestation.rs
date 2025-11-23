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

//! MintAttestation
//!
//! This module implements encoding and decoding for ReducedMintAttestation messages.
//! All message encodings use **big-endian**.
//!
//! Constants:
//! - Set magic: `0x10cbb1ec` (bytes4(keccak256("circle.gateway.ReducedAttestationSet")))
//!
//! Attestation set layout:
//! ```
//! offset  size  field
//! 0       4     magic (0x10cbb1ec)
//! 4       4     version
//! 8       4     destination_domain
//! 12      32    destination_contract
//! 44      32    destination_caller
//! 76      8     max_block_height (u64)
//! 84      4     num_attestations
//! 88      ?     attestations (concatenated)
//! ```
//!
//! Attestation element layout:
//! ```
//! offset  size  field
//! 0       32    destination_token
//! 32      32    destination_recipient
//! 64      8     value (u64)
//! 72      32    transfer_spec_hash
//! 104     4     hook_data_length
//! 108     N     hook_data
//! ```

use crate::error::GatewayMinterError;
use anchor_lang::prelude::*;

#[derive(Clone, Debug)]
pub struct MintAttestation<'a> {
    data: &'a [u8],
    offset: usize,
    index: u32,
    num_elements: u32,
}

// Iterator
impl<'a> MintAttestation<'a> {
    pub const ATTESTATION_SET_MAGIC: u32 = 0x10cbb1ec;

    // Byte offsets of each field in the MintAttestationSet header
    const MAGIC_OFFSET: usize = 0;
    const VERSION_OFFSET: usize = 4;
    const DESTINATION_DOMAIN_OFFSET: usize = 8;
    const DESTINATION_CONTRACT_OFFSET: usize = 12;
    const DESTINATION_CALLER_OFFSET: usize = 44;
    const MAX_BLOCK_HEIGHT_OFFSET: usize = 76;
    const ATTESTATION_SET_NUM_ATTESTATIONS_OFFSET: usize = 84;
    const ATTESTATION_SET_ATTESTATIONS_OFFSET: usize = 88;

    // Relative byte offsets of each field in an attestation element
    const DESTINATION_TOKEN_OFFSET: usize = 0;
    const DESTINATION_RECIPIENT_OFFSET: usize = 32;
    const VALUE_OFFSET: usize = 64;
    const TRANSFER_SPEC_HASH_OFFSET: usize = 72;
    const HOOK_DATA_LENGTH_OFFSET: usize = 104;
    const HOOK_DATA_OFFSET: usize = 108;

    pub fn new(message_bytes: &'a [u8]) -> Result<Self> {
        // The smallest valid encoding is an attestation set with 1 attestation
        require_gte!(
            message_bytes.len(),
            Self::ATTESTATION_SET_ATTESTATIONS_OFFSET + Self::HOOK_DATA_OFFSET,
            GatewayMinterError::AttestationTooShort
        );

        let mut attestation = Self {
            data: message_bytes,
            offset: 0,
            index: 0,
            num_elements: 0,
        };

        require!(
            attestation.magic()? == Self::ATTESTATION_SET_MAGIC,
            GatewayMinterError::AttestationMagicMismatch
        );

        attestation.num_elements = attestation.num_attestations()?;
        attestation.offset = Self::ATTESTATION_SET_ATTESTATIONS_OFFSET;

        require_gt!(
            attestation.num_elements,
            0,
            GatewayMinterError::EmptyAttestationSet
        );

        Ok(attestation)
    }

    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> Result<bool> {
        if self.index >= self.num_elements {
            return Ok(false);
        }

        // Advance to the next attestation based on size of the attestation element
        // Do not advance on the first call; just expose the first element
        if self.index > 0 {
            let hook_data_length = Self::u32_to_usize(self.hook_data_length()?)?;
            let attestation_length = Self::checked_add(Self::HOOK_DATA_OFFSET, hook_data_length)?;
            self.offset = Self::checked_add(self.offset, attestation_length)?;
        }
        self.index += 1;

        // Check that there are enough bytes to read the next attestation's fixed header
        let remaining_length = self.data.len() - self.offset;
        require_gte!(
            remaining_length,
            Self::HOOK_DATA_OFFSET,
            GatewayMinterError::AttestationTooShort
        );

        // Check that there are enough bytes to read the next attestation's hook data
        let hook_data_length = Self::u32_to_usize(self.hook_data_length()?)?;
        let attestation_length = Self::checked_add(Self::HOOK_DATA_OFFSET, hook_data_length)?;
        require_gte!(
            remaining_length,
            attestation_length,
            GatewayMinterError::AttestationTooShort
        );

        // If the next attestation is the last, check that it has no extraneous bytes
        if self.index == self.num_elements {
            require_eq!(
                self.offset + attestation_length,
                self.data.len(),
                GatewayMinterError::AttestationTooLong
            );
        }

        // Show the next attestation
        Ok(true)
    }
}

// Field accessors
impl<'a> MintAttestation<'a> {
    /// Returns the magic field for a MintAttestation or MintAttestationSet
    pub fn magic(&self) -> Result<u32> {
        self.read_u32(Self::MAGIC_OFFSET)
    }

    /// Returns the num_attestations field for a MintAttestationSet
    pub fn num_attestations(&self) -> Result<u32> {
        self.read_u32(Self::ATTESTATION_SET_NUM_ATTESTATIONS_OFFSET)
    }

    /// Returns version field
    pub fn version(&self) -> Result<u32> {
        self.read_u32(Self::VERSION_OFFSET)
    }

    /// Returns destination_domain field
    pub fn destination_domain(&self) -> Result<u32> {
        self.read_u32(Self::DESTINATION_DOMAIN_OFFSET)
    }

    /// Returns destination_contract field
    pub fn destination_contract(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::DESTINATION_CONTRACT_OFFSET)
    }

    /// Returns destination_token field
    pub fn destination_token(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::checked_add(
            self.offset,
            Self::DESTINATION_TOKEN_OFFSET,
        )?)
    }

    /// Returns destination_recipient field
    pub fn destination_recipient(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::checked_add(
            self.offset,
            Self::DESTINATION_RECIPIENT_OFFSET,
        )?)
    }

    /// Returns destination_caller field
    pub fn destination_caller(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::DESTINATION_CALLER_OFFSET)
    }

    /// Returns value field
    pub fn value(&self) -> Result<u64> {
        self.read_u64(Self::checked_add(self.offset, Self::VALUE_OFFSET)?)
    }

    /// Returns max_block_height field
    pub fn max_block_height(&self) -> Result<u64> {
        self.read_u64(Self::MAX_BLOCK_HEIGHT_OFFSET)
    }

    /// Returns transfer_spec_hash field
    pub fn transfer_spec_hash(&self) -> Result<[u8; 32]> {
        self.read_bytes::<32>(Self::checked_add(
            self.offset,
            Self::TRANSFER_SPEC_HASH_OFFSET,
        )?)
    }

    /// Returns hook_data_length field
    pub fn hook_data_length(&self) -> Result<u32> {
        self.read_u32(Self::checked_add(
            self.offset,
            Self::HOOK_DATA_LENGTH_OFFSET,
        )?)
    }

    /// Returns hook_data field
    pub fn hook_data(&self) -> Result<&[u8]> {
        let hook_data_offset = Self::checked_add(self.offset, Self::HOOK_DATA_OFFSET)?;
        let hook_data_length = Self::u32_to_usize(self.hook_data_length()?)?;
        Ok(&self.data[hook_data_offset..Self::checked_add(hook_data_offset, hook_data_length)?])
    }

    // Private helpers

    /// Reads u32 field at the given offset
    fn read_u32(&self, index: usize) -> Result<u32> {
        let end = Self::checked_add(index, 4)?;
        Ok(u32::from_be_bytes(
            self.data[index..end]
                .try_into()
                .map_err(|_| error!(GatewayMinterError::MalformedMintAttestation))?,
        ))
    }

    /// Reads u64 field at the given offset
    fn read_u64(&self, index: usize) -> Result<u64> {
        let end = Self::checked_add(index, 8)?;
        Ok(u64::from_be_bytes(
            self.data[index..end]
                .try_into()
                .map_err(|_| error!(GatewayMinterError::MalformedMintAttestation))?,
        ))
    }

    /// Reads pubkey field at the given offset
    fn read_pubkey(&self, index: usize) -> Result<Pubkey> {
        Pubkey::try_from(
            &self.data[index..Self::checked_add(index, std::mem::size_of::<Pubkey>())?],
        )
        .map_err(|_| error!(GatewayMinterError::MalformedMintAttestation))
    }

    /// Reads bytes field at the given offset
    fn read_bytes<const N: usize>(&self, index: usize) -> Result<[u8; N]> {
        self.data[index..Self::checked_add(index, N)?]
            .try_into()
            .map_err(|_| error!(GatewayMinterError::MalformedMintAttestation))
    }

    /// Converts a u32 to a usize
    fn u32_to_usize(value: u32) -> Result<usize> {
        usize::try_from(value).map_err(|_| error!(GatewayMinterError::MalformedMintAttestation))
    }

    #[inline]
    fn checked_add(a: usize, b: usize) -> Result<usize> {
        a.checked_add(b)
            .ok_or_else(|| error!(GatewayMinterError::MalformedMintAttestation))
    }
}

#[derive(Clone, Debug)]
pub struct MintAttestationStruct<'a> {
    pub version: u32,
    pub destination_domain: u32,
    pub destination_contract: [u8; 32],
    pub destination_caller: [u8; 32],
    pub max_block_height: u64,
    pub elements: Vec<MintAttestationElementStruct<'a>>,
}

#[derive(Clone, Debug)]
pub struct MintAttestationElementStruct<'a> {
    pub destination_token: [u8; 32],
    pub destination_recipient: [u8; 32],
    pub value: u64,
    pub transfer_spec_hash: [u8; 32],
    pub hook_data: &'a [u8],
}

#[allow(clippy::too_many_arguments)]
impl<'a> MintAttestationStruct<'a> {
    pub fn encode_attestation(&self) -> Vec<u8> {
        let num_elements = self.elements.len() as u32;

        let mut total_size = MintAttestation::ATTESTATION_SET_ATTESTATIONS_OFFSET; // fixed header size
        for element in &self.elements {
            let hook_data_length = element.hook_data.len();
            total_size += MintAttestation::HOOK_DATA_OFFSET + hook_data_length;
        }

        let mut buffer = Vec::with_capacity(total_size);

        // Encode attestation set header
        buffer.extend_from_slice(&MintAttestation::ATTESTATION_SET_MAGIC.to_be_bytes());
        buffer.extend_from_slice(&self.version.to_be_bytes());
        buffer.extend_from_slice(&self.destination_domain.to_be_bytes());
        buffer.extend_from_slice(&self.destination_contract);
        buffer.extend_from_slice(&self.destination_caller);
        buffer.extend_from_slice(&self.max_block_height.to_be_bytes());
        buffer.extend_from_slice(&num_elements.to_be_bytes());

        // Encode each attestation element
        for element in &self.elements {
            let hook_data_length = element.hook_data.len() as u32;
            buffer.extend_from_slice(&element.destination_token);
            buffer.extend_from_slice(&element.destination_recipient);
            buffer.extend_from_slice(&element.value.to_be_bytes());
            buffer.extend_from_slice(&element.transfer_spec_hash);
            buffer.extend_from_slice(&hook_data_length.to_be_bytes());
            buffer.extend_from_slice(element.hook_data);
        }

        buffer
    }
}
