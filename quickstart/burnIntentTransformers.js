import { randomBytes } from "node:crypto";
import { pad, zeroAddress as evmZeroAddress } from "viem";
import bs58 from "bs58";

const solanaZeroAddress = "11111111111111111111111111111111";

// Maximum value for u64 (used for Solana block heights)
const MAX_U64 = 2n ** 64n - 1n;

export function addressToBytes32(address, isSolana) {
  if (isSolana) {
    const decoded = Buffer.from(bs58.decode(address));
    return `0x${decoded.toString("hex")}`;
  } else {
    return pad(address.toLowerCase(), { size: 32 });
  }
}

export function burnIntent({ account, from, to, amount, recipient }) {
  return {
    // Needs to be at least 7 days in the future
    maxBlockHeight: MAX_U64,
    // 2.01 USDC will cover the fee for any chain.
    maxFee: 2_010000n,
    // The details of the transfer
    spec: {
      version: 1,
      sourceDomain: from.domain,
      destinationDomain: to.domain,
      sourceContract: from.gatewayWallet.address,
      destinationContract: to.gatewayMinter.address,
      sourceToken: from.usdc.address,
      destinationToken: to.usdc.address,
      sourceDepositor: account.address,
      destinationRecipient: recipient || account.address,
      sourceSigner: account.address,
      destinationCaller: solanaZeroAddress, // Use the zero address to specify that anyone can execute the attestation
      value: BigInt(Math.floor(amount * 1e6)), // Convert the amount string to USDC atomic units
      salt: "0x" + randomBytes(32).toString("hex"),
      hookData: "0x", // No hook data for now
    },
  };
}

export function transformBurnIntent(
  burnIntent,
  isSourceSolana,
  isDestinationSolana
) {
  const destinationCallerValue = isDestinationSolana
    ? burnIntent.spec.destinationCaller ?? solanaZeroAddress
    : burnIntent.spec.destinationCaller ?? evmZeroAddress;

  return {
    maxBlockHeight: burnIntent.maxBlockHeight,
    maxFee: burnIntent.maxFee,
    spec: {
      ...burnIntent.spec,
      sourceContract: addressToBytes32(
        burnIntent.spec.sourceContract,
        isSourceSolana
      ),
      destinationContract: addressToBytes32(
        burnIntent.spec.destinationContract,
        isDestinationSolana
      ),
      sourceToken: addressToBytes32(
        burnIntent.spec.sourceToken,
        isSourceSolana
      ),
      destinationToken: addressToBytes32(
        burnIntent.spec.destinationToken,
        isDestinationSolana
      ),
      sourceDepositor: addressToBytes32(
        burnIntent.spec.sourceDepositor,
        isSourceSolana
      ),
      destinationRecipient: addressToBytes32(
        burnIntent.spec.destinationRecipient,
        isDestinationSolana
      ),
      sourceSigner: addressToBytes32(
        burnIntent.spec.sourceSigner,
        isSourceSolana
      ),
      destinationCaller: addressToBytes32(
        destinationCallerValue,
        isDestinationSolana
      ),
    },
  };
}
