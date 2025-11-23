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

describe("addBurnSigner", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);

    // Initialize the gateway wallet for each test
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });
  });

  it("should successfully add a burn signer", async () => {
    const signer = Keypair.generate();

    const txSignature = await client.addBurnSigner({
      signer: signer.publicKey,
    });

    // Verify the burn signer was added to the state
    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );

    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(1);
    expect(gatewayWalletAccount.burnSigners[0]).to.deep.equal(signer.publicKey);

    // Verify the event was emitted
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.deep.equal([
      {
        name: "burnSignerAdded",
        data: {
          signer: signer.publicKey,
        },
      },
    ]);
  });

  it("should successfully add multiple burn signers", async () => {
    const signer1 = Keypair.generate();
    const signer2 = Keypair.generate();
    const signer3 = Keypair.generate();

    await client.addBurnSigner({ signer: signer1.publicKey });
    await client.addBurnSigner({ signer: signer2.publicKey });
    await client.addBurnSigner({ signer: signer3.publicKey });

    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );

    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(3);
    expect(gatewayWalletAccount.burnSigners).to.deep.include(signer1.publicKey);
    expect(gatewayWalletAccount.burnSigners).to.deep.include(signer2.publicKey);
    expect(gatewayWalletAccount.burnSigners).to.deep.include(signer3.publicKey);
  });

  it("should fail when adding the default pubkey as burn signer", async () => {
    await expectAnchorError(
      client.addBurnSigner({
        signer: PublicKey.default,
      }),
      "InvalidBurnSigner"
    );
  });

  it("should be idempotent when adding a burn signer that is already added", async () => {
    const signer = Keypair.generate();

    // Add the burn signer first
    const firstTxSignature = await client.addBurnSigner({
      signer: signer.publicKey,
    });

    // Verify it was added
    let gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(1);
    expect(gatewayWalletAccount.burnSigners[0]).to.deep.equal(signer.publicKey);

    // Try to add the same burn signer again - should succeed (idempotent)
    const secondTxSignature = await client.addBurnSigner({
      signer: signer.publicKey,
    });

    // Verify it's still only added once
    gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(1);
    expect(gatewayWalletAccount.burnSigners[0]).to.deep.equal(signer.publicKey);

    // Verify both transactions emitted events for idempotency
    const firstEvents = getEvents(
      client.svm,
      firstTxSignature,
      client.gatewayWalletProgram
    );
    expect(firstEvents).to.have.lengthOf(1);
    expect(firstEvents[0].name).to.equal("burnSignerAdded");

    const secondEvents = getEvents(
      client.svm,
      secondTxSignature,
      client.gatewayWalletProgram
    );
    expect(secondEvents).to.have.lengthOf(1);
    expect(secondEvents[0].name).to.equal("burnSignerAdded");
  });

  it("should fail when burn signer limit is exceeded", async () => {
    // Add 10 burn signers (the maximum limit)
    const signers = Array.from({ length: 10 }, () => Keypair.generate());

    for (const signer of signers) {
      await client.addBurnSigner({ signer: signer.publicKey });
    }

    // Try to add an 11th burn signer
    const extraSigner = Keypair.generate();
    await expectAnchorError(
      client.addBurnSigner({ signer: extraSigner.publicKey }),
      "BurnSignerLimitExceeded"
    );

    // Verify we still have exactly 10 burn signers
    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.burnSigners).to.have.lengthOf(10);
  });

  it("should fail when not signed by owner", async () => {
    const signer = Keypair.generate();
    const nonOwner = Keypair.generate();
    client.svm.airdrop(nonOwner.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(
      client.addBurnSigner({ signer: signer.publicKey }, nonOwner),
      "InvalidAuthority"
    );
  });
});
