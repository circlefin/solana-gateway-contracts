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

//! Gateway Burn
//!
//! Processes a burn intent message by verifying the user signature via the Ed25519
//! precompile and burning tokens from the custody account. A valid burn signer
//! must authorize this instruction by signing the encoded burn data.
//!
//! The transaction must place the Ed25519 verification instruction immediately
//! before this `gateway_burn` instruction. That program introspects this
//! instruction's data to read the signature, public key, and message.
//!
//! Instruction data layout
//! ```
//! offset  size  field
//! 0       2     discriminator (custom 2-byte discriminator)
//! 2       4     encoded_burn_data length (u32)
//! 6       N     encoded_burn_data
//! 6+N     4     burn_signature length (u32)
//! 6+N+4   M     burn_signature
//! ```
//!
//! When constructing the Ed25519 precompile instruction, use:
//! ```
//! const num_signatures = 1
//! const padding = 0
//! const signature_offset = 6 + BurnData::BURN_DATA_USER_SIGNATURE_OFFSET
//! const signature_instruction_index = <index of this gateway_burn instruction>
//! const public_key_offset = 6 + BurnData::TS_SOURCE_SIGNER_OFFSET
//! const public_key_instruction_index = <index of this gateway_burn instruction>
//! const message_data_offset = 6 + BurnData::BURN_INTENT_MESSAGE_PREFIX_OFFSET
//! const message_data_size = 16 + <burn intent message length>
//! const message_instruction_index = <index of this gateway_burn instruction>
//! ```

use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::keccak::hash;
use anchor_lang::solana_program::sysvar::instructions::{
    get_instruction_relative, load_current_index_checked,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use gateway_shared::{
    create_used_transfer_spec_hash_account, ethereum_signed_message_hash,
    is_transfer_spec_hash_used, DISCRIMINATOR_SIZE, USED_TRANSFER_SPEC_HASH_SEED_PREFIX,
};

use crate::ed25519::Ed25519InstructionData;
use crate::{
    burn_data::BurnData,
    error::GatewayWalletError,
    events::{GatewayBurned, InsufficientBalance},
    seeds::{
        GATEWAY_DELEGATE_SEED, GATEWAY_DEPOSIT_SEED, GATEWAY_WALLET_CUSTODY_SEED,
        GATEWAY_WALLET_SEED,
    },
    state::{GatewayDelegate, GatewayDeposit, GatewayWallet, UsedTransferSpecHash},
    utils::validate_signer_authorization,
};

// The expected index of the used transfer spec hash account in the remaining accounts
const USED_TRANSFER_SPEC_HASH_ACCOUNT_INDEX: usize = 0;

// The offset of the start of the burn data relative to the start of the gateway_burn instruction data
// This includes the discriminator and a 4-byte size field for the size of the encoded_burn_data
const BURN_DATA_OFFSET: u16 = (DISCRIMINATOR_SIZE + 4) as u16;

// Required values for the Ed25519 instruction
const ED25519_NUM_SIGNATURES: u8 = 1;
const ED25519_PADDING: u8 = 0;

#[event_cpi]
#[derive(Accounts)]
pub struct GatewayBurnContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
        constraint = !gateway_wallet.paused @ GatewayWalletError::ProgramPaused
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,

    #[account(mut)]
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = gateway_wallet,
        seeds = [GATEWAY_WALLET_CUSTODY_SEED, token_mint.key().as_ref()],
        bump = gateway_wallet.get_custody_token_account_bump(token_mint.key())?
    )]
    pub custody_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = gateway_wallet.fee_recipient,
        associated_token::token_program = token_program
    )]
    pub fee_recipient_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [GATEWAY_DEPOSIT_SEED, token_mint.key().as_ref(), deposit.depositor.key().as_ref()],
        bump = deposit.bump,
    )]
    pub deposit: Account<'info, GatewayDeposit>,

    #[account(
        seeds = [
            GATEWAY_DELEGATE_SEED,
            token_mint.key().as_ref(),
            delegate_account.depositor.key().as_ref(),
            delegate_account.delegate.key().as_ref()
        ],
        bump = delegate_account.bump,
    )]
    pub delegate_account: Option<Account<'info, GatewayDelegate>>,

    /// CHECK: Verify that this is the instructions sysvar
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    pub token_program: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GatewayBurnParams {
    pub encoded_burn_data: Vec<u8>,
    pub burn_signature: Vec<u8>,
}

pub fn gateway_burn<'burn>(
    ctx: Context<'_, '_, '_, 'burn, GatewayBurnContext<'burn>>,
    params: &GatewayBurnParams,
) -> Result<()> {
    let gateway_wallet = &ctx.accounts.gateway_wallet;

    // We expect the burn signer to sign the keccak256 hash of the
    // encoded_burn_data bytes using EIP-191 "Ethereum Signed Message"
    let encoded_data_hash = hash(&params.encoded_burn_data).0;
    let eth_signed_hash = ethereum_signed_message_hash(&encoded_data_hash);
    gateway_wallet.verify_burn_signature(&eth_signed_hash, &params.burn_signature)?;

    // Parse the burn intent
    let burn_data: BurnData<'_> = BurnData::new(&params.encoded_burn_data)?;
    verify_user_signature(
        &ctx.accounts.instructions_sysvar,
        burn_data.burn_intent_message_length()?,
    )?;

    // Validate version matches gateway_wallet version
    let intent_version = burn_data.version()?;
    require_eq!(
        intent_version,
        gateway_wallet.version,
        GatewayWalletError::VersionMismatch
    );

    // Verify the burn intent has not expired
    // Note: max_block_height refers to Solana slot number
    let max_block_height = burn_data.max_block_height()?;
    let current_slot = Clock::get()?.slot;
    require_gte!(
        max_block_height,
        current_slot,
        GatewayWalletError::BurnIntentExpired
    );

    // Verify the source domain matches the local domain
    let source_domain = burn_data.source_domain()?;
    require_eq!(
        source_domain,
        ctx.accounts.gateway_wallet.local_domain,
        GatewayWalletError::SourceDomainMismatch
    );

    // Verify the source contract matches this gateway wallet
    let source_contract = burn_data.source_contract()?;
    require_keys_eq!(
        source_contract,
        *ctx.program_id,
        GatewayWalletError::SourceContractMismatch
    );

    // Verify the token mint matches the source token in the burn intent
    let source_token = burn_data.source_token()?;
    require_keys_eq!(
        source_token,
        ctx.accounts.token_mint.key(),
        GatewayWalletError::SourceTokenMismatch
    );

    // Verify the depositor matches the depositor in the burn intent
    let source_depositor = burn_data.source_depositor()?;
    require_keys_eq!(
        source_depositor,
        ctx.accounts.deposit.depositor,
        GatewayWalletError::SourceDepositorMismatch
    );

    let source_signer = burn_data.source_signer()?;

    validate_signer_authorization(
        &source_signer,
        &source_depositor,
        ctx.accounts.delegate_account.as_ref(),
    )?;

    // Verify the fee does not exceed the maximum allowed fee
    let max_fee = burn_data.max_fee()?;
    let fee = burn_data.fee()?;
    require_gte!(max_fee, fee, GatewayWalletError::BurnFeeExceedsMaxFee);

    // Check sufficient balance in custody account
    let value: u64 = burn_data.value()?;
    require_gte!(
        ctx.accounts.custody_token_account.amount,
        value + fee,
        GatewayWalletError::InsufficientCustodyBalance
    );

    // Get the transfer spec hash account
    require_eq!(
        ctx.remaining_accounts.len(),
        1,
        GatewayWalletError::RemainingAccountsLengthMismatch
    );
    let transfer_spec_hash = burn_data.transfer_spec_hash()?;
    let hash_account = &ctx.remaining_accounts[USED_TRANSFER_SPEC_HASH_ACCOUNT_INDEX];

    let (expected_pda, bump) = Pubkey::find_program_address(
        &[USED_TRANSFER_SPEC_HASH_SEED_PREFIX, &transfer_spec_hash],
        ctx.program_id,
    );

    require_keys_eq!(
        expected_pda,
        hash_account.key(),
        GatewayWalletError::InvalidTransferSpecHashAccount
    );

    let is_used = {
        let account_data = hash_account.try_borrow_data()?;
        is_transfer_spec_hash_used(&account_data, UsedTransferSpecHash::DISCRIMINATOR)?
    };

    if is_used {
        return Err(GatewayWalletError::TransferSpecHashAlreadyUsed.into());
    }

    // Create and initialize the used transfer spec hash account
    create_used_transfer_spec_hash_account(
        hash_account,
        &transfer_spec_hash,
        bump,
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ctx.program_id,
        UsedTransferSpecHash::DISCRIMINATOR,
    )?;

    let (from_available, from_withdrawing) = ctx.accounts.deposit.reduce_balance(value + fee)?;

    let deducted_amount = from_available + from_withdrawing;
    if deducted_amount < value + fee {
        emit_cpi!(InsufficientBalance {
            token: ctx.accounts.token_mint.key(),
            depositor: ctx.accounts.deposit.depositor,
            value: value + fee,
            available_balance: from_available,
            withdrawing_balance: from_withdrawing,
        });
    }

    let actual_fee_charged = deducted_amount.saturating_sub(value);

    // Transfer the fee to the fee recipient
    if actual_fee_charged > 0 {
        let authority_seeds: &[&[&[u8]]] =
            &[&[GATEWAY_WALLET_SEED, &[ctx.accounts.gateway_wallet.bump]]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.custody_token_account.to_account_info(),
                to: ctx.accounts.fee_recipient_token_account.to_account_info(),
                authority: ctx.accounts.gateway_wallet.to_account_info(),
            },
            authority_seeds,
        );

        anchor_spl::token::transfer(transfer_ctx, actual_fee_charged)?;
    }

    // Burn everything else (deducted_amount - actual_fee_charged)
    let burn_amount = deducted_amount - actual_fee_charged;

    gateway_wallet.burn_token(
        &ctx.accounts.token_program,
        &ctx.accounts.token_mint,
        &ctx.accounts.custody_token_account,
        &ctx.accounts.gateway_wallet,
        ctx.accounts.gateway_wallet.bump,
        burn_amount,
    )?;

    emit_cpi!(GatewayBurned {
        token: ctx.accounts.token_mint.key(),
        depositor: ctx.accounts.deposit.depositor,
        transfer_spec_hash,
        destination_domain: burn_data.destination_domain()?,
        destination_recipient: burn_data.destination_recipient()?.to_bytes(),
        signer: burn_data.source_signer()?,
        value: burn_amount,
        fee: actual_fee_charged,
        from_available,
        from_withdrawing,
    });

    Ok(())
}

fn verify_user_signature<'burn>(
    instructions_sysvar: &UncheckedAccount<'burn>,
    burn_intent_message_length: usize,
) -> Result<()> {
    require_gte!(
        u16::MAX as usize,
        burn_intent_message_length,
        GatewayWalletError::MalformedBurnData
    );

    // Get the current instruction index
    let current_instruction_index = load_current_index_checked(instructions_sysvar)?;

    require_gt!(
        current_instruction_index,
        0,
        GatewayWalletError::PreviousInstructionNotEd25519Program
    );

    // Load the previous instruction
    let previous_instruction = get_instruction_relative(-1, instructions_sysvar)?;

    // Ensure the previous instruction is the Ed25519 program
    require_keys_eq!(
        previous_instruction.program_id,
        ed25519_program::ID,
        GatewayWalletError::PreviousInstructionNotEd25519Program
    );

    // Parse the Ed25519 instruction data and ensure that it validated the expected signature, public key, and message
    let data = Ed25519InstructionData::new(&previous_instruction.data)?;
    let signature_offset: u16 = BURN_DATA_OFFSET + BurnData::BURN_DATA_USER_SIGNATURE_OFFSET as u16;
    let source_signer_offset: u16 = BURN_DATA_OFFSET + BurnData::TS_SOURCE_SIGNER_OFFSET as u16;
    let burn_intent_message_offset: u16 =
        BURN_DATA_OFFSET + BurnData::BURN_INTENT_MESSAGE_PREFIX_OFFSET as u16;

    let valid_signature = data.num_signatures()? == ED25519_NUM_SIGNATURES
        && data.padding()? == ED25519_PADDING
        // Ensure the signature offset is the start of the user signature within the burn data
        && data.signature_offset()? == signature_offset
        && data.signature_instruction_index()? == current_instruction_index
        // Ensure the public key offset is the start of the burn intent source signer
        && data.public_key_offset()? == source_signer_offset
        && data.public_key_instruction_index()? == current_instruction_index
        // Ensure the message data offset is the start of the burn intent message and has the correct size
        && data.message_data_offset()? == burn_intent_message_offset
        && data.message_data_size()? == burn_intent_message_length as u16
        && data.message_instruction_index()? == current_instruction_index;

    if !valid_signature {
        let current_index_bytes = current_instruction_index.to_le_bytes();
        let expected_data = [
            [ED25519_NUM_SIGNATURES, ED25519_PADDING],
            signature_offset.to_le_bytes(),
            current_index_bytes,
            source_signer_offset.to_le_bytes(),
            current_index_bytes,
            burn_intent_message_offset.to_le_bytes(),
            (burn_intent_message_length as u16).to_le_bytes(),
            current_index_bytes,
        ];
        msg!(
            "Ed25519 ix data: {:?}, expected: {:?}",
            data.data(),
            expected_data.concat()
        );
        return err!(GatewayWalletError::InvalidEd25519InstructionData);
    }

    Ok(())
}
