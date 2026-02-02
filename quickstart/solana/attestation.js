import { publicKey } from "@solana/buffer-layout-utils";
import {
  u32be,
  nu64be,
  struct,
  seq,
  blob,
  offset,
} from "@solana/buffer-layout";

const MintAttestationElementLayout = struct([
  publicKey("destinationToken"),
  publicKey("destinationRecipient"),
  nu64be("value"),
  blob(32, "transferSpecHash"),
  u32be("hookDataLength"),
  blob(offset(u32be(), -4), "hookData"),
]);

export const MintAttestationSetLayout = struct([
  u32be("magic"),
  u32be("version"),
  u32be("destinationDomain"),
  publicKey("destinationContract"),
  publicKey("destinationCaller"),
  nu64be("maxBlockHeight"),
  u32be("numAttestations"),
  seq(MintAttestationElementLayout, offset(u32be(), -4), "attestations"),
]);

// Decode an attestation set using the buffer layout
export function decodeAttestationSet(attestation) {
  const buffer = Buffer.from(attestation.slice(2), "hex");
  return MintAttestationSetLayout.decode(buffer);
}
