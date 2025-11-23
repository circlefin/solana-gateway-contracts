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
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { expectAnchorError, getEvents } from "../utils";
import { SOLANA_DOMAIN } from "../constants";

describe("GatewayWallet: transferOwnership", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({ localDomain: SOLANA_DOMAIN });
  });

  it("should set pending owner when owner calls transferOwnership", async () => {
    const newOwner = Keypair.generate();
    const txSignature = await client.transferOwnership({
      newOwner: newOwner.publicKey,
    });

    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.owner).to.deep.equal(client.owner.publicKey);
    expect(gatewayWalletAccount.pendingOwner).to.deep.equal(newOwner.publicKey);

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.deep.equal([
      {
        name: "ownershipTransferStarted",
        data: {
          previousOwner: client.owner.publicKey,
          newOwner: newOwner.publicKey,
        },
      },
    ]);
  });

  it("should allow clearing pending owner by setting to null address", async () => {
    // First set a pending owner
    const newOwner = Keypair.generate();
    await client.transferOwnership({ newOwner: newOwner.publicKey });

    let gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.pendingOwner).to.deep.equal(newOwner.publicKey);

    // Clear the pending owner by setting to default
    const txSignature = await client.transferOwnership({
      newOwner: PublicKey.default,
    });

    gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.pendingOwner).to.deep.equal(PublicKey.default);

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.deep.equal([
      {
        name: "ownershipTransferStarted",
        data: {
          previousOwner: client.owner.publicKey,
          newOwner: PublicKey.default,
        },
      },
    ]);
  });

  it("should fail if not signed by owner", async () => {
    // Generate and fund a random key
    const newOwner = Keypair.generate();
    client.svm.airdrop(newOwner.publicKey, BigInt(LAMPORTS_PER_SOL));

    // Attempt to transfer ownership using the random key
    await expectAnchorError(
      client.transferOwnership({ newOwner: newOwner.publicKey }, newOwner),
      "InvalidAuthority"
    );
  });

  it("should allow transferring ownership to the same owner", async () => {
    const txSignature = await client.transferOwnership({
      newOwner: client.owner.publicKey,
    });

    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.owner).to.deep.equal(client.owner.publicKey);
    expect(gatewayWalletAccount.pendingOwner).to.deep.equal(
      client.owner.publicKey
    );

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.deep.equal([
      {
        name: "ownershipTransferStarted",
        data: {
          previousOwner: client.owner.publicKey,
          newOwner: client.owner.publicKey,
        },
      },
    ]);
  });

  it("should allow transferring ownership to the same owner again", async () => {
    // Transfer ownership to a new owner
    const newOwner = Keypair.generate();
    await client.transferOwnership({
      newOwner: newOwner.publicKey,
    });

    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.owner).to.deep.equal(client.owner.publicKey);
    expect(gatewayWalletAccount.pendingOwner).to.deep.equal(newOwner.publicKey);

    // Attempt to transfer ownership to the same owner again
    const txSignature = await client.transferOwnership({
      newOwner: newOwner.publicKey,
    });

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.deep.equal([
      {
        name: "ownershipTransferStarted",
        data: {
          previousOwner: client.owner.publicKey,
          newOwner: newOwner.publicKey,
        },
      },
    ]);
  });
});
