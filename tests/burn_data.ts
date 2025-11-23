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

import {
  BI_TRANSFER_SPEC_OFFSET,
  TS_SOURCE_SIGNER_OFFSET,
} from "./burn_intent";

export const DISCRIMINATOR_SIZE = 2;
export const BURN_SIGNER_SIGNATURE_LENGTH = 65;
export const FEE_LENGTH = 8;
export const USER_SIGNATURE_LENGTH = 64;
export const BURN_INTENT_MESSAGE_PREFIX_LENGTH = 16;

export const BURN_INTENT_MESSAGE_PREFIX = Buffer.from([
  0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

// ed25519 offsets
export const ED25519_SIGNATURE_OFFSET = DISCRIMINATOR_SIZE + 4 + FEE_LENGTH;
export const ED25519_DATA_OFFSET =
  DISCRIMINATOR_SIZE + 4 + FEE_LENGTH + USER_SIGNATURE_LENGTH;
export const ED25519_PUBLIC_KEY_OFFSET =
  ED25519_DATA_OFFSET +
  BURN_INTENT_MESSAGE_PREFIX_LENGTH +
  BI_TRANSFER_SPEC_OFFSET +
  TS_SOURCE_SIGNER_OFFSET;

// Encodes a GatewayBurnData into a Buffer.
export function encodeGatewayBurnData(
  burnSignerSignature: Buffer,
  burnSignerMessage: Buffer
): Buffer {
  const serializedLen = BURN_SIGNER_SIGNATURE_LENGTH + burnSignerMessage.length;
  const out = Buffer.alloc(serializedLen);
  burnSignerSignature.copy(out, 0);
  burnSignerMessage.copy(out, BURN_SIGNER_SIGNATURE_LENGTH);
  return out;
}

// Encodes the fee and burn intent message (the message signed by the burn signer)
export function encodeBurnSignerMessage(
  fee: bigint,
  burnIntentSignature: Buffer,
  burnIntent: Buffer,
  burnIntentMessagePrefix: Buffer = BURN_INTENT_MESSAGE_PREFIX
): Buffer {
  const feeOffset = 0;
  const userSignatureOffset = feeOffset + FEE_LENGTH;
  const burnIntentMessagePrefixOffset =
    userSignatureOffset + USER_SIGNATURE_LENGTH;
  const burnIntentOffset =
    burnIntentMessagePrefixOffset + BURN_INTENT_MESSAGE_PREFIX_LENGTH;

  const out = Buffer.alloc(burnIntentOffset + burnIntent.length);

  out.writeBigUInt64BE(fee, feeOffset);
  burnIntentSignature.copy(out, userSignatureOffset);
  burnIntentMessagePrefix.copy(out, burnIntentMessagePrefixOffset);
  burnIntent.copy(out, burnIntentOffset);
  return out;
}

// Encodes the burn intent message (the message signed by the user)
export function encodeBurnIntentMessage(burnIntent: Buffer): Buffer {
  const out = Buffer.alloc(
    BURN_INTENT_MESSAGE_PREFIX_LENGTH + burnIntent.length
  );
  BURN_INTENT_MESSAGE_PREFIX.copy(out, 0);
  burnIntent.copy(out, BURN_INTENT_MESSAGE_PREFIX_LENGTH);
  return out;
}

export function encodeEd25519InstructionData(
  burnIntentLength: number,
  overrides?: {
    signatureOffset?: number;
    signatureInstructionIndex?: number;
    publicKeyOffset?: number;
    publicKeyInstructionIndex?: number;
    messageDataOffset?: number;
    messageDataSize?: number;
    messageInstructionIndex?: number;
    additionalData?: Buffer;
  }
): Buffer {
  const numSignatures = 1;
  const padding = 0;
  const signatureOffset =
    overrides?.signatureOffset ?? DISCRIMINATOR_SIZE + 4 + FEE_LENGTH;
  const signatureInstructionIndex = overrides?.signatureInstructionIndex ?? 1;
  const publicKeyOffset =
    overrides?.publicKeyOffset ?? ED25519_PUBLIC_KEY_OFFSET;
  const publicKeyInstructionIndex = overrides?.publicKeyInstructionIndex ?? 1;
  const messageDataOffset = overrides?.messageDataOffset ?? ED25519_DATA_OFFSET;
  const messageDataSize =
    overrides?.messageDataSize ??
    BURN_INTENT_MESSAGE_PREFIX_LENGTH + burnIntentLength;
  const messageInstructionIndex = overrides?.messageInstructionIndex ?? 1;

  const out = Buffer.alloc(16 + (overrides?.additionalData?.length ?? 0));
  out.writeUInt8(numSignatures, 0);
  out.writeUInt8(padding, 1);
  out.writeUInt16LE(signatureOffset, 2);
  out.writeUInt16LE(signatureInstructionIndex, 4);
  out.writeUInt16LE(publicKeyOffset, 6);
  out.writeUInt16LE(publicKeyInstructionIndex, 8);
  out.writeUInt16LE(messageDataOffset, 10);
  out.writeUInt16LE(messageDataSize, 12);
  out.writeUInt16LE(messageInstructionIndex, 14);
  if (overrides?.additionalData) {
    overrides.additionalData.copy(out, 16);
  }
  return out;
}
