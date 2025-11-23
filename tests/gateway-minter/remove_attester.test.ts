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
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expectAnchorError, getEvents } from "../utils";
import { SOLANA_DOMAIN } from "../constants";

describe("removeAttester", () => {
  let svm: LiteSVM;
  let client: GatewayMinterTestClient;
  let attester1: Keypair;
  let attester2: Keypair;
  let attester3: Keypair;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayMinterTestClient(svm);

    // Initialize the gateway minter for each test
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    // Set up some attesters for removal tests
    attester1 = Keypair.generate();
    attester2 = Keypair.generate();
    attester3 = Keypair.generate();

    await client.addAttester({ attester: attester1.publicKey });
    await client.addAttester({ attester: attester2.publicKey });
    await client.addAttester({ attester: attester3.publicKey });
  });

  it("should successfully remove an attester", async () => {
    const txSignature = await client.removeAttester({
      attester: attester2.publicKey,
    });

    // Verify the attester was removed from the state
    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );

    expect(gatewayMinterAccount.enabledAttesters).to.have.lengthOf(2);
    expect(gatewayMinterAccount.enabledAttesters).to.deep.include(
      attester1.publicKey
    );
    expect(gatewayMinterAccount.enabledAttesters).to.deep.include(
      attester3.publicKey
    );
    expect(gatewayMinterAccount.enabledAttesters).to.not.deep.include(
      attester2.publicKey
    );

    // Verify the event was emitted
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayMinterProgram
    );
    expect(events).to.deep.equal([
      {
        name: "attestationSignerRemoved",
        data: {
          signer: attester2.publicKey,
        },
      },
    ]);
  });

  it("should successfully remove the first attester", async () => {
    await client.removeAttester({
      attester: attester1.publicKey,
    });

    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );

    expect(gatewayMinterAccount.enabledAttesters).to.have.lengthOf(2);
    expect(gatewayMinterAccount.enabledAttesters).to.deep.include(
      attester2.publicKey
    );
    expect(gatewayMinterAccount.enabledAttesters).to.deep.include(
      attester3.publicKey
    );
    expect(gatewayMinterAccount.enabledAttesters).to.not.deep.include(
      attester1.publicKey
    );
  });

  it("should successfully remove the last attester", async () => {
    await client.removeAttester({
      attester: attester3.publicKey,
    });

    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );

    expect(gatewayMinterAccount.enabledAttesters).to.have.lengthOf(2);
    expect(gatewayMinterAccount.enabledAttesters).to.deep.include(
      attester1.publicKey
    );
    expect(gatewayMinterAccount.enabledAttesters).to.deep.include(
      attester2.publicKey
    );
    expect(gatewayMinterAccount.enabledAttesters).to.not.deep.include(
      attester3.publicKey
    );
  });

  it("should successfully remove all attesters", async () => {
    await client.removeAttester({ attester: attester1.publicKey });
    await client.removeAttester({ attester: attester2.publicKey });
    await client.removeAttester({ attester: attester3.publicKey });

    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );

    expect(gatewayMinterAccount.enabledAttesters).to.have.lengthOf(0);
  });

  it("should be idempotent when removing an attester that is not added", async () => {
    const nonExistentAttester = Keypair.generate();

    // Should succeed (idempotent)
    const txSignature = await client.removeAttester({
      attester: nonExistentAttester.publicKey,
    });

    // Verify state unchanged
    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );
    expect(gatewayMinterAccount.enabledAttesters).to.have.lengthOf(3);

    // Verify event was still emitted
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayMinterProgram
    );
    expect(events).to.deep.equal([
      {
        name: "attestationSignerRemoved",
        data: {
          signer: nonExistentAttester.publicKey,
        },
      },
    ]);
  });

  it("should be idempotent when removing an attester that was already removed", async () => {
    // Remove an attester
    await client.removeAttester({ attester: attester1.publicKey });

    // Remove the same attester again - should succeed (idempotent)
    const txSignature = await client.removeAttester({
      attester: attester1.publicKey,
    });

    // Verify state unchanged (still 2 attesters)
    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );
    expect(gatewayMinterAccount.enabledAttesters).to.have.lengthOf(2);

    // Verify event was still emitted
    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayMinterProgram
    );
    expect(events).to.deep.equal([
      {
        name: "attestationSignerRemoved",
        data: {
          signer: attester1.publicKey,
        },
      },
    ]);
  });

  it("should fail when not signed by owner", async () => {
    const nonOwner = Keypair.generate();
    client.svm.airdrop(nonOwner.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(
      client.removeAttester({ attester: attester1.publicKey }, nonOwner),
      "InvalidAuthority"
    );
  });
});
