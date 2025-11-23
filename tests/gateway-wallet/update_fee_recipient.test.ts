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
import { Keypair, PublicKey } from "@solana/web3.js";
import { SOLANA_DOMAIN } from "../constants";
import { getEvents, expectAnchorError } from "../utils";

describe("updateFeeRecipient", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });
  });

  it("should successfully update fee recipient", async () => {
    const newFeeRecipient = Keypair.generate().publicKey;

    const txSig = await client.updateFeeRecipient({
      newFeeRecipient: newFeeRecipient,
    });

    const events = getEvents(svm, txSig, client.gatewayWalletProgram);
    expect(events.length).to.equal(1);
    expect(events[0].name).to.equal("feeRecipientChanged");
    expect(events[0].data.oldFeeRecipient).to.deep.equal(
      client.owner.publicKey
    );
    expect(events[0].data.newFeeRecipient).to.deep.equal(newFeeRecipient);

    // Verify the state was updated
    const gatewayWallet =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWallet.feeRecipient).to.deep.equal(newFeeRecipient);
  });

  it("should fail when called by non-owner", async () => {
    const nonOwner = Keypair.generate();
    svm.airdrop(nonOwner.publicKey, BigInt(10_000_000_000));
    const newFeeRecipient = Keypair.generate().publicKey;

    await expectAnchorError(
      client.updateFeeRecipient({ newFeeRecipient }, nonOwner),
      "InvalidAuthority"
    );
  });

  it("should fail when new fee recipient is zero address", async () => {
    await expectAnchorError(
      client.updateFeeRecipient({ newFeeRecipient: PublicKey.default }),
      "InvalidAuthority"
    );
  });
});
