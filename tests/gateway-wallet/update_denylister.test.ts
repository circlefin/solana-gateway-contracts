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

describe("GatewayWallet: updateDenylister", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({ localDomain: SOLANA_DOMAIN });
  });

  it("owner can set denylister and emits event", async () => {
    const newDenylister = Keypair.generate().publicKey;
    const txSignature = await client.updateDenylister({
      newDenylister,
    });

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.denylister).to.deep.equal(newDenylister);

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: "denylisterChanged",
      data: { oldDenylister: client.owner.publicKey, newDenylister },
    });
  });

  it("non-owner cannot set denylister", async () => {
    const newDenylister = Keypair.generate().publicKey;
    const nonOwner = Keypair.generate();
    client.svm.airdrop(nonOwner.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(
      client.updateDenylister({ newDenylister }, nonOwner),
      "InvalidAuthority"
    );
  });

  it("owner can set denylister to same value (idempotent)", async () => {
    const acct1 = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    const currentDenylister = acct1.denylister;

    // Setting to same value should succeed (idempotent)
    const txSignature = await client.updateDenylister({
      newDenylister: currentDenylister,
    });

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.denylister).to.deep.equal(currentDenylister);

    // Event is still emitted
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: "denylisterChanged",
      data: {
        oldDenylister: currentDenylister,
        newDenylister: currentDenylister,
      },
    });
  });

  it("owner cannot set denylister to default", async () => {
    await expectAnchorError(
      client.updateDenylister({
        newDenylister: PublicKey.default,
      }),
      "InvalidDenylister"
    );
  });
});
