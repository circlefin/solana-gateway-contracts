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

import { PublicKey } from "@solana/web3.js";
import { ethers } from "ethers";
import { SOLANA_DOMAIN } from "./constants";

// TransferSpec constants (relative to start of TransferSpec, not BurnIntent)
export const TRANSFER_SPEC_MAGIC = 0xca85def7;
export const TS_MAGIC_OFFSET = 0;
export const TS_VERSION_OFFSET = 4;
export const TS_SOURCE_DOMAIN_OFFSET = 8;
export const TS_DESTINATION_DOMAIN_OFFSET = 12;
export const TS_SOURCE_CONTRACT_OFFSET = 16;
export const TS_DESTINATION_CONTRACT_OFFSET = 48;
export const TS_SOURCE_TOKEN_OFFSET = 80;
export const TS_DESTINATION_TOKEN_OFFSET = 112;
export const TS_SOURCE_DEPOSITOR_OFFSET = 144;
export const TS_DESTINATION_RECIPIENT_OFFSET = 176;
export const TS_SOURCE_SIGNER_OFFSET = 208;
export const TS_DESTINATION_CALLER_OFFSET = 240;
export const TS_VALUE_OFFSET = 272;
export const TS_SALT_OFFSET = 304;
export const TS_HOOK_DATA_LENGTH_OFFSET = 336;
export const TS_HOOK_DATA_OFFSET = 340;

// BurnIntent constants
export const BURN_INTENT_MAGIC = 0x070afbc2;
export const BURN_INTENT_SET_MAGIC = 0xe999239b;
export const BI_MAGIC_OFFSET = 0;
export const BI_MAX_BLOCK_HEIGHT_OFFSET = 4;
export const BI_MAX_FEE_OFFSET = 36;
export const BI_TRANSFER_SPEC_LENGTH_OFFSET = 68;
export const BI_TRANSFER_SPEC_OFFSET = 72;
export const BI_SET_NUM_INTENTS_OFFSET = 4;
export const BI_SET_INTENTS_OFFSET = 8;

// Helper functions

/**
 * Generate a random bigint value (up to 64-bit safe integer)
 */
export function randomBigInt(): bigint {
  const randomValue = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  return BigInt(randomValue);
}

/**
 * Convert a bigint to a 32-byte big-endian buffer
 */
export function bigIntToBuffer32BE(value: bigint): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.writeBigUInt64BE(value, 24);
  return buffer;
}

export type TransferSpec = {
  magic: number;
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: PublicKey;
  destinationContract: PublicKey;
  sourceToken: PublicKey;
  destinationToken: PublicKey;
  sourceDepositor: PublicKey;
  destinationRecipient: PublicKey;
  sourceSigner: PublicKey;
  destinationCaller: PublicKey;
  value: bigint;
  salt: Buffer; // 32 bytes
  hookDataLength: number;
  hookData: Buffer;
};

export type BurnIntent = {
  magic: number;
  maxBlockHeight: bigint;
  maxFee: bigint;
  transferSpecLength: number;
  transferSpec: TransferSpec;
};

export function encodeTransferSpec(ts: TransferSpec): Buffer {
  const hook = Buffer.from(ts.hookData);
  const len = TS_HOOK_DATA_OFFSET + hook.length;
  const out = Buffer.alloc(len);

  out.writeUInt32BE(ts.magic, TS_MAGIC_OFFSET);
  out.writeUInt32BE(ts.version, TS_VERSION_OFFSET);
  out.writeUInt32BE(ts.sourceDomain, TS_SOURCE_DOMAIN_OFFSET);
  out.writeUInt32BE(ts.destinationDomain, TS_DESTINATION_DOMAIN_OFFSET);
  ts.sourceContract.toBuffer().copy(out, TS_SOURCE_CONTRACT_OFFSET);
  ts.destinationContract.toBuffer().copy(out, TS_DESTINATION_CONTRACT_OFFSET);
  ts.sourceToken.toBuffer().copy(out, TS_SOURCE_TOKEN_OFFSET);
  ts.destinationToken.toBuffer().copy(out, TS_DESTINATION_TOKEN_OFFSET);
  ts.sourceDepositor.toBuffer().copy(out, TS_SOURCE_DEPOSITOR_OFFSET);
  ts.destinationRecipient.toBuffer().copy(out, TS_DESTINATION_RECIPIENT_OFFSET);
  ts.sourceSigner.toBuffer().copy(out, TS_SOURCE_SIGNER_OFFSET);
  ts.destinationCaller.toBuffer().copy(out, TS_DESTINATION_CALLER_OFFSET);
  bigIntToBuffer32BE(ts.value).copy(out, TS_VALUE_OFFSET);
  Buffer.from(ts.salt).copy(out, TS_SALT_OFFSET);
  out.writeUInt32BE(ts.hookDataLength, TS_HOOK_DATA_LENGTH_OFFSET);
  if (hook.length > 0) hook.copy(out, TS_HOOK_DATA_OFFSET);
  return out;
}

export function encodeBurnIntent(bi: BurnIntent): Buffer {
  const encodedTs = encodeTransferSpec(bi.transferSpec);
  // Keep the BurnIntent object consistent with encoded bytes for test expectations
  bi.transferSpecLength = encodedTs.length;
  const out = Buffer.alloc(BI_TRANSFER_SPEC_OFFSET + encodedTs.length);
  out.writeUInt32BE(bi.magic, BI_MAGIC_OFFSET);
  bigIntToBuffer32BE(bi.maxBlockHeight).copy(out, BI_MAX_BLOCK_HEIGHT_OFFSET);
  bigIntToBuffer32BE(bi.maxFee).copy(out, BI_MAX_FEE_OFFSET);
  out.writeUInt32BE(encodedTs.length, BI_TRANSFER_SPEC_LENGTH_OFFSET);
  encodedTs.copy(out, BI_TRANSFER_SPEC_OFFSET);
  return out;
}

export function encodeBurnIntentSet(intents: BurnIntent[]): Buffer {
  const encoded = Buffer.concat(intents.map(encodeBurnIntent));
  const out = Buffer.alloc(BI_SET_INTENTS_OFFSET + encoded.length);
  out.writeUInt32BE(BURN_INTENT_SET_MAGIC, BI_MAGIC_OFFSET);
  out.writeUInt32BE(intents.length, BI_SET_NUM_INTENTS_OFFSET);
  encoded.copy(out, BI_SET_INTENTS_OFFSET);
  return out;
}

export function generateTransferSpec(
  overrides: Partial<TransferSpec> = {}
): TransferSpec {
  const randomBytes = (length: number) =>
    Buffer.from(Array.from({ length }, () => Math.floor(Math.random() * 256)));
  const randomPublicKey = () => new PublicKey(randomBytes(32));
  const hook = randomBytes(Math.floor(Math.random() * 33));

  const defaults: TransferSpec = {
    magic: TRANSFER_SPEC_MAGIC,
    version: 1,
    sourceDomain: SOLANA_DOMAIN,
    destinationDomain: 1,
    sourceContract: randomPublicKey(),
    destinationContract: randomPublicKey(),
    sourceToken: randomPublicKey(),
    destinationToken: randomPublicKey(),
    sourceDepositor: randomPublicKey(),
    destinationRecipient: randomPublicKey(),
    sourceSigner: randomPublicKey(),
    destinationCaller: randomPublicKey(),
    value: randomBigInt(),
    salt: randomBytes(32), // salt can be fully random
    hookDataLength: hook.length,
    hookData: hook,
  };
  return { ...defaults, ...overrides };
}

export function generateBurnIntent(
  overrides: Partial<BurnIntent> = {}
): BurnIntent {
  const transferSpec = generateTransferSpec();
  const defaults: BurnIntent = {
    magic: BURN_INTENT_MAGIC,
    maxBlockHeight: BigInt("18446744073709551615"),
    maxFee: BigInt("18446744073709551615"),
    transferSpecLength: TS_HOOK_DATA_OFFSET + transferSpec.hookData.length,
    transferSpec: transferSpec,
  };
  const merged = { ...defaults, ...overrides };

  return merged;
}

export function calculateTransferSpecHash(transferSpec: TransferSpec): Buffer {
  return Buffer.from(
    ethers.keccak256(encodeTransferSpec(transferSpec)).slice(2),
    "hex"
  );
}
