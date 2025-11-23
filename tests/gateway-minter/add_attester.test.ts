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
import { GatewayMinterTestClient } from "./test_client";
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { expectAnchorError, getEvents } from "../utils";
import { SOLANA_DOMAIN } from "../constants";

describe("addAttester", () => {
  let svm: LiteSVM;
  let client: GatewayMinterTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayMinterTestClient(svm);

    // Initialize the gateway minter for each test
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });
  });

  it("should successfully add an attester", async () => {
    const attester = Keypair.generate();

    const txSignature = await client.addAttester({
      attester: attester.publicKey,
    });

    // Verify the attester was added to the state
    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );

    expect(gatewayMinterAccount.enabledAttesters).to.have.lengthOf(1);
    expect(gatewayMinterAccount.enabledAttesters[0]).to.deep.equal(
      attester.publicKey
    );

    // Verify the event was emitted
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayMinterProgram
    );
    expect(events).to.deep.equal([
      {
        name: "attestationSignerAdded",
        data: {
          signer: attester.publicKey,
        },
      },
    ]);
  });

  it("should successfully add multiple attesters", async () => {
    const attester1 = Keypair.generate();
    const attester2 = Keypair.generate();
    const attester3 = Keypair.generate();

    await client.addAttester({ attester: attester1.publicKey });
    await client.addAttester({ attester: attester2.publicKey });
    await client.addAttester({ attester: attester3.publicKey });

    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );

    expect(gatewayMinterAccount.enabledAttesters).to.have.lengthOf(3);
    expect(gatewayMinterAccount.enabledAttesters).to.deep.include(
      attester1.publicKey
    );
    expect(gatewayMinterAccount.enabledAttesters).to.deep.include(
      attester2.publicKey
    );
    expect(gatewayMinterAccount.enabledAttesters).to.deep.include(
      attester3.publicKey
    );
  });

  it("should fail when adding the default pubkey as attester", async () => {
    await expectAnchorError(
      client.addAttester({
        attester: PublicKey.default,
      }),
      "InvalidAttester"
    );
  });

  it("should be idempotent when adding an attester that is already added", async () => {
    const attester = Keypair.generate();

    // Add the attester first
    await client.addAttester({ attester: attester.publicKey });

    // Add the same attester again - should succeed (idempotent)
    const txSignature = await client.addAttester({
      attester: attester.publicKey,
    });

    // Verify still only one attester in state
    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );
    expect(gatewayMinterAccount.enabledAttesters).to.have.lengthOf(1);

    // Verify event was still emitted
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayMinterProgram
    );
    expect(events).to.deep.equal([
      {
        name: "attestationSignerAdded",
        data: {
          signer: attester.publicKey,
        },
      },
    ]);
  });

  it("should fail when attester limit is exceeded", async () => {
    // Add 10 attesters (the maximum limit)
    const attesters = Array.from({ length: 10 }, () => Keypair.generate());

    for (const attester of attesters) {
      await client.addAttester({ attester: attester.publicKey });
    }

    // Try to add an 11th attester
    const extraAttester = Keypair.generate();
    await expectAnchorError(
      client.addAttester({ attester: extraAttester.publicKey }),
      "AttesterLimitExceeded"
    );

    // Verify we still have exactly 10 attesters
    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );
    expect(gatewayMinterAccount.enabledAttesters).to.have.lengthOf(10);
  });

  it("should fail when not signed by owner", async () => {
    const attester = Keypair.generate();
    const nonOwner = Keypair.generate();
    client.svm.airdrop(nonOwner.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(
      client.addAttester({ attester: attester.publicKey }, nonOwner),
      "InvalidAuthority"
    );
  });
});
