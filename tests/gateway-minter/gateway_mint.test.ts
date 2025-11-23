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

import { LiteSVM, Clock } from "litesvm";
import { GatewayMinterTestClient } from "./test_client";
import { expect } from "chai";
import { SOLANA_DOMAIN } from "../constants";
import {
  ATTESTATION_SET_MAGIC,
  encodeMintAttestationSet,
  generateMintAttestationElement,
  generateMintAttestationSet,
} from "../attestation";
import {
  getEvents,
  expectAnchorError,
  findPDA,
  createGatewayMintRemainingAccounts,
  EvmKeypair,
  generateSignerKeypair,
  signAttestation,
  verifySignature,
  hashAttestation,
  createMalformedSignature,
  expectAttestationUsedToEqual,
} from "../utils";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Wallet } from "ethers";

describe("gatewayMint instruction", () => {
  let svm: LiteSVM;
  let client: GatewayMinterTestClient;
  let tokenMint: PublicKey;
  let mintAuthority: Keypair;
  let destinationTokenAccount: PublicKey;
  let custodyTokenAccountPDA: PublicKey;

  // Test attesters for signature verification
  let validAttester: EvmKeypair;
  let invalidAttester: EvmKeypair;

  // Default valid mint attestation
  const generateDefaultAttestation = () =>
    generateMintAttestationSet({
      destinationCaller: client.owner.publicKey,
      destinationContract: client.gatewayMinterProgram.programId,
      attestations: [
        generateMintAttestationElement({
          destinationToken: tokenMint,
          destinationRecipient: destinationTokenAccount,
          value: new anchor.BN(100000000),
        }),
      ],
    });

  // Helper function to get valid signature for attestation
  const getValidSignature = (attestationBytes: Buffer): Buffer => {
    return signAttestation(attestationBytes, validAttester.privateKey);
  };

  // Helper function to set clock to specific slot
  const setClockToSlot = (slot: number) => {
    const clock = new Clock(
      BigInt(slot),
      BigInt(0),
      BigInt(0),
      BigInt(0),
      BigInt(Math.floor(Date.now() / 1000))
    );
    svm.setClock(clock);
  };

  const createSupportedToken = async () => {
    // Create a test token mint
    const authority = Keypair.generate();
    const mint = await client.createTokenMint(authority.publicKey, 6);

    // Add the token to the gateway minter
    await client.addToken({ tokenMint: mint });

    // Get the custody token account PDA
    const pda = findPDA(
      [Buffer.from("gateway_minter_custody"), mint.toBuffer()],
      client.gatewayMinterProgram.programId
    ).publicKey;

    // Mint tokens to the custody account
    await client.mintToken(
      mint,
      pda,
      1000000000, // 1000 tokens with 6 decimals
      authority
    );

    return {
      authority,
      mint,
      pda,
    };
  };

  beforeEach(async () => {
    svm = new LiteSVM();

    // Set clock to slot 10000 to ensure attestations don't expire by default
    setClockToSlot(10000);

    client = new GatewayMinterTestClient(svm);
    await client.initialize({ localDomain: SOLANA_DOMAIN });

    // Create and add test attesters
    validAttester = generateSignerKeypair();
    invalidAttester = generateSignerKeypair();

    // Add valid attester to the gateway minter
    await client.addAttester({ attester: validAttester.publicKey });

    const supportedToken = await createSupportedToken();
    mintAuthority = supportedToken.authority;
    tokenMint = supportedToken.mint;
    custodyTokenAccountPDA = supportedToken.pda;

    // Create a destination token account
    const destinationAccount = Keypair.generate();
    destinationTokenAccount = await client.createTokenAccount(
      tokenMint,
      destinationAccount
    );
  });

  describe("gatewayMint happy path", () => {
    it("should successfully execute a mint attestation with a single element", async () => {
      const transferAmount = 100000000; // 100 tokens with 6 decimals

      // Check initial balances
      const initialCustodyBalance = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      const initialDestinationBalance = await client.getTokenAccount(
        destinationTokenAccount
      );

      const attestation = generateDefaultAttestation();
      attestation.attestations[0].value = new anchor.BN(transferAmount);
      const txSignature = await client.gatewayMint({
        attestation,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      const events = getEvents(
        client.svm,
        txSignature,
        client.gatewayMinterProgram
      );
      expect(events.length).to.equal(1);
      expectAttestationUsedToEqual(events, attestation.attestations);

      // Verify token transfer occurred
      const finalCustodyBalance = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      const finalDestinationBalance = await client.getTokenAccount(
        destinationTokenAccount
      );
      expect(finalCustodyBalance.amount).to.equal(
        initialCustodyBalance.amount - BigInt(transferAmount)
      ); // 1000 - 100 = 900 tokens
      expect(finalDestinationBalance.amount).to.equal(
        initialDestinationBalance.amount + BigInt(transferAmount)
      );
    });

    it("should successfully exeute a mint attesetation set with multiple tokens and recipients", async () => {
      const supportedToken2 = await createSupportedToken();
      const supportedToken3 = await createSupportedToken();
      const tokenMint2 = supportedToken2.mint;
      const tokenMint3 = supportedToken3.mint;
      const destinationTokenAccount2 = await client.createTokenAccount(
        tokenMint2,
        Keypair.generate()
      );
      const destinationTokenAccount3 = await client.createTokenAccount(
        tokenMint3,
        Keypair.generate()
      );

      const attestation = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        attestations: [
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
            value: new anchor.BN(50000000),
          }),
          generateMintAttestationElement({
            destinationToken: tokenMint2,
            destinationRecipient: destinationTokenAccount2,
            value: new anchor.BN(30000000),
          }),
          generateMintAttestationElement({
            destinationToken: tokenMint3,
            destinationRecipient: destinationTokenAccount3,
            value: new anchor.BN(20000000),
          }),
        ],
      });

      const txSignature = await client.gatewayMint({
        attestation: attestation,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      const events = getEvents(
        client.svm,
        txSignature,
        client.gatewayMinterProgram
      );
      expectAttestationUsedToEqual(events, attestation.attestations);

      // Verify total tokens transferred (50 + 30 + 20 = 100)
      const destinationBalance1 = await client.getTokenAccount(
        destinationTokenAccount
      );
      const destinationBalance2 = await client.getTokenAccount(
        destinationTokenAccount2
      );
      const destinationBalance3 = await client.getTokenAccount(
        destinationTokenAccount3
      );
      expect(Number(destinationBalance1.amount)).to.equal(50000000);
      expect(Number(destinationBalance2.amount)).to.equal(30000000);
      expect(Number(destinationBalance3.amount)).to.equal(20000000);
    });
  });

  describe("signature verification integration", () => {
    it("should reject signature from non-enabled attester", async () => {
      await expectAnchorError(
        client.gatewayMint({
          attestation: generateDefaultAttestation(),
          signers: {
            attesterKey: invalidAttester.privateKey,
          },
        }),
        "InvalidAttesterSignature"
      );
    });

    it("should reject malformed signatures", async () => {
      const attestation = generateDefaultAttestation();
      const attestationBytes = encodeMintAttestationSet(attestation);

      const signature = signAttestation(
        attestationBytes,
        validAttester.privateKey
      );

      // Test various malformed signatures
      await expectAnchorError(
        client.gatewayMint({
          attestation: generateDefaultAttestation(),
          signature: createMalformedSignature(signature, "short"),
        }),
        "InvalidAttesterSignature"
      );

      await expectAnchorError(
        client.gatewayMint({
          attestation: generateDefaultAttestation(),
          signature: createMalformedSignature(signature, "long"),
        }),
        "InvalidAttesterSignature"
      );

      await expectAnchorError(
        client.gatewayMint({
          attestation: generateDefaultAttestation(),
          signature: createMalformedSignature(signature, "invalid_recovery"),
        }),
        "InvalidAttesterSignature"
      );

      await expectAnchorError(
        client.gatewayMint({
          attestation: generateDefaultAttestation(),
          signature: createMalformedSignature(signature, "high_s"),
        }),
        "InvalidAttesterSignature"
      );
    });

    it("should work with multiple enabled attesters using different signatures", async () => {
      // Add multiple attesters
      const attester2 = generateSignerKeypair();
      const attester3 = generateSignerKeypair();
      await client.addAttester({ attester: attester2.publicKey });
      await client.addAttester({ attester: attester3.publicKey });

      // Test w/ each attester one by one with different attestations
      const attesters: EvmKeypair[] = [validAttester, attester2, attester3];

      for (let i = 0; i < attesters.length; i++) {
        const attester = attesters[i];

        const attestation = generateMintAttestationSet({
          destinationCaller: client.owner.publicKey,
          destinationContract: client.gatewayMinterProgram.programId,
          attestations: [
            generateMintAttestationElement({
              destinationToken: tokenMint,
              destinationRecipient: destinationTokenAccount,
              value: new anchor.BN(25000000 + i * 1000000),
            }),
          ],
        });
        await client.gatewayMint({
          attestation,
          signers: {
            attesterKey: attester.privateKey,
          },
        });
      }

      // Verify each attester could sign independently
      const balance = (await client.getTokenAccount(destinationTokenAccount))
        .amount;
      expect(balance).to.equal(BigInt(78000000)); // 25M + 26M + 27M
    });

    it("should handle non-EVM format public keys correctly", async () => {
      // Test with a manually created non-standard public key format
      // This simulates a case where the attester PublicKey isn't a standard EVM address
      const customAttester = Keypair.generate(); // generating  Solana keypair using ed25519 instead of ECDSA
      // Try adding this non-EVM format attester
      await client.addAttester({ attester: customAttester.publicKey });

      // Create signature from the EVM version of the custom attester private key
      const customAttesterPrivateKey = Buffer.from(
        customAttester.secretKey
      ).slice(0, 32);
      const customAttesterEvmWallet = new Wallet(
        customAttesterPrivateKey.toString("hex")
      );

      // This should fail because signature doesn't match the non-EVM attester
      await expectAnchorError(
        client.gatewayMint({
          attestation: generateDefaultAttestation(),
          signers: {
            attesterKey: generateSignerKeypair(customAttesterEvmWallet)
              .privateKey,
          },
        }),
        "InvalidAttesterSignature"
      );

      // Add the same attester in EVM format in BE format.
      const evmPubkeyBuffer = Buffer.alloc(32);
      Buffer.from(customAttesterEvmWallet.address.slice(2), "hex").copy(
        evmPubkeyBuffer,
        12
      );
      await client.addAttester({ attester: new PublicKey(evmPubkeyBuffer) });

      // Mint should now succeed
      const attestation = generateDefaultAttestation();
      const txSignature = await client.gatewayMint({
        attestation,
        signers: {
          attesterKey: generateSignerKeypair(customAttesterEvmWallet)
            .privateKey,
        },
      });
      const events = getEvents(
        client.svm,
        txSignature,
        client.gatewayMinterProgram
      );
      expectAttestationUsedToEqual(events, attestation.attestations);
    });

    it("should reject signature after attester is removed", async () => {
      // This test validates that removed attesters can't sign valid transactions
      const attestation = generateDefaultAttestation();

      // Should work initially
      await client.gatewayMint({
        attestation,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      // Remove the attester
      await client.removeAttester({ attester: validAttester.publicKey });

      // Create new attestation for second attempt
      const newAttestation = generateDefaultAttestation();

      // Should now fail
      await expectAnchorError(
        client.gatewayMint({
          attestation: newAttestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "InvalidAttesterSignature"
      );
    });

    it("should successfully validate a valid Gateway attester's signature from testnet", async () => {
      // https://sepolia.etherscan.io/tx/0xfe16dfb711ea69cdd0b42adc3da640d684226443c44f1a50eecf4063d3adf28f
      const attesterAddress = "0xa0E7E2084C428864105879fD675711A7c0A3347f";
      const attestation = Buffer.from(
        "ff6fb33400000000000000000000000000000000000000000000000000000000008cef0600000154ca85def70000000100000001000000000000000000000000000000000077777d7eba4688bdef3e311b846f25870a19b90000000000000000000000000022222abe238cc2c7bb1f21003f0a260052475b0000000000000000000000005425890298aed601595a70ab815c96711a31bc650000000000000000000000001c7d4b196cb0c7b01d743fbc6116a902379c7238000000000000000000000000c1e24c87336d5ba3b30c48a37b9d42b3dcae5d8d000000000000000000000000c1e24c87336d5ba3b30c48a37b9d42b3dcae5d8d000000000000000000000000c1e24c87336d5ba3b30c48a37b9d42b3dcae5d8d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000186a07446f58711eab27e284586b86ffba352b53971d5d649523ab1028e3e958ca4ac00000000",
        "hex"
      );
      const signature = Buffer.from(
        "8051258ae59ada39d4075ecd2a6748125b46c16b6d1a13c75653be2bcdf24dde0fe2d6dafeef00cc91ae806e98dac6f630f0acb0e332e46bd1ccfc155cbd0e741b",
        "hex"
      );

      // Verify signature works locally first
      const isValidLocally = verifySignature(
        hashAttestation(attestation),
        signature,
        Buffer.from(attesterAddress.slice(2), "hex")
      );
      expect(isValidLocally).to.equal(true);

      // Verify signature fails with invalid attester signature
      await expectAnchorError(
        client.gatewayMinterProgram.methods
          .gatewayMint({ attestation, signature })
          .accountsPartial({
            gatewayMinter: client.pdas.gatewayMinter.publicKey,
            destinationCaller: client.owner.publicKey,
            payer: client.owner.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts([])
          .signers([client.owner])
          .rpc(),
        "InvalidAttesterSignature"
      );

      // Convert the expected evm signer to a Solana public key and add as an attester.
      const evmPubkeyBuffer = Buffer.alloc(32);
      Buffer.from(attesterAddress.slice(2), "hex").copy(evmPubkeyBuffer, 12);
      await client.addAttester({ attester: new PublicKey(evmPubkeyBuffer) });

      // After adding the attester, we should pass signature verification (but fail elsewhere)
      expectAnchorError(
        client.gatewayMinterProgram.methods
          .gatewayMint({ attestation, signature })
          .accountsPartial({
            gatewayMinter: client.pdas.gatewayMinter.publicKey,
            destinationCaller: client.owner.publicKey,
            payer: client.owner.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts([])
          .signers([client.owner])
          .rpc(),
        "AttestationMagicMismatch"
      );
    });
  });

  describe("version check", () => {
    it("should reject attestations that don't match the gateway minter version", async () => {
      const invalidVersion = 2;
      const attestation = generateDefaultAttestation();
      attestation.version = invalidVersion;

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "VersionMismatch"
      );
    });
  });

  describe("attestation expiry validation", () => {
    it("should succeed when attestation expires after current slot", async () => {
      setClockToSlot(15000);

      const attestation = generateDefaultAttestation();
      attestation.maxBlockHeight = new anchor.BN(15000); // Expires at exactly current slot

      const txSignature = await client.gatewayMint({
        attestation,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      const events = getEvents(
        client.svm,
        txSignature,
        client.gatewayMinterProgram
      );
      expect(events.length).to.equal(1);
      expectAttestationUsedToEqual(events, attestation.attestations);

      // Verify token transfer occurred
      const destinationBalance = await client.getTokenAccount(
        destinationTokenAccount
      );
      expect(Number(destinationBalance.amount)).to.equal(100000000);
    });

    it("should reject when attestation has expired", async () => {
      // Current slot is 10000, set expiry to 5000 (past)
      const attestation = generateDefaultAttestation();
      attestation.maxBlockHeight = new anchor.BN(5000); // Expired at slot 5000 (past)

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "AttestationExpired"
      );
    });

    it("should reject when attestation expires just before current slot", async () => {
      setClockToSlot(15000);

      const attestation = generateDefaultAttestation();
      attestation.maxBlockHeight = new anchor.BN(14999); // Expires just before current slot
      const attestationBytes = encodeMintAttestationSet(attestation);
      const signature = getValidSignature(attestationBytes);

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signature,
        }),
        "AttestationExpired"
      );
    });
  });

  describe("destination caller authorization", () => {
    it("should pass when attestation has zero address destination caller", async () => {
      const attestation = generateDefaultAttestation();
      attestation.destinationCaller = PublicKey.default;
      attestation.attestations[0].value = new anchor.BN(75000000);

      await client.gatewayMint({
        attestation,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });
    });

    it("should reject when unauthorized caller tries to execute", async () => {
      const authorizedCaller = Keypair.generate();
      const unauthorizedCaller = Keypair.generate();
      svm.airdrop(unauthorizedCaller.publicKey, BigInt(1000000000));

      const attestation = generateDefaultAttestation();
      attestation.destinationCaller = authorizedCaller.publicKey;
      attestation.attestations[0].value = new anchor.BN(75000000);
      const attestationBytes = encodeMintAttestationSet(attestation);
      const signature = getValidSignature(attestationBytes);

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signature,
          signers: {
            destinationCaller: unauthorizedCaller,
          },
        }),
        "DestinationCallerMismatch"
      );
    });
  });

  describe("destination domain validation", () => {
    it("should reject when attestation has wrong destination domain", async () => {
      const attestation = generateDefaultAttestation();
      attestation.destinationDomain = 0;

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "DestinationDomainMismatch"
      );
    });
  });

  describe("destination contract validation", () => {
    it("should reject invalid destination contract", async () => {
      const wrongProgram = Keypair.generate().publicKey;

      const attestation = generateDefaultAttestation();
      attestation.destinationContract = wrongProgram;

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "DestinationContractMismatch"
      );
    });
  });

  describe("remaining accounts validation", () => {
    it("should fail when remaining accounts is less than expected", async () => {
      const attestation = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        attestations: [
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
        ],
      });

      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          remainingAccounts: remainingAccounts.slice(0, -1),
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "RemainingAccountsLengthMismatch"
      );
    });

    it("should fail when remaining accounts is greater than expected", async () => {
      const attestation = generateDefaultAttestation();
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          remainingAccounts: [...remainingAccounts, ...remainingAccounts],
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "RemainingAccountsLengthMismatch"
      );
    });

    it("should fail when providing remaining accounts in wrong order for attestation set", async () => {
      const attestation = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        attestations: [
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
        ],
      });

      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      // Provide PDAs in wrong order (reversed)
      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts: [
            ...remainingAccounts.slice(3),
            ...remainingAccounts.slice(0, 3),
          ],
        }),
        "InvalidTransferSpecHashAccount"
      );
    });
  });

  describe("should parse mint attestations", () => {
    it("should fail to parse an empty attestation", async () => {
      const emptyAttestationBytes = Buffer.alloc(0);
      const signature = getValidSignature(emptyAttestationBytes);

      await expectAnchorError(
        client.gatewayMinterProgram.methods
          .gatewayMint({ attestation: emptyAttestationBytes, signature })
          .accountsPartial({
            gatewayMinter: client.pdas.gatewayMinter.publicKey,
            destinationCaller: client.owner.publicKey,
            payer: client.owner.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts([])
          .signers([client.owner])
          .rpc(),
        "AttestationTooShort"
      );
    });

    it("should fail to parse an attestation with invalid magic", async () => {
      const attestation = generateDefaultAttestation();
      const attestationBytes = encodeMintAttestationSet(attestation);
      attestationBytes.writeUInt32LE(0x11111111, 0); // Overwrite magic with invalid value
      const signature = getValidSignature(attestationBytes);

      await expectAnchorError(
        client.gatewayMinterProgram.methods
          .gatewayMint({ attestation: attestationBytes, signature })
          .accountsPartial({
            gatewayMinter: client.pdas.gatewayMinter.publicKey,
            destinationCaller: client.owner.publicKey,
            payer: client.owner.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts([])
          .signers([client.owner])
          .rpc(),
        "AttestationMagicMismatch"
      );
    });

    it("should fail when single attestation is shorter than the fixed header (192 bytes)", async () => {
      const attestation = generateDefaultAttestation();
      const attestationBytes = encodeMintAttestationSet(attestation);
      const tooShort = attestationBytes.slice(0, attestationBytes.length - 1);
      const signature = getValidSignature(tooShort);

      await expectAnchorError(
        client.gatewayMinterProgram.methods
          .gatewayMint({ attestation: tooShort, signature })
          .accountsPartial({
            gatewayMinter: client.pdas.gatewayMinter.publicKey,
            destinationCaller: client.owner.publicKey,
            payer: client.owner.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts(
            createGatewayMintRemainingAccounts(
              attestation,
              client.gatewayMinterProgram.programId
            )
          )
          .signers([client.owner])
          .rpc(),
        "AttestationTooShort"
      );
    });

    it("should fail when hook_data_length is overstated", async () => {
      const attestation = generateDefaultAttestation();
      attestation.attestations[0].hookData = Buffer.alloc(10);
      attestation.attestations[0].hookDataLength = 11; // Claims 11 but only has 10 bytes
      const attestationBytes = encodeMintAttestationSet(attestation);
      const signature = getValidSignature(attestationBytes);

      await expectAnchorError(
        client.gatewayMinterProgram.methods
          .gatewayMint({ attestation: attestationBytes, signature })
          .accountsPartial({
            gatewayMinter: client.pdas.gatewayMinter.publicKey,
            destinationCaller: client.owner.publicKey,
            payer: client.owner.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts(
            createGatewayMintRemainingAccounts(
              attestation,
              client.gatewayMinterProgram.programId
            )
          )
          .signers([client.owner])
          .rpc(),
        "AttestationTooShort"
      );
    });

    it("should fail when hook_data_length is understated", async () => {
      const attestation = generateDefaultAttestation();
      attestation.attestations[0].hookData = Buffer.alloc(10);
      attestation.attestations[0].hookDataLength = 0; // Claims 0 but has 10 bytes
      const attestationBytes = encodeMintAttestationSet(attestation);
      const signature = getValidSignature(attestationBytes);

      await expectAnchorError(
        client.gatewayMinterProgram.methods
          .gatewayMint({ attestation: attestationBytes, signature })
          .accountsPartial({
            gatewayMinter: client.pdas.gatewayMinter.publicKey,
            destinationCaller: client.owner.publicKey,
            payer: client.owner.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts(
            createGatewayMintRemainingAccounts(
              attestation,
              client.gatewayMinterProgram.programId
            )
          )
          .signers([client.owner])
          .rpc(),
        "AttestationTooLong"
      );
    });
  });

  describe("should parse mint attestation sets", () => {
    it("should fail when attestation set header is too short", async () => {
      const tooShort = Buffer.alloc(4);
      tooShort.writeUInt32BE(ATTESTATION_SET_MAGIC, 0);
      const signature = getValidSignature(tooShort);

      await expectAnchorError(
        client.gatewayMinterProgram.methods
          .gatewayMint({ attestation: tooShort, signature })
          .accountsPartial({
            gatewayMinter: client.pdas.gatewayMinter.publicKey,
            destinationCaller: client.owner.publicKey,
            payer: client.owner.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts([])
          .signers([client.owner])
          .rpc(),
        "AttestationTooShort"
      );
    });

    it("should fail when the number of attestations is zero", async () => {
      // This should contain a single valid attestation, to bypass the length check
      // but the stated number of attestations is zero, so it should fail
      const attestation = generateDefaultAttestation();
      attestation.numAttestations = 0;

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "EmptyAttestationSet"
      );
    });

    it("should fail when extra bytes follow the last attestation in a set", async () => {
      const attestation = generateDefaultAttestation();
      const setBytes = encodeMintAttestationSet(attestation);
      const extra = Buffer.concat([setBytes, Buffer.from([0x00])]);
      const signature = getValidSignature(extra);

      await expectAnchorError(
        client.gatewayMinterProgram.methods
          .gatewayMint({ attestation: extra, signature })
          .accountsPartial({
            gatewayMinter: client.pdas.gatewayMinter.publicKey,
            destinationCaller: client.owner.publicKey,
            payer: client.owner.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts(
            createGatewayMintRemainingAccounts(
              attestation,
              client.gatewayMinterProgram.programId
            )
          )
          .signers([client.owner])
          .rpc(),
        "AttestationTooLong"
      );
    });

    it("should fail when a set contains an malformed inner attestation", async () => {
      const attestation = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        attestations: [
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
            hookDataLength: 10000,
            hookData: Buffer.alloc(1), // Invalid hook data length
          }),
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
        ],
      });

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "AttestationTooShort"
      );
    });

    it("should fail when set header overstates the number of attestations present", async () => {
      const attestation = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        numAttestations: 2,
        attestations: [
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
        ],
      });

      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          // Add extra remaining accounts so that it matches the stated number of attestations * 3
          remainingAccounts: [...remainingAccounts, ...remainingAccounts],
        }),
        "AttestationTooShort"
      );
    });

    it("should fail when set header understates the number of attestations present", async () => {
      const attestation = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        numAttestations: 1,
        attestations: [
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
        ],
      });

      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          // Remove remaining accounts so that it matches the stated number of attestations * 3
          remainingAccounts: remainingAccounts.slice(0, 3),
        }),
        "AttestationTooLong"
      );
    });
  });

  describe("should transfer funds correctly", () => {
    it("should fail when custody account has insufficient balance", async () => {
      const custodyBalance = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      const transferAmount = Number(custodyBalance.amount) + 1;

      const attestation = generateDefaultAttestation();
      attestation.attestations[0].value = new anchor.BN(transferAmount);

      try {
        await client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        });
        expect.fail("Expected transaction to fail");
      } catch (error: unknown) {
        // This is a Solana runtime error (insufficient balance), not an Anchor custom error
        expect(error.toString()).to.include("insufficient");
      }
    });
  });

  describe("should validate account constraints", () => {
    it("should fail if token is not supported", async () => {
      // Create an unsupported token
      const unsupportedTokenMint = await client.createTokenMint(
        mintAuthority.publicKey,
        6
      );
      const wrongCustodyTokenAccount = await client.createTokenAccount(
        unsupportedTokenMint,
        Keypair.generate()
      );
      const attestation = generateDefaultAttestation();
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );
      remainingAccounts[0] = {
        pubkey: wrongCustodyTokenAccount,
        isWritable: true,
        isSigner: false,
      };

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "InvalidCustodyTokenAccount"
      );
    });

    it("should fail if wrong custody token account is provided", async () => {
      // Create a different token account with wrong seeds
      const wrongCustodyAccount = await client.createTokenAccount(
        tokenMint,
        Keypair.generate()
      );

      const attestation = generateDefaultAttestation();
      // Override the custody account (first account in the triplet)
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );
      remainingAccounts[0] = {
        pubkey: wrongCustodyAccount,
        isWritable: true,
        isSigner: false,
      };
      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "InvalidCustodyTokenAccount"
      );
    });

    it("should fail when custody account is system program owned", async () => {
      const attestation = generateDefaultAttestation();
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      // Create a system-owned account (funded but not a token account)
      const systemOwnedAccount = Keypair.generate();
      svm.airdrop(systemOwnedAccount.publicKey, BigInt(LAMPORTS_PER_SOL));

      remainingAccounts[0] = {
        pubkey: systemOwnedAccount.publicKey,
        isWritable: true,
        isSigner: false,
      };

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "InvalidCustodyTokenAccount"
      );
    });

    it("should fail when destination account is system program owned", async () => {
      const attestation = generateDefaultAttestation();
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      // Create a system-owned account (funded but not a token account)
      const systemOwnedAccount = Keypair.generate();
      svm.airdrop(systemOwnedAccount.publicKey, BigInt(LAMPORTS_PER_SOL));

      remainingAccounts[1] = {
        pubkey: systemOwnedAccount.publicKey,
        isWritable: true,
        isSigner: false,
      };

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "InvalidDestinationTokenAccount"
      );
    });

    it("should fail when custody account is a token mint instead of token account", async () => {
      const attestation = generateDefaultAttestation();
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      // Use a token mint (not a token account) as custody account
      remainingAccounts[0] = {
        pubkey: tokenMint,
        isWritable: true,
        isSigner: false,
      };

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "InvalidCustodyTokenAccount"
      );
    });

    it("should fail when destination account is a token mint instead of token account", async () => {
      const attestation = generateDefaultAttestation();
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      // Use a token mint (not a token account) as destination account
      remainingAccounts[1] = {
        pubkey: tokenMint,
        isWritable: true,
        isSigner: false,
      };

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "InvalidDestinationTokenAccount"
      );
    });

    it("should fail when custody account is uninitialized", async () => {
      const attestation = generateDefaultAttestation();
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      // Use an uninitialized account (no data, no lamports)
      const uninitializedAccount = Keypair.generate();

      remainingAccounts[0] = {
        pubkey: uninitializedAccount.publicKey,
        isWritable: true,
        isSigner: false,
      };

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "InvalidCustodyTokenAccount"
      );
    });

    it("should fail when destination account is uninitialized", async () => {
      const attestation = generateDefaultAttestation();
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );

      // Use an uninitialized account (no data, no lamports)
      const uninitializedAccount = Keypair.generate();

      remainingAccounts[1] = {
        pubkey: uninitializedAccount.publicKey,
        isWritable: true,
        isSigner: false,
      };

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "InvalidDestinationTokenAccount"
      );
    });
  });

  describe("used_transfer_spec_hash account funding", () => {
    const DISCRIMINATOR_SIZE = 2;
    const usedTransferSpecHashDiscriminator = Buffer.from([11, 1]); // UsedTransferSpecHash discriminator for Minter

    describe("when account doesn't exist", () => {
      it("should create account when it doesn't exist (lamports == 0)", async () => {
        const attestation = generateDefaultAttestation();
        const hashPDA = PublicKey.findProgramAddressSync(
          [
            Buffer.from("used_transfer_spec_hash"),
            attestation.attestations[0].transferSpecHash,
          ],
          client.gatewayMinterProgram.programId
        )[0];

        // Perform the mint
        await client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        });

        // Verify account was created with proper rent
        const accountInfo = await client.provider.connection.getAccountInfo(
          hashPDA
        );
        const rentExemptBalance =
          await client.provider.connection.getMinimumBalanceForRentExemption(
            DISCRIMINATOR_SIZE
          );
        expect(accountInfo!.lamports).to.equal(rentExemptBalance);
        expect(accountInfo!.owner.toBase58()).to.equal(
          client.gatewayMinterProgram.programId.toBase58()
        );
        expect(accountInfo!.data).to.deep.equal(
          usedTransferSpecHashDiscriminator
        );
      });
    });

    describe("when account exists", () => {
      describe("when account is system-owned", () => {
        it("should handle account with sufficient funds and space", async () => {
          const attestation = generateDefaultAttestation();
          const hashPDA = PublicKey.findProgramAddressSync(
            [
              Buffer.from("used_transfer_spec_hash"),
              attestation.attestations[0].transferSpecHash,
            ],
            client.gatewayMinterProgram.programId
          )[0];

          // Create a system-owned account with sufficient funds
          client.svm.airdrop(hashPDA, BigInt(LAMPORTS_PER_SOL));

          // Verify it's system-owned with sufficient funds
          let accountInfo = await client.provider.connection.getAccountInfo(
            hashPDA
          );
          expect(accountInfo).to.not.equal(null);
          expect(accountInfo!.owner.toBase58()).to.equal(
            SystemProgram.programId.toBase58()
          );
          expect(accountInfo!.lamports).to.equal(LAMPORTS_PER_SOL);
          expect(accountInfo!.data.length).to.equal(0);

          // Perform the mint
          await client.gatewayMint({
            attestation,
            signers: {
              attesterKey: validAttester.privateKey,
            },
          });

          // Verify account is now program-owned with same lamports (no top-up needed)
          accountInfo = await client.provider.connection.getAccountInfo(
            hashPDA
          );
          expect(accountInfo!.owner.toBase58()).to.equal(
            client.gatewayMinterProgram.programId.toBase58()
          );
          expect(accountInfo!.lamports).to.equal(LAMPORTS_PER_SOL);
          expect(accountInfo!.data.length).to.equal(DISCRIMINATOR_SIZE);
        });

        it("should handle account with insufficient funds", async () => {
          const attestation = generateDefaultAttestation();
          const hashPDA = PublicKey.findProgramAddressSync(
            [
              Buffer.from("used_transfer_spec_hash"),
              attestation.attestations[0].transferSpecHash,
            ],
            client.gatewayMinterProgram.programId
          )[0];
          const rentExemptBalance =
            await client.provider.connection.getMinimumBalanceForRentExemption(
              DISCRIMINATOR_SIZE
            );

          client.svm.airdrop(hashPDA, BigInt(rentExemptBalance - 100));

          // Verify initial state
          let accountInfo = await client.provider.connection.getAccountInfo(
            hashPDA
          );
          expect(accountInfo!.owner.toBase58()).to.equal(
            SystemProgram.programId.toBase58()
          );
          expect(accountInfo!.lamports).to.be.lessThan(rentExemptBalance);
          expect(accountInfo!.data.length).to.equal(0); // Size 0

          // Mint should: transfer (top-up) + allocate + assign
          await client.gatewayMint({
            attestation,
            signers: {
              attesterKey: validAttester.privateKey,
            },
          });

          // Verify final state
          accountInfo = await client.provider.connection.getAccountInfo(
            hashPDA
          );
          expect(accountInfo!.owner.toBase58()).to.equal(
            client.gatewayMinterProgram.programId.toBase58()
          );
          expect(accountInfo!.lamports).to.equal(rentExemptBalance);
          expect(accountInfo!.data).to.deep.equal(
            usedTransferSpecHashDiscriminator
          );
        });
      });

      describe("when account is program-owned", () => {
        it("should reject replay attempts when account has sufficient funds", async () => {
          const attestation = generateDefaultAttestation();
          const hashPDA = PublicKey.findProgramAddressSync(
            [
              Buffer.from("used_transfer_spec_hash"),
              attestation.attestations[0].transferSpecHash,
            ],
            client.gatewayMinterProgram.programId
          )[0];

          // First mint to create and fund the account
          await client.gatewayMint({
            attestation,
            signers: {
              attesterKey: validAttester.privateKey,
            },
          });

          // Record the lamports after first mint
          const accountInfoBefore =
            await client.provider.connection.getAccountInfo(hashPDA);
          expect(accountInfoBefore).to.not.equal(null);
          expect(accountInfoBefore!.owner.toBase58()).to.equal(
            client.gatewayMinterProgram.programId.toBase58()
          );
          expect(accountInfoBefore!.data).to.deep.equal(
            usedTransferSpecHashDiscriminator
          );

          const lamportsBefore = accountInfoBefore!.lamports;

          // Try to mint again with the same attestation - should fail
          await expectAnchorError(
            client.gatewayMint({
              attestation,
              signers: {
                attesterKey: validAttester.privateKey,
              },
            }),
            "TransferSpecHashAlreadyUsed"
          );

          // Verify lamports didn't change (no funding operations occurred)
          const accountInfoAfter =
            await client.provider.connection.getAccountInfo(hashPDA);
          expect(accountInfoAfter!.lamports).to.equal(lamportsBefore);
          expect(accountInfoAfter!.owner.toBase58()).to.equal(
            client.gatewayMinterProgram.programId.toBase58()
          );
          expect(accountInfoAfter!.data).to.deep.equal(
            usedTransferSpecHashDiscriminator
          );
        });
      });
    });
  });

  describe("should validate attestation parameters", () => {
    it("should fail if attestation destination recipient doesn't match destination token account", async () => {
      const attestation = generateDefaultAttestation();

      const wrongDestinationTokenAccount = await client.createTokenAccount(
        tokenMint,
        Keypair.generate()
      );
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );
      // Override the destination token account (second account in the triplet) with wrong mint
      remainingAccounts[1] = {
        pubkey: wrongDestinationTokenAccount,
        isWritable: true,
        isSigner: false,
      };

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "DestinationRecipientMismatch"
      );
    });

    it("should fail if destination account has wrong mint", async () => {
      // Create another token mint
      const wrongMint = await client.createTokenMint(
        mintAuthority.publicKey,
        6
      );

      // Create destination account for wrong mint
      const wrongDestination = await client.createTokenAccount(
        wrongMint,
        Keypair.generate()
      );

      const attestation = generateDefaultAttestation();
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );
      // Override the destination token account (second account in the triplet) with wrong mint
      remainingAccounts[1] = {
        pubkey: wrongDestination,
        isWritable: true,
        isSigner: false,
      };
      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "DestinationTokenMismatch"
      );
    });

    it("should fail if custody token account has wrong mint", async () => {
      // Create another token mint
      const { pda: wrongCustodyTokenAccount } = await createSupportedToken();
      const attestation = generateDefaultAttestation();
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );
      // Override the custody token account (first account in the triplet) with wrong mint
      remainingAccounts[0] = {
        pubkey: wrongCustodyTokenAccount,
        isWritable: true,
        isSigner: false,
      };
      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "DestinationTokenMismatch"
      );
    });

    it("should reject zero value transfer", async () => {
      const attestation = generateDefaultAttestation();
      attestation.attestations[0].value = new anchor.BN(0);
      attestation.maxBlockHeight = new anchor.BN(20000);

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "InvalidAttestationValue"
      );
    });

    it("should reject zero value in attestation set", async () => {
      const attestation = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        attestations: [
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
            value: new anchor.BN(0),
            transferSpecHash: Buffer.alloc(32, 2), // Different hash
          }),
        ],
      });

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "InvalidAttestationValue"
      );
    });
  });

  describe("used_transfer_spec_hash validation", () => {
    it("should fail with InvalidTransferSpecHashAccount error when wrong PDA is provided", async () => {
      const attestation = generateDefaultAttestation();
      // Create a wrong PDA with different seeds
      const [wrongPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("wrong_seed"),
          attestation.attestations[0].transferSpecHash,
        ],
        client.gatewayMinterProgram.programId
      );
      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );
      remainingAccounts[2] = {
        pubkey: wrongPDA,
        isWritable: true,
        isSigner: false,
      };

      // Manually call with wrong PDA
      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "InvalidTransferSpecHashAccount"
      );
    });

    it("should fail when providing non-PDA account as transfer spec hash account", async () => {
      const attestation = generateDefaultAttestation();

      // Use a random keypair instead of the correct PDA
      const wrongAccount = Keypair.generate();

      const remainingAccounts = createGatewayMintRemainingAccounts(
        attestation,
        client.gatewayMinterProgram.programId
      );
      remainingAccounts[2] = {
        pubkey: wrongAccount.publicKey,
        isWritable: true,
        isSigner: false,
      };
      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
          remainingAccounts,
        }),
        "InvalidTransferSpecHashAccount"
      );
    });

    it("should fail if trying to replay one attestation from a set", async () => {
      const attestationSet = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        attestations: [
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
          }),
        ],
      });

      // First mint the set - should succeed
      await client.gatewayMint({
        attestation: attestationSet,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      // Now try to mint just the second attestation individually
      const singleAttestation = generateDefaultAttestation();
      singleAttestation.attestations[0].transferSpecHash =
        attestationSet.attestations[1].transferSpecHash;

      // Should fail because attestation2's hash was already used
      await expectAnchorError(
        client.gatewayMint({
          attestation: singleAttestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "TransferSpecHashAlreadyUsed"
      );
    });

    it("should handle concurrent minting attempts with same attestation", async () => {
      // Get the owner of the destination token account
      const destTokenAccountInfo = await client.getTokenAccount(
        destinationTokenAccount
      );

      const attestation = generateDefaultAttestation();
      attestation.attestations[0].destinationRecipient =
        destTokenAccountInfo.owner;

      // First mint should succeed
      await client.gatewayMint({
        attestation,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      // Second mint with same attestation should fail with TransferSpecHashAlreadyUsed
      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "TransferSpecHashAlreadyUsed"
      );

      // Verify only one mint succeeded
      const balance = await client.getTokenAccount(destinationTokenAccount);
      expect(Number(balance.amount)).to.equal(100000000);
    });

    it("should correctly handle attestation set with duplicate transfer spec hashes", async () => {
      // Create two attestations with identical parameters
      const attestation = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        attestations: [
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
            hookData: Buffer.alloc(0),
            hookDataLength: 0,
          }),
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
            hookData: Buffer.alloc(0),
            hookDataLength: 0,
          }),
        ],
      });

      // Manually set the same transfer spec hash for both
      const sharedHash = attestation.attestations[0].transferSpecHash;
      attestation.attestations[1].transferSpecHash = sharedHash;

      // Verify they have the same hash
      expect(attestation.attestations[0].transferSpecHash).to.deep.equal(
        attestation.attestations[1].transferSpecHash
      );

      // Should fail on the second attestation since it has the same hash
      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "TransferSpecHashAlreadyUsed"
      );
    });
  });

  describe("pause contract enforcement", () => {
    it("should fail gateway mint when contract is paused", async () => {
      await client.gatewayMinterProgram.methods
        .pause()
        .accountsPartial({
          pauser: client.owner.publicKey,
          gatewayMinter: client.pdas.gatewayMinter.publicKey,
        })
        .signers([client.owner])
        .rpc();

      const gatewayMinterState =
        await client.gatewayMinterProgram.account.gatewayMinter.fetch(
          client.pdas.gatewayMinter.publicKey
        );
      expect(gatewayMinterState.paused).to.equal(true);

      const attestation = generateDefaultAttestation();

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "ProgramPaused"
      );
    });
  });
});
