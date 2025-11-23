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
import { getEvents } from "../utils";

describe("GatewayWallet initiateWithdrawal", () => {
  let svm: LiteSVM;
  let testClient: GatewayWalletTestClient;
  let testTokenMint: PublicKey;
  let userTokenAccount: PublicKey;
  let depositor: Keypair;

  before(async () => {
    svm = new LiteSVM();
    testClient = new GatewayWalletTestClient(svm);
    await testClient.initialize({
      localDomain: 1,
      version: 1,
      withdrawalDelay: 100, // 100 slots delay
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
      1_000_000, // 1 token
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: 500_000, // 0.5 tokens
        fromTokenAccount: userTokenAccount,
      },
      { owner: depositor }
    );
  });

  it("successfully initiates withdrawal", async () => {
    const withdrawalAmount = 300_000; // 0.3 tokens

    const depositPDA = testClient.getDepositPDA(
      testTokenMint,
      depositor.publicKey
    );
    const depositAccountBefore =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    const txSignature = await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: withdrawalAmount,
      },
      depositor
    );

    const depositAccountAfter =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    expect(depositAccountAfter.availableAmount.toNumber()).to.equal(
      depositAccountBefore.availableAmount.toNumber() - withdrawalAmount
    );
    expect(depositAccountAfter.withdrawingAmount.toNumber()).to.equal(
      depositAccountBefore.withdrawingAmount.toNumber() + withdrawalAmount
    );
    expect(depositAccountAfter.withdrawalBlock.toNumber()).to.be.greaterThan(
      depositAccountBefore.withdrawalBlock.toNumber()
    );

    const events = getEvents(svm, txSignature, testClient.gatewayWalletProgram);
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("withdrawalInitiated");
    expect(events[0].data.token).to.deep.equal(testTokenMint);
    expect(events[0].data.depositor).to.deep.equal(depositor.publicKey);
    expect(events[0].data.value.toString()).to.equal(
      withdrawalAmount.toString()
    );
    expect(events[0].data.remainingAvailable.toString()).to.equal(
      depositAccountAfter.availableAmount.toString()
    );
    expect(events[0].data.totalWithdrawing.toString()).to.equal(
      depositAccountAfter.withdrawingAmount.toString()
    );
    expect(events[0].data.withdrawalBlock.toString()).to.equal(
      depositAccountAfter.withdrawalBlock.toString()
    );
  });

  it("supports multiple withdrawal initiations (accumulating)", async () => {
    const firstWithdrawal = 50_000; // 0.05 tokens
    const secondWithdrawal = 75_000; // 0.075 tokens

    const depositPDA = testClient.getDepositPDA(
      testTokenMint,
      depositor.publicKey
    );
    const depositAccountInitial =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: firstWithdrawal,
      },
      depositor
    );

    const depositAccountAfterFirst =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: secondWithdrawal,
      },
      depositor
    );

    const depositAccountAfterSecond =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    expect(depositAccountAfterSecond.withdrawingAmount.toNumber()).to.equal(
      depositAccountAfterFirst.withdrawingAmount.toNumber() + secondWithdrawal
    );

    expect(depositAccountAfterSecond.availableAmount.toNumber()).to.equal(
      depositAccountInitial.availableAmount.toNumber() -
        firstWithdrawal -
        secondWithdrawal
    );
  });

  it("fails to withdraw more than available balance", async () => {
    const depositPDA = testClient.getDepositPDA(
      testTokenMint,
      depositor.publicKey
    );
    const depositAccount =
      await testClient.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    const excessiveAmount = depositAccount.availableAmount.toNumber() + 1000;

    try {
      await testClient.initiateWithdrawal(
        {
          tokenMint: testTokenMint,
          amount: excessiveAmount,
        },
        depositor
      );
      expect.fail("Should have failed with insufficient balance");
    } catch (error) {
      expect(error.toString()).to.include("InsufficientDepositBalance");
    }
  });

  it("fails to withdraw zero amount", async () => {
    try {
      await testClient.initiateWithdrawal(
        {
          tokenMint: testTokenMint,
          amount: 0,
        },
        depositor
      );
      expect.fail("Should have failed with invalid amount");
    } catch (error) {
      expect(error.toString()).to.include("InvalidWithdrawalAmount");
    }
  });

  it("fails when deposit account doesn't exist", async () => {
    const newUser = Keypair.generate();
    svm.airdrop(newUser.publicKey, BigInt(1_000_000_000));

    try {
      await testClient.initiateWithdrawal(
        {
          tokenMint: testTokenMint,
          amount: 100_000,
        },
        newUser
      );
      expect.fail("Should have failed with account not initialized");
    } catch (error) {
      expect(error.toString()).to.include("AccountNotInitialized");
    }
  });

  it("verifies withdrawal delay is properly set", async () => {
    const depositor2 = Keypair.generate();
    svm.airdrop(depositor2.publicKey, BigInt(1_000_000_000));

    const userTokenAccount2 = await testClient.createTokenAccount(
      testTokenMint,
      depositor2.publicKey
    );

    await testClient.mintToken(
      testTokenMint,
      userTokenAccount2,
      200_000, // 0.2 tokens
      testClient.owner
    );

    await testClient.deposit(
      {
        tokenMint: testTokenMint,
        amount: 200_000,
        fromTokenAccount: userTokenAccount2,
      },
      { owner: depositor2 }
    );

    await testClient.initiateWithdrawal(
      {
        tokenMint: testTokenMint,
        amount: 100_000,
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

    const actualWithdrawableSlot = depositAccount.withdrawalBlock.toNumber();
    expect(actualWithdrawableSlot).to.be.greaterThan(0);
  });
});
