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

describe("GatewayWallet: updateTokenController", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);

    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });
  });

  it("owner can set token controller and emits event", async () => {
    const newTokenController = Keypair.generate().publicKey;
    const txSignature = await client.updateTokenController({
      newTokenController,
    });

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.tokenController).to.deep.equal(newTokenController);

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: "tokenControllerUpdated",
      data: {
        previousTokenController: client.owner.publicKey,
        newTokenController: newTokenController,
      },
    });
  });

  it("should fail if not signed by owner", async () => {
    const randomKey = Keypair.generate();
    svm.airdrop(randomKey.publicKey, BigInt(LAMPORTS_PER_SOL));

    const newTokenController = Keypair.generate().publicKey;

    await expectAnchorError(
      client.updateTokenController({ newTokenController }, randomKey),
      "InvalidAuthority"
    );
  });

  it("should fail if new token controller is default pubkey", async () => {
    const newTokenController = PublicKey.default;

    await expectAnchorError(
      client.updateTokenController({ newTokenController }),
      "InvalidTokenController"
    );
  });

  it("should be idempotent when setting token controller to same value", async () => {
    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    const currentTokenController = state.tokenController;

    // Setting to same value should succeed (idempotent)
    const txSignature = await client.updateTokenController({
      newTokenController: currentTokenController,
    });

    const updatedState =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(updatedState.tokenController).to.deep.equal(currentTokenController);

    // Event is still emitted
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: "tokenControllerUpdated",
      data: {
        previousTokenController: currentTokenController,
        newTokenController: currentTokenController,
      },
    });
  });
});
