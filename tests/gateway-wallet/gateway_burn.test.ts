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
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { SOLANA_DOMAIN } from "../constants";
import {
  BI_TRANSFER_SPEC_LENGTH_OFFSET,
  BI_MAX_BLOCK_HEIGHT_OFFSET,
  BI_MAX_FEE_OFFSET,
  BI_TRANSFER_SPEC_OFFSET,
  TS_VALUE_OFFSET,
  encodeBurnIntent,
  encodeBurnIntentSet,
  generateBurnIntent,
  generateTransferSpec,
  BurnIntent,
  calculateTransferSpecHash,
} from "../burn_intent";
import {
  getEvents,
  expectAnchorError,
  findPDA,
  createGatewayBurnRemainingAccounts,
  createSignedBurnIntent,
  signBurnIntent,
  generateSignerKeypair,
  EvmKeypair,
  expectEd25519ProgramError,
} from "../utils";

function expectgatewayBurnedToEqual(
  actual: { name: string; data: Record<string, unknown> },
  expected: BurnIntent,
  expectedTokenMint: PublicKey,
  expectedDepositor: PublicKey
) {
  expect(actual.name).to.equal("gatewayBurned");
  const data = actual.data;
  expect(data.token).to.deep.equal(expectedTokenMint);
  expect(data.depositor).to.deep.equal(expectedDepositor);

  const actualHash = Buffer.from(data.transferSpecHash as number[]);
  const expectedHash = calculateTransferSpecHash(expected.transferSpec);
  expect(actualHash).to.deep.equal(expectedHash);

  expect(data.destinationDomain).to.equal(
    expected.transferSpec.destinationDomain
  );
  expect(Buffer.from(data.destinationRecipient as number[])).to.deep.equal(
    expected.transferSpec.destinationRecipient.toBuffer()
  );
  expect(data.signer).to.deep.equal(expected.transferSpec.sourceSigner);

  expect(data.value.toString()).to.deep.equal(
    expected.transferSpec.value.toString()
  );
}

describe("gatewayBurn", () => {
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

    // Add the token to the gateway minter
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

  // Helper function to execute a burn and return events
  async function executeBurnAndGetEvents(options: {
    burnAmount: bigint;
    fee?: bigint;
    maxFee?: bigint;
    customDepositor?: Keypair;
    customBurnSigner?: EvmKeypair;
    intentOverrides?: Partial<BurnIntent>;
    customFeeRecipientTokenAccount?: PublicKey;
  }) {
    const {
      burnAmount,
      fee = BigInt(0),
      maxFee,
      customDepositor,
      customBurnSigner,
      intentOverrides,
      customFeeRecipientTokenAccount,
    } = options;

    const finalIntentOverrides: Partial<BurnIntent> = {
      ...intentOverrides,
    };

    // Only include maxFee if it's defined
    if (maxFee !== undefined) {
      finalIntentOverrides.maxFee = maxFee;
    }

    // Use depositor as the burn intent signer (for depositor signing their own balance)
    const currentDepositor = customDepositor || depositor;
    const { intent, bytes, signature } = createSignedBurnIntent({
      signer: currentDepositor,
      burnIntentOverrides: finalIntentOverrides,
      transferSpecOverrides: {
        sourceContract: client.gatewayWalletProgram.programId,
        sourceToken: tokenMint,
        sourceDepositor: currentDepositor.publicKey,
        value: burnAmount,
      },
    });

    const depositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        tokenMint.toBuffer(),
        currentDepositor.publicKey.toBuffer(),
      ],
      client.gatewayWalletProgram.programId
    ).publicKey;

    const txSig = await client.gatewayBurn(
      {
        burnIntent: bytes,
        userSignature: signature,
        tokenMint,
        custodyTokenAccount: custodyTokenAccountPDA,
        feeRecipientTokenAccount:
          customFeeRecipientTokenAccount || feeRecipientTokenAccount,
        deposit: depositPDA,
        fee,
        remainingAccounts: createGatewayBurnRemainingAccounts(
          [intent],
          client.gatewayWalletProgram.programId
        ),
      },
      customBurnSigner || defaultBurnSigner
    );

    return {
      events: getEvents(client.svm, txSig, client.gatewayWalletProgram),
      intent,
    };
  }

  // Helper function to expect burn to fail
  async function expectBurnToFail(options: {
    burnAmount: bigint;
    fee?: bigint;
    errorName: string;
    maxFee?: bigint;
    customDepositor?: Keypair;
    customBurnSigner?: EvmKeypair;
    customFeeRecipientTokenAccount?: PublicKey;
  }) {
    const {
      burnAmount,
      fee = BigInt(0),
      errorName,
      maxFee,
      customDepositor,
      customBurnSigner,
      customFeeRecipientTokenAccount,
    } = options;

    const intentOverrides: Partial<BurnIntent> = {};

    // Only include maxFee if it's defined
    if (maxFee !== undefined) {
      intentOverrides.maxFee = maxFee;
    }

    const currentDepositor = customDepositor || depositor;
    const { intent, bytes, signature } = createSignedBurnIntent({
      signer: currentDepositor,
      burnIntentOverrides: intentOverrides,
      transferSpecOverrides: {
        sourceContract: client.gatewayWalletProgram.programId,
        sourceToken: tokenMint,
        sourceDepositor: currentDepositor.publicKey,
        value: burnAmount,
      },
    });

    const depositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        tokenMint.toBuffer(),
        currentDepositor.publicKey.toBuffer(),
      ],
      client.gatewayWalletProgram.programId
    ).publicKey;

    await expectAnchorError(
      client.gatewayBurn(
        {
          burnIntent: bytes,
          userSignature: signature,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount:
            customFeeRecipientTokenAccount || feeRecipientTokenAccount,
          deposit: depositPDA,
          fee,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [intent],
            client.gatewayWalletProgram.programId
          ),
        },
        customBurnSigner || defaultBurnSigner
      ),
      errorName
    );
  }

  describe("should parse burn data", () => {
    it("should successfully process valid burn intents", async () => {
      // Test regular burn intent
      const {
        intent: burnIntent1,
        bytes: burnBytes1,
        signature: signature1,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000), // 1 token with 6 decimals
        },
      });

      const txSig1 = await client.gatewayBurn(
        {
          burnIntent: burnBytes1,
          userSignature: signature1,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent1],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      const events1 = getEvents(
        client.svm,
        txSig1,
        client.gatewayWalletProgram
      );
      expect(events1.length).to.equal(1);
      expectgatewayBurnedToEqual(
        events1[0],
        burnIntent1,
        tokenMint,
        depositor.publicKey
      );
      // Verify from_available and from_withdrawing
      expect(events1[0].data.fromAvailable.toString()).to.equal("1000000");
      expect(events1[0].data.fromWithdrawing.toString()).to.equal("0");

      // Test burn intent with zero-length hook data
      const {
        intent: burnIntent2,
        bytes: burnBytes2,
        signature: signature2,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000), // 1 token with 6 decimals
          hookData: Buffer.alloc(0),
          hookDataLength: 0,
        },
      });

      const txSig2 = await client.gatewayBurn(
        {
          burnIntent: burnBytes2,
          userSignature: signature2,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent2],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      const events2 = getEvents(
        client.svm,
        txSig2,
        client.gatewayWalletProgram
      );
      expect(events2.length).to.equal(1);
      expectgatewayBurnedToEqual(
        events2[0],
        burnIntent2,
        tokenMint,
        depositor.publicKey
      );
    });

    it("should fail when the burn intent length is invalid", async () => {
      const intent = generateBurnIntent();
      const bytes = encodeBurnIntent(intent);
      const tooShort = bytes.subarray(0, 411);
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: tooShort,
            userSignature: signBurnIntent(tooShort, depositor.secretKey),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            excludeEd25519Instruction: true,
          },
          defaultBurnSigner
        ),
        "BurnIntentLengthMismatch"
      );

      const tooLong = Buffer.concat([bytes, Buffer.alloc(1)]);
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: tooLong,
            userSignature: signBurnIntent(tooLong, depositor.secretKey),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            excludeEd25519Instruction: true,
          },
          defaultBurnSigner
        ),
        "BurnIntentLengthMismatch"
      );
    });

    it("should fail when the burn intent magic is invalid", async () => {
      const invalidBurnIntentBytes = Buffer.alloc(500);
      invalidBurnIntentBytes.writeUInt32BE(0x11111111, 0);
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: invalidBurnIntentBytes,
            userSignature: signBurnIntent(
              invalidBurnIntentBytes,
              depositor.secretKey
            ),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            excludeEd25519Instruction: true,
          },
          defaultBurnSigner
        ),
        "BurnIntentMagicMismatch"
      );
    });

    it("should fail when the burn intent message prefix is invalid", async () => {
      const intent = generateBurnIntent();
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: encodeBurnIntent(intent),
            userSignature: Buffer.alloc(64),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            excludeEd25519Instruction: true,
            burnIntentMessagePrefix: Buffer.alloc(16),
          },
          defaultBurnSigner
        ),
        "InvalidBurnIntentMessagePrefix"
      );
    });

    it("should fail when hook_data_length is misstated", async () => {
      // Hook data length overstated (truncated bytes)
      const intent1 = generateBurnIntent({
        transferSpec: generateTransferSpec({
          hookData: Buffer.alloc(10),
          hookDataLength: 10,
        }),
      });
      const valid1 = encodeBurnIntent(intent1);
      const truncated = valid1.subarray(0, valid1.length - 1);
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: truncated,
            userSignature: Buffer.alloc(64),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [intent1],
              client.gatewayWalletProgram.programId
            ),
            excludeEd25519Instruction: true,
          },
          defaultBurnSigner
        ),
        "BurnIntentLengthMismatch"
      );

      // Hook data length understated
      const intent2 = generateBurnIntent({
        transferSpec: generateTransferSpec({
          hookData: Buffer.alloc(10),
          hookDataLength: 0, // Understated length
        }),
      });
      const valid2 = encodeBurnIntent(intent2);
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: valid2,
            userSignature: Buffer.alloc(64),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [intent2],
              client.gatewayWalletProgram.programId
            ),
            excludeEd25519Instruction: true,
          },
          defaultBurnSigner
        ),
        "BurnIntentLengthMismatch"
      );
    });

    it("should fail when the transfer spec magic is invalid", async () => {
      // Invalid transfer spec magic
      const intent1 = generateBurnIntent({
        transferSpec: generateTransferSpec({
          magic: 0x00000000, // Invalid magic
        }),
      });
      const bytes1 = encodeBurnIntent(intent1);
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: bytes1,
            userSignature: Buffer.alloc(64),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [intent1],
              client.gatewayWalletProgram.programId
            ),
            excludeEd25519Instruction: true,
          },
          defaultBurnSigner
        ),
        "TransferSpecMagicMismatch"
      );
    });

    it("should fail when the transfer spec length is invalid", async () => {
      // Transfer spec length overstated
      const intent = generateBurnIntent();
      const bytes = encodeBurnIntent(intent);
      const actualLength = bytes.readUInt32BE(BI_TRANSFER_SPEC_LENGTH_OFFSET);
      const remainingAccounts = createGatewayBurnRemainingAccounts(
        [intent],
        client.gatewayWalletProgram.programId
      );

      const overstated = Buffer.from(bytes);
      overstated.writeUInt32BE(
        actualLength + 1,
        BI_TRANSFER_SPEC_LENGTH_OFFSET
      );
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: overstated,
            userSignature: Buffer.alloc(64),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts,
            excludeEd25519Instruction: true,
          },
          defaultBurnSigner
        ),
        "BurnIntentLengthMismatch"
      );

      // Transfer spec length understated
      const understated = Buffer.from(bytes);
      understated.writeUInt32BE(
        actualLength - 1,
        BI_TRANSFER_SPEC_LENGTH_OFFSET
      );
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: understated,
            userSignature: Buffer.alloc(64),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts,
            excludeEd25519Instruction: true,
          },
          defaultBurnSigner
        ),
        "BurnIntentLengthMismatch"
      );
    });

    it("should fail when value is zero", async () => {
      const intent = generateBurnIntent({
        transferSpec: generateTransferSpec({
          value: BigInt(0), // Zero value
        }),
      });
      const bytes = encodeBurnIntent(intent);
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: bytes,
            userSignature: Buffer.alloc(64),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [intent],
              client.gatewayWalletProgram.programId
            ),
            excludeEd25519Instruction: true,
          },
          defaultBurnSigner
        ),
        "InvalidBurnIntentValue"
      );
    });

    it("should fail when u256 high bytes are non-zero", async () => {
      const { intent, bytes: validBurnIntentBytes } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000), // 1 token with 6 decimals
          hookData: Buffer.alloc(0),
          hookDataLength: 0,
        },
      });
      const remainingAccounts = createGatewayBurnRemainingAccounts(
        [intent],
        client.gatewayWalletProgram.programId
      );

      // Test max_block_height with non-zero high bytes
      const invalid1 = Buffer.from(validBurnIntentBytes);
      // Set a non-zero byte in the high 24 bytes of max_block_height
      // max_block_height is a 32-byte u256, we need to modify bytes 0-23 (high bytes)
      invalid1[BI_MAX_BLOCK_HEIGHT_OFFSET + 20] = 0x01;
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: invalid1,
            userSignature: signBurnIntent(invalid1, depositor.secretKey),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts,
          },
          defaultBurnSigner
        ),
        "InvalidU64HighBytes"
      );

      // Test max_fee with non-zero high bytes
      const invalid2 = Buffer.from(validBurnIntentBytes);
      // Set a non-zero byte in the high 24 bytes of max_fee
      // max_fee is a 32-byte u256, we need to modify bytes 0-23 (high bytes)
      invalid2[BI_MAX_FEE_OFFSET + 6] = 0x01;
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: invalid2,
            userSignature: signBurnIntent(invalid2, depositor.secretKey),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts,
          },
          defaultBurnSigner
        ),
        "InvalidU64HighBytes"
      );

      // Test value with non-zero high bytes
      const invalid3 = Buffer.from(validBurnIntentBytes);
      // Set a non-zero byte in the high 24 bytes of value
      // Value offset in burn intent = BI_TRANSFER_SPEC_OFFSET + TS_VALUE_OFFSET
      // value is a 32-byte u256, we need to modify bytes 0-23 (high bytes)
      invalid3[BI_TRANSFER_SPEC_OFFSET + TS_VALUE_OFFSET + 3] = 0x01;
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: invalid3,
            userSignature: signBurnIntent(invalid3, depositor.secretKey),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts,
          },
          defaultBurnSigner
        ),
        "InvalidU64HighBytes"
      );
    });
  });

  describe("should reject burn intent sets", () => {
    it("should fail with BurnIntentMagicMismatch for any burn intent set", async () => {
      // Single burn intent in a set
      const intent1 = generateBurnIntent({
        transferSpec: generateTransferSpec({
          sourceToken: tokenMint,
          value: BigInt(1000000), // 1 token with 6 decimals
          hookData: Buffer.alloc(0),
          hookDataLength: 0,
        }),
      });
      const singleSetBytes = encodeBurnIntentSet([intent1]);

      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: singleSetBytes,
            userSignature: Buffer.alloc(64),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: [],
            excludeEd25519Instruction: true,
          },
          defaultBurnSigner
        ),
        "BurnIntentMagicMismatch"
      );
    });
  });

  describe("burn signer validation", () => {
    it("should fail when source signer is not a burn signer", async () => {
      // Create a burn intent with a non-burn signer as source signer
      const nonBurnSigner = generateSignerKeypair();

      // Should fail with BurnSignerNotAuthorized error
      await expectBurnToFail({
        burnAmount: BigInt(1000000), // 1 token with 6 decimals
        errorName: "BurnSignerNotAuthorized",
        customBurnSigner: nonBurnSigner,
      });
    });
  });

  describe("remaining accounts validation", () => {
    it("should fail when no remaining accounts are provided", async () => {
      // Use depositor as signer to test the "depositor signing own balance" case
      const { bytes: burnBytes, signature: signature } = createSignedBurnIntent(
        {
          signer: depositor,
          transferSpecOverrides: {
            sourceContract: client.gatewayWalletProgram.programId,
            sourceToken: tokenMint,
            sourceDepositor: depositor.publicKey,
            value: BigInt(1000000), // 1 token with 6 decimals
          },
        }
      );

      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: [], // No remaining accounts
          },
          defaultBurnSigner
        ),
        "RemainingAccountsLengthMismatch"
      );
    });

    it("should fail when more than one remaining account is provided", async () => {
      const {
        intent: burnIntent1,
        bytes: burnBytes1,
        signature: signature1,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000), // 1 token with 6 decimals
        },
      });
      const { intent: burnIntent2 } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(2000000), // 2 tokens with 6 decimals
        },
      });

      // Create remaining accounts for both intents (2 accounts total)
      const remainingAccounts = [
        ...createGatewayBurnRemainingAccounts(
          [burnIntent1],
          client.gatewayWalletProgram.programId
        ),
        ...createGatewayBurnRemainingAccounts(
          [burnIntent2],
          client.gatewayWalletProgram.programId
        ),
      ];

      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes1,
            userSignature: signature1,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts,
          },
          defaultBurnSigner
        ),
        "RemainingAccountsLengthMismatch"
      );
    });

    it("should fail when an invalid PDA is provided for transfer spec hash", async () => {
      const { bytes: burnBytes, signature: signature } = createSignedBurnIntent(
        {
          signer: depositor,
          transferSpecOverrides: {
            sourceContract: client.gatewayWalletProgram.programId,
            sourceToken: tokenMint,
            sourceDepositor: depositor.publicKey,
            value: BigInt(1000000), // 1 token with 6 decimals
          },
        }
      );

      // Create a random invalid PDA instead of the correct one
      const invalidPDA = Keypair.generate().publicKey;

      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: [
              {
                pubkey: invalidPDA,
                isWritable: true,
                isSigner: false,
              },
            ],
          },
          defaultBurnSigner
        ),
        "InvalidTransferSpecHashAccount"
      );
    });
  });

  describe("transfer spec hash replay protection", () => {
    it("should fail when the same transfer spec hash is used twice", async () => {
      // Create a burn intent
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000), // 1 token with 6 decimals
        },
      });

      // First burn should succeed
      const txSig1 = await client.gatewayBurn(
        {
          burnIntent: burnBytes,
          userSignature: signature,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      const events1 = getEvents(
        client.svm,
        txSig1,
        client.gatewayWalletProgram
      );
      expect(events1.length).to.equal(1);

      // Second burn with the same intent should fail
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "TransferSpecHashAlreadyUsed"
      );
    });

    it("should allow different transfer spec hashes", async () => {
      // Create first burn intent
      const {
        intent: burnIntent1,
        bytes: burnBytes1,
        signature: signature1,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000), // 1 token with 6 decimals
        },
      });

      // Create second burn intent with different transfer spec
      const {
        intent: burnIntent2,
        bytes: burnBytes2,
        signature: signature2,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(2000000), // 2 tokens with 6 decimals
        },
      });

      // First burn should succeed
      const txSig1 = await client.gatewayBurn(
        {
          burnIntent: burnBytes1,
          userSignature: signature1,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent1],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      const events1 = getEvents(
        client.svm,
        txSig1,
        client.gatewayWalletProgram
      );
      expect(events1.length).to.equal(1);

      // Second burn with different transfer spec should also succeed
      const txSig2 = await client.gatewayBurn(
        {
          burnIntent: burnBytes2,
          userSignature: signature2,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent2],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      const events2 = getEvents(
        client.svm,
        txSig2,
        client.gatewayWalletProgram
      );
      expect(events2.length).to.equal(1);
    });
  });

  describe("token validation", () => {
    it("should fail when source token in burn intent doesn't match token mint", async () => {
      // Create a second token mint
      const mintAuthority = Keypair.generate();
      const wrongTokenMint = await client.createTokenMint(
        mintAuthority.publicKey,
        6
      );

      // Create a burn intent with the wrong token mint as source token
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: wrongTokenMint, // Wrong token
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000), // 1 token with 6 decimals
        },
      });

      // Should fail because source token doesn't match token mint
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint, // Correct token mint
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "SourceTokenMismatch"
      );
    });

    it("should fail with AccountNotInitialized when token is not supported", async () => {
      // Create an unsupported token (we won't call addToken for it)
      const mintAuthority2 = Keypair.generate();
      const unsupportedTokenMint = await client.createTokenMint(
        mintAuthority2.publicKey,
        6
      );

      // The custody account PDA for this token won't exist since we never called addToken
      const unsupportedCustodyPDA = findPDA(
        [
          Buffer.from("gateway_wallet_custody"),
          unsupportedTokenMint.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      ).publicKey;

      const unsupportedDeposit = findPDA(
        [
          Buffer.from("gateway_deposit"),
          unsupportedTokenMint.toBuffer(),
          depositor.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      ).publicKey;

      // Create burn intent with unsupported token
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: unsupportedTokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000),
        },
      });

      // Should fail with AccountNotInitialized because custody account doesn't exist
      // Anchor's account validation happens before is_token_supported check
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint: unsupportedTokenMint,
            custodyTokenAccount: unsupportedCustodyPDA,
            feeRecipientTokenAccount,
            deposit: unsupportedDeposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "AccountNotInitialized"
      );
    });
  });

  describe("token burning", () => {
    it("should fail when attempting to burn with insufficient custody balance", async () => {
      const initialBalance = 1000000000; // 1000 tokens with 6 decimals
      const burnAmount = BigInt(2000000000); // 2000 tokens - more than available

      // Verify initial balance
      const custodyAccountBefore = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      expect(custodyAccountBefore.amount).to.equal(BigInt(initialBalance));

      // Create burn intent with amount exceeding balance
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: burnAmount,
        },
      });

      // Should fail due to insufficient balance
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "InsufficientCustodyBalance"
      );
    });

    it("should fail when attempting to burn with zero value", async () => {
      // Create burn intent with zero value
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(0), // Zero value
        },
      });

      // Should fail due to zero value
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "InvalidBurnIntentValue"
      );
    });

    it("should burn tokens from the custody account", async () => {
      const initialBalance = 1000000000; // 1000 tokens with 6 decimals
      const burnAmount = BigInt(100000000); // 100 tokens with 6 decimals

      // Check initial balance
      const custodyAccountBefore = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      expect(custodyAccountBefore.amount).to.equal(BigInt(initialBalance));

      // Create and execute burn
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: burnAmount,
        },
      });

      await client.gatewayBurn(
        {
          burnIntent: burnBytes,
          userSignature: signature,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      // Check balance after burn
      const custodyAccountAfter = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      expect(custodyAccountAfter.amount).to.equal(
        BigInt(initialBalance) - burnAmount
      );
    });

    it("should handle multiple burns correctly", async () => {
      const initialBalance = 1000000000; // 1000 tokens with 6 decimals
      const burnAmount1 = BigInt(50000000); // 50 tokens with 6 decimals
      const burnAmount2 = BigInt(75000000); // 75 tokens with 6 decimals

      // Check initial balance
      const custodyAccountBefore = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      expect(custodyAccountBefore.amount).to.equal(BigInt(initialBalance));

      // First burn
      const {
        intent: burnIntent1,
        bytes: burnBytes1,
        signature: signature1,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: burnAmount1,
        },
      });

      await client.gatewayBurn(
        {
          burnIntent: burnBytes1,
          userSignature: signature1,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent1],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      // Check balance after first burn
      const custodyAccountAfterFirst = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      expect(custodyAccountAfterFirst.amount).to.equal(
        BigInt(initialBalance) - burnAmount1
      );

      // Second burn
      const {
        intent: burnIntent2,
        bytes: burnBytes2,
        signature: signature2,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: burnAmount2,
        },
      });

      await client.gatewayBurn(
        {
          burnIntent: burnBytes2,
          userSignature: signature2,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent2],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      // Check balance after second burn
      const custodyAccountAfterSecond = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      expect(custodyAccountAfterSecond.amount).to.equal(
        BigInt(initialBalance) - burnAmount1 - burnAmount2
      );
    });

    it("should emit correct event with burn amount", async () => {
      const burnAmount = BigInt(123456789); // 123.456789 tokens with 6 decimals

      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: burnAmount,
        },
      });

      const txSig = await client.gatewayBurn(
        {
          burnIntent: burnBytes,
          userSignature: signature,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      const events = getEvents(client.svm, txSig, client.gatewayWalletProgram);
      expect(events.length).to.equal(1);
      expect(events[0].name).to.equal("gatewayBurned");
      expect(events[0].data.value.toString()).to.equal(burnAmount.toString());
    });
  });

  describe("user signature verification", () => {
    it("should succeed with valid user signature", async () => {
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000),
        },
      });

      expect(burnIntent.transferSpec.sourceSigner).to.deep.equal(
        depositor.publicKey
      );

      const txSig = await client.gatewayBurn(
        {
          burnIntent: burnBytes,
          userSignature: signature,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      const events = getEvents(client.svm, txSig, client.gatewayWalletProgram);
      expect(events.length).to.equal(1);
      expect(events[0].name).to.equal("gatewayBurned");
    });

    it("should fail with signature from wrong signer", async () => {
      const wrongDepositor = Keypair.generate();
      // Create intent signed by correct signer
      const { bytes: burnBytes, intent } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000),
        },
      });

      // Sign with wrong signer's key
      const wrongSignature = signBurnIntent(
        burnBytes,
        wrongDepositor.secretKey
      );

      await expectEd25519ProgramError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: wrongSignature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [intent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "InvalidSignature"
      );
    });

    it("should fail with signature over wrong message", async () => {
      const userSigner = Keypair.generate();

      const { bytes: burnBytes1 } = createSignedBurnIntent({
        signer: userSigner,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000),
        },
      });

      // Create second intent with different data
      const { bytes: burnBytes2, intent: intent2 } = createSignedBurnIntent({
        signer: userSigner,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(2000000),
        },
      });

      // Sign first intent but try to use with second intent's bytes
      const signature1 = signBurnIntent(burnBytes1, userSigner.secretKey);

      await expectEd25519ProgramError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes2, // Different burn intent
            userSignature: signature1, // Signature for burnBytes1
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [intent2],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "InvalidSignature"
      );
    });

    it("should fail with malformed signature bytes", async () => {
      const { bytes: burnBytes, intent } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000),
        },
      });

      // Create completely random/invalid signature bytes
      const malformedSignature = Buffer.from(
        Array.from({ length: 64 }, () => Math.floor(Math.random() * 256))
      );

      await expectEd25519ProgramError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: malformedSignature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [intent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "InvalidSignature"
      );
    });

    it("should fail when signature is created without 0xff000000000000000000000000000000 prefix", async () => {
      const { bytes: burnBytes, intent } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000),
        },
      });

      // Signs the burn intent WITHOUT the 0xff000000000000000000000000000000 prefix
      // The contract expects signatures to be over 0xff000000000000000000000000000000 || burnIntent
      const signatureWithoutPrefix = signBurnIntent(
        burnBytes,
        depositor.secretKey,
        false
      );

      await expectEd25519ProgramError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: Buffer.from(signatureWithoutPrefix),
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [intent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "InvalidSignature"
      );
    });
  });

  describe("balance reduction (from_available and from_withdrawing)", () => {
    it("should deduct from available balance when sufficient", async () => {
      // Depositor has 1000 tokens in available, 0 in withdrawing
      const { events } = await executeBurnAndGetEvents({
        burnAmount: BigInt(100000000), // 100 tokens
      });
      expect(events.length).to.equal(1);
      expect(events[0].data.fromAvailable.toString()).to.equal("100000000");
      expect(events[0].data.fromWithdrawing.toString()).to.equal("0");

      // Verify on-chain balance
      const depositAccount = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      expect(depositAccount.amount).to.equal(BigInt(900000000)); // 1000 - 100
    });

    it("should deduct from both available and withdrawing when needed", async () => {
      // First, initiate a withdrawal to move some to withdrawing
      await client.initiateWithdrawal(
        {
          tokenMint,
          amount: 600000000, // Move 600 tokens to withdrawing
        },
        depositor
      );

      // Now depositor has: 400 available, 600 withdrawing
      const { events } = await executeBurnAndGetEvents({
        burnAmount: BigInt(700000000), // 700 tokens
      });
      expect(events.length).to.equal(1);
      // Should take all 400 from available, and 300 from withdrawing
      expect(events[0].data.fromAvailable.toString()).to.equal("400000000");
      expect(events[0].data.fromWithdrawing.toString()).to.equal("300000000");

      // Verify on-chain balance
      const depositAccount = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      expect(depositAccount.amount).to.equal(BigInt(300000000)); // 600 - 300
    });

    it("should deduct entirely from withdrawing when available is empty", async () => {
      // Move all to withdrawing
      await client.initiateWithdrawal(
        {
          tokenMint,
          amount: 1000000000, // Move all 1000 tokens to withdrawing
        },
        depositor
      );

      // Now depositor has: 0 available, 1000 withdrawing
      const { events } = await executeBurnAndGetEvents({
        burnAmount: BigInt(500000000), // 500 tokens
      });
      expect(events.length).to.equal(1);
      expect(events[0].data.fromAvailable.toString()).to.equal("0");
      expect(events[0].data.fromWithdrawing.toString()).to.equal("500000000");

      // Verify on-chain balance
      const depositAccount = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      expect(depositAccount.amount).to.equal(BigInt(500000000)); // 1000 - 500
    });

    it("should deduct all from both balances when burning total", async () => {
      // Move some to withdrawing
      await client.initiateWithdrawal(
        {
          tokenMint,
          amount: 400000000, // Move 400 tokens to withdrawing
        },
        depositor
      );

      // Now depositor has: 600 available, 400 withdrawing = 1000 total
      const { events } = await executeBurnAndGetEvents({
        burnAmount: BigInt(1000000000), // Burn all 1000 tokens
      });
      expect(events.length).to.equal(1);
      expect(events[0].data.fromAvailable.toString()).to.equal("600000000");
      expect(events[0].data.fromWithdrawing.toString()).to.equal("400000000");

      // Verify on-chain balance - both should be 0
      const depositAccount = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      expect(depositAccount.amount).to.equal(BigInt(0));
    });

    it("should fail when trying to burn more than total balance", async () => {
      // Depositor has 1000 total, try to burn 1001
      await expectBurnToFail({
        burnAmount: BigInt(1000000001),
        errorName: "InsufficientCustodyBalance",
      });
    });

    it("should handle multiple burns reducing balance progressively", async () => {
      // First burn: 200 tokens (from available)
      const { events: events1 } = await executeBurnAndGetEvents({
        burnAmount: BigInt(200000000),
      });
      expect(events1[0].data.fromAvailable.toString()).to.equal("200000000");
      expect(events1[0].data.fromWithdrawing.toString()).to.equal("0");

      // Initiate withdrawal of 500 tokens
      await client.initiateWithdrawal(
        {
          tokenMint,
          amount: 500000000,
        },
        depositor
      );
      // Now: 300 available, 500 withdrawing

      // Second burn: 600 tokens (300 from available, 300 from withdrawing)
      const { events: events2 } = await executeBurnAndGetEvents({
        burnAmount: BigInt(600000000),
      });
      expect(events2[0].data.fromAvailable.toString()).to.equal("300000000");
      expect(events2[0].data.fromWithdrawing.toString()).to.equal("300000000");

      // Final balance: 0 available, 200 withdrawing
      const finalDeposit = await client.getTokenAccount(custodyTokenAccountPDA);
      expect(finalDeposit.amount).to.equal(BigInt(200000000));
    });
  });

  describe("depositor verification", () => {
    it("should succeed when depositor matches burn intent", async () => {
      const { intent, bytes, signature } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000),
        },
      });

      const txSig = await client.gatewayBurn(
        {
          burnIntent: bytes,
          userSignature: signature,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [intent],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      const events = getEvents(client.svm, txSig, client.gatewayWalletProgram);
      expect(events.length).to.equal(1);
      expect(events[0].name).to.equal("gatewayBurned");
    });

    it("should fail when deposit PDA doesn't match the burn intent source depositor", async () => {
      // Create a second depositor's deposit PDA
      const depositor2 = Keypair.generate();
      svm.airdrop(depositor2.publicKey, BigInt(LAMPORTS_PER_SOL));
      const depositor2TokenAccount = await client.createTokenAccount(
        tokenMint,
        depositor2.publicKey
      );

      await client.mintToken(
        tokenMint,
        depositor2TokenAccount,
        500000000,
        mintAuthority
      );

      await client.deposit(
        {
          tokenMint,
          amount: 500000000,
          fromTokenAccount: depositor2TokenAccount,
          forDepositor: depositor2.publicKey,
        },
        { owner: depositor2 }
      );

      const deposit2 = findPDA(
        [
          Buffer.from("gateway_deposit"),
          tokenMint.toBuffer(),
          depositor2.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      ).publicKey;

      // Create burn intent for depositor1
      const { intent, bytes, signature } = createSignedBurnIntent({
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000),
        },
      });

      // Try to use depositor1 but with depositor2's deposit PDA - should fail
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: bytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit: deposit2, // Wrong deposit PDA (belongs to depositor2)
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [intent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "SourceDepositorMismatch"
      );
    });
  });

  describe("Fee Handling", () => {
    describe("Fee Calculation", () => {
      it("charges full fee when balance is sufficient for value + fee", async () => {
        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(100000000), // 100 tokens
          fee: BigInt(10000000), // 10 tokens
        });

        expect(events.length).to.equal(1);
        expect(events[0].name).to.equal("gatewayBurned");
        expect(events[0].data.fee.toString()).to.equal("10000000");
        expect(events[0].data.value.toString()).to.equal("100000000");
        expect(events[0].data.fromAvailable.toString()).to.equal("110000000");
        expect(events[0].data.fromWithdrawing.toString()).to.equal("0");

        // Verify custody balance reduced by both burn amount AND fee
        const custodyAccount = await client.getTokenAccount(
          custodyTokenAccountPDA
        );
        expect(custodyAccount.amount).to.equal(BigInt(890000000));

        // Verify fee recipient received the fee
        const feeRecipientBalance = await client.getTokenAccountBalance(
          feeRecipientTokenAccount
        );
        expect(feeRecipientBalance).to.equal(BigInt(10000000));
      });

      it("charges zero fee when requested fee is zero", async () => {
        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(100000000),
          fee: BigInt(0),
        });

        expect(events.length).to.equal(1);
        expect(events[0].data.fee.toString()).to.equal("0");
        expect(events[0].data.fromAvailable.toString()).to.equal("100000000");
      });

      it("handles large fee values correctly", async () => {
        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(100000000),
          fee: BigInt(900000000),
        });

        expect(events.length).to.equal(1);
        expect(events[0].data.fee.toString()).to.equal("900000000");
        expect(events[0].data.fromAvailable.toString()).to.equal("1000000000");

        const custodyAccount = await client.getTokenAccount(
          custodyTokenAccountPDA
        );
        expect(custodyAccount.amount).to.equal(BigInt(0));

        const feeRecipientBalance = await client.getTokenAccountBalance(
          feeRecipientTokenAccount
        );
        expect(feeRecipientBalance).to.equal(BigInt(900000000));
      });

      it("deducts fees from both available and withdrawing when needed", async () => {
        await client.initiateWithdrawal(
          { tokenMint, amount: 600000000 },
          depositor
        );

        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(500000000),
          fee: BigInt(50000000),
        });

        expect(events[0].data.fromAvailable.toString()).to.equal("400000000");
        expect(events[0].data.fromWithdrawing.toString()).to.equal("150000000");
        expect(events[0].data.fee.toString()).to.equal("50000000");
      });
    });

    describe("Partial Fee Scenarios", () => {
      beforeEach(async () => {
        // Mint extra tokens into the custody account to avoid test the partial fee scenarios without
        // triggering the InsufficientCustodyBalance error
        await client.mintToken(
          tokenMint,
          custodyTokenAccountPDA,
          100_000_000_000000,
          mintAuthority
        );
      });

      it("charges partial fee when balance insufficient - available only", async () => {
        await executeBurnAndGetEvents({ burnAmount: BigInt(895000000) });

        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(100000000),
          fee: BigInt(10000000),
        });

        expect(events.length).to.equal(2);
        expect(events[0].name).to.equal("insufficientBalance");
        expect(events[0].data.value.toString()).to.equal("110000000");
        expect(events[0].data.availableBalance.toString()).to.equal(
          "105000000"
        );

        expect(events[1].name).to.equal("gatewayBurned");
        expect(events[1].data.fee.toString()).to.equal("5000000");
      });

      it("charges zero fee when only enough for exact burn amount", async () => {
        await executeBurnAndGetEvents({ burnAmount: BigInt(900000000) });

        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(100000000),
          fee: BigInt(10000000),
        });

        expect(events.length).to.equal(2);
        expect(events[0].name).to.equal("insufficientBalance");
        expect(events[1].data.fee.toString()).to.equal("0");
      });

      it("charges partial fee from available and withdrawing balances", async () => {
        await client.initiateWithdrawal(
          { tokenMint, amount: 300000000 },
          depositor
        );

        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(980000000),
          fee: BigInt(50000000),
        });

        expect(events.length).to.equal(2);
        expect(events[1].data.fee.toString()).to.equal("20000000");
        expect(events[1].data.fromAvailable.toString()).to.equal("700000000");
        expect(events[1].data.fromWithdrawing.toString()).to.equal("300000000");

        const feeRecipientBalance = await client.getTokenAccountBalance(
          feeRecipientTokenAccount
        );
        expect(feeRecipientBalance).to.equal(BigInt(20000000));
      });

      it("charges partial fee from withdrawing only", async () => {
        await client.initiateWithdrawal(
          { tokenMint, amount: 1000000000 },
          depositor
        );

        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(995000000),
          fee: BigInt(10000000),
        });

        expect(events.length).to.equal(2);
        expect(events[1].data.fee.toString()).to.equal("5000000");
        expect(events[1].data.fromWithdrawing.toString()).to.equal(
          "1000000000"
        );
      });

      it("does not emit InsufficientBalance when balance exactly sufficient", async () => {
        await client.initiateWithdrawal(
          { tokenMint, amount: 400000000 },
          depositor
        );

        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(900000000),
          fee: BigInt(100000000),
        });

        expect(events.length).to.equal(1);
        expect(events[0].name).to.equal("gatewayBurned");
        expect(events[0].data.fee.toString()).to.equal("100000000");
      });
    });

    describe("MaxFee Enforcement", () => {
      it("succeeds when fee <= maxFee", async () => {
        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(100000000),
          fee: BigInt(10000000),
          maxFee: BigInt(10000000),
        });

        expect(events[0].data.fee.toString()).to.equal("10000000");
      });

      it("rejects when fee > maxFee", async () => {
        await expectBurnToFail({
          burnAmount: BigInt(100000000),
          fee: BigInt(20000000),
          maxFee: BigInt(10000000),
          errorName: "BurnFeeExceedsMaxFee",
        });
      });

      it("rejects non-zero fee when maxFee is zero", async () => {
        await expectBurnToFail({
          burnAmount: BigInt(100000000),
          fee: BigInt(10000000),
          maxFee: BigInt(0),
          errorName: "BurnFeeExceedsMaxFee",
        });
      });
    });

    describe("Fee Recipient", () => {
      it("transfers fees to fee recipient ATA", async () => {
        const initialBalance = await client.getTokenAccountBalance(
          feeRecipientTokenAccount
        );
        expect(initialBalance.toString()).to.equal("0");

        await executeBurnAndGetEvents({
          burnAmount: BigInt(100000000),
          fee: BigInt(10000000),
        });

        const finalBalance = await client.getTokenAccountBalance(
          feeRecipientTokenAccount
        );
        expect(finalBalance.toString()).to.equal("10000000");
      });

      it("accumulates fees from multiple burns", async () => {
        await executeBurnAndGetEvents({
          burnAmount: BigInt(100000000),
          fee: BigInt(10000000),
        });

        let balance = await client.getTokenAccountBalance(
          feeRecipientTokenAccount
        );
        expect(balance.toString()).to.equal("10000000");

        await executeBurnAndGetEvents({
          burnAmount: BigInt(100000000),
          fee: BigInt(5000000),
        });

        balance = await client.getTokenAccountBalance(feeRecipientTokenAccount);
        expect(balance.toString()).to.equal("15000000");
      });

      it("rejects non-ATA fee recipient account", async () => {
        const invalidAccount = await client.createTokenAccount(
          tokenMint,
          feeRecipient.publicKey
        );

        await expectBurnToFail({
          burnAmount: BigInt(1000000),
          fee: BigInt(10000),
          errorName: "ConstraintAssociated",
          customFeeRecipientTokenAccount: invalidAccount,
        });
      });
    });

    describe("Insufficient Balance Behavior", () => {
      it("emits InsufficientBalance event when depositor balance is insufficient", async () => {
        // Mint extra tokens into the custody account to avoid triggering the InsufficientCustodyBalance error
        await client.mintToken(
          tokenMint,
          custodyTokenAccountPDA,
          100_000_000_000000,
          mintAuthority
        );

        // Initiate a withdrawal to simulate a double spend
        await client.initiateWithdrawal({ tokenMint, amount: 100 }, depositor);
        const { availableAmount, withdrawingAmount } =
          await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
            deposit
          );

        // Try to burn more than is available
        const totalDepositAmount =
          availableAmount.toNumber() + withdrawingAmount.toNumber();
        const burnAmount = totalDepositAmount - 50;
        const fee = 100;
        const { events } = await executeBurnAndGetEvents({
          burnAmount: BigInt(burnAmount),
          fee: BigInt(fee),
        });

        // Verify the InsufficientBalance event is emitted
        expect(events.length).to.equal(2);
        expect(events[0].name).to.equal("insufficientBalance");
        expect(events[0].data.value.toString()).to.equal(
          (burnAmount + fee).toString()
        );
        expect(events[0].data.availableBalance.toString()).to.equal(
          availableAmount.toString()
        );
        expect(events[0].data.withdrawingBalance.toString()).to.equal(
          withdrawingAmount.toString()
        );

        // Verify that the full value was burned and a partial fee was charged (whatever was left)
        expect(events[1].name).to.equal("gatewayBurned");
        expect(events[1].data.value.toString()).to.equal(burnAmount.toString());
        expect(events[1].data.fee.toString()).to.equal(
          (totalDepositAmount - burnAmount).toString()
        );
      });

      it("rejects when burn amount alone exceeds the entire custody account balance", async () => {
        await executeBurnAndGetEvents({ burnAmount: BigInt(950000000) });

        await expectBurnToFail({
          burnAmount: BigInt(100000000),
          fee: BigInt(10000000),
          errorName: "InsufficientCustodyBalance",
        });
      });

      it("rejects when burn amount and fee exceeds the entire custody account balance", async () => {
        const custodyAccount = await client.getTokenAccount(
          custodyTokenAccountPDA
        );

        // Value alone can be covered by the balance
        const value = custodyAccount.amount - BigInt(1);

        // Value + fee cannot be covered by the balance
        const fee = BigInt(2);

        await expectBurnToFail({
          burnAmount: value,
          fee: fee,
          errorName: "InsufficientCustodyBalance",
        });
      });
    });
  });

  describe("version check", () => {
    it("should reject burn intetns that don't match the gateway wallet version", async () => {
      const invalidVersion = 2;
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: burnSignature,
      } = createSignedBurnIntent({
        signer: depositor,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          sourceSigner: depositor.publicKey,
          value: BigInt(100000000),
          version: invalidVersion,
        },
      });
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: burnSignature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "VersionMismatch"
      );
    });
  });

  describe("burn intent expiration validation", () => {
    it("should fail when burn intent has expired", async () => {
      // Warp forward to ensure we're not at slot 0
      svm.warpToSlot(BigInt(100));

      const expiredSlot = BigInt(1);

      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: depositor,
        burnIntentOverrides: {
          maxBlockHeight: expiredSlot,
        },
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          value: BigInt(1000000),
        },
      });

      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "BurnIntentExpired"
      );
    });

    it("should succeed when burn intent has not expired", async () => {
      const futureSlot = BigInt("18446744073709551615");

      // Create burn intent with future expiration
      const { events } = await executeBurnAndGetEvents({
        burnAmount: BigInt(1000000),
        intentOverrides: {
          maxBlockHeight: futureSlot,
        },
      });

      expect(events.length).to.equal(1);
      expect(events[0].name).to.equal("gatewayBurned");
    });
  });

  describe("With Delegates", () => {
    it("fails when delegate is not initialized", async () => {
      const delegate = Keypair.generate();

      const delegateAccountPDA = findPDA(
        [
          Buffer.from("gateway_delegate"),
          tokenMint.toBuffer(),
          depositor.publicKey.toBuffer(),
          delegate.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: delegate,
        transferSpecOverrides: {
          sourceContract: client.pdas.gatewayWallet.publicKey,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          sourceSigner: delegate.publicKey,
          value: BigInt(100000000),
        },
      });

      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            delegateAccount: delegateAccountPDA.publicKey,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "AccountNotInitialized"
      );
    });

    it("succeeds when delegate is authorized", async () => {
      const delegate = Keypair.generate();
      await client.addDelegate(
        { tokenMint, delegate: delegate.publicKey },
        { depositor }
      );

      const delegateAccountPDA = findPDA(
        [
          Buffer.from("gateway_delegate"),
          tokenMint.toBuffer(),
          depositor.publicKey.toBuffer(),
          delegate.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      // Create burn intent with delegate as signer
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: delegate,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          sourceSigner: delegate.publicKey,
          value: BigInt(100000000),
        },
      });

      const txSignature = await client.gatewayBurn(
        {
          burnIntent: burnBytes,
          userSignature: signature,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          feeRecipientTokenAccount,
          deposit,
          delegateAccount: delegateAccountPDA.publicKey,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent],
            client.gatewayWalletProgram.programId
          ),
        },
        defaultBurnSigner
      );

      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.lengthOf(1);
      expect(events[0].name).to.equal("gatewayBurned");
    });

    it("fails when intent source_signer does not match delegate account delegate", async () => {
      // Add a delegate
      const delegate = Keypair.generate();
      await client.addDelegate(
        { tokenMint, delegate: delegate.publicKey },
        { depositor }
      );

      // Create a different signer (not the delegate)
      const wrongSigner = Keypair.generate();

      const delegateAccountPDA = findPDA(
        [
          Buffer.from("gateway_delegate"),
          tokenMint.toBuffer(),
          depositor.publicKey.toBuffer(),
          delegate.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      // Create burn intent with wrongSigner as source_signer but using delegate's account
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: wrongSigner,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          sourceSigner: wrongSigner.publicKey, // Different from delegate
          value: BigInt(100000000),
        },
      });

      // Should fail because intent.source_signer != delegate_account.delegate
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            delegateAccount: delegateAccountPDA.publicKey,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "DelegateSignerMismatch"
      );
    });

    it("fails when delegate account depositor does not match intent source_depositor", async () => {
      // Create a second depositor, funded by the first depositor
      const depositor2 = Keypair.generate();
      await client.deposit(
        {
          tokenMint,
          amount: 10,
          fromTokenAccount: depositorTokenAccount,
          forDepositor: depositor2.publicKey,
        },
        { owner: depositor }
      );

      // Add a delegate for depositor2
      const delegate = Keypair.generate();
      await client.addDelegate(
        { tokenMint, delegate: delegate.publicKey },
        { depositor: depositor2 }
      );

      const delegateForDepositor2AccountPDA = findPDA(
        [
          Buffer.from("gateway_delegate"),
          tokenMint.toBuffer(),
          depositor2.publicKey.toBuffer(),
          delegate.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      // Create burn intent with that spends from depositor's deposit
      // but try to use depositor2's delegate account to sign it
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: delegate,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          sourceSigner: delegate.publicKey,
          value: BigInt(100000000),
        },
      });

      // Should fail because delegate_account.depositor != intent.source_depositor
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            delegateAccount: delegateForDepositor2AccountPDA.publicKey,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "DelegateDepositorMismatch"
      );
    });

    it("fails when the intent signer does not match the intended delegate", async () => {
      // Add a delegate
      const delegate = Keypair.generate();
      await client.addDelegate(
        { tokenMint, delegate: delegate.publicKey },
        { depositor }
      );

      const delegateAccountPDA = findPDA(
        [
          Buffer.from("gateway_delegate"),
          tokenMint.toBuffer(),
          depositor.publicKey.toBuffer(),
          delegate.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      // Create a different signer (not the delegate)
      const wrongSigner = Keypair.generate();

      // Create burn intent using the delegate account, but signed by a different signer
      const {
        intent: burnIntent,
        bytes: burnBytes,
        signature: signature,
      } = createSignedBurnIntent({
        signer: wrongSigner,
        transferSpecOverrides: {
          sourceContract: client.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositor.publicKey,
          sourceSigner: delegate.publicKey,
          value: BigInt(100000000),
        },
      });

      // Should fail because the signer is neither the depositor nor the delegate
      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: burnBytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount: custodyTokenAccountPDA,
            feeRecipientTokenAccount,
            deposit,
            delegateAccount: delegateAccountPDA.publicKey,
            remainingAccounts: createGatewayBurnRemainingAccounts(
              [burnIntent],
              client.gatewayWalletProgram.programId
            ),
          },
          defaultBurnSigner
        ),
        "DelegateSignerMismatch"
      );
    });
  });
});
