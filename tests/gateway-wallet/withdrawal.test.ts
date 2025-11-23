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

import { LiteSVM } from "litesvm";
import { GatewayWalletTestClient } from "./test_client";
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getEvents, expectAnchorError, findPDA } from "../utils";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("GatewayWallet withdraw", () => {
  let svm: LiteSVM;
  let testClient: GatewayWalletTestClient;
  let testTokenMint: PublicKey;
  let userTokenAccount: PublicKey;
  let depositor: Keypair;

  const WITHDRAWAL_DELAY = 100; // 100 slots delay
  const INITIAL_DEPOSIT = 1_000_000; // 1 token
  const WITHDRAWAL_AMOUNT = 500_000; // 0.5 tokens

  before(async () => {
    svm = new LiteSVM();
    testClient = new GatewayWalletTestClient(svm);
    await testClient.initialize({
      localDomain: 5,
      withdrawalDelay: WITHDRAWAL_DELAY,
    });

    testTokenMint = await testClient.createTokenMint(
      testClient.owner.publicKey,
      6
    );

    await testClient.addToken({ tokenMint: testTokenMint });

    depositor = Keypair.generate();
    svm.airdrop(depositor.publicKey, BigInt(1_000_000_000)); // 1 SOL

    userTokenAccount = await testClient.createTokenAccount(
      testTokenMint,
      depositor.publicKey
    );

    await testClient.mintToken(
      testTokenMint,
      userTokenAccount,
      INITIAL_DEPOSIT * 2,
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: INITIAL_DEPOSIT,
        fromTokenAccount: userTokenAccount,
      },
      { owner: depositor }
    );
  });

  it("successfully completes withdrawal after delay period", async () => {
    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: WITHDRAWAL_AMOUNT,
      },
      depositor
    );

    const depositPDA = testClient.getDepositPDA(
      testTokenMint,
      depositor.publicKey
    );
    const depositAccount =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    svm.warpToSlot(BigInt(depositAccount.withdrawalBlock.toNumber() + 1));

    const depositAccountBefore =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    const userTokenAccountBefore = await testClient.getTokenAccount(
      userTokenAccount
    );

    const txSignature = await testClient.withdraw(
      {
        tokenMint: testTokenMint,
        toTokenAccount: userTokenAccount,
      },
      depositor
    );

    const depositAccountAfter =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    expect(depositAccountAfter.withdrawingAmount.toNumber()).to.equal(0);
    expect(depositAccountAfter.withdrawalBlock.toNumber()).to.equal(0);
    expect(depositAccountAfter.availableAmount.toNumber()).to.equal(
      depositAccountBefore.availableAmount.toNumber()
    );

    const userTokenAccountAfter = await testClient.getTokenAccount(
      userTokenAccount
    );
    expect(userTokenAccountAfter.amount).to.equal(
      userTokenAccountBefore.amount + BigInt(WITHDRAWAL_AMOUNT)
    );

    const events = getEvents(svm, txSignature, testClient.gatewayWalletProgram);
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("withdrawalCompleted");
    expect(events[0].data.token).to.deep.equal(testTokenMint);
    expect(events[0].data.depositor).to.deep.equal(depositor.publicKey);
    expect(events[0].data.value.toString()).to.equal(
      WITHDRAWAL_AMOUNT.toString()
    );
  });

  it("fails to withdraw before delay period expires", async () => {
    const depositor2 = Keypair.generate();
    svm.airdrop(depositor2.publicKey, BigInt(1_000_000_000));

    const userTokenAccount2 = await testClient.createTokenAccount(
      testTokenMint,
      depositor2.publicKey
    );

    await testClient.mintToken(
      testTokenMint,
      userTokenAccount2,
      INITIAL_DEPOSIT,
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: INITIAL_DEPOSIT,
        fromTokenAccount: userTokenAccount2,
      },
      { owner: depositor2 }
    );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: WITHDRAWAL_AMOUNT,
      },
      depositor2
    );

    await expectAnchorError(
      testClient.withdraw(
        {
          tokenMint: testTokenMint,
          toTokenAccount: userTokenAccount2,
        },
        depositor2
      ),
      "WithdrawalDelayNotElapsed"
    );
  });

  it("fails to withdraw exactly 1 slot before delay period expires", async () => {
    const depositor2b = Keypair.generate();
    svm.airdrop(depositor2b.publicKey, BigInt(1_000_000_000));

    const userTokenAccount2b = await testClient.createTokenAccount(
      testTokenMint,
      depositor2b.publicKey
    );

    await testClient.mintToken(
      testTokenMint,
      userTokenAccount2b,
      INITIAL_DEPOSIT,
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: INITIAL_DEPOSIT,
        fromTokenAccount: userTokenAccount2b,
      },
      { owner: depositor2b }
    );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: WITHDRAWAL_AMOUNT,
      },
      depositor2b
    );

    const depositPDA = testClient.getDepositPDA(
      testTokenMint,
      depositor2b.publicKey
    );
    const depositAccount =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    // Warp to exactly 1 slot before the withdrawal becomes available
    svm.warpToSlot(BigInt(depositAccount.withdrawalBlock.toNumber() - 1));

    await expectAnchorError(
      testClient.withdraw(
        {
          tokenMint: testTokenMint,
          toTokenAccount: userTokenAccount2b,
        },
        depositor2b
      ),
      "WithdrawalDelayNotElapsed"
    );
  });

  it("fails to withdraw when no pending withdrawal exists", async () => {
    const depositor3 = Keypair.generate();
    svm.airdrop(depositor3.publicKey, BigInt(1_000_000_000));

    const userTokenAccount3 = await testClient.createTokenAccount(
      testTokenMint,
      depositor3.publicKey
    );

    await testClient.mintToken(
      testTokenMint,
      userTokenAccount3,
      INITIAL_DEPOSIT,
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: INITIAL_DEPOSIT,
        fromTokenAccount: userTokenAccount3,
      },
      { owner: depositor3 }
    );

    await expectAnchorError(
      testClient.withdraw(
        {
          tokenMint: testTokenMint,
          toTokenAccount: userTokenAccount3,
        },
        depositor3
      ),
      "NoWithdrawalInProgress"
    );
  });

  it("successfully withdraws exactly on the deadline slot", async () => {
    const depositor4 = Keypair.generate();
    svm.airdrop(depositor4.publicKey, BigInt(1_000_000_000));

    const userTokenAccount4 = await testClient.createTokenAccount(
      testTokenMint,
      depositor4.publicKey
    );

    await testClient.mintToken(
      testTokenMint,
      userTokenAccount4,
      INITIAL_DEPOSIT,
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: INITIAL_DEPOSIT,
        fromTokenAccount: userTokenAccount4,
      },
      { owner: depositor4 }
    );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: WITHDRAWAL_AMOUNT,
      },
      depositor4
    );

    const depositPDA = testClient.getDepositPDA(
      testTokenMint,
      depositor4.publicKey
    );
    const depositAccount =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    svm.warpToSlot(BigInt(depositAccount.withdrawalBlock.toNumber()));

    const txSignature = await testClient.withdraw(
      {
        tokenMint: testTokenMint,
        toTokenAccount: userTokenAccount4,
      },
      depositor4
    );

    const events = getEvents(svm, txSignature, testClient.gatewayWalletProgram);
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("withdrawalCompleted");
  });

  it("fails to withdraw an unsupported token", async () => {
    const unsupportedTokenMint = await testClient.createTokenMint(
      testClient.owner.publicKey,
      6
    );

    const depositor5 = Keypair.generate();
    svm.airdrop(depositor5.publicKey, BigInt(1_000_000_000));

    const userTokenAccount5 = await testClient.createTokenAccount(
      unsupportedTokenMint,
      depositor5.publicKey
    );

    await expectAnchorError(
      testClient.withdraw(
        {
          tokenMint: unsupportedTokenMint,
          toTokenAccount: userTokenAccount5,
        },
        depositor5
      ),
      "AccountNotInitialized"
    );
  });

  it("fails if a non-depositor tries to withdraw", async () => {
    const depositor2 = Keypair.generate();
    svm.airdrop(depositor2.publicKey, BigInt(1_000_000_000));

    const depositor2TokenAccount = await testClient.createTokenAccount(
      testTokenMint,
      depositor2.publicKey
    );

    await testClient.mintToken(
      testTokenMint,
      depositor2TokenAccount,
      INITIAL_DEPOSIT,
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: INITIAL_DEPOSIT,
        fromTokenAccount: depositor2TokenAccount,
      },
      { owner: depositor2 }
    );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: WITHDRAWAL_AMOUNT,
      },
      depositor2
    );

    const depositPDA = testClient.getDepositPDA(
      testTokenMint,
      depositor2.publicKey
    );
    const depositAccount =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    svm.warpToSlot(BigInt(depositAccount.withdrawalBlock.toNumber() + 1));

    const anotherDepositor = Keypair.generate();
    svm.airdrop(anotherDepositor.publicKey, BigInt(1_000_000_000));

    await expectAnchorError(
      testClient.withdraw(
        {
          tokenMint: testTokenMint,
          toTokenAccount: depositor2TokenAccount,
        },
        anotherDepositor
      ),
      "AccountNotInitialized"
    );
  });

  it("fails if withdrawal destination account is not owned by the depositor", async () => {
    const depositor2 = Keypair.generate();
    svm.airdrop(depositor2.publicKey, BigInt(1_000_000_000));

    const depositor2TokenAccount = await testClient.createTokenAccount(
      testTokenMint,
      depositor2.publicKey
    );

    await testClient.mintToken(
      testTokenMint,
      depositor2TokenAccount,
      INITIAL_DEPOSIT,
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: INITIAL_DEPOSIT,
        fromTokenAccount: depositor2TokenAccount,
      },
      { owner: depositor2 }
    );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: WITHDRAWAL_AMOUNT,
      },
      depositor2
    );

    const anotherDepositor = Keypair.generate();
    const anotherDepositorAccount = await testClient.createTokenAccount(
      testTokenMint,
      anotherDepositor.publicKey
    );

    const depositPDA = testClient.getDepositPDA(
      testTokenMint,
      depositor2.publicKey
    );
    const depositAccount =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    svm.warpToSlot(BigInt(depositAccount.withdrawalBlock.toNumber() + 1));

    await expectAnchorError(
      testClient.withdraw(
        {
          tokenMint: testTokenMint,
          toTokenAccount: anotherDepositorAccount,
        },
        depositor2
      ),
      "ConstraintTokenOwner"
    );
  });

  it("handles multiple accumulated withdrawals correctly", async () => {
    const depositor6 = Keypair.generate();
    svm.airdrop(depositor6.publicKey, BigInt(1_000_000_000));

    const userTokenAccount6 = await testClient.createTokenAccount(
      testTokenMint,
      depositor6.publicKey
    );

    await testClient.mintToken(
      testTokenMint,
      userTokenAccount6,
      INITIAL_DEPOSIT,
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: INITIAL_DEPOSIT,
        fromTokenAccount: userTokenAccount6,
      },
      { owner: depositor6 }
    );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: 200_000,
      },
      depositor6
    );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: 300_000,
      },
      depositor6
    );

    const depositPDA = testClient.getDepositPDA(
      testTokenMint,
      depositor6.publicKey
    );
    const depositAccount =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    svm.warpToSlot(BigInt(depositAccount.withdrawalBlock.toNumber()));

    const userTokenAccountBefore = await testClient.getTokenAccount(
      userTokenAccount6
    );

    const txSignature = await testClient.withdraw(
      {
        tokenMint: testTokenMint,
        toTokenAccount: userTokenAccount6,
      },
      depositor6
    );

    const userTokenAccountAfter = await testClient.getTokenAccount(
      userTokenAccount6
    );

    expect(userTokenAccountAfter.amount).to.equal(
      userTokenAccountBefore.amount + BigInt(500_000)
    );

    const events = getEvents(svm, txSignature, testClient.gatewayWalletProgram);
    expect(events).to.have.length(1);
    expect(events[0].data.value.toString()).to.equal("500000");
  });

  it("allows multiple withdraw cycles", async () => {
    const depositor8 = Keypair.generate();
    svm.airdrop(depositor8.publicKey, BigInt(1_000_000_000));

    const userTokenAccount8 = await testClient.createTokenAccount(
      testTokenMint,
      depositor8.publicKey
    );

    const DEPOSIT_AMOUNT = 500_000; // 0.5 tokens
    const WITHDRAWAL_CYCLE_AMOUNT = 200_000; // 0.2 tokens per withdrawal

    await testClient.mintToken(
      testTokenMint,
      userTokenAccount8,
      DEPOSIT_AMOUNT,
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: DEPOSIT_AMOUNT,
        fromTokenAccount: userTokenAccount8,
      },
      { owner: depositor8 }
    );

    const depositPDA = testClient.getDepositPDA(
      testTokenMint,
      depositor8.publicKey
    );

    let userTokenAccountBalance = await testClient.getTokenAccount(
      userTokenAccount8
    );
    const initialBalance = userTokenAccountBalance.amount;

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: WITHDRAWAL_CYCLE_AMOUNT,
      },
      depositor8
    );

    let depositAccount =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    svm.warpToSlot(BigInt(depositAccount.withdrawalBlock.toNumber() + 1));

    const txSignature1 = await testClient.withdraw(
      {
        tokenMint: testTokenMint,
        toTokenAccount: userTokenAccount8,
      },
      depositor8
    );

    userTokenAccountBalance = await testClient.getTokenAccount(
      userTokenAccount8
    );
    expect(userTokenAccountBalance.amount).to.equal(
      initialBalance + BigInt(WITHDRAWAL_CYCLE_AMOUNT)
    );

    const events1 = getEvents(
      svm,
      txSignature1,
      testClient.gatewayWalletProgram
    );
    expect(events1).to.have.length(1);
    expect(events1[0].name).to.equal("withdrawalCompleted");
    expect(events1[0].data.value.toString()).to.equal(
      WITHDRAWAL_CYCLE_AMOUNT.toString()
    );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: WITHDRAWAL_CYCLE_AMOUNT,
      },
      depositor8
    );

    depositAccount =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );
    svm.warpToSlot(BigInt(depositAccount.withdrawalBlock.toNumber() + 1));

    const txSignature2 = await testClient.withdraw(
      {
        tokenMint: testTokenMint,
        toTokenAccount: userTokenAccount8,
      },
      depositor8
    );

    userTokenAccountBalance = await testClient.getTokenAccount(
      userTokenAccount8
    );
    expect(userTokenAccountBalance.amount).to.equal(
      initialBalance + BigInt(WITHDRAWAL_CYCLE_AMOUNT * 2)
    );

    const events2 = getEvents(
      svm,
      txSignature2,
      testClient.gatewayWalletProgram
    );
    expect(events2).to.have.length(1);
    expect(events2[0].name).to.equal("withdrawalCompleted");
    expect(events2[0].data.value.toString()).to.equal(
      WITHDRAWAL_CYCLE_AMOUNT.toString()
    );

    const finalDepositAccount =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    expect(finalDepositAccount.availableAmount.toNumber()).to.equal(
      DEPOSIT_AMOUNT - WITHDRAWAL_CYCLE_AMOUNT * 2
    );
    expect(finalDepositAccount.withdrawingAmount.toNumber()).to.equal(0);
    expect(finalDepositAccount.withdrawalBlock.toNumber()).to.equal(0);

    const totalWithdrawn = WITHDRAWAL_CYCLE_AMOUNT * 2;
    expect(userTokenAccountBalance.amount).to.equal(
      initialBalance + BigInt(totalWithdrawn)
    );
  });

  it("fails when deposit account mint does not match custody and user token account mint", async () => {
    // Create a second token mint
    const testTokenMint2 = await testClient.createTokenMint(
      testClient.owner.publicKey,
      6
    );
    await testClient.addToken({ tokenMint: testTokenMint2 });

    // Create a token account for the second token mint
    const tokenAccount2 = await testClient.createTokenAccount(
      testTokenMint2,
      depositor.publicKey
    );
    await testClient.mintToken(
      testTokenMint2,
      tokenAccount2,
      INITIAL_DEPOSIT,
      testClient.owner
    );

    // Deposit using second token mint
    await testClient.deposit(
      {
        tokenMint: testTokenMint2,
        amount: INITIAL_DEPOSIT,
        fromTokenAccount: tokenAccount2,
      },
      { owner: depositor }
    );

    // Initiate withdrawal for first token
    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: WITHDRAWAL_AMOUNT,
      },
      depositor
    );

    svm.warpToSlot(BigInt(WITHDRAWAL_DELAY + 1));

    // Try to withdraw using custody/token accounts for testTokenMint
    // but with a deposit account for testTokenMint2 (should fail)
    const depositPDA2 = testClient.getDepositPDA(
      testTokenMint2,
      depositor.publicKey
    );

    const custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_wallet_custody"), testTokenMint.toBuffer()],
      testClient.gatewayWalletProgram.programId
    );

    await expectAnchorError(
      testClient.gatewayWalletProgram.methods
        .withdraw()
        .accountsPartial({
          depositor: depositor.publicKey,
          gatewayWallet: testClient.pdas.gatewayWallet.publicKey,
          custodyTokenAccount: custodyTokenAccountPDA.publicKey,
          depositorTokenAccount: userTokenAccount,
          deposit: depositPDA2.publicKey, // Wrong deposit account (different mint)
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc(),
      "ConstraintRaw"
    );
  });
});
