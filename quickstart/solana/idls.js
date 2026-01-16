///////////////////////////////////////////////////////////////////////////////
// IDLs used for the Gateway contracts

// The subset of the GatewayWallet IDL that is used in the quickstart guide
export const gatewayWalletIdl = {
  address: "devN7ZZFhGVTgwoKHaDDTFFgrhRzSGzuC6hgVFPrxbs",
  metadata: {
    name: "gatewayWallet",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Created with Anchor",
  },
  instructions: [
    {
      name: "deposit",
      discriminator: [22, 0],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true,
        },
        {
          name: "owner",
          signer: true,
        },
        {
          name: "gatewayWallet",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103, 97, 116, 101, 119, 97, 121, 95, 119, 97, 108, 108, 101,
                  116,
                ],
              },
            ],
          },
        },
        {
          name: "ownerTokenAccount",
          writable: true,
        },
        {
          name: "custodyTokenAccount",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103, 97, 116, 101, 119, 97, 121, 95, 119, 97, 108, 108, 101,
                  116, 95, 99, 117, 115, 116, 111, 100, 121,
                ],
              },
              {
                kind: "account",
                path: "custody_token_account.mint",
                account: "tokenAccount",
              },
            ],
          },
        },
        {
          name: "deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103, 97, 116, 101, 119, 97, 121, 95, 100, 101, 112, 111, 115,
                  105, 116,
                ],
              },
              {
                kind: "account",
                path: "custody_token_account.mint",
                account: "tokenAccount",
              },
              {
                kind: "account",
                path: "owner",
              },
            ],
          },
        },
        {
          name: "depositorDenylist",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [100, 101, 110, 121, 108, 105, 115, 116],
              },
              {
                kind: "account",
                path: "owner",
              },
            ],
          },
        },
        {
          name: "tokenProgram",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111",
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111,
                  114, 105, 116, 121,
                ],
              },
            ],
          },
        },
        {
          name: "program",
        },
      ],
      args: [
        {
          name: "amount",
          type: "u64",
        },
      ],
    },
  ],
};

// The subset of the GatewayMinter IDL that is used in the quickstart guide
export const gatewayMinterIdl = {
  address: "dev7nrwT5HL2S1mdcmzgpUDfyEKZaQfZLRmNAhYZCVa",
  metadata: {
    name: "gatewayMinter",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Created with Anchor",
  },
  instructions: [
    {
      name: "gatewayMint",
      discriminator: [12, 0],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true,
        },
        {
          name: "destinationCaller",
          signer: true,
        },
        {
          name: "gatewayMinter",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103, 97, 116, 101, 119, 97, 121, 95, 109, 105, 110, 116, 101,
                  114,
                ],
              },
            ],
          },
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111",
        },
        {
          name: "tokenProgram",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111,
                  114, 105, 116, 121,
                ],
              },
            ],
          },
        },
        {
          name: "program",
        },
      ],
      args: [
        {
          name: "params",
          type: {
            defined: {
              name: "gatewayMintParams",
            },
          },
        },
      ],
    },
  ],
  types: [
    {
      name: "gatewayMintParams",
      docs: ["Mode 1: Full attestation bytes with signature"],
      type: {
        kind: "struct",
        fields: [
          {
            name: "attestation",
            type: "bytes",
          },
          {
            name: "signature",
            type: "bytes",
          },
        ],
      },
    },
  ],
};
