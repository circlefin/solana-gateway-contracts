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

#[event(discriminator = [20, 0])]
pub struct GatewayWalletInitialized {}

#[event(discriminator = [20, 1])]
pub struct OwnershipTransferStarted {
    pub previous_owner: Pubkey,
    pub new_owner: Pubkey,
}

#[event(discriminator = [20, 2])]
pub struct OwnershipTransferred {
    pub previous_owner: Pubkey,
    pub new_owner: Pubkey,
}

#[event(discriminator = [20, 3])]
pub struct PauserChanged {
    pub old_pauser: Pubkey,
    pub new_pauser: Pubkey,
}

#[event(discriminator = [20, 4])]
pub struct DenylisterChanged {
    pub old_denylister: Pubkey,
    pub new_denylister: Pubkey,
}

#[event(discriminator = [20, 5])]
pub struct TokenControllerUpdated {
    pub previous_token_controller: Pubkey,
    pub new_token_controller: Pubkey,
}

#[event(discriminator = [20, 6])]
pub struct TokenSupported {
    pub token: Pubkey,
    pub custody_token_account: Pubkey,
}

#[event(discriminator = [20, 7])]
pub struct Deposited {
    pub token: Pubkey,
    pub depositor: Pubkey,
    pub sender: Pubkey,
    pub value: u64,
}

#[event(discriminator = [20, 8])]
pub struct DelegateAdded {
    pub token: Pubkey,
    pub depositor: Pubkey,
    pub delegate: Pubkey,
}

#[event(discriminator = [20, 9])]
pub struct DelegateRemoved {
    pub token: Pubkey,
    pub depositor: Pubkey,
    pub delegate: Pubkey,
}

#[event(discriminator = [20, 10])]
pub struct Denylisted {
    pub addr: Pubkey,
}

#[event(discriminator = [20, 11])]
pub struct UnDenylisted {
    pub addr: Pubkey,
}

#[event(discriminator = [20, 12])]
pub struct WithdrawalInitiated {
    pub token: Pubkey,
    pub depositor: Pubkey,
    pub value: u64,
    pub remaining_available: u64,
    pub total_withdrawing: u64,
    pub withdrawal_block: u64, // Named "withdrawal_block" for consistency with EVM events, but represents a Solana slot.
}

#[event(discriminator = [20, 13])]
pub struct BurnSignerAdded {
    pub signer: Pubkey,
}

#[event(discriminator = [20, 14])]
pub struct BurnSignerRemoved {
    pub signer: Pubkey,
}

#[event(discriminator = [20, 15])]
pub struct WithdrawalCompleted {
    pub token: Pubkey,
    pub depositor: Pubkey,
    pub value: u64,
}

#[event(discriminator = [20, 16])]
pub struct WithdrawalDelayChanged {
    pub old_delay: u64,
    pub new_delay: u64,
}

#[event(discriminator = [20, 17])]
pub struct FeeRecipientChanged {
    pub old_fee_recipient: Pubkey,
    pub new_fee_recipient: Pubkey,
}

#[event(discriminator = [20, 18])]
pub struct Paused {
    pub account: Pubkey,
}

#[event(discriminator = [20, 19])]
pub struct Unpaused {
    pub account: Pubkey,
}

#[event(discriminator = [20, 20])]
pub struct GatewayBurned {
    pub token: Pubkey,
    pub depositor: Pubkey,
    pub transfer_spec_hash: [u8; 32],
    pub destination_domain: u32,
    pub destination_recipient: [u8; 32],
    pub signer: Pubkey,
    pub value: u64,
    pub fee: u64,
    pub from_available: u64,
    pub from_withdrawing: u64,
}

#[event(discriminator = [20, 21])]
pub struct InsufficientBalance {
    pub token: Pubkey,
    pub depositor: Pubkey,
    pub value: u64,
    pub available_balance: u64,
    pub withdrawing_balance: u64,
}
