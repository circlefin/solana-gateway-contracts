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

import { LiteSVM } from "litesvm";
import { GatewayWalletTestClient } from "./test_client";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Ed25519Program,
} from "@solana/web3.js";
import { SOLANA_DOMAIN } from "../constants";
import {
  BI_TRANSFER_SPEC_OFFSET,
  TS_HOOK_DATA_OFFSET,
  TransferSpec,
} from "../burn_intent";
import {
  expectAnchorError,
  expectEd25519ProgramError,
  findPDA,
  createGatewayBurnRemainingAccounts,
  createSignedBurnIntent,
  generateSignerKeypair,
  EvmKeypair,
  signAttestation,
  signBurnIntent,
} from "../utils";
import {
  encodeBurnSignerMessage,
  encodeEd25519InstructionData,
  BURN_INTENT_MESSAGE_PREFIX_LENGTH,
  ED25519_DATA_OFFSET,
} from "../burn_data";

describe("Ed25519 Precompile Validation", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;
  let tokenMint: PublicKey;
  let mintAuthority: Keypair;
  let custodyTokenAccountPDA: PublicKey;
  let depositor: Keypair;
  let depositorTokenAccount: PublicKey;
  let deposit: PublicKey;
  let feeRecipient: Keypair;
  let feeRecipientTokenAccount: PublicKey;
  let defaultBurnSigner: EvmKeypair;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);

    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    // Add a burn signer
    defaultBurnSigner = generateSignerKeypair();
    await client.addBurnSigner({ signer: defaultBurnSigner.publicKey });

    // Create a test token mint
    mintAuthority = Keypair.generate();
    tokenMint = await client.createTokenMint(mintAuthority.publicKey, 6);

    // Add the token to the gateway wallet
    await client.addToken({ tokenMint });

    // Get the custody token account PDA
    custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
      client.gatewayWalletProgram.programId
    ).publicKey;

    // Create fee recipient token account
    feeRecipient = Keypair.generate();
    client.updateFeeRecipient({ newFeeRecipient: feeRecipient.publicKey });
    feeRecipientTokenAccount = await client.createAssociatedTokenAccount(
      tokenMint,
      feeRecipient.publicKey
    );

    // Create depositor and their token account
    depositor = Keypair.generate();
    svm.airdrop(depositor.publicKey, BigInt(LAMPORTS_PER_SOL));
    depositorTokenAccount = await client.createTokenAccount(
      tokenMint,
      depositor.publicKey
    );

    // Mint tokens to the depositor's token account
    await client.mintToken(
      tokenMint,
      depositorTokenAccount,
      2000000000, // 2000 tokens with 6 decimals
      mintAuthority
    );

    // Depositor deposits tokens (transfers to custody)
    await client.deposit(
      {
        tokenMint,
        amount: 1000000000, // 1000 tokens with 6 decimals
        fromTokenAccount: depositorTokenAccount,
        forDepositor: depositor.publicKey,
      },
      { owner: depositor }
    );

    deposit = findPDA(
      [
        Buffer.from("gateway_deposit"),
        tokenMint.toBuffer(),
        depositor.publicKey.toBuffer(),
      ],
      client.gatewayWalletProgram.programId
    ).publicKey;
  });

  describe("Precompile instruction ordering", () => {
    it("should fail when no ed25519 precompile instruction is included", async () => {
      // Create only the gateway_burn instruction, without ed25519 precompile
      const { instruction: burnInstruction } =
        await createGatewayBurnInstruction();

      const transaction = new Transaction().add(burnInstruction);

      await expectAnchorError(
        client.sendTransaction(transaction),
        "PreviousInstructionNotEd25519Program"
      );
    });

    it("should fail when ed25519 instruction is not immediately before gateway_burn", async () => {
      const { instruction: burnInstruction, burnBytes } =
        await createGatewayBurnInstruction({
          hookData: Buffer.alloc(0),
          hookDataLength: 0,
        });

      // Create ed25519 precompile instruction
      const ed25519Instruction = new TransactionInstruction({
        keys: [],
        programId: Ed25519Program.programId,
        data: encodeEd25519InstructionData(burnBytes.length, {
          signatureInstructionIndex: 2,
          publicKeyInstructionIndex: 2,
          messageInstructionIndex: 2,
        }),
      });

      // Create a no-op instruction to insert between ed25519 and gateway_burn
      const noopInstruction = new TransactionInstruction({
        keys: [],
        programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        data: Buffer.from("noop"),
      });

      // ed25519 -> noop -> gateway_burn (should fail)
      const transaction = new Transaction()
        .add(ed25519Instruction)
        .add(noopInstruction)
        .add(burnInstruction);

      await expectAnchorError(
        client.sendTransaction(transaction),
        "PreviousInstructionNotEd25519Program"
      );
    });
  });

  describe("Invalid offset scenarios", () => {
    it("should fail when public key offset is invalid", async () => {
      const { instruction: burnInstruction, burnBytes } =
        await createGatewayBurnInstruction();

      // Create ed25519 instruction with invalid public key offset
      const invalidEd25519Instruction = new TransactionInstruction({
        keys: [],
        programId: Ed25519Program.programId,
        data: encodeEd25519InstructionData(burnBytes.length, {
          publicKeyOffset: 9999, // Points outside instruction data
        }),
      });

      const transaction = new Transaction()
        .add(invalidEd25519Instruction)
        .add(burnInstruction);

      // Should fail at the Ed25519 precompile level
      await expectEd25519ProgramError(
        client.sendTransaction(transaction),
        "InvalidDataOffsets"
      );
    });
  });

  describe("Invalid signature scenarios", () => {
    it("should fail when signature is invalid", async () => {
      // Create burn data with an invalid signature (all zeros)
      const invalidSignature = Buffer.alloc(64);

      const { instruction: burnInstruction, burnBytes } =
        await createGatewayBurnInstruction({
          userSignature: invalidSignature,
        });

      // Create ed25519 precompile instruction with valid offsets
      const ed25519Instruction = new TransactionInstruction({
        keys: [],
        programId: Ed25519Program.programId,
        data: encodeEd25519InstructionData(burnBytes.length),
      });

      const transaction = new Transaction()
        .add(ed25519Instruction)
        .add(burnInstruction);

      // Should fail at the Ed25519 precompile level (invalid signature)
      await expectEd25519ProgramError(
        client.sendTransaction(transaction),
        "InvalidSignature"
      );
    });
  });

  describe("Invalid ed25519 instruction data scenarios", () => {
    it("should pass ed25519 precompile but fail in gateway_burn when instruction index points to another instruction", async () => {
      // Honest depositor signs a harmless looking message
      const invalidMessage = Buffer.from("sign me");
      const badSignature = signBurnIntent(
        invalidMessage,
        depositor.secretKey,
        false
      );

      const { instruction: burnInstruction, burnBytes } =
        await createGatewayBurnInstruction({
          userSignature: badSignature,
          hookData: Buffer.alloc(0),
          hookDataLength: 0,
        });

      // Encode the invalidMessage into a third instruction
      const messageInstruction = new TransactionInstruction({
        keys: [],
        programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        data: Buffer.concat([invalidMessage]),
      });

      // Update the ed25519 instruction data to point to the invalidMessage in the third instruction
      const invalidEd25519InstructionData = encodeEd25519InstructionData(
        burnBytes.length,
        {
          messageDataOffset: 0,
          messageDataSize: invalidMessage.length,
          messageInstructionIndex: 2,
        }
      );
      const invalidEd25519Instruction = new TransactionInstruction({
        keys: [],
        programId: Ed25519Program.programId,
        data: invalidEd25519InstructionData,
      });

      const transaction = new Transaction()
        .add(invalidEd25519Instruction)
        .add(burnInstruction)
        .add(messageInstruction);

      // Precompile succeeds, but gateway_burn fails
      await expectAnchorError(
        client.sendTransaction(transaction),
        "InvalidEd25519InstructionData"
      );
    });

    it("should pass ed25519 instruction but fail in gateway_burn when pubkey offset points into hookData", async () => {
      // Try to trick the gateway_burn to accept an unauthorized burn intent by getting the precompile to validate a
      // random message in the hook data.
      const badKeypair = Keypair.generate();
      const badPubkey = badKeypair.publicKey.toBuffer();
      const invalidMessage = Buffer.from("msg");
      const badSignature = signBurnIntent(
        invalidMessage,
        badKeypair.secretKey,
        false
      );

      const { instruction: burnInstruction, burnBytes } =
        await createGatewayBurnInstruction({
          userSignature: badSignature,
          hookData: Buffer.concat([badPubkey, invalidMessage]),
          hookDataLength: badPubkey.length + invalidMessage.length,
        });

      // Update the ed25519 instruction data to point to hook data for pubkey and message
      const hookDataOffset =
        ED25519_DATA_OFFSET +
        BURN_INTENT_MESSAGE_PREFIX_LENGTH +
        BI_TRANSFER_SPEC_OFFSET +
        TS_HOOK_DATA_OFFSET;
      const invalidEd25519InstructionData = encodeEd25519InstructionData(
        burnBytes.length,
        {
          publicKeyOffset: hookDataOffset,
          messageDataOffset: hookDataOffset + 32,
          messageDataSize: invalidMessage.length,
        }
      );

      // Create ed25519 instruction with instruction indexes pointing to itself (0)
      const invalidEd25519Instruction = new TransactionInstruction({
        keys: [],
        programId: Ed25519Program.programId,
        data: invalidEd25519InstructionData,
      });

      const transaction = new Transaction()
        .add(invalidEd25519Instruction)
        .add(burnInstruction);

      await expectAnchorError(
        client.sendTransaction(transaction),
        "InvalidEd25519InstructionData"
      );
    });

    it("should fail when ed25519 instruction data is too short", async () => {
      const { instruction: burnInstruction } =
        await createGatewayBurnInstruction();

      // Create ed25519 instruction with data that's too short (15 bytes instead of 16)
      const shortData = Buffer.alloc(15);
      const invalidEd25519Instruction = new TransactionInstruction({
        keys: [],
        programId: Ed25519Program.programId,
        data: shortData,
      });

      const transaction = new Transaction()
        .add(invalidEd25519Instruction)
        .add(burnInstruction);

      // Should fail at the Ed25519 precompile level
      await expectEd25519ProgramError(
        client.sendTransaction(transaction),
        "InvalidInstructionDataSize"
      );
    });

    it("should fail when ed25519 instruction data is too long", async () => {
      const { instruction: burnInstruction, burnBytes } =
        await createGatewayBurnInstruction();

      // Create ed25519 instruction with data that's too long (17 bytes instead of 16)
      const longData = encodeEd25519InstructionData(burnBytes.length, {
        additionalData: Buffer.alloc(1),
      });

      const invalidEd25519Instruction = new TransactionInstruction({
        keys: [],
        programId: Ed25519Program.programId,
        data: longData,
      });

      const transaction = new Transaction()
        .add(invalidEd25519Instruction)
        .add(burnInstruction);

      // Should fail at the gateway_burn level
      await expectAnchorError(
        client.sendTransaction(transaction),
        "InvalidEd25519InstructionData"
      );
    });
  });

  // Helper function to create a signed burn intent with default parameters
  function createDefaultSignedBurnIntent(overrides?: {
    sourceSigner?: PublicKey;
    value?: bigint;
    hookData?: Buffer;
    hookDataLength?: number;
  }) {
    const transferSpecOverrides: Partial<TransferSpec> = {
      sourceSigner: overrides?.sourceSigner || depositor.publicKey,
      sourceContract: client.gatewayWalletProgram.programId,
      sourceToken: tokenMint,
      sourceDepositor: depositor.publicKey,
      value: overrides?.value || BigInt(1000000),
    };

    // Only include hookData and hookDataLength if they are explicitly provided
    if (overrides?.hookData !== undefined) {
      transferSpecOverrides.hookData = overrides.hookData;
    }
    if (overrides?.hookDataLength !== undefined) {
      transferSpecOverrides.hookDataLength = overrides.hookDataLength;
    }

    return createSignedBurnIntent({
      signer: depositor,
      transferSpecOverrides,
    });
  }

  // Helper function to create gateway burn instruction
  async function createGatewayBurnInstruction(overrides?: {
    userSignature?: Buffer;
    sourceSigner?: PublicKey;
    hookData?: Buffer;
    hookDataLength?: number;
  }) {
    const {
      bytes: burnBytes,
      signature,
      intent: burnIntent,
    } = createDefaultSignedBurnIntent({
      sourceSigner: overrides?.sourceSigner,
      hookData: overrides?.hookData,
      hookDataLength: overrides?.hookDataLength,
    });

    const userSignature = overrides?.userSignature ?? signature;

    const encodedBurnData = encodeBurnSignerMessage(
      BigInt(0),
      userSignature,
      burnBytes
    );
    const burnSignature = signAttestation(
      encodedBurnData,
      defaultBurnSigner.privateKey
    );

    return {
      instruction: await client.gatewayWalletProgram.methods
        .gatewayBurn({
          encodedBurnData,
          burnSignature,
        })
        .accountsPartial({
          gatewayWallet: client.pdas.gatewayWallet.publicKey,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          delegateAccount: null,
        })
        .remainingAccounts(
          createGatewayBurnRemainingAccounts(
            [burnIntent],
            client.gatewayWalletProgram.programId
          )
        )
        .instruction(),
      burnBytes,
    };
  }
});
