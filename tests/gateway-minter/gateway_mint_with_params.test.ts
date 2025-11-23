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
  generateMintAttestationElement,
  generateMintAttestationSet,
  encodeMintAttestationSet,
} from "../attestation";
import {
  expectAnchorError,
  findPDA,
  generateSignerKeypair,
  getEvents,
  EvmKeypair,
  createMalformedSignature,
  signAttestation,
  createGatewayMintRemainingAccounts,
  createAddressLookupTable,
  expectAttestationUsedToEqual,
} from "../utils";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";

describe("gatewayMintWithParams", () => {
  let svm: LiteSVM;
  let client: GatewayMinterTestClient;
  let tokenMint: PublicKey;
  let mintAuthority: Keypair;
  let destinationTokenAccount: PublicKey;
  let destinationOwner: Keypair;
  let custodyTokenAccountPDA: PublicKey;

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
        }),
      ],
    });

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

  beforeEach(async () => {
    svm = new LiteSVM();

    // Set clock to slot 10000 to ensure attestations don't expire by default
    setClockToSlot(10000);

    client = new GatewayMinterTestClient(svm);
    await client.initialize({ localDomain: SOLANA_DOMAIN });

    validAttester = generateSignerKeypair();
    invalidAttester = generateSignerKeypair();

    await client.addAttester({ attester: validAttester.publicKey });

    mintAuthority = Keypair.generate();
    tokenMint = await client.createTokenMint(mintAuthority.publicKey, 6);

    await client.addToken({ tokenMint });

    custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_minter_custody"), tokenMint.toBuffer()],
      client.gatewayMinterProgram.programId
    ).publicKey;

    await client.mintToken(
      tokenMint,
      custodyTokenAccountPDA,
      1000000000, // 1000 tokens
      mintAuthority
    );

    destinationOwner = Keypair.generate();
    destinationTokenAccount = await client.createTokenAccount(
      tokenMint,
      destinationOwner
    );
  });

  describe("happy path", () => {
    it("should successfully mint single attestation with default destination caller", async () => {
      const attestation = generateDefaultAttestation();
      attestation.destinationCaller = PublicKey.default;
      attestation.attestations[0].value = new anchor.BN(100000000);

      const tx = await client.gatewayMint({
        attestation,
        withParams: true,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      const balance = await client.getTokenAccount(destinationTokenAccount);
      expect(Number(balance.amount)).to.equal(100000000);

      const events = getEvents(client.svm, tx, client.gatewayMinterProgram);
      expectAttestationUsedToEqual(events, attestation.attestations);
    });

    it("should successfully mint single element with specific destination caller", async () => {
      const attestation = generateDefaultAttestation();
      attestation.attestations[0].value = new anchor.BN(50000000);

      const tx = await client.gatewayMint({
        attestation,
        withParams: true,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      const balance = await client.getTokenAccount(destinationTokenAccount);
      expect(Number(balance.amount)).to.equal(50000000);
      const events = getEvents(client.svm, tx, client.gatewayMinterProgram);
      expectAttestationUsedToEqual(events, attestation.attestations);
    });

    it("should successfully mint multiple elements", async () => {
      const attestation = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        attestations: [
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
            value: new anchor.BN(30000000),
          }),
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
            value: new anchor.BN(20000000),
          }),
        ],
      });

      const tx = await client.gatewayMint({
        attestation,
        withParams: true,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      const balance = await client.getTokenAccount(destinationTokenAccount);
      expect(Number(balance.amount)).to.equal(50000000);

      const events = getEvents(client.svm, tx, client.gatewayMinterProgram);
      expectAttestationUsedToEqual(events, attestation.attestations);
    });

    it("should successfully mint 10 attestations", async () => {
      const attestationElements = [];
      const expectedValues = [];

      // Create 10 attestation elements with varying amounts
      for (let i = 0; i < 10; i++) {
        const value = (i + 1) * 10000000; // 10M, 20M, 30M, ..., 100M
        expectedValues.push(value);
        attestationElements.push(
          generateMintAttestationElement({
            destinationToken: tokenMint,
            destinationRecipient: destinationTokenAccount,
            value: new anchor.BN(value),
            hookData: Buffer.alloc(0),
            hookDataLength: 0,
          })
        );
      }

      const attestation = generateMintAttestationSet({
        destinationCaller: client.owner.publicKey,
        destinationContract: client.gatewayMinterProgram.programId,
        attestations: attestationElements,
      });

      // Create a lookup table
      const lowCardinalityAccounts = [
        client.pdas.gatewayMinter.publicKey, // gateway_minter PDA
        custodyTokenAccountPDA, // custody_token_account for this mint
        destinationTokenAccount, // destination token account
        SystemProgram.programId, // system_program
        TOKEN_PROGRAM_ID, // token_program
      ];

      const lookupTable = await createAddressLookupTable(
        svm,
        client.owner,
        lowCardinalityAccounts
      );

      // Advance slot (ALT addresses can't be used in the same slot they were added)
      const currentSlot = Number(svm.getClock().slot);
      setClockToSlot(currentSlot + 1);

      const tx = await client.gatewayMint({
        attestation,
        withParams: true,
        signers: {
          attesterKey: validAttester.privateKey,
        },
        accounts: {
          lookupTable,
        },
      });

      // Verify total balance (sum of 10M + 20M + ... + 100M = 550M)
      const expectedTotal = expectedValues.reduce((sum, val) => sum + val, 0);
      const balance = await client.getTokenAccount(destinationTokenAccount);
      expect(Number(balance.amount)).to.equal(expectedTotal);

      // Verify all 10 events were emitted with correct values
      const events = getEvents(client.svm, tx, client.gatewayMinterProgram);
      expectAttestationUsedToEqual(events, attestation.attestations);
    });

    it("should succeed with empty hook data", async () => {
      const attestation = generateDefaultAttestation();
      attestation.attestations[0].value = new anchor.BN(100000000);
      attestation.attestations[0].hookData = Buffer.alloc(0);
      attestation.attestations[0].hookDataLength = 0;

      await client.gatewayMint({
        attestation,
        withParams: true,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      const balance = await client.getTokenAccount(destinationTokenAccount);
      expect(Number(balance.amount)).to.equal(100000000);
    });

    it("should succeed with large hook data within limits", async () => {
      const attestation = generateDefaultAttestation();
      attestation.attestations[0].value = new anchor.BN(100000000);
      attestation.attestations[0].hookData = Buffer.alloc(500, 42);
      attestation.attestations[0].hookDataLength = 500;

      await client.gatewayMint({
        attestation,
        withParams: true,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      const balance = await client.getTokenAccount(destinationTokenAccount);
      expect(Number(balance.amount)).to.equal(100000000);
    });
  });

  describe("parameters validation", () => {
    it("should reject empty elements array", async () => {
      const attestation = generateDefaultAttestation();
      attestation.attestations = [];
      attestation.numAttestations = 0;

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          withParams: true,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "EmptyAttestationSet"
      );
    });

    it("should reject zero value transfers", async () => {
      const attestation = generateDefaultAttestation();
      attestation.attestations[0].value = new anchor.BN(0);

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          withParams: true,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "InvalidAttestationValue"
      );
    });

    it("should reject expired attestation", async () => {
      // Set current time to after expiry
      setClockToSlot(15000);

      const attestation = generateDefaultAttestation();
      attestation.maxBlockHeight = new anchor.BN(10000); // Expired at slot 10000 (past)

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          withParams: true,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "AttestationExpired"
      );
    });
  });

  describe("signature verification", () => {
    it("should reject signature from non-enabled attester", async () => {
      const attestation = generateDefaultAttestation();

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          withParams: true,
          signers: {
            attesterKey: invalidAttester.privateKey,
          },
        }),
        "InvalidAttesterSignature"
      );
    });

    it("should reject malformed signature", async () => {
      const attestation = generateDefaultAttestation();
      const signature = signAttestation(
        encodeMintAttestationSet(attestation),
        validAttester.privateKey
      );

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          withParams: true,
          signature: createMalformedSignature(signature, "short"),
        }),
        "InvalidAttesterSignature"
      );
    });

    it("should reject signature mismatch for reconstructed bytes", async () => {
      const attestation = generateDefaultAttestation();

      const differentAttestation = generateDefaultAttestation();
      differentAttestation.attestations[0].value = new anchor.BN(200000000); // Different value

      // Sign the different attestation but use it with the original
      const differentBytes = encodeMintAttestationSet(differentAttestation);
      const wrongSignature = signAttestation(
        differentBytes,
        validAttester.privateKey
      );

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          withParams: true,
          signature: wrongSignature,
        }),
        "InvalidAttesterSignature"
      );
    });
  });

  describe("destination caller authorization", () => {
    it("should allow any caller with zero destination caller", async () => {
      const unauthorizedCaller = Keypair.generate();

      svm.airdrop(
        unauthorizedCaller.publicKey,
        BigInt(anchor.web3.LAMPORTS_PER_SOL)
      );

      const attestation = generateDefaultAttestation();
      attestation.destinationCaller = PublicKey.default;
      attestation.attestations[0].value = new anchor.BN(100000000);

      await client.gatewayMint({
        attestation,
        withParams: true,
        signers: {
          attesterKey: validAttester.privateKey,
          destinationCaller: unauthorizedCaller,
        },
      });

      const balance = await client.getTokenAccount(destinationTokenAccount);
      expect(Number(balance.amount)).to.equal(100000000);
    });

    it("should reject unauthorized caller with specific destination caller", async () => {
      const unauthorizedCaller = Keypair.generate();
      svm.airdrop(
        unauthorizedCaller.publicKey,
        BigInt(anchor.web3.LAMPORTS_PER_SOL)
      );

      const attestation = generateDefaultAttestation();
      attestation.attestations[0].value = new anchor.BN(100000000);

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          withParams: true,
          signers: {
            attesterKey: validAttester.privateKey,
            destinationCaller: unauthorizedCaller,
          },
        }),
        "InvalidAttesterSignature"
      );

      await client.gatewayMint({
        attestation,
        withParams: true,
        signers: {
          attesterKey: validAttester.privateKey,
          destinationCaller: client.owner,
        },
      });

      const balance = await client.getTokenAccount(destinationTokenAccount);
      expect(Number(balance.amount)).to.equal(100000000);
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
          withParams: true,
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
          withParams: true,
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
          withParams: true,
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

  describe("contract state validation", () => {
    it("should reject when contract is paused", async () => {
      await client.gatewayMinterProgram.methods
        .pause()
        .accountsPartial({
          pauser: client.owner.publicKey,
          gatewayMinter: client.pdas.gatewayMinter.publicKey,
        })
        .signers([client.owner])
        .rpc();

      const attestation = generateDefaultAttestation();

      await expectAnchorError(
        client.gatewayMint({
          attestation,
          withParams: true,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        }),
        "ProgramPaused"
      );
    });

    it("should succeed after contract is unpaused", async () => {
      await client.gatewayMinterProgram.methods
        .pause()
        .accountsPartial({
          pauser: client.owner.publicKey,
          gatewayMinter: client.pdas.gatewayMinter.publicKey,
        })
        .signers([client.owner])
        .rpc();

      await client.gatewayMinterProgram.methods
        .unpause()
        .accountsPartial({
          pauser: client.owner.publicKey,
          gatewayMinter: client.pdas.gatewayMinter.publicKey,
        })
        .signers([client.owner])
        .rpc();

      const attestation = generateDefaultAttestation();
      attestation.attestations[0].value = new anchor.BN(100000000);

      await client.gatewayMint({
        attestation,
        withParams: true,
        signers: {
          attesterKey: validAttester.privateKey,
        },
      });

      const balance = await client.getTokenAccount(destinationTokenAccount);
      expect(Number(balance.amount)).to.equal(100000000);
    });

    it("should fail with insufficient custody balance", async () => {
      const custodyBalance = await client.getTokenAccount(
        custodyTokenAccountPDA
      );
      const burnAmount = Number(custodyBalance.amount) - 50000000; // Leave only 50 tokens

      await client.gatewayMinterProgram.methods
        .burnTokenCustody(new anchor.BN(burnAmount))
        .accountsPartial({
          tokenController: client.owner.publicKey,
          gatewayMinter: client.pdas.gatewayMinter.publicKey,
          tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([client.owner])
        .rpc();

      const attestation = generateDefaultAttestation();
      attestation.attestations[0].value = new anchor.BN(100000000); // Try to mint 100 tokens (more than available)

      try {
        await client.gatewayMint({
          attestation,
          withParams: true,
          signers: {
            attesterKey: validAttester.privateKey,
          },
        });
        throw new Error("Expected transaction to fail");
      } catch (err) {
        expect(err.toString()).to.include("insufficient funds");
      }
    });
  });
});
