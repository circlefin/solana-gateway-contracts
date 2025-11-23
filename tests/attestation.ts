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
import * as anchor from "@coral-xyz/anchor";
import { SOLANA_DOMAIN } from "./constants";

// Attestation Set fixed header offsets
export const ATTESTATION_SET_MAGIC = 0x10cbb1ec;
export const MAGIC_OFFSET = 0;
export const VERSION_OFFSET = 4;
export const DESTINATION_DOMAIN_OFFSET = 8;
export const DESTINATION_CONTRACT_OFFSET = 12;
export const DESTINATION_CALLER_OFFSET = 44;
export const MAX_BLOCK_HEIGHT_OFFSET = 76;
export const ATTESTATION_SET_NUM_ATTESTATIONS_OFFSET = 84;
export const ATTESTATION_SET_ATTESTATIONS_OFFSET = 88;

// Attestation Element relative offsets
export const DESTINATION_TOKEN_OFFSET = 0;
export const DESTINATION_RECIPIENT_OFFSET = 32;
export const VALUE_OFFSET = 64;
export const TRANSFER_SPEC_HASH_OFFSET = 72;
export const HOOK_DATA_LENGTH_OFFSET = 104;
export const HOOK_DATA_OFFSET = 108;

export type MintAttestationSet = {
  version: number;
  destinationDomain: number;
  destinationContract: PublicKey;
  destinationCaller: PublicKey;
  maxBlockHeight: anchor.BN;
  numAttestations: number;
  attestations: MintAttestationElement[];
};

export type MintAttestationElement = {
  destinationToken: PublicKey;
  destinationRecipient: PublicKey;
  value: anchor.BN;
  transferSpecHash: Buffer;
  hookDataLength: number;
  hookData: Buffer;
};

export type MintAttestationSetParams = {
  isDefaultDestinationCaller: boolean;
  maxBlockHeight: number;
  elements: MintAttestationParams[];
};

export type MintAttestationParams = {
  value: number;
  transferSpecHash: Buffer;
  hookData: Buffer;
};

// Helper functions

/**
 * Generate a random bigint value (up to 64-bit safe integer)
 */
export function randomBigInt(): bigint {
  const randomValue = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  return BigInt(randomValue);
}

/**
 * Convert an anchor.BN to an 8-byte big-endian buffer
 */
export function bnToBuffer8BE(value: anchor.BN): Buffer {
  const buffer = Buffer.alloc(8);
  const hex = value.toString(16, 16); // pad to 16 hex chars (8 bytes)
  Buffer.from(hex, "hex").copy(buffer);
  return buffer;
}

/**
 * Encode a MintAttestationElement to a buffer
 */
export function encodeMintAttestationElement(
  element: MintAttestationElement
): Buffer {
  const hook = Buffer.from(element.hookData);
  const len = HOOK_DATA_OFFSET + hook.length;
  const out = Buffer.alloc(len);

  element.destinationToken.toBuffer().copy(out, DESTINATION_TOKEN_OFFSET);
  element.destinationRecipient
    .toBuffer()
    .copy(out, DESTINATION_RECIPIENT_OFFSET);
  bnToBuffer8BE(element.value).copy(out, VALUE_OFFSET);
  Buffer.from(element.transferSpecHash).copy(out, TRANSFER_SPEC_HASH_OFFSET);
  out.writeUInt32BE(element.hookDataLength, HOOK_DATA_LENGTH_OFFSET);
  if (hook.length > 0) hook.copy(out, HOOK_DATA_OFFSET);
  return out;
}

/**
 * Encode a MintAttestationSet to a buffer
 */
export function encodeMintAttestationSet(set: MintAttestationSet): Buffer {
  const encodedAttestations = Buffer.concat(
    set.attestations.map(encodeMintAttestationElement)
  );
  const out = Buffer.alloc(
    ATTESTATION_SET_ATTESTATIONS_OFFSET + encodedAttestations.length
  );

  out.writeUInt32BE(ATTESTATION_SET_MAGIC, MAGIC_OFFSET);
  out.writeUInt32BE(set.version, VERSION_OFFSET);
  out.writeUInt32BE(set.destinationDomain, DESTINATION_DOMAIN_OFFSET);
  set.destinationContract.toBuffer().copy(out, DESTINATION_CONTRACT_OFFSET);
  set.destinationCaller.toBuffer().copy(out, DESTINATION_CALLER_OFFSET);
  bnToBuffer8BE(set.maxBlockHeight).copy(out, MAX_BLOCK_HEIGHT_OFFSET);
  out.writeUInt32BE(
    set.numAttestations,
    ATTESTATION_SET_NUM_ATTESTATIONS_OFFSET
  );
  encodedAttestations.copy(out, ATTESTATION_SET_ATTESTATIONS_OFFSET);
  return out;
}

/**
 * Decode a Buffer to a MintAttestationSet
 */
export function decodeMintAttestationSet(buffer: Buffer): MintAttestationSet {
  const version = buffer.readUInt32BE(VERSION_OFFSET);
  const destinationDomain = buffer.readUInt32BE(DESTINATION_DOMAIN_OFFSET);
  const destinationContract = new PublicKey(
    buffer.subarray(
      DESTINATION_CONTRACT_OFFSET,
      DESTINATION_CONTRACT_OFFSET + 32
    )
  );
  const destinationCaller = new PublicKey(
    buffer.subarray(DESTINATION_CALLER_OFFSET, DESTINATION_CALLER_OFFSET + 32)
  );
  const maxBlockHeight = new anchor.BN(
    buffer
      .subarray(MAX_BLOCK_HEIGHT_OFFSET, MAX_BLOCK_HEIGHT_OFFSET + 8)
      .toString("hex"),
    16
  );
  const numAttestations = buffer.readUInt32BE(
    ATTESTATION_SET_NUM_ATTESTATIONS_OFFSET
  );

  // Decode each attestation element
  const attestations: MintAttestationElement[] = [];
  let offset = ATTESTATION_SET_ATTESTATIONS_OFFSET;

  for (let i = 0; i < numAttestations; i++) {
    const destinationToken = new PublicKey(
      buffer.subarray(
        offset + DESTINATION_TOKEN_OFFSET,
        offset + DESTINATION_TOKEN_OFFSET + 32
      )
    );
    const destinationRecipient = new PublicKey(
      buffer.subarray(
        offset + DESTINATION_RECIPIENT_OFFSET,
        offset + DESTINATION_RECIPIENT_OFFSET + 32
      )
    );
    const value = new anchor.BN(
      buffer
        .subarray(offset + VALUE_OFFSET, offset + VALUE_OFFSET + 8)
        .toString("hex"),
      16
    );
    const transferSpecHash = buffer.subarray(
      offset + TRANSFER_SPEC_HASH_OFFSET,
      offset + TRANSFER_SPEC_HASH_OFFSET + 32
    );
    const hookDataLength = buffer.readUInt32BE(
      offset + HOOK_DATA_LENGTH_OFFSET
    );
    const hookData = buffer.subarray(
      offset + HOOK_DATA_OFFSET,
      offset + HOOK_DATA_OFFSET + hookDataLength
    );

    attestations.push({
      destinationToken,
      destinationRecipient,
      value,
      transferSpecHash,
      hookDataLength,
      hookData,
    });

    // Move to next attestation element
    offset += HOOK_DATA_OFFSET + hookDataLength;
  }

  return {
    version,
    destinationDomain,
    destinationContract,
    destinationCaller,
    maxBlockHeight,
    numAttestations,
    attestations,
  };
}

/**
 * Generate a random MintAttestationElement
 */
export function generateMintAttestationElement(
  overrides: Partial<MintAttestationElement> = {}
): MintAttestationElement {
  const randomBytes = (length: number) =>
    Buffer.from(Array.from({ length }, () => Math.floor(Math.random() * 256)));
  const randomPublicKey = () => new PublicKey(randomBytes(32));
  const hook = randomBytes(Math.floor(Math.random() * 33));

  const defaults: MintAttestationElement = {
    destinationToken: randomPublicKey(),
    destinationRecipient: randomPublicKey(),
    value: new anchor.BN(Math.floor(Math.random() * 100000000).toString()),
    transferSpecHash: randomBytes(32),
    hookDataLength: hook.length,
    hookData: hook,
  };
  return { ...defaults, ...overrides };
}

/**
 * Generate a random MintAttestationSet
 */
export function generateMintAttestationSet(
  overrides: Partial<MintAttestationSet> = {}
): MintAttestationSet {
  const randomBytes = (length: number) =>
    Buffer.from(Array.from({ length }, () => Math.floor(Math.random() * 256)));
  const randomPublicKey = () => new PublicKey(randomBytes(32));

  const attestations =
    overrides.attestations ||
    Array.from({ length: overrides.numAttestations || 1 }, () =>
      generateMintAttestationElement()
    );

  const defaults: MintAttestationSet = {
    version: 1,
    destinationDomain: SOLANA_DOMAIN,
    destinationContract: randomPublicKey(),
    destinationCaller: randomPublicKey(),
    maxBlockHeight: new anchor.BN(Number.MAX_SAFE_INTEGER),
    numAttestations: attestations.length,
    attestations: attestations,
  };
  return { ...defaults, ...overrides };
}

export function attestationSetToParams(
  set: MintAttestationSet
): MintAttestationSetParams {
  return {
    isDefaultDestinationCaller: set.destinationCaller.equals(PublicKey.default),
    maxBlockHeight: set.maxBlockHeight.toNumber(),
    elements: set.attestations.map((attestation) => ({
      value: attestation.value.toNumber(),
      transferSpecHash: attestation.transferSpecHash,
      hookData: attestation.hookData,
    })),
  };
}
