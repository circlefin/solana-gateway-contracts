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
pub enum GatewayWalletError {
    // Authorization
    #[msg("Invalid authority")]
    InvalidAuthority,

    // Admin Roles
    #[msg("Invalid pauser")]
    InvalidPauser,
    #[msg("Invalid denylister")]
    InvalidDenylister,
    #[msg("Invalid token controller")]
    InvalidTokenController,

    // Pausing
    #[msg("Program is paused")]
    ProgramPaused,

    // Denylist
    #[msg("Account is denylisted")]
    AccountDenylisted,

    // Burn Signer Management
    #[msg("Invalid burn signer")]
    InvalidBurnSigner,
    #[msg("Burn signer limit exceeded")]
    BurnSignerLimitExceeded,

    // Token Management
    #[msg("Max tokens supported")]
    MaxTokensSupported,
    #[msg("Token not supported")]
    TokenNotSupported,

    // Deposit / Withdrawal
    #[msg("Invalid depositor")]
    InvalidDepositor,
    #[msg("Invalid deposit amount")]
    InvalidDepositAmount,
    #[msg("Invalid withdrawal amount")]
    InvalidWithdrawalAmount,
    #[msg("Insufficient deposit balance")]
    InsufficientDepositBalance,
    #[msg("No withdrawal in progress")]
    NoWithdrawalInProgress,
    #[msg("Withdrawal delay not elapsed")]
    WithdrawalDelayNotElapsed,
    #[msg("Invalid withdrawal delay")]
    InvalidWithdrawalDelay,

    // Delegation
    #[msg("Invalid delegate")]
    InvalidDelegate,
    #[msg("Cannot delegate to self")]
    CannotDelegateToSelf,

    // Burn Intent Parsing
    #[msg("Malformed burn data")]
    MalformedBurnData,
    #[msg("Invalid burn intent message prefix")]
    InvalidBurnIntentMessagePrefix,
    #[msg("Invalid burn intent value")]
    InvalidBurnIntentValue,
    #[msg("Burn intent magic mismatch")]
    BurnIntentMagicMismatch,
    #[msg("Burn intent length mismatch")]
    BurnIntentLengthMismatch,
    #[msg("Transfer spec magic mismatch")]
    TransferSpecMagicMismatch,
    #[msg("Invalid u64 high bytes")]
    InvalidU64HighBytes,

    // Burn Signature Verification
    #[msg("Invalid burn signer signature")]
    InvalidBurnSignerSignature,
    #[msg("Burn signer not authorized")]
    BurnSignerNotAuthorized,

    // Burn Intent Validation
    #[msg("Version mismatch")]
    VersionMismatch,
    #[msg("Burn intent expired")]
    BurnIntentExpired,
    #[msg("Fee exceeds max fee")]
    BurnFeeExceedsMaxFee,
    #[msg("Source domain does not match local domain")]
    SourceDomainMismatch,
    #[msg("Source contract does not match program ID")]
    SourceContractMismatch,
    #[msg("Source token does not match token mint")]
    SourceTokenMismatch,
    #[msg("Source depositor does not match deposit")]
    SourceDepositorMismatch,
    #[msg("Invalid balance reduction amount")]
    InvalidBalanceReductionAmount,
    #[msg("Insufficient custody balance")]
    InsufficientCustodyBalance,

    // User Signature Verification
    #[msg("The previous instruction must be the Ed25519 program")]
    PreviousInstructionNotEd25519Program,
    #[msg("Invalid Ed25519 instruction data")]
    InvalidEd25519InstructionData,
    #[msg("Invalid delegate account")]
    InvalidDelegateAccount,
    #[msg("Delegate depositor does not match source depositor")]
    DelegateDepositorMismatch,
    #[msg("Delegate signer does not match source signer")]
    DelegateSignerMismatch,
    #[msg("Delegate signer not authorized")]
    DelegateSignerNotAuthorized,

    // Transfer Spec Hash
    #[msg("Remaining accounts length mismatch")]
    RemainingAccountsLengthMismatch,
    #[msg("Invalid transfer spec hash account")]
    InvalidTransferSpecHashAccount,
    #[msg("Transfer spec hash already used")]
    TransferSpecHashAlreadyUsed,
}
