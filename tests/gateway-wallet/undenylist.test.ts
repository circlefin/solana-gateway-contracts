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

describe("GatewayWallet: undenylist", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;
  let denylister: Keypair;
  let targetAccount: Keypair;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({ localDomain: SOLANA_DOMAIN });

    // Create a denylister
    denylister = Keypair.generate();
    svm.airdrop(denylister.publicKey, BigInt(LAMPORTS_PER_SOL));

    // Set the denylister
    await client.updateDenylister({ newDenylister: denylister.publicKey });

    // Create a target account to denylist/undenylist
    targetAccount = Keypair.generate();
    svm.airdrop(targetAccount.publicKey, BigInt(LAMPORTS_PER_SOL));
  });

  describe("Valid undenylist operations", () => {
    beforeEach(async () => {
      // Denylist the target account first
      await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );

      // Verify it's denylisted
      const denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.not.equal(null);
    });

    it("denylister can undenylist a denylisted account and emits event", async () => {
      const txSignature = await client.undenylist(
        { account: targetAccount.publicKey },
        { denylister }
      );

      // Verify the denylist account was closed/removed
      const denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.equal(null);

      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.length(1);
      expect(events[0].name).to.equal("unDenylisted");
      expect(events[0].data.addr).to.deep.equal(targetAccount.publicKey);
    });

    it("owner can undenylist when owner is also denylister", async () => {
      // Reset denylister to be the owner
      await client.updateDenylister({ newDenylister: client.owner.publicKey });

      // First denylist with owner as denylister
      const anotherAccount = Keypair.generate();
      await client.denylist(
        { account: anotherAccount.publicKey },
        { denylister: client.owner }
      );

      // Then undenylist with owner
      const txSignature = await client.undenylist(
        { account: anotherAccount.publicKey },
        { denylister: client.owner }
      );

      // Verify the denylist account was closed
      const denylistAccount = await client.getDenylistAccount(
        anotherAccount.publicKey
      );
      expect(denylistAccount).to.equal(null);

      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.length(1);
      expect(events[0].name).to.equal("unDenylisted");
      expect(events[0].data.addr).to.deep.equal(anotherAccount.publicKey);
    });

    it("can undenylist multiple different accounts", async () => {
      const account1 = Keypair.generate();
      const account2 = Keypair.generate();
      const account3 = Keypair.generate();

      // Denylist multiple accounts first
      await client.denylist({ account: account1.publicKey }, { denylister });
      await client.denylist({ account: account2.publicKey }, { denylister });
      await client.denylist({ account: account3.publicKey }, { denylister });

      // Verify all are denylisted
      expect(await client.getDenylistAccount(account1.publicKey)).to.not.equal(
        null
      );
      expect(await client.getDenylistAccount(account2.publicKey)).to.not.equal(
        null
      );
      expect(await client.getDenylistAccount(account3.publicKey)).to.not.equal(
        null
      );

      // Undenylist all accounts
      await client.undenylist({ account: account1.publicKey }, { denylister });
      await client.undenylist({ account: account2.publicKey }, { denylister });
      await client.undenylist({ account: account3.publicKey }, { denylister });

      // Verify all accounts are removed from denylist
      expect(await client.getDenylistAccount(account1.publicKey)).to.equal(
        null
      );
      expect(await client.getDenylistAccount(account2.publicKey)).to.equal(
        null
      );
      expect(await client.getDenylistAccount(account3.publicKey)).to.equal(
        null
      );
    });

    it("rent is returned to fee payer when account is closed", async () => {
      const payer = Keypair.generate();
      svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

      // Get fee payer balance before undenylist
      const balanceBefore = await svm.getBalance(payer.publicKey);
      // Undenylist the account (this closes the denylist account)
      await client.undenylist(
        { account: targetAccount.publicKey },
        { denylister, payer }
      );

      // Get payer balance after undenylist
      const balanceAfter = await svm.getBalance(payer.publicKey);
      // Payer should have received lamports back (account rent)
      expect(Number(balanceAfter)).to.be.greaterThan(Number(balanceBefore));
    });
  });

  describe("Unauthorized undenylist attempts", () => {
    beforeEach(async () => {
      // Denylist the target account first
      await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );
    });

    it("non-denylister cannot undenylist an account", async () => {
      const nonDenylister = Keypair.generate();
      svm.airdrop(nonDenylister.publicKey, BigInt(LAMPORTS_PER_SOL));

      await expectAnchorError(
        client.undenylist(
          { account: targetAccount.publicKey },
          { denylister: nonDenylister }
        ),
        "InvalidAuthority"
      );

      // Verify account is still denylisted
      const denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.not.equal(null);
    });
  });

  describe("Error conditions", () => {
    it("cannot undenylist an account that is not denylisted", async () => {
      const nonDenylistedAccount = Keypair.generate();

      // Verify account is not denylisted
      const denylistAccount = await client.getDenylistAccount(
        nonDenylistedAccount.publicKey
      );
      expect(denylistAccount).to.equal(null);

      await expectAnchorError(
        client.undenylist(
          { account: nonDenylistedAccount.publicKey },
          { denylister }
        ),
        "AccountNotInitialized"
      );
    });

    it("cannot undenylist the same account twice", async () => {
      // First, we need to denylist the target account
      await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );

      // Verify it's denylisted
      let denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.not.equal(null);
      // First undenylist should succeed
      await client.undenylist(
        { account: targetAccount.publicKey },
        { denylister }
      );

      // Verify account was removed from denylist (account closed)
      denylistAccount = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(denylistAccount).to.equal(null);

      // Second undenylist should fail because the account no longer exists
      await expectAnchorError(
        client.undenylist({ account: targetAccount.publicKey }, { denylister }),
        "AccountNotInitialized"
      );
    });
  });

  describe("Denylist and Undenylist cycle", () => {
    beforeEach(async () => {
      // Denylist the target account first for these tests
      await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );
    });

    it("can denylist and undenylist the same account multiple times", async () => {
      // Initial state: account is denylisted (from beforeEach)
      expect(
        await client.getDenylistAccount(targetAccount.publicKey)
      ).to.not.equal(null);

      // Cycle 1: undenylist -> denylist
      await client.undenylist(
        { account: targetAccount.publicKey },
        { denylister }
      );
      expect(await client.getDenylistAccount(targetAccount.publicKey)).to.equal(
        null
      );

      await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );
      expect(
        await client.getDenylistAccount(targetAccount.publicKey)
      ).to.not.equal(null);

      // Cycle 2: undenylist -> denylist
      await client.undenylist(
        { account: targetAccount.publicKey },
        { denylister }
      );
      expect(await client.getDenylistAccount(targetAccount.publicKey)).to.equal(
        null
      );

      await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );
      expect(
        await client.getDenylistAccount(targetAccount.publicKey)
      ).to.not.equal(null);

      // Cycle 3: undenylist -> denylist
      await client.undenylist(
        { account: targetAccount.publicKey },
        { denylister }
      );
      expect(await client.getDenylistAccount(targetAccount.publicKey)).to.equal(
        null
      );

      await client.denylist(
        { account: targetAccount.publicKey },
        { denylister }
      );

      const finalDenylist = await client.getDenylistAccount(
        targetAccount.publicKey
      );
      expect(finalDenylist).to.not.equal(null);
    });
  });
});
