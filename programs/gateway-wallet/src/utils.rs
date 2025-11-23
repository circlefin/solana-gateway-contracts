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

//! Common utility functions.

use {
    crate::{error::GatewayWalletError, state::GatewayDelegate},
    anchor_lang::prelude::*,
};

// Re-export from shared library for convenience
pub use gateway_shared::DISCRIMINATOR_SIZE;

/// Check if denylist account exists
///
/// # Arguments
/// * `denylist_account` - The denylist UncheckedAccount (with seeds constraint)
///
/// # Returns
/// * `true` - Account exists with data (user is denylisted)
/// * `false` - Account doesn't exist (user is not denylisted)
pub fn is_account_denylisted<'info>(denylist_account: &UncheckedAccount<'info>) -> bool {
    // If account has no data, user is not denylisted
    !denylist_account.data_is_empty()
}

/// Validates that a signer was ever authorized for a depositor's balance.
/// A depositor is always authorized for their own balance.
/// Otherwise, checks for a delegate account with Authorized or Revoked status.
///
/// # Arguments
/// * `source_signer` - The signer to validate
/// * `source_depositor` - The depositor from the burn intent
/// * `delegate_account` - Optional delegate account if signer != depositor
///
/// # Returns
/// * `Ok(())` if the signer is authorized
/// * `Err` if the signer is not authorized
pub fn validate_signer_authorization<'info>(
    source_signer: &Pubkey,
    source_depositor: &Pubkey,
    delegate_account: Option<&Account<'info, GatewayDelegate>>,
) -> Result<()> {
    // A depositor is always authorized for their own balance
    if source_signer == source_depositor {
        return Ok(());
    }

    // For delegates, we need to check the delegate account
    let delegate_account = delegate_account.ok_or(GatewayWalletError::InvalidDelegateAccount)?;

    // Ensure that the chosen delegate account applies to this depositor
    require_keys_eq!(
        delegate_account.depositor,
        *source_depositor,
        GatewayWalletError::DelegateDepositorMismatch
    );

    // Ensure the the chosen delegate account matches the intended signer
    require_keys_eq!(
        delegate_account.delegate,
        *source_signer,
        GatewayWalletError::DelegateSignerMismatch
    );

    require!(
        delegate_account.was_ever_authorized_for_balance(*source_depositor, *source_signer),
        GatewayWalletError::DelegateSignerNotAuthorized
    );

    Ok(())
}
