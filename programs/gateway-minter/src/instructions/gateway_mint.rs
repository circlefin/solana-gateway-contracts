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

//! Gateway mint instruction handler

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak::hash;
use anchor_lang::solana_program::sysvar::clock::Clock;
use anchor_spl::token::{Token, TokenAccount};
use gateway_shared::{
    create_used_transfer_spec_hash_account, ethereum_signed_message_hash,
    is_transfer_spec_hash_used, USED_TRANSFER_SPEC_HASH_SEED_PREFIX,
};

use crate::{
    attestation::{MintAttestation, MintAttestationElementStruct, MintAttestationStruct},
    error::GatewayMinterError,
    events::AttestationUsed,
    seeds::{GATEWAY_MINTER_CUSTODY_SEED, GATEWAY_MINTER_SEED},
    state::{GatewayMinter, UsedTransferSpecHash},
};

#[event_cpi]
#[derive(Accounts)]
pub struct GatewayMintContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub destination_caller: Signer<'info>,

    #[account(
        seeds = [GATEWAY_MINTER_SEED],
        bump = gateway_minter.bump,
        constraint = !gateway_minter.paused @ GatewayMinterError::ProgramPaused
    )]
    pub gateway_minter: Box<Account<'info, GatewayMinter>>,

    pub system_program: Program<'info, System>,

    pub token_program: Program<'info, Token>,
    // Additional account triplets for each attestation element
    //   0. `[writable]` The custody token account PDA (seeds = [GATEWAY_MINTER_CUSTODY_SEED, destination_token])
    //   1. `[writable]` The destination recipient token account.
    //   2. `[writable]` The used transfer spec hash account PDA (seeds = [USED_TRANSFER_SPEC_HASH_SEED_PREFIX, transfer_spec_hash])
}

/// Mode 1: Full attestation bytes with signature
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GatewayMintParams {
    pub attestation: Vec<u8>,
    pub signature: Vec<u8>,
}

/// Mode 2: Parameter reconstruction mode with elements
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GatewayMintReconstructParams {
    pub is_default_destination_caller: bool,
    pub max_block_height: u64,
    pub elements: Vec<MintAttestationParams>,
    pub signature: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MintAttestationParams {
    pub value: u64,
    pub transfer_spec_hash: [u8; 32],
    pub hook_data: Vec<u8>,
}

pub fn gateway_mint<'mint>(
    ctx: Context<'_, '_, 'mint, 'mint, GatewayMintContext<'mint>>,
    params: &GatewayMintParams,
) -> Result<()> {
    let gateway_minter = &ctx.accounts.gateway_minter;

    // We expect the attestation signer to sign the keccak256 hash of the
    // attestation message bytes using EIP-191 "Ethereum Signed Message"
    let attestation_hash = hash(&params.attestation).0;
    let eth_signed_hash = ethereum_signed_message_hash(&attestation_hash);
    gateway_minter.verify_attestation_signature(&eth_signed_hash, &params.signature)?;

    let mut attestation = MintAttestation::new(&params.attestation)?;

    // Validate version matches gateway_minter version
    require_eq!(
        attestation.version()?,
        gateway_minter.version,
        GatewayMinterError::VersionMismatch
    );

    // Verify attestation is not expired
    // Note: the field is called max_block_height for consistency with EVM,
    // but in Solana context it refers to the slot height expiration
    require_gte!(
        attestation.max_block_height()?,
        Clock::get()?.slot,
        GatewayMinterError::AttestationExpired
    );

    // If destination caller is not zero address, verify it matches the signer
    let attestation_destination_caller = attestation.destination_caller()?;
    if attestation_destination_caller != Pubkey::default() {
        require_keys_eq!(
            attestation_destination_caller,
            ctx.accounts.destination_caller.key(),
            GatewayMinterError::DestinationCallerMismatch
        );
    }

    // Verify destination domain matches local domain
    require_eq!(
        attestation.destination_domain()?,
        gateway_minter.local_domain,
        GatewayMinterError::DestinationDomainMismatch
    );

    // Verify destination contract matches program ID
    require_keys_eq!(
        attestation.destination_contract()?,
        *ctx.program_id,
        GatewayMinterError::DestinationContractMismatch
    );

    // Check that remaining accounts length is exactly the number of attestation elements times 3
    // It is possible that num_attestations is encoded incorrectly. In this case we expect the
    // attestation iterator to return an error.
    require_eq!(
        ctx.remaining_accounts.len(),
        (attestation.num_attestations()? * 3) as usize,
        GatewayMinterError::RemainingAccountsLengthMismatch
    );

    // Each attestation element requires 3 accounts:
    // 0. Custody token account
    // 1. Destination recipient account
    // 2. Used transfer spec hash account
    let mut account_index = 0;
    while attestation.next()? {
        let custody_token_account = validate_custody_token_account(
            &ctx.remaining_accounts[account_index],
            gateway_minter,
            &ctx.accounts.gateway_minter.key(),
            ctx.program_id,
        )?;

        let destination_recipient_account =
            validate_destination_token_account(&ctx.remaining_accounts[account_index + 1])?;

        let transfer_spec_hash = process_used_transfer_spec_hash(
            attestation.transfer_spec_hash()?,
            &ctx.remaining_accounts[account_index + 2],
            &ctx.accounts.payer,
            &ctx.accounts.system_program,
            ctx.program_id,
        )?;

        // Verify token account mints match the expected destination token
        let destination_token = attestation.destination_token()?;
        require_keys_eq!(
            custody_token_account.mint,
            destination_token,
            GatewayMinterError::DestinationTokenMismatch
        );
        require_keys_eq!(
            destination_recipient_account.mint,
            destination_token,
            GatewayMinterError::DestinationTokenMismatch
        );

        // Verify destination account matches expected recipient
        require_keys_eq!(
            destination_recipient_account.key(),
            attestation.destination_recipient()?,
            GatewayMinterError::DestinationRecipientMismatch
        );

        // Verify attestation value is greater than 0
        let value = attestation.value()?;
        require_gt!(value, 0, GatewayMinterError::InvalidAttestationValue);

        // Mint token
        gateway_minter.mint_token(
            &ctx.accounts.token_program,
            &custody_token_account,
            &destination_recipient_account,
            &ctx.accounts.gateway_minter,
            gateway_minter.bump,
            value,
        )?;

        // Emit attestation used event
        emit_cpi!(AttestationUsed {
            token: attestation.destination_token()?,
            recipient: attestation.destination_recipient()?,
            transfer_spec_hash,
            value,
        });

        account_index += 3;
    }

    // Ensure no extra accounts were provided
    require_eq!(
        account_index,
        ctx.remaining_accounts.len(),
        GatewayMinterError::RemainingAccountsLengthMismatch
    );

    Ok(())
}

fn validate_custody_token_account<'mint>(
    account_info: &'mint AccountInfo<'mint>, // UncheckedAccount
    gateway_minter: &GatewayMinter,
    gateway_minter_key: &Pubkey,
    program_id: &Pubkey,
) -> Result<Account<'mint, TokenAccount>> {
    // Deserialize the token account
    let custody_account = Account::<'mint, TokenAccount>::try_from(account_info)
        .map_err(|_| GatewayMinterError::InvalidCustodyTokenAccount)?;

    // Verify authority is gateway_minter
    require_keys_eq!(
        custody_account.owner,
        *gateway_minter_key,
        GatewayMinterError::InvalidCustodyTokenAccount
    );

    // Verify account matches the expected custody PDA, and the token is supported
    let custody_bump = gateway_minter.get_custody_token_account_bump(custody_account.mint)?;
    let expected_custody_pda = Pubkey::create_program_address(
        &[
            GATEWAY_MINTER_CUSTODY_SEED,
            custody_account.mint.as_ref(),
            &[custody_bump],
        ],
        program_id,
    )
    .map_err(|_| GatewayMinterError::InvalidCustodyTokenAccount)?;

    require_keys_eq!(
        expected_custody_pda,
        account_info.key(),
        GatewayMinterError::InvalidCustodyTokenAccount
    );

    Ok(custody_account)
}

fn validate_destination_token_account<'mint>(
    account_info: &'mint AccountInfo<'mint>, // UncheckedAccount
) -> Result<Account<'mint, TokenAccount>> {
    // Deserialize the token account
    let destination_account = Account::<'mint, TokenAccount>::try_from(account_info)
        .map_err(|_| GatewayMinterError::InvalidDestinationTokenAccount)?;

    Ok(destination_account)
}

fn process_used_transfer_spec_hash<'mint>(
    transfer_spec_hash: [u8; 32],
    hash_account: &AccountInfo<'mint>, // UncheckedAccount
    payer: &Signer<'mint>,
    system_program: &Program<'mint, System>,
    program_id: &Pubkey,
) -> Result<[u8; 32]> {
    // Derive the expected PDA using the parsed hash
    let (expected_pda, bump) = Pubkey::find_program_address(
        &[USED_TRANSFER_SPEC_HASH_SEED_PREFIX, &transfer_spec_hash],
        program_id,
    );

    // Verify the provided account matches the expected PDA
    require_keys_eq!(
        expected_pda,
        hash_account.key(),
        GatewayMinterError::InvalidTransferSpecHashAccount
    );

    // Check if the hash is already used
    let is_used = {
        let account_data = hash_account.try_borrow_data()?;
        is_transfer_spec_hash_used(&account_data, UsedTransferSpecHash::DISCRIMINATOR)?
    };

    if is_used {
        return Err(GatewayMinterError::TransferSpecHashAlreadyUsed.into());
    }

    // Create and initialize the used transfer spec hash account
    create_used_transfer_spec_hash_account(
        hash_account,
        &transfer_spec_hash,
        bump,
        payer,
        system_program,
        program_id,
        UsedTransferSpecHash::DISCRIMINATOR,
    )?;

    Ok(transfer_spec_hash)
}

pub fn gateway_mint_with_params<'mint>(
    ctx: Context<'_, '_, 'mint, 'mint, GatewayMintContext<'mint>>,
    params: GatewayMintReconstructParams,
) -> Result<()> {
    require!(
        !params.elements.is_empty(),
        GatewayMinterError::EmptyAttestationSet
    );

    let attestation_bytes = reconstruct_attestation_bytes(&ctx, &params)?;

    let gateway_mint_params = GatewayMintParams {
        attestation: attestation_bytes,
        signature: params.signature,
    };

    gateway_mint(ctx, &gateway_mint_params)
}

fn reconstruct_attestation_bytes<'mint>(
    ctx: &Context<'_, '_, 'mint, 'mint, GatewayMintContext<'mint>>,
    params: &GatewayMintReconstructParams,
) -> Result<Vec<u8>> {
    // Check that remaining accounts length is exactly the number of attestation elements times 3
    require_eq!(
        ctx.remaining_accounts.len(),
        params.elements.len() * 3,
        GatewayMinterError::RemainingAccountsLengthMismatch
    );

    // Reconstruct each attestation element
    let mut account_index = 0;
    let mut elements = Vec::with_capacity(params.elements.len());
    for element in &params.elements {
        // Parse the destination recipient token account
        let destination_account =
            validate_destination_token_account(&ctx.remaining_accounts[account_index + 1])?;

        // Assume that the destination token is the same as the destination recipient token
        elements.push(MintAttestationElementStruct {
            destination_token: destination_account.mint.to_bytes(),
            destination_recipient: destination_account.key().to_bytes(),
            value: element.value,
            transfer_spec_hash: element.transfer_spec_hash,
            hook_data: element.hook_data.as_slice(),
        });

        account_index += 3;
    }

    // Determine how the destination caller should be encoded
    let destination_caller = if params.is_default_destination_caller {
        Pubkey::default()
    } else {
        ctx.accounts.destination_caller.key()
    };

    // Reconstruct the attestation bytes
    let attestation_struct = MintAttestationStruct {
        version: ctx.accounts.gateway_minter.version,
        destination_domain: ctx.accounts.gateway_minter.local_domain,
        destination_contract: ctx.program_id.to_bytes(),
        destination_caller: destination_caller.to_bytes(),
        max_block_height: params.max_block_height,
        elements,
    };

    Ok(attestation_struct.encode_attestation())
}
