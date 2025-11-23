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

import { expect } from "chai";
import { LiteSVM } from "litesvm";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Clock } from "litesvm";
import * as anchor from "@coral-xyz/anchor";
import { GatewayWalletTestClient } from "../gateway-wallet/test_client";
import { GatewayMinterTestClient } from "../gateway-minter/test_client";
import {
  generateSignerKeypair,
  createSignedBurnIntent,
  createGatewayBurnRemainingAccounts,
  findPDA,
} from "../utils";
import {
  generateMintAttestationSet,
  generateMintAttestationElement,
} from "../attestation";
import { SOLANA_DOMAIN } from "../constants";
import { BurnIntent } from "../burn_intent";

const DEPOSIT_AMOUNT = 1_000_000_000; // 1,000 tokens
const MINT_AMOUNT = 300_000_000; // 300 tokens
const FEE_AMOUNT = 3_000_000; // 3 tokens

describe("Multi Deposit And Mint Flow", () => {
  let svm: LiteSVM;
  let walletClient: GatewayWalletTestClient;
  let minterClient: GatewayMinterTestClient;
  let tokenMint: PublicKey;
  let mintAuthority: Keypair;
  let depositor: Keypair;
  let recipient: Keypair;
  let feeRecipient: Keypair;
  let attestationSigner: ReturnType<typeof generateSignerKeypair>;
  let burnSigner: ReturnType<typeof generateSignerKeypair>;

  // Default valid mint attestation
  const generateDefaultAttestation = (recipientTokenAccount: PublicKey) =>
    generateMintAttestationSet({
      destinationCaller: PublicKey.default,
      destinationContract: minterClient.gatewayMinterProgram.programId,
      attestations: [
        generateMintAttestationElement({
          destinationToken: tokenMint,
          destinationRecipient: recipientTokenAccount,
          value: new anchor.BN(MINT_AMOUNT),
        }),
      ],
    });

  beforeEach(async () => {
    svm = new LiteSVM();
    walletClient = new GatewayWalletTestClient(svm);
    minterClient = new GatewayMinterTestClient(svm);

    const clock = new Clock(
      BigInt(10000),
      BigInt(0),
      BigInt(0),
      BigInt(0),
      BigInt(Math.floor(Date.now() / 1000))
    );
    svm.setClock(clock);

    depositor = Keypair.generate();
    recipient = Keypair.generate();
    feeRecipient = Keypair.generate();
    mintAuthority = Keypair.generate();

    await walletClient.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    await walletClient.updateFeeRecipient({
      newFeeRecipient: feeRecipient.publicKey,
    });
    await minterClient.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    svm.airdrop(depositor.publicKey, BigInt(LAMPORTS_PER_SOL * 10));
    svm.airdrop(recipient.publicKey, BigInt(LAMPORTS_PER_SOL * 10));
    svm.airdrop(feeRecipient.publicKey, BigInt(LAMPORTS_PER_SOL * 10));
    svm.airdrop(mintAuthority.publicKey, BigInt(LAMPORTS_PER_SOL));

    tokenMint = await walletClient.createTokenMint(mintAuthority.publicKey, 6);
    await walletClient.addToken({ tokenMint });
    await minterClient.addToken({ tokenMint });

    attestationSigner = generateSignerKeypair();
    await minterClient.addAttester({
      attester: attestationSigner.publicKey,
    });

    burnSigner = generateSignerKeypair();
    await walletClient.addBurnSigner({ signer: burnSigner.publicKey });

    const custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_minter_custody"), tokenMint.toBuffer()],
      minterClient.gatewayMinterProgram.programId
    );
    await minterClient.mintToken(
      tokenMint,
      custodyTokenAccountPDA.publicKey,
      3000000000, // 3000 tokens
      mintAuthority
    );
  });

  it("should handle multiple deposits and aggregate mint", async () => {
    const depositor1 = Keypair.generate();
    const depositor2 = Keypair.generate();
    const depositor3 = Keypair.generate();

    svm.airdrop(depositor1.publicKey, BigInt(LAMPORTS_PER_SOL * 10));
    svm.airdrop(depositor2.publicKey, BigInt(LAMPORTS_PER_SOL * 10));
    svm.airdrop(depositor3.publicKey, BigInt(LAMPORTS_PER_SOL * 10));

    const depositors = [depositor1, depositor2, depositor3];
    const tokenAccounts: PublicKey[] = [];
    const burnIntents: BurnIntent[] = [];
    const burnIntentBytes: Buffer[] = [];
    const burnSignatures: Buffer[] = [];

    for (let i = 0; i < depositors.length; i++) {
      const depositorAccount = await walletClient.createTokenAccount(
        tokenMint,
        depositors[i].publicKey
      );
      tokenAccounts.push(depositorAccount);

      await walletClient.mintToken(
        tokenMint,
        depositorAccount,
        DEPOSIT_AMOUNT,
        mintAuthority
      );

      await walletClient.deposit(
        {
          tokenMint,
          amount: DEPOSIT_AMOUNT,
          fromTokenAccount: depositorAccount,
        },
        { owner: depositors[i] }
      );
    }

    const destinationAccount = Keypair.generate();
    const recipientTokenAccount = await minterClient.createTokenAccount(
      tokenMint,
      destinationAccount
    );

    for (let i = 0; i < depositors.length; i++) {
      const {
        intent: burnIntent,
        bytes: burnIntentBytesItem,
        signature: burnSignature,
      } = createSignedBurnIntent({
        signer: depositors[i],
        transferSpecOverrides: {
          sourceContract: walletClient.gatewayWalletProgram.programId,
          sourceToken: tokenMint,
          sourceDepositor: depositors[i].publicKey,
          sourceSigner: depositors[i].publicKey,
          value: BigInt(MINT_AMOUNT),
        },
        burnIntentOverrides: {
          maxFee: BigInt(FEE_AMOUNT),
        },
      });

      burnIntents.push(burnIntent);
      burnIntentBytes.push(burnIntentBytesItem);
      burnSignatures.push(burnSignature);
    }

    const attestations = burnIntents.map((_, index) => {
      const attestation = generateDefaultAttestation(recipientTokenAccount);
      attestation.attestations[0].transferSpecHash = Buffer.alloc(
        32,
        index + 1
      );
      return attestation;
    });

    let totalMinted = 0;

    for (const attestation of attestations) {
      await minterClient.gatewayMint({
        attestation,
        signers: {
          attesterKey: attestationSigner.privateKey,
        },
      });

      totalMinted += MINT_AMOUNT;
    }

    const recipientBalance = await minterClient.getTokenAccount(
      recipientTokenAccount
    );
    expect(Number(recipientBalance.amount)).to.equal(totalMinted);

    const feeRecipientTokenAccount =
      await walletClient.createAssociatedTokenAccount(
        tokenMint,
        feeRecipient.publicKey
      );

    for (let i = 0; i < depositors.length; i++) {
      const custodyTokenAccount = findPDA(
        [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
        walletClient.gatewayWalletProgram.programId
      ).publicKey;
      const depositPDA = walletClient.getDepositPDA(
        tokenMint,
        depositors[i].publicKey
      );

      await walletClient.gatewayBurn(
        {
          burnIntent: burnIntentBytes[i],
          fee: FEE_AMOUNT,
          userSignature: burnSignatures[i],
          tokenMint,
          custodyTokenAccount,
          feeRecipientTokenAccount,
          deposit: depositPDA.publicKey,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntents[i]],
            walletClient.gatewayWalletProgram.programId
          ),
        },
        burnSigner
      );
    }

    const totalFeeBalance = await walletClient.getTokenAccount(
      feeRecipientTokenAccount
    );
    expect(Number(totalFeeBalance.amount)).to.equal(FEE_AMOUNT * 3);
  });

  it("should handle single deposit and multiple mints", async () => {
    const depositorTokenAccount = await walletClient.createTokenAccount(
      tokenMint,
      depositor.publicKey
    );
    await walletClient.mintToken(
      tokenMint,
      depositorTokenAccount,
      DEPOSIT_AMOUNT,
      mintAuthority
    );

    await walletClient.deposit(
      {
        tokenMint,
        amount: DEPOSIT_AMOUNT,
        fromTokenAccount: depositorTokenAccount,
      },
      { owner: depositor }
    );

    const recipient1 = Keypair.generate();
    const recipient2 = Keypair.generate();
    const recipient3 = Keypair.generate();

    svm.airdrop(recipient1.publicKey, BigInt(LAMPORTS_PER_SOL * 10));
    svm.airdrop(recipient2.publicKey, BigInt(LAMPORTS_PER_SOL * 10));
    svm.airdrop(recipient3.publicKey, BigInt(LAMPORTS_PER_SOL * 10));

    const recipients = [recipient1, recipient2, recipient3];
    const recipientAccounts: PublicKey[] = [];

    for (let i = 0; i < recipients.length; i++) {
      const destinationAccount = Keypair.generate();
      const recipientAccount = await minterClient.createTokenAccount(
        tokenMint,
        destinationAccount
      );
      recipientAccounts.push(recipientAccount);
    }

    for (let i = 0; i < recipients.length; i++) {
      const attestation = generateDefaultAttestation(recipientAccounts[i]);
      attestation.attestations[0].transferSpecHash = Buffer.alloc(32, i + 10);

      await minterClient.gatewayMint({
        attestation,
        signers: {
          attesterKey: attestationSigner.privateKey,
        },
      });

      const recipientBalance = await minterClient.getTokenAccount(
        recipientAccounts[i]
      );
      expect(Number(recipientBalance.amount)).to.equal(MINT_AMOUNT);
    }

    const feeRecipientTokenAccount =
      await walletClient.createAssociatedTokenAccount(
        tokenMint,
        feeRecipient.publicKey
      );

    const {
      intent: totalBurnIntent,
      bytes: totalBurnIntentBytes,
      signature: totalBurnSignature,
    } = createSignedBurnIntent({
      signer: depositor,
      transferSpecOverrides: {
        sourceContract: walletClient.gatewayWalletProgram.programId,
        sourceToken: tokenMint,
        sourceDepositor: depositor.publicKey,
        sourceSigner: depositor.publicKey,
        value: BigInt(MINT_AMOUNT * 3),
      },
      burnIntentOverrides: {
        maxFee: BigInt(FEE_AMOUNT * 3),
      },
    });

    const custodyTokenAccount = findPDA(
      [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
      walletClient.gatewayWalletProgram.programId
    ).publicKey;
    const depositPDA = walletClient.getDepositPDA(
      tokenMint,
      depositor.publicKey
    );

    await walletClient.gatewayBurn(
      {
        burnIntent: totalBurnIntentBytes,
        fee: FEE_AMOUNT * 3,
        userSignature: totalBurnSignature,
        tokenMint,
        custodyTokenAccount,
        feeRecipientTokenAccount,
        deposit: depositPDA.publicKey,
        remainingAccounts: createGatewayBurnRemainingAccounts(
          [totalBurnIntent],
          walletClient.gatewayWalletProgram.programId
        ),
      },
      burnSigner
    );

    const depositState =
      await walletClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    const expectedBalance = DEPOSIT_AMOUNT - MINT_AMOUNT * 3 - FEE_AMOUNT * 3;
    expect(Number(depositState.availableAmount)).to.equal(expectedBalance);

    const feeBalance = await walletClient.getTokenAccount(
      feeRecipientTokenAccount
    );
    expect(Number(feeBalance.amount)).to.equal(FEE_AMOUNT * 3);
  });
});
