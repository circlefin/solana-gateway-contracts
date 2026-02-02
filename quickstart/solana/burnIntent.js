import { publicKey } from "@solana/buffer-layout-utils";
import { u32be, struct, blob, offset, Layout } from "@solana/buffer-layout";
import { PublicKey } from "@solana/web3.js";

// Magic numbers
const TRANSFER_SPEC_MAGIC = 0xca85def7;
const BURN_INTENT_MAGIC = 0x070afbc2;

// Custom layout for 256-bit unsigned integers (stored as 32 bytes big-endian)
// Currently only reads the last 8 bytes as a regular number
class UInt256BE extends Layout {
  constructor(property) {
    super(32, property);
  }

  decode(b, offset = 0) {
    const buffer = b.slice(offset, offset + 32);
    // Read only the last 8 bytes as a BigInt
    const value = buffer.readBigUInt64BE(24);
    return value;
  }

  encode(src, b, offset = 0) {
    const buffer = Buffer.alloc(32);
    buffer.writeBigUInt64BE(BigInt(src), 24);
    buffer.copy(b, offset);
    return 32;
  }
}

const uint256be = (property) => new UInt256BE(property);

const hexToPublicKey = (hex) => new PublicKey(Buffer.from(hex.slice(2), "hex"));

// BurnIntent layout with nested TransferSpec
// Fixed size: 72 bytes for BurnIntent header (4 + 32 + 32 + 4)
// + 340 bytes for TransferSpec header (4 + 4 + 4 + 4 + 32*8 + 32 + 32 + 4)
// Variable: hookData within TransferSpec
const BurnIntentLayout = struct([
  u32be("magic"),
  uint256be("maxBlockHeight"),
  uint256be("maxFee"),
  u32be("transferSpecLength"),
  struct(
    [
      u32be("magic"),
      u32be("version"),
      u32be("sourceDomain"),
      u32be("destinationDomain"),
      publicKey("sourceContract"),
      publicKey("destinationContract"),
      publicKey("sourceToken"),
      publicKey("destinationToken"),
      publicKey("sourceDepositor"),
      publicKey("destinationRecipient"),
      publicKey("sourceSigner"),
      publicKey("destinationCaller"),
      uint256be("value"),
      blob(32, "salt"),
      u32be("hookDataLength"),
      blob(offset(u32be(), -4), "hookData"),
    ],
    "spec"
  ),
]);

export function encodeBurnIntent(bi) {
  const hookData = Buffer.from((bi.spec.hookData || "0x").slice(2), "hex");

  const prepared = {
    magic: BURN_INTENT_MAGIC,
    maxBlockHeight: bi.maxBlockHeight,
    maxFee: bi.maxFee,
    transferSpecLength: 340 + hookData.length,
    spec: {
      magic: TRANSFER_SPEC_MAGIC,
      version: bi.spec.version,
      sourceDomain: bi.spec.sourceDomain,
      destinationDomain: bi.spec.destinationDomain,
      sourceContract: hexToPublicKey(bi.spec.sourceContract),
      destinationContract: hexToPublicKey(bi.spec.destinationContract),
      sourceToken: hexToPublicKey(bi.spec.sourceToken),
      destinationToken: hexToPublicKey(bi.spec.destinationToken),
      sourceDepositor: hexToPublicKey(bi.spec.sourceDepositor),
      destinationRecipient: hexToPublicKey(bi.spec.destinationRecipient),
      sourceSigner: hexToPublicKey(bi.spec.sourceSigner),
      destinationCaller: hexToPublicKey(bi.spec.destinationCaller),
      value: bi.spec.value,
      salt: Buffer.from(bi.spec.salt.slice(2), "hex"),
      hookDataLength: hookData.length,
      hookData,
    },
  };

  const buffer = Buffer.alloc(72 + 340 + hookData.length);
  const bytesWritten = BurnIntentLayout.encode(prepared, buffer);
  return buffer.subarray(0, bytesWritten);
}
