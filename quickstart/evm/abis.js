///////////////////////////////////////////////////////////////////////////////
// ABIs used for the Gateway contracts

// The subset of the GatewayWallet ABI that is used in the quickstart guide
export const gatewayWalletAbi = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
      {
        name: "value",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

// The subset of the GatewayMinter ABI that is used in the quickstart guide
export const gatewayMinterAbi = [
  {
    type: "function",
    name: "gatewayMint",
    inputs: [
      {
        name: "attestationPayload",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "signature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
];
