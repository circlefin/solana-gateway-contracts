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

import { AnchorError, Idl, Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  PublicKey,
  SendTransactionError,
  LAMPORTS_PER_SOL,
  Keypair,
  AddressLookupTableProgram,
  VersionedTransaction,
  AddressLookupTableAccount,
  TransactionMessage,
} from "@solana/web3.js";
import {
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";
import bs58 from "bs58";
import { ethers } from "ethers";
import {
  BurnIntent,
  TransferSpec,
  calculateTransferSpecHash,
  encodeBurnIntent,
  generateBurnIntent,
  generateTransferSpec,
} from "./burn_intent";
import crypto from "crypto";
import { MintAttestationElement, MintAttestationSet } from "./attestation";

export type PDA = {
  publicKey: PublicKey;
  bump: number;
};

export type EvmKeypair = {
  privateKey: Buffer;
  publicKey: PublicKey;
  ethereumAddress: Buffer;
};

export const expectAnchorError = async (
  promise: Promise<unknown>,
  errorCode: string
) => {
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(AnchorError, `Not an Anchor error: ${err}`);
    expect(err.error.errorCode.code).to.equal(errorCode);
    return;
  }
  throw new Error("Call should've failed");
};

export const expectEd25519ProgramError = async (
  promise: Promise<unknown>,
  expectedErrorCode: string,
  instrucionIndex: number = 0
) => {
  // Based on https://docs.rs/solana-precompile-error/3.0.0/solana_precompile_error/enum.PrecompileError.html
  const errorCodes = [
    "InvalidPublicKey",
    "InvalidRecoveryId",
    "InvalidSignature",
    "InvalidDataOffsets",
    "InvalidInstructionDataSize",
  ];
  const errorCodeIndex = errorCodes.indexOf(expectedErrorCode);
  if (errorCodeIndex === -1) {
    throw new Error(`Unknown error code: ${expectedErrorCode}`);
  }
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(SendTransactionError);
    expect(err.transactionMessage).equals(
      `TransactionErrorInstructionError { index: ${instrucionIndex}, error: InstructionErrorCustom { code: ${errorCodeIndex} } }`
    );
    return;
  }
  throw new Error("Call should've failed");
};

export const expectAccountExistsError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(SendTransactionError);
    expect(err.transactionError.logs).has.match(
      /Allocate: account .* already in use/
    );
    expect(err.transactionError.logs).to.contain(
      "Program 11111111111111111111111111111111 failed: custom program error: 0x0"
    );
    return;
  }
  throw new Error("Call should've failed");
};

export function expectAttestationUsedToEqual(
  actual: { name: string; data: Record<string, unknown> }[],
  expected: MintAttestationElement[]
) {
  expect(actual.length).to.equal(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i].name).to.equal("attestationUsed");

    const data = actual[i].data;
    expect(data.token).to.deep.equal(expected[i].destinationToken);
    expect(data.recipient).to.deep.equal(expected[i].destinationRecipient);
    expect(Buffer.from(data.transferSpecHash as Uint8Array)).to.deep.equal(
      Buffer.from(expected[i].transferSpecHash as Uint8Array)
    );
    expect(data.value.toString()).to.equal(expected[i].value.toString());
  }
}

export const expectSPLTokenInsufficientFundsError = async (
  promise: Promise<unknown>
) => {
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(SendTransactionError);
    expect(err.transactionError.logs).has.match(/insufficient funds/);
    expect(err.transactionError.logs).to.contain(
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x1"
    );
    return;
  }
  throw new Error("Call should've failed");
};

export function findPDA(seeds: Buffer[], programId: PublicKey): PDA {
  const [publicKey, bump] = PublicKey.findProgramAddressSync(seeds, programId);
  return { publicKey, bump };
}

export function getEvents<IDL extends Idl>(
  svm: LiteSVM,
  txSignature: string,
  program: Program<IDL>
) {
  const txSignatureBuffer = bs58.decode(txSignature);
  const txResult = svm.getTransaction(txSignatureBuffer) as TransactionMetadata;
  const returnData: { name: string; data: Record<string, unknown> }[] = [];

  for (const ixBlock of txResult.innerInstructions()) {
    for (const ix of ixBlock) {
      const ixInstruction = ix.instruction();
      const ixData = Buffer.from(ixInstruction.data());
      const eventData = Buffer.from(ixData.slice(8)).toString("base64");
      const event = program.coder.events.decode(eventData);
      if (event) {
        returnData.push({ name: event.name, data: event.data });
      }
    }
  }

  return returnData;
}

/**
 * Simulates the deployment of a program to LiteSVM by manually constructing the necessary accounts.
 *
 * Alternative to LiteSVM.addProgram(), which currently does not support setting the upgrade authority.
 *
 * @param svm - The LiteSVM instance to use
 * @param programId - The ID of the program to deploy
 * @param programBytes - The bytes of the program to deploy
 * @param upgradeAuthority - The upgrade authority to set for the program
 */
export function deployProgram(
  svm: LiteSVM,
  programId: PublicKey,
  programBytes: Buffer,
  upgradeAuthority: PublicKey
) {
  const loaderV3ProgramId = new PublicKey(
    "BPFLoaderUpgradeab1e11111111111111111111111"
  );
  const programDataAddress = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    loaderV3ProgramId
  )[0];

  // The program account contains a pointer to the program data account
  const encodeProgramAccount = (programDataPk: PublicKey): Buffer => {
    const out = Buffer.alloc(4 + 32);
    // UpgradeableLoaderState::Program variant index = 2
    out.writeUInt32LE(2, 0);
    // Pointer to the program data account
    programDataPk.toBuffer().copy(out, 4);
    return out;
  };

  // The program data account contains the program code and the upgrade authority
  const encodeProgramDataAccount = (
    slot: bigint,
    authority: PublicKey,
    programBytes: Buffer
  ): Buffer => {
    const out = Buffer.alloc(4 + 8 + 1 + 32 + programBytes.length);
    // UpgradeableLoaderState::ProgramData variant = 3
    out.writeUInt32LE(3, 0);
    // Slot indicating when the program was deployed
    out.writeBigUInt64LE(slot, 4);
    // Flag indicating that the upgrade authority is present
    out.writeUInt8(1, 12);
    // Upgrade authority
    authority.toBuffer().copy(out, 13);
    // Program bytes
    programBytes.copy(out, 45);
    return out;
  };

  svm.setAccount(programDataAddress, {
    executable: false,
    owner: loaderV3ProgramId,
    lamports: LAMPORTS_PER_SOL,
    data: encodeProgramDataAccount(BigInt(0), upgradeAuthority, programBytes),
    rentEpoch: 0,
  });

  svm.setAccount(programId, {
    executable: true,
    owner: loaderV3ProgramId,
    lamports: LAMPORTS_PER_SOL,
    data: encodeProgramAccount(programDataAddress),
    rentEpoch: 0,
  });
}

/**
 * Generates a keypair with both Solana PublicKey and private key for signing
 */
export function generateSignerKeypair(
  walletOverride?: ethers.Wallet
): EvmKeypair {
  const wallet = walletOverride ?? ethers.Wallet.createRandom();
  const privateKey = Buffer.from(wallet.privateKey.slice(2), "hex");
  const ethereumAddress = Buffer.from(wallet.address.slice(2), "hex");
  const publicKey = new PublicKey(ethereumAddress);

  return { privateKey, publicKey, ethereumAddress };
}

/**
 * Creates a malformed signature for testing error cases
 */
export function createMalformedSignature(
  signature: Buffer,
  type: "short" | "long" | "invalid_recovery" | "high_s"
): Buffer {
  switch (type) {
    case "short": {
      const shortSignature = Buffer.alloc(64);
      signature.copy(shortSignature);
      return shortSignature;
    }
    case "long": {
      const longSignature = Buffer.alloc(66);
      signature.copy(longSignature);
      return longSignature;
    }
    case "invalid_recovery": {
      const invalidRecoverySignature = Buffer.from(signature);
      invalidRecoverySignature[64] = 29;
      return invalidRecoverySignature;
    }
    case "high_s": {
      const highS = Buffer.from(signature);
      Buffer.from("fffffffffffffffffffffffffffffff", "hex").copy(highS, 32);
      return highS;
    }
    default:
      throw new Error(`Unknown malformed signature type: ${type}`);
  }
}

/**
 * Computes keccak256 hash of attestation data
 */
export function hashAttestation(attestationData: Buffer): Buffer {
  return Buffer.from(ethers.keccak256(attestationData).slice(2), "hex");
}

/**
 * Creates a valid signature for attestation data using Ethereum Signed Message format
 * This matches Circle's KMS and our updated Solana contract
 */
export function signAttestation(
  attestationData: Buffer,
  privateKey: Buffer
): Buffer {
  // Step 1: keccak256(attestation) - same as before
  const rawHash = hashAttestation(attestationData);

  // Step 2 & 3 are signing using Ethereum Signed Message format (synchronous approach)
  // This creates the same result as Circle's hashMessage(keccak256(payload))
  const privateKeyHex = "0x" + privateKey.toString("hex");
  const wallet = new ethers.Wallet(privateKeyHex);

  // Apply Ethereum Signed Message prefix manually and sign
  const ethSignedHash = ethers.hashMessage(rawHash);
  const signature = wallet.signingKey.sign(ethSignedHash);

  // Convert to our contract format (r, s, v)
  const fullSignature = Buffer.alloc(65);
  Buffer.from(signature.r.slice(2), "hex").copy(fullSignature, 0);
  Buffer.from(signature.s.slice(2), "hex").copy(fullSignature, 32);
  fullSignature[64] = signature.v;

  return fullSignature;
}

/**
 * Verifies that a signature can be recovered to the expected address using Ethereum Signed Message format
 */
export function verifySignature(
  messageHash: Buffer,
  signature: Buffer,
  expectedAddress: Buffer
): boolean {
  try {
    if (signature.length !== 65) return false;

    const v = signature[64];
    if (v < 27 || v > 30) return false;

    const sigHex = "0x" + signature.toString("hex");

    // Apply Ethereum Signed Message format to match how contract verifies
    const ethSignedHash = ethers.hashMessage(messageHash);

    const recoveredAddress = ethers.recoverAddress(ethSignedHash, sigHex);
    const expectedAddressHex = "0x" + expectedAddress.toString("hex");
    return recoveredAddress.toLowerCase() === expectedAddressHex.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Derives the PDA for a custody token account used in gateway minting
 */
function deriveCustodyTokenAccountPDA(
  tokenMint: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("gateway_minter_custody"), tokenMint.toBuffer()],
    programId
  );
  return pda;
}

/**
 * Derives the PDA for a transfer spec hash used in gateway minting
 */
function deriveTransferSpecHashPDA(
  transferSpecHash: Buffer,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("used_transfer_spec_hash"), transferSpecHash],
    programId
  );
  return pda;
}

/**
 * Creates remaining accounts array for gateway mint from attestations
 */
export function createGatewayMintRemainingAccounts(
  attestation: MintAttestationSet,
  programId: PublicKey
): Array<{ pubkey: PublicKey; isWritable: boolean; isSigner: boolean }> {
  return attestation.attestations.flatMap((attestation) => {
    return [
      {
        pubkey: deriveCustodyTokenAccountPDA(
          attestation.destinationToken,
          programId
        ),
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: attestation.destinationRecipient,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: deriveTransferSpecHashPDA(
          attestation.transferSpecHash,
          programId
        ),
        isWritable: true,
        isSigner: false,
      },
    ];
  });
}

/**
 * Creates remaining accounts array for gateway burn from burn intents
 */
export function createGatewayBurnRemainingAccounts(
  burnIntents: BurnIntent[],
  programId: PublicKey
): Array<{ pubkey: PublicKey; isWritable: boolean; isSigner: boolean }> {
  return burnIntents.map((burnIntent) => ({
    pubkey: deriveTransferSpecHashPDA(
      calculateTransferSpecHash(burnIntent.transferSpec),
      programId
    ),
    isWritable: true,
    isSigner: false,
  }));
}

export function signBurnIntent(
  message: Buffer,
  keypairBytes: Uint8Array,
  usePrefix: boolean = true
): Buffer {
  const prefixed = usePrefix
    ? Buffer.concat([
        Buffer.from([0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        message,
      ])
    : message;
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"), // PKCS#8 header
      Buffer.from(keypairBytes.slice(0, 32)), // Rest of the key is the public key
    ]),
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, prefixed, privateKey);
}

export type SignedBurnIntent = {
  intent: BurnIntent;
  bytes: Buffer;
  signature: Buffer;
  signer: Keypair;
};

export function createSignedBurnIntent(
  params: {
    burnIntentOverrides?: Partial<BurnIntent>;
    transferSpecOverrides?: Partial<TransferSpec>;
    signer?: Keypair;
  } = {}
): SignedBurnIntent {
  const { burnIntentOverrides, transferSpecOverrides, signer } = params;
  const userSigner = signer ?? Keypair.generate();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sourceSigner: _ignoredSourceSigner, ...transferOverrides } =
    transferSpecOverrides ?? {};

  const transferSpec = generateTransferSpec({
    ...transferOverrides,
    sourceSigner: userSigner.publicKey,
  });

  const intent = generateBurnIntent({
    ...burnIntentOverrides,
    transferSpec,
  });

  const bytes = encodeBurnIntent(intent);
  const signature = signBurnIntent(bytes, userSigner.secretKey);

  return {
    intent,
    bytes,
    signature,
    signer: userSigner,
  };
}

/**
 * Creates an Address Lookup Table (ALT) and adds addresses to it
 * @param svm - LiteSVM instance
 * @param payer - Payer for the transaction
 * @param addresses - Array of PublicKeys to add to the lookup table
 * @returns The lookup table address
 */
export async function createAddressLookupTable(
  svm: LiteSVM,
  payer: Keypair,
  addresses: PublicKey[]
): Promise<AddressLookupTableAccount> {
  // Create lookup table instruction
  const [createIx, lookupTableAddress] =
    AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey,
      payer: payer.publicKey,
      // The LUT program doesn't respect what we set the clock sysvar
      // to using LiteSVM. Only using zero seems to work here.
      recentSlot: 0,
    });

  // Create transaction to create the lookup table
  const createTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: svm.latestBlockhash(),
      instructions: [createIx],
    }).compileToV0Message()
  );
  createTx.sign([payer]);

  const createTxResult = svm.sendTransaction(createTx);
  if (createTxResult instanceof FailedTransactionMetadata) {
    console.error("Create transaction failed:", createTxResult.toString());
    throw new Error("Create transaction failed");
  }

  // Add addresses to lookup table in batches of 20
  const BATCH_SIZE = 20;
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      lookupTable: lookupTableAddress,
      authority: payer.publicKey,
      payer: payer.publicKey,
      addresses: batch,
    });

    const extendTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: svm.latestBlockhash(),
        instructions: [extendIx],
      }).compileToV0Message()
    );
    extendTx.sign([payer]);

    const extendTxResult = svm.sendTransaction(extendTx);
    if (extendTxResult instanceof FailedTransactionMetadata) {
      console.error("Extend transaction failed:", extendTxResult.toString());
      throw new Error("Extend transaction failed");
    }
  }

  return getAddressLookupTable(svm, lookupTableAddress);
}

/**
 * Fetches an Address Lookup Table account
 * @param svm - LiteSVM instance
 * @param address - The lookup table address
 * @returns The AddressLookupTableAccount or null if not found
 */
export async function getAddressLookupTable(
  svm: LiteSVM,
  address: PublicKey
): Promise<AddressLookupTableAccount | null> {
  const accountInfo = svm.getAccount(address);
  if (!accountInfo) {
    return null;
  }

  return new AddressLookupTableAccount({
    key: address,
    state: AddressLookupTableAccount.deserialize(accountInfo.data),
  });
}
