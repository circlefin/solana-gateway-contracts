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
  createSignedBurnIntent,
} from "../utils";
import { SOLANA_DOMAIN } from "../constants";

describe("GatewayWallet: pause", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;
  let feeRecipient: Keypair;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    feeRecipient = Keypair.generate();
    client.updateFeeRecipient({ newFeeRecipient: feeRecipient.publicKey });
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });
  });

  it("initializes with paused set to false", async () => {
    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.paused).to.equal(false);
  });

  it("pauser can pause and emits event", async () => {
    const txSignature = await client.pause();

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.paused).to.equal(true);

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events[0]).to.deep.equal({
      name: "paused",
      data: {
        account: client.owner.publicKey,
      },
    });
  });

  it("non-pauser cannot pause", async () => {
    const nonPauser = Keypair.generate();
    client.svm.airdrop(nonPauser.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(client.pause(nonPauser), "InvalidAuthority");
  });

  it("new pauser can pause after pauser is updated", async () => {
    const newPauser = Keypair.generate();
    client.svm.airdrop(newPauser.publicKey, BigInt(LAMPORTS_PER_SOL));

    await client.updatePauser({ newPauser: newPauser.publicKey });

    // Old pauser should not be able to pause
    await expectAnchorError(client.pause(), "InvalidAuthority");

    // New pauser should be able to pause
    await client.pause(newPauser);

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.paused).to.equal(true);
  });

  describe("paused state blocks operations", () => {
    let tokenMint;
    let tokenAccount;

    beforeEach(async () => {
      // Setup: Create a token and add it to gateway wallet
      tokenMint = await client.createTokenMint(client.owner.publicKey, 6);
      await client.addToken({ tokenMint });

      // Create token account and mint some tokens for testing
      tokenAccount = await client.createTokenAccount(
        tokenMint,
        client.owner.publicKey
      );
      await client.mintToken(tokenMint, tokenAccount, 1000000, client.owner);
    });

    it("blocks deposit when paused", async () => {
      await client.pause();

      await expectAnchorError(
        client.deposit({
          tokenMint,
          amount: 100000,
          fromTokenAccount: tokenAccount,
        }),
        "ProgramPaused"
      );
    });

    it("blocks depositFor when paused", async () => {
      await client.pause();

      const depositor = Keypair.generate().publicKey;

      await expectAnchorError(
        client.deposit({
          tokenMint,
          amount: 100000,
          fromTokenAccount: tokenAccount,
          forDepositor: depositor,
        }),
        "ProgramPaused"
      );
    });

    it("blocks addDelegate when paused", async () => {
      await client.pause();

      const delegate = Keypair.generate().publicKey;

      await expectAnchorError(
        client.addDelegate({ tokenMint, delegate }),
        "ProgramPaused"
      );
    });

    it("blocks removeDelegate when paused", async () => {
      const delegate = Keypair.generate().publicKey;
      await client.addDelegate({ tokenMint, delegate });

      await client.pause();

      // Try to remove delegate while paused
      await expectAnchorError(
        client.removeDelegate({ tokenMint, delegate }),
        "ProgramPaused"
      );
    });

    it("blocks initiateWithdrawal when paused", async () => {
      await client.deposit({
        tokenMint,
        amount: 100000,
        fromTokenAccount: tokenAccount,
      });

      await client.pause();

      await expectAnchorError(
        client.initiateWithdrawal({ tokenMint, amount: 50000 }),
        "ProgramPaused"
      );
    });

    it("blocks withdraw when paused", async () => {
      await client.deposit({
        tokenMint,
        amount: 100000,
        fromTokenAccount: tokenAccount,
      });
      await client.initiateWithdrawal({ tokenMint, amount: 50000 });

      await client.pause();

      await expectAnchorError(
        client.withdraw({ tokenMint, toTokenAccount: tokenAccount }),
        "ProgramPaused"
      );
    });

    it("blocks gatewayBurn when paused", async () => {
      const burnSigner = generateSignerKeypair();
      await client.addBurnSigner({ signer: burnSigner.publicKey });

      // Create deposit account first by making a deposit
      await client.deposit({
        tokenMint,
        amount: 100000,
        fromTokenAccount: tokenAccount,
      });

      const custodyTokenAccount = findPDA(
        [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
        client.gatewayWalletProgram.programId
      ).publicKey;

      // Create fee recipient token account
      const feeRecipientTokenAccount =
        await client.createAssociatedTokenAccount(
          tokenMint,
          feeRecipient.publicKey
        );

      const depositPDA = findPDA(
        [
          Buffer.from("gateway_deposit"),
          tokenMint.toBuffer(),
          client.owner.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      ).publicKey;

      await client.pause();

      const { bytes, signature } = createSignedBurnIntent();

      await expectAnchorError(
        client.gatewayBurn(
          {
            burnIntent: bytes,
            userSignature: signature,
            tokenMint,
            custodyTokenAccount,
            feeRecipientTokenAccount,
            deposit: depositPDA,
            remainingAccounts: [],
          },
          burnSigner
        ),
        "ProgramPaused"
      );
    });
  });
});
