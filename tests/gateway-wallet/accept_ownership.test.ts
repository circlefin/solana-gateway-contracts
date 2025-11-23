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

describe("GatewayWallet: acceptOwnership", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({ localDomain: SOLANA_DOMAIN });
  });

  it("pending owner should accept ownership and clear pending", async () => {
    const newOwner = Keypair.generate();
    await client.transferOwnership({
      newOwner: newOwner.publicKey,
    });

    const txSignature = await client.acceptOwnership(newOwner);

    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.owner).to.deep.equal(newOwner.publicKey);
    expect(gatewayWalletAccount.pendingOwner).to.deep.equal(PublicKey.default);

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.deep.equal([
      {
        name: "ownershipTransferred",
        data: {
          previousOwner: client.owner.publicKey,
          newOwner: newOwner.publicKey,
        },
      },
    ]);
  });

  it("should fail if non-pending owner calls acceptOwnership", async () => {
    // Initiate ownership transfer to new owner
    const newOwner = Keypair.generate();
    await client.transferOwnership({
      newOwner: newOwner.publicKey,
    });

    // Generate and fund a random key
    const randomKey = Keypair.generate();
    svm.airdrop(randomKey.publicKey, BigInt(LAMPORTS_PER_SOL));

    // Attempt to accept ownership using the random key
    await expectAnchorError(
      client.acceptOwnership(randomKey),
      "InvalidAuthority"
    );
  });
});
