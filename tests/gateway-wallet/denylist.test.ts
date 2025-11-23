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
import { expectAnchorError, getEvents } from "../utils";
import { SOLANA_DOMAIN } from "../constants";

describe("GatewayWallet: denylist", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;
  let denylister: Keypair;
  let targetAccount: Keypair;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({ localDomain: SOLANA_DOMAIN });

    // Create a denylister (different from owner)
    denylister = Keypair.generate();
    svm.airdrop(denylister.publicKey, BigInt(LAMPORTS_PER_SOL));

    // Set the denylister
    await client.updateDenylister({ newDenylister: denylister.publicKey });

    // Create a target account to denylist
    targetAccount = Keypair.generate();
    svm.airdrop(targetAccount.publicKey, BigInt(LAMPORTS_PER_SOL));
  });

  describe("Valid denylist operations", () => {
    it("denylister can denylist an account and emits event", async () => {
      const txSignature = await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );

      // Verify the denylist account was created
      const denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.not.equal(null);

      // Verify an event was emitted
      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.length(1);
      expect(events[0].name).to.equal("denylisted");
      expect(events[0].data.addr).to.deep.equal(targetAccount.publicKey);
    });

    it("owner can denylist an account when owner is also denylister", async () => {
      // Reset denylister to be the owner
      await client.updateDenylister({ newDenylister: client.owner.publicKey });

      const txSignature = await client.denylist(
        { account: targetAccount.publicKey },
        { denylister: client.owner }
      );

      // Verify the denylist account was created
      const denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.not.equal(null);

      // Verify an event was emitted
      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.length(1);
      expect(events[0].name).to.equal("denylisted");
      expect(events[0].data.addr).to.deep.equal(targetAccount.publicKey);
    });

    it("can denylist multiple different accounts", async () => {
      const account1 = Keypair.generate();
      const account2 = Keypair.generate();
      const account3 = Keypair.generate();

      // Denylist multiple accounts
      await client.denylist({ account: account1.publicKey }, { denylister });
      await client.denylist({ account: account2.publicKey }, { denylister });
      await client.denylist({ account: account3.publicKey }, { denylister });

      // Verify all accounts are denylisted
      const denylist1 = await client.getDenylistAccount(account1.publicKey);
      const denylist2 = await client.getDenylistAccount(account2.publicKey);
      const denylist3 = await client.getDenylistAccount(account3.publicKey);

      expect(denylist1).to.not.equal(null);
      expect(denylist2).to.not.equal(null);
      expect(denylist3).to.not.equal(null);
    });
  });

  describe("Unauthorized denylist attempts", () => {
    it("non-denylister cannot denylist an account", async () => {
      const nonDenylister = Keypair.generate();
      svm.airdrop(nonDenylister.publicKey, BigInt(LAMPORTS_PER_SOL));

      await expectAnchorError(
        client.denylist(
          { account: targetAccount.publicKey },
          { denylister: nonDenylister }
        ),
        "InvalidAuthority"
      );

      // Verify no denylist account was created
      const denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.equal(null);
    });

    it("owner cannot denylist when not denylister", async () => {
      const state =
        await client.gatewayWalletProgram.account.gatewayWallet.fetch(
          client.pdas.gatewayWallet.publicKey
        );
      expect(state.denylister).to.deep.equal(denylister.publicKey);
      expect(state.denylister).to.not.deep.equal(client.owner.publicKey);

      await expectAnchorError(
        client.denylist(
          { account: targetAccount.publicKey },
          { denylister: client.owner }
        ),
        "InvalidAuthority"
      );

      // Verify no denylist account was created
      const denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.equal(null);
    });
  });

  describe("Edge cases and error conditions", () => {
    it("can denylist the same account twice (idempotent)", async () => {
      // First denylist should succeed
      const firstTxSignature = await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );

      // Verify account was created and user is denylisted
      let denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.not.equal(null);

      // Verify first event was emitted
      const firstEvents = getEvents(
        svm,
        firstTxSignature,
        client.gatewayWalletProgram
      );
      expect(firstEvents).to.have.length(1);
      expect(firstEvents[0].name).to.equal("denylisted");

      // Second denylist should succeed (idempotent)
      const secondTxSignature = await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );

      // Verify account still exists
      denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.not.equal(null);

      // Verify second event was emitted for idempotency
      const secondEvents = getEvents(
        svm,
        secondTxSignature,
        client.gatewayWalletProgram
      );
      expect(secondEvents).to.have.length(1);
      expect(secondEvents[0].name).to.equal("denylisted");
    });
  });

  describe("State verification", () => {
    it("denylist account has correct structure and data", async () => {
      await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );

      const denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );

      expect(denylistAccount).to.not.equal(null);
    });

    it("non-denylisted account returns null", async () => {
      const nonDenylistedAccount = Keypair.generate();

      const denylistAccount = await client.getDenylistAccount(
        nonDenylistedAccount.publicKey
      );

      expect(denylistAccount).to.equal(null);
    });
  });
});
