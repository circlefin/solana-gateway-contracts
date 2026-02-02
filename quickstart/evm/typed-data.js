import { transformBurnIntent } from "../burnIntentTransformers.js";

///////////////////////////////////////////////////////////////////////////////
// EIP-712 typed data utils for burn intents and burn intent sets

const domain = { name: "GatewayWallet", version: "1" };

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
];

const TransferSpec = [
  { name: "version", type: "uint32" },
  { name: "sourceDomain", type: "uint32" },
  { name: "destinationDomain", type: "uint32" },
  { name: "sourceContract", type: "bytes32" },
  { name: "destinationContract", type: "bytes32" },
  { name: "sourceToken", type: "bytes32" },
  { name: "destinationToken", type: "bytes32" },
  { name: "sourceDepositor", type: "bytes32" },
  { name: "destinationRecipient", type: "bytes32" },
  { name: "sourceSigner", type: "bytes32" },
  { name: "destinationCaller", type: "bytes32" },
  { name: "value", type: "uint256" },
  { name: "salt", type: "bytes32" },
  { name: "hookData", type: "bytes" },
];

const BurnIntent = [
  { name: "maxBlockHeight", type: "uint256" },
  { name: "maxFee", type: "uint256" },
  { name: "spec", type: "TransferSpec" },
];

const BurnIntentSet = [{ name: "intents", type: "BurnIntent[]" }];

export function burnIntentTypedData(
  burnIntent,
  isSourceSolana,
  isDestinationSolana
) {
  const transformedMessage = transformBurnIntent(
    burnIntent,
    isSourceSolana,
    isDestinationSolana
  );

  return {
    types: { EIP712Domain, TransferSpec, BurnIntent },
    domain,
    primaryType: "BurnIntent",
    message: transformedMessage,
  };
}

export function burnIntentSetTypedData({ intents }) {
  return {
    types: { EIP712Domain, TransferSpec, BurnIntent, BurnIntentSet },
    domain,
    primaryType: "BurnIntentSet",
    message: {
      intents: intents.map((intent) => burnIntentTypedData(intent).message),
    },
  };
}
