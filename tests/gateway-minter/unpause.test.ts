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

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { GatewayMinter } from "../../target/types/gateway_minter";
import { GatewayMinterTestClient } from "./test_client";
import { expectAnchorError, getEvents } from "../utils";
import { LiteSVM } from "litesvm";
import { SOLANA_DOMAIN } from "../constants";

describe("unpause", () => {
  let svm: LiteSVM;
  let client: GatewayMinterTestClient;
  let program: Program<GatewayMinter>;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayMinterTestClient(svm);
    program = client.gatewayMinterProgram;

    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    await program.methods
      .pause()
      .accountsPartial({
        pauser: client.owner.publicKey,
        gatewayMinter: client.pdas.gatewayMinter.publicKey,
      })
      .signers([client.owner])
      .rpc();

    client.svm.expireBlockhash();
  });

  it("should allow pauser to unpause the contract", async () => {
    let gatewayMinterState = await program.account.gatewayMinter.fetch(
      client.pdas.gatewayMinter.publicKey
    );
    expect(gatewayMinterState.paused).to.equal(true);

    await program.methods
      .unpause()
      .accountsPartial({
        pauser: client.owner.publicKey,
        gatewayMinter: client.pdas.gatewayMinter.publicKey,
      })
      .signers([client.owner])
      .rpc();

    gatewayMinterState = await program.account.gatewayMinter.fetch(
      client.pdas.gatewayMinter.publicKey
    );
    expect(gatewayMinterState.paused).to.equal(false);
  });

  it("should fail when non-pauser tries to unpause", async () => {
    const nonPauserKeypair = anchor.web3.Keypair.generate();
    client.svm.airdrop(
      nonPauserKeypair.publicKey,
      BigInt(anchor.web3.LAMPORTS_PER_SOL)
    );

    await expectAnchorError(
      program.methods
        .unpause()
        .accountsPartial({
          pauser: nonPauserKeypair.publicKey,
          gatewayMinter: client.pdas.gatewayMinter.publicKey,
        })
        .signers([nonPauserKeypair])
        .rpc(),
      "InvalidAuthority"
    );
  });

  it("should emit Unpaused CPI event", async () => {
    const txSignature = await program.methods
      .unpause()
      .accountsPartial({
        pauser: client.owner.publicKey,
        gatewayMinter: client.pdas.gatewayMinter.publicKey,
      })
      .signers([client.owner])
      .rpc();

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayMinterProgram
    );
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: "unpaused",
      data: {
        account: client.owner.publicKey,
      },
    });
  });

  it("should allow idempotent unpause operations", async () => {
    await program.methods
      .unpause()
      .accountsPartial({
        pauser: client.owner.publicKey,
        gatewayMinter: client.pdas.gatewayMinter.publicKey,
      })
      .signers([client.owner])
      .rpc();

    let gatewayMinterState = await program.account.gatewayMinter.fetch(
      client.pdas.gatewayMinter.publicKey
    );
    expect(gatewayMinterState.paused).to.equal(false);

    client.svm.expireBlockhash();

    await program.methods
      .unpause()
      .accountsPartial({
        pauser: client.owner.publicKey,
        gatewayMinter: client.pdas.gatewayMinter.publicKey,
      })
      .signers([client.owner])
      .rpc();

    gatewayMinterState = await program.account.gatewayMinter.fetch(
      client.pdas.gatewayMinter.publicKey
    );
    expect(gatewayMinterState.paused).to.equal(false);
  });
});
