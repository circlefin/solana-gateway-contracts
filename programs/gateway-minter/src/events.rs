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

#[event(discriminator = [10, 0])]
pub struct OwnershipTransferStarted {
    pub previous_owner: Pubkey,
    pub new_owner: Pubkey,
}

#[event(discriminator = [10, 1])]
pub struct OwnershipTransferred {
    pub previous_owner: Pubkey,
    pub new_owner: Pubkey,
}

#[event(discriminator = [10, 2])]
pub struct GatewayMinterInitialized {}

#[event(discriminator = [10, 3])]
pub struct PauserChanged {
    pub old_pauser: Pubkey,
    pub new_pauser: Pubkey,
}

#[event(discriminator = [10, 4])]
pub struct AttestationSignerAdded {
    pub signer: Pubkey,
}

#[event(discriminator = [10, 5])]
pub struct AttestationSignerRemoved {
    pub signer: Pubkey,
}

#[event(discriminator = [10, 6])]
pub struct TokenControllerUpdated {
    pub previous_token_controller: Pubkey,
    pub new_token_controller: Pubkey,
}

#[event(discriminator = [10, 7])]
pub struct TokenSupported {
    pub token: Pubkey,
    pub custody_token_account: Pubkey,
}

#[event(discriminator = [10, 8])]
pub struct TokenCustodyBurned {
    pub token: Pubkey,
    pub custody_token_account: Pubkey,
    pub amount: u64,
}

#[event(discriminator = [10, 9])]
pub struct Paused {
    pub account: Pubkey,
}

#[event(discriminator = [10, 10])]
pub struct Unpaused {
    pub account: Pubkey,
}

#[event(discriminator = [10, 11])]
pub struct AttestationUsed {
    pub token: Pubkey,
    pub recipient: Pubkey,
    pub transfer_spec_hash: [u8; 32],
    pub value: u64,
}
