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

//! Ed25519 instruction extraction and verification

use crate::error::GatewayWalletError;
use anchor_lang::prelude::*;

/// Ed25519 instruction header parser
///
/// Parses the Ed25519 instruction data format:
/// ```
/// struct Ed25519InstructionHeader {
///     num_signatures: u8,   // 1 byte
///     padding: u8,          // 1 byte
///     offsets: Ed25519SignatureOffsets, // 14 bytes
/// }
///
/// struct Ed25519SignatureOffsets {
///     signature_offset: u16,             // 2 bytes
///     signature_instruction_index: u16,  // 2 bytes
///     public_key_offset: u16,            // 2 bytes
///     public_key_instruction_index: u16, // 2 bytes
///     message_data_offset: u16,          // 2 bytes
///     message_data_size: u16,            // 2 bytes
///     message_instruction_index: u16,    // 2 bytes
/// }
/// ```
#[derive(Clone, Debug)]
pub struct Ed25519InstructionData<'a> {
    data: &'a [u8],
}

impl<'a> Ed25519InstructionData<'a> {
    // Ed25519InstructionHeader offsets
    const NUM_SIGNATURES_OFFSET: usize = 0;
    const PADDING_OFFSET: usize = 1;

    // Ed25519SignatureOffsets field offsets
    const SIGNATURE_OFFSET: usize = 2;
    const SIGNATURE_INSTRUCTION_INDEX_OFFSET: usize = 4;
    const PUBLIC_KEY_OFFSET: usize = 6;
    const PUBLIC_KEY_INSTRUCTION_INDEX_OFFSET: usize = 8;
    const MESSAGE_DATA_OFFSET: usize = 10;
    const MESSAGE_DATA_SIZE_OFFSET: usize = 12;
    const MESSAGE_INSTRUCTION_INDEX_OFFSET: usize = 14;

    // Total header size
    const HEADER_SIZE: usize = 16;

    pub fn new(data: &'a [u8]) -> Result<Self> {
        let instruction = Self { data };
        require_eq!(
            instruction.data.len(),
            Self::HEADER_SIZE,
            GatewayWalletError::InvalidEd25519InstructionData
        );
        Ok(instruction)
    }
}

impl<'a> Ed25519InstructionData<'a> {
    /// Returns the number of signatures in the instruction
    pub fn num_signatures(&self) -> Result<u8> {
        self.read_u8(Self::NUM_SIGNATURES_OFFSET)
    }

    /// Returns the padding
    pub fn padding(&self) -> Result<u8> {
        self.read_u8(Self::PADDING_OFFSET)
    }

    /// Returns the signature offset
    pub fn signature_offset(&self) -> Result<u16> {
        self.read_u16(Self::SIGNATURE_OFFSET)
    }

    /// Returns the signature instruction index
    pub fn signature_instruction_index(&self) -> Result<u16> {
        self.read_u16(Self::SIGNATURE_INSTRUCTION_INDEX_OFFSET)
    }

    /// Returns the public key offset
    pub fn public_key_offset(&self) -> Result<u16> {
        self.read_u16(Self::PUBLIC_KEY_OFFSET)
    }

    /// Returns the public key instruction index
    pub fn public_key_instruction_index(&self) -> Result<u16> {
        self.read_u16(Self::PUBLIC_KEY_INSTRUCTION_INDEX_OFFSET)
    }

    /// Returns the message data offset
    pub fn message_data_offset(&self) -> Result<u16> {
        self.read_u16(Self::MESSAGE_DATA_OFFSET)
    }

    /// Returns the message data size
    pub fn message_data_size(&self) -> Result<u16> {
        self.read_u16(Self::MESSAGE_DATA_SIZE_OFFSET)
    }

    /// Returns the message instruction index
    pub fn message_instruction_index(&self) -> Result<u16> {
        self.read_u16(Self::MESSAGE_INSTRUCTION_INDEX_OFFSET)
    }

    pub fn data(&self) -> &[u8] {
        self.data
    }

    // Private helpers

    /// Reads u8 field at the given offset
    fn read_u8(&self, index: usize) -> Result<u8> {
        self.data
            .get(index)
            .copied()
            .ok_or_else(|| error!(GatewayWalletError::InvalidEd25519InstructionData))
    }

    /// Reads u16 field at the given offset (little-endian)
    fn read_u16(&self, index: usize) -> Result<u16> {
        let end = Self::checked_add(index, 2)?;
        Ok(u16::from_le_bytes(
            self.data[index..end]
                .try_into()
                .map_err(|_| error!(GatewayWalletError::InvalidEd25519InstructionData))?,
        ))
    }

    #[inline]
    fn checked_add(a: usize, b: usize) -> Result<usize> {
        a.checked_add(b)
            .ok_or_else(|| error!(GatewayWalletError::InvalidEd25519InstructionData))
    }
}
