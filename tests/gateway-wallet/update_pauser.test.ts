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

describe("GatewayWallet: updatePauser", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({ localDomain: SOLANA_DOMAIN });
  });

  it("owner can set pauser and emits event", async () => {
    const newPauser = Keypair.generate().publicKey;
    const txSignature = await client.updatePauser({ newPauser });

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.pauser).to.deep.equal(newPauser);

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events.find((e) => e.name === "pauserChanged")).to.deep.equal({
      name: "pauserChanged",
      data: { oldPauser: client.owner.publicKey, newPauser },
    });
  });

  it("non-owner cannot set pauser", async () => {
    const newPauser = Keypair.generate().publicKey;
    const nonOwner = Keypair.generate();
    client.svm.airdrop(nonOwner.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(
      client.updatePauser({ newPauser }, nonOwner),
      "InvalidAuthority"
    );
  });

  it("owner can set pauser to same value (idempotent)", async () => {
    const acct1 = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    const currentPauser = acct1.pauser;

    // Setting to same value should succeed (idempotent)
    const txSignature = await client.updatePauser({ newPauser: currentPauser });

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.pauser).to.deep.equal(currentPauser);

    // Event is still emitted
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events.find((e) => e.name === "pauserChanged")).to.deep.equal({
      name: "pauserChanged",
      data: { oldPauser: currentPauser, newPauser: currentPauser },
    });
  });

  it("owner cannot set pauser to default", async () => {
    await expectAnchorError(
      client.updatePauser({ newPauser: PublicKey.default }),
      "InvalidPauser"
    );
  });
});
