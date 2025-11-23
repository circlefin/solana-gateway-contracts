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

describe("removeBurnSigner", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;
  let signer1: Keypair;
  let signer2: Keypair;
  let signer3: Keypair;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);

    // Initialize the gateway wallet for each test
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    // Set up some burn signers for removal tests
    signer1 = Keypair.generate();
    signer2 = Keypair.generate();
    signer3 = Keypair.generate();

    await client.addBurnSigner({ signer: signer1.publicKey });
    await client.addBurnSigner({ signer: signer2.publicKey });
    await client.addBurnSigner({ signer: signer3.publicKey });
  });

  it("should successfully remove a burn signer", async () => {
    const txSignature = await client.removeBurnSigner({
      signer: signer2.publicKey,
    });

    // Verify the burn signer was removed from the state
    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );

    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(2);
    expect(gatewayWalletAccount.burnSigners).to.deep.include(signer1.publicKey);
    expect(gatewayWalletAccount.burnSigners).to.deep.include(signer3.publicKey);
    expect(gatewayWalletAccount.burnSigners).to.not.deep.include(
      signer2.publicKey
    );

    // Verify the event was emitted
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.deep.equal([
      {
        name: "burnSignerRemoved",
        data: {
          signer: signer2.publicKey,
        },
      },
    ]);
  });

  it("should successfully remove the first burn signer", async () => {
    await client.removeBurnSigner({
      signer: signer1.publicKey,
    });

    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );

    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(2);
    expect(gatewayWalletAccount.burnSigners).to.deep.include(signer2.publicKey);
    expect(gatewayWalletAccount.burnSigners).to.deep.include(signer3.publicKey);
    expect(gatewayWalletAccount.burnSigners).to.not.deep.include(
      signer1.publicKey
    );
  });

  it("should successfully remove the last burn signer", async () => {
    await client.removeBurnSigner({
      signer: signer3.publicKey,
    });

    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );

    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(2);
    expect(gatewayWalletAccount.burnSigners).to.deep.include(signer1.publicKey);
    expect(gatewayWalletAccount.burnSigners).to.deep.include(signer2.publicKey);
    expect(gatewayWalletAccount.burnSigners).to.not.deep.include(
      signer3.publicKey
    );
  });

  it("should successfully remove all burn signers", async () => {
    await client.removeBurnSigner({ signer: signer1.publicKey });
    await client.removeBurnSigner({ signer: signer2.publicKey });
    await client.removeBurnSigner({ signer: signer3.publicKey });

    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );

    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(0);
  });

  it("should be idempotent when removing a burn signer that is not added", async () => {
    const nonExistentSigner = Keypair.generate();

    // Removing a non-existent signer should succeed (idempotent)
    const txSignature = await client.removeBurnSigner({
      signer: nonExistentSigner.publicKey,
    });

    // Verify the state hasn't changed
    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(3);

    // Verify event is still emitted for idempotency
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.have.lengthOf(1);
    expect(events[0].name).to.equal("burnSignerRemoved");
  });

  it("should be idempotent when removing a burn signer that was already removed", async () => {
    // Remove a burn signer
    await client.removeBurnSigner({ signer: signer1.publicKey });

    // Verify it was removed
    let gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(2);
    expect(gatewayWalletAccount.burnSigners).to.not.deep.include(
      signer1.publicKey
    );

    // Try to remove the same burn signer again - should succeed (idempotent)
    const secondTxSignature = await client.removeBurnSigner({
      signer: signer1.publicKey,
    });

    // Verify the state hasn't changed
    gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(2);
    expect(gatewayWalletAccount.burnSigners).to.not.deep.include(
      signer1.publicKey
    );

    // Verify event is still emitted for idempotency
    const events = getEvents(
      client.svm,
      secondTxSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.have.lengthOf(1);
    expect(events[0].name).to.equal("burnSignerRemoved");
  });

  it("should fail when not signed by owner", async () => {
    const nonOwner = Keypair.generate();
    client.svm.airdrop(nonOwner.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(
      client.removeBurnSigner({ signer: signer1.publicKey }, nonOwner),
      "InvalidAuthority"
    );
  });
});
