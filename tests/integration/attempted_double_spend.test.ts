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
  expectAnchorError,
} from "../utils";
import {
  generateMintAttestationSet,
  generateMintAttestationElement,
} from "../attestation";
import { SOLANA_DOMAIN } from "../constants";

const DEPOSIT_AMOUNT = 1_000_000_000; // 1,000 tokens
const MINT_AMOUNT = 600_000_000; // 600 tokens
const FEE_AMOUNT = 6_000_000; // 6 tokens
const WITHDRAW_DELAY = 1000; // slots

describe("Attempted Double Spend", () => {
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
      2000000000, // 2000 tokens
      mintAuthority
    );
  });

  it("should allow withdrawing remaining balance after partial burn", async () => {
    const depositorTokenAccount = await walletClient.createTokenAccount(
      tokenMint,
      depositor.publicKey
    );
    const destinationAccount = Keypair.generate();
    const recipientTokenAccount = await minterClient.createTokenAccount(
      tokenMint,
      destinationAccount
    );
    const feeRecipientTokenAccount =
      await walletClient.createAssociatedTokenAccount(
        tokenMint,
        feeRecipient.publicKey
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

    const depositPDA = walletClient.getDepositPDA(
      tokenMint,
      depositor.publicKey
    );
    let depositState =
      await walletClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    expect(Number(depositState.availableAmount)).to.equal(DEPOSIT_AMOUNT);

    const blockHeightWhenInitiatingWithdrawal = 10000;

    await walletClient.initiateWithdrawal(
      {
        tokenMint,
        amount: DEPOSIT_AMOUNT,
      },
      depositor
    );

    depositState =
      await walletClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    expect(Number(depositState.availableAmount)).to.equal(0);
    expect(Number(depositState.withdrawingAmount)).to.equal(DEPOSIT_AMOUNT);
    expect(Number(depositState.withdrawalBlock)).to.be.greaterThan(0);

    const {
      intent: burnIntent,
      bytes: burnIntentBytes,
      signature: burnSignature,
    } = createSignedBurnIntent({
      signer: depositor,
      transferSpecOverrides: {
        sourceContract: walletClient.gatewayWalletProgram.programId,
        sourceToken: tokenMint,
        sourceDepositor: depositor.publicKey,
        sourceSigner: depositor.publicKey,
        value: BigInt(MINT_AMOUNT),
      },
      burnIntentOverrides: {
        maxFee: BigInt(FEE_AMOUNT),
      },
    });

    const attestation = generateDefaultAttestation(recipientTokenAccount);
    attestation.attestations[0].transferSpecHash = Buffer.alloc(32, 1);

    await minterClient.gatewayMint({
      attestation,
      signers: {
        attesterKey: attestationSigner.privateKey,
      },
    });

    const recipientBalance = await minterClient.getTokenAccount(
      recipientTokenAccount
    );
    expect(Number(recipientBalance.amount)).to.equal(MINT_AMOUNT);

    const custodyTokenAccount = findPDA(
      [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
      walletClient.gatewayWalletProgram.programId
    ).publicKey;
    const burnDepositPDA = walletClient.getDepositPDA(
      tokenMint,
      depositor.publicKey
    );

    await walletClient.gatewayBurn(
      {
        burnIntent: burnIntentBytes,
        fee: FEE_AMOUNT,
        userSignature: burnSignature,
        tokenMint,
        custodyTokenAccount,
        feeRecipientTokenAccount,
        deposit: burnDepositPDA.publicKey,
        remainingAccounts: createGatewayBurnRemainingAccounts(
          [burnIntent],
          walletClient.gatewayWalletProgram.programId
        ),
      },
      burnSigner
    );

    const expectedRemainingBalance = DEPOSIT_AMOUNT - MINT_AMOUNT - FEE_AMOUNT;

    depositState =
      await walletClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    expect(Number(depositState.availableAmount)).to.equal(0);
    expect(Number(depositState.withdrawingAmount)).to.equal(
      expectedRemainingBalance
    );

    const targetSlot =
      blockHeightWhenInitiatingWithdrawal + WITHDRAW_DELAY + 100;

    const clock = new Clock(
      BigInt(targetSlot),
      BigInt(0),
      BigInt(0),
      BigInt(0),
      BigInt(Math.floor(Date.now() / 1000))
    );
    svm.setClock(clock);

    await walletClient.withdraw(
      {
        tokenMint,
        toTokenAccount: depositorTokenAccount,
      },
      depositor
    );

    const finalDepositorBalance = await walletClient.getTokenAccount(
      depositorTokenAccount
    );
    expect(Number(finalDepositorBalance.amount)).to.equal(
      expectedRemainingBalance
    );

    const finalDepositState =
      await walletClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    expect(Number(finalDepositState.availableAmount)).to.equal(0);
    expect(Number(finalDepositState.withdrawingAmount)).to.equal(0);

    const finalRecipientBalance = await minterClient.getTokenAccount(
      recipientTokenAccount
    );
    expect(Number(finalRecipientBalance.amount)).to.equal(MINT_AMOUNT);
  });

  it("should prevent actual double spending attempts", async () => {
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

    const {
      intent: burnIntent1,
      bytes: burnIntentBytes1,
      signature: burnSignature1,
    } = createSignedBurnIntent({
      signer: depositor,
      transferSpecOverrides: {
        sourceContract: walletClient.gatewayWalletProgram.programId,
        sourceToken: tokenMint,
        sourceDepositor: depositor.publicKey,
        sourceSigner: depositor.publicKey,
        value: BigInt(MINT_AMOUNT),
      },
      burnIntentOverrides: {
        maxFee: BigInt(FEE_AMOUNT),
      },
    });

    const {
      intent: burnIntent2,
      bytes: burnIntentBytes2,
      signature: burnSignature2,
    } = createSignedBurnIntent({
      signer: depositor,
      transferSpecOverrides: {
        sourceContract: walletClient.gatewayWalletProgram.programId,
        sourceToken: tokenMint,
        sourceDepositor: depositor.publicKey,
        sourceSigner: depositor.publicKey,
        value: BigInt(MINT_AMOUNT),
      },
      burnIntentOverrides: {
        maxFee: BigInt(FEE_AMOUNT),
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
    const feeRecipientTokenAccount =
      await walletClient.createAssociatedTokenAccount(
        tokenMint,
        feeRecipient.publicKey
      );

    await walletClient.gatewayBurn(
      {
        burnIntent: burnIntentBytes1,
        fee: FEE_AMOUNT,
        userSignature: burnSignature1,
        tokenMint,
        custodyTokenAccount,
        feeRecipientTokenAccount,
        deposit: depositPDA.publicKey,
        remainingAccounts: createGatewayBurnRemainingAccounts(
          [burnIntent1],
          walletClient.gatewayWalletProgram.programId
        ),
      },
      burnSigner
    );

    await expectAnchorError(
      walletClient.gatewayBurn(
        {
          burnIntent: burnIntentBytes2,
          fee: FEE_AMOUNT,
          userSignature: burnSignature2,
          tokenMint,
          custodyTokenAccount,
          feeRecipientTokenAccount,
          deposit: depositPDA.publicKey,
          remainingAccounts: createGatewayBurnRemainingAccounts(
            [burnIntent2],
            walletClient.gatewayWalletProgram.programId
          ),
        },
        burnSigner
      ),
      "InsufficientCustodyBalance"
    );

    const depositState =
      await walletClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    const expectedBalance = DEPOSIT_AMOUNT - MINT_AMOUNT - FEE_AMOUNT;
    expect(Number(depositState.availableAmount)).to.equal(expectedBalance);
  });
});
