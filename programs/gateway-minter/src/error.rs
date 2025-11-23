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

#[error_code]
pub enum GatewayMinterError {
    // Authorization
    #[msg("Invalid authority")]
    InvalidAuthority,

    // Admin Roles
    #[msg("Invalid pauser")]
    InvalidPauser,
    #[msg("Invalid token controller")]
    InvalidTokenController,

    // Pausing
    #[msg("Program is paused")]
    ProgramPaused,

    // Attester Management
    #[msg("Invalid attester")]
    InvalidAttester,
    #[msg("Attester limit exceeded")]
    AttesterLimitExceeded,

    // Token Management
    #[msg("Max tokens supported")]
    MaxTokensSupported,
    #[msg("Token not supported")]
    TokenNotSupported,
    #[msg("Invalid burn amount")]
    InvalidBurnAmount,

    // Attestation Parsing
    #[msg("Malformed mint attestation")]
    MalformedMintAttestation,
    #[msg("Mint attestation magic mismatch")]
    AttestationMagicMismatch,
    #[msg("Mint attestation too short")]
    AttestationTooShort,
    #[msg("Mint attestation too long")]
    AttestationTooLong,
    #[msg("Empty attestation set")]
    EmptyAttestationSet,

    // Attestation Signature Verification
    #[msg("Invalid attester signature")]
    InvalidAttesterSignature,

    // Attestation Validation
    #[msg("Version mismatch")]
    VersionMismatch,
    #[msg("Attestation expired")]
    AttestationExpired,
    #[msg("Invalid attestation value")]
    InvalidAttestationValue,
    #[msg("Destination domain does not match local domain")]
    DestinationDomainMismatch,
    #[msg("Destination contract does not match program ID")]
    DestinationContractMismatch,
    #[msg("Destination token does not match token mint")]
    DestinationTokenMismatch,
    #[msg("Destination caller does not match signer")]
    DestinationCallerMismatch,
    #[msg("Destination recipient does not match token account")]
    DestinationRecipientMismatch,

    // Transfer Spec Hash
    #[msg("Remaining accounts length mismatch")]
    RemainingAccountsLengthMismatch,
    #[msg("Invalid transfer spec hash account")]
    InvalidTransferSpecHashAccount,
    #[msg("Transfer spec hash already used")]
    TransferSpecHashAlreadyUsed,

    // Token Account Validation
    #[msg("Invalid custody token account")]
    InvalidCustodyTokenAccount,
    #[msg("Invalid destination token account")]
    InvalidDestinationTokenAccount,
}
