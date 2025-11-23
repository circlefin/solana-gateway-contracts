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
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  expectAnchorError,
  findPDA,
  getEvents,
  generateSignerKeypair,
} from "../utils";
import { SOLANA_DOMAIN } from "../constants";

describe("GatewayWallet: unpause", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({ localDomain: SOLANA_DOMAIN });
    // Pause first for unpause tests
    await client.pause();
  });

  it("pauser can unpause and emits event", async () => {
    const txSignature = await client.unpause();

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.paused).to.equal(false);

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events[0]).to.deep.equal({
      name: "unpaused",
      data: {
        account: client.owner.publicKey,
      },
    });
  });

  it("non-pauser cannot unpause", async () => {
    const nonPauser = Keypair.generate();
    client.svm.airdrop(nonPauser.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(client.unpause(nonPauser), "InvalidAuthority");

    // Verify state is still paused
    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.paused).to.equal(true);
  });

  it("can pause and unpause multiple times", async () => {
    await client.unpause();
    let state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.paused).to.equal(false);

    await client.pause();
    state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.paused).to.equal(true);

    await client.unpause();
    state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.paused).to.equal(false);
  });

  it("new pauser can unpause after pauser is updated", async () => {
    const newPauser = Keypair.generate();
    client.svm.airdrop(newPauser.publicKey, BigInt(LAMPORTS_PER_SOL));

    await client.updatePauser({ newPauser: newPauser.publicKey });

    await expectAnchorError(client.unpause(), "InvalidAuthority");

    await client.unpause(newPauser);

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.paused).to.equal(false);
  });

  describe("unpaused state allows operations", () => {
    let tokenMint;
    let tokenAccount;

    beforeEach(async () => {
      const state =
        await client.gatewayWalletProgram.account.gatewayWallet.fetch(
          client.pdas.gatewayWallet.publicKey
        );

      expect(state.paused).to.equal(true);

      await client.unpause();

      tokenMint = await client.createTokenMint(client.owner.publicKey, 6);
      await client.addToken({ tokenMint });

      tokenAccount = await client.createTokenAccount(
        tokenMint,
        client.owner.publicKey
      );
      await client.mintToken(tokenMint, tokenAccount, 1000000, client.owner);
    });

    it("allows deposit when unpaused", async () => {
      await client.deposit({
        tokenMint,
        amount: 100000,
        fromTokenAccount: tokenAccount,
      });

      const depositPDA = client.getDepositPDA(
        tokenMint,
        client.owner.publicKey
      );
      const depositState =
        await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
          depositPDA.publicKey
        );
      expect(depositState.availableAmount.toNumber()).to.equal(100000);
    });

    it("allows depositFor when unpaused", async () => {
      const depositor = Keypair.generate().publicKey;

      await client.deposit({
        tokenMint,
        amount: 50000,
        fromTokenAccount: tokenAccount,
        forDepositor: depositor,
      });

      const depositPDA = client.getDepositPDA(tokenMint, depositor);
      const depositState =
        await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
          depositPDA.publicKey
        );
      expect(depositState.availableAmount.toNumber()).to.equal(50000);
    });

    it("allows addDelegate when unpaused", async () => {
      const delegate = Keypair.generate().publicKey;

      await client.addDelegate({ tokenMint, delegate });

      const delegateAccount = await client.getDelegateAccount(
        tokenMint,
        client.owner.publicKey,
        delegate
      );
      expect(delegateAccount.status).to.deep.equal({ authorized: {} });
    });

    it("allows removeDelegate when unpaused", async () => {
      const delegate = Keypair.generate().publicKey;
      await client.addDelegate({ tokenMint, delegate });

      await client.removeDelegate({ tokenMint, delegate });

      const delegateAccount = await client.getDelegateAccount(
        tokenMint,
        client.owner.publicKey,
        delegate
      );
      expect(delegateAccount.status).to.deep.equal({ revoked: {} });
    });

    it("allows initiateWithdrawal when unpaused", async () => {
      await client.deposit({
        tokenMint,
        amount: 100000,
        fromTokenAccount: tokenAccount,
      });

      await client.initiateWithdrawal({ tokenMint, amount: 50000 });

      const depositPDA = client.getDepositPDA(
        tokenMint,
        client.owner.publicKey
      );
      const depositState =
        await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
          depositPDA.publicKey
        );
      expect(depositState.availableAmount.toNumber()).to.equal(50000);
      expect(depositState.withdrawingAmount.toNumber()).to.equal(50000);
    });

    it("allows withdraw when unpaused", async () => {
      await client.deposit({
        tokenMint,
        amount: 100000,
        fromTokenAccount: tokenAccount,
      });
      await client.initiateWithdrawal({ tokenMint, amount: 50000 });

      svm.warpToSlot(BigInt(1));
      await client.withdraw({ tokenMint, toTokenAccount: tokenAccount });

      const depositPDA = client.getDepositPDA(
        tokenMint,
        client.owner.publicKey
      );
      const depositState =
        await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
          depositPDA.publicKey
        );
      expect(depositState.withdrawingAmount.toNumber()).to.equal(0);
    });

    it("allows gatewayBurn when unpaused with valid burn signer", async () => {
      const burnSigner = generateSignerKeypair();
      await client.addBurnSigner({ signer: burnSigner.publicKey });

      // Create a minimal burn intent (empty for this test)
      const burnIntent = Buffer.alloc(0);

      const custodyTokenAccount = findPDA(
        [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
        client.gatewayWalletProgram.programId
      ).publicKey;

      // Create fee recipient token account
      const feeRecipient = Keypair.generate();
      client.svm.airdrop(feeRecipient.publicKey, BigInt(LAMPORTS_PER_SOL));
      const feeRecipientTokenAccount = await client.createTokenAccount(
        tokenMint,
        feeRecipient.publicKey
      );

      const depositPDA = client.getDepositPDA(
        tokenMint,
        client.owner.publicKey
      );

      // Should not throw ProgramPaused error
      // It May fail with other errors due to invalid burnIntent structure,
      // but that's expected, we're just verifying pause doesn't block it
      try {
        await client.gatewayBurn(
          {
            burnIntent,
            userSignature: Buffer.alloc(64),
            tokenMint,
            custodyTokenAccount,
            feeRecipientTokenAccount,
            deposit: depositPDA.publicKey,
            remainingAccounts: [],
          },
          burnSigner
        );
      } catch (error) {
        // Verify it's NOT a ProgramPaused error
        expect(error.message).to.not.include("ProgramPaused");
        expect(error.message).to.not.include("Instruction is not allowed");
      }
    });
  });
});
