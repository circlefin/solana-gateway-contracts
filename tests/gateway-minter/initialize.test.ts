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
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  deployProgram,
  expectAccountExistsError,
  expectAnchorError,
  findPDA,
  getEvents,
} from "../utils";
import * as path from "path";
import { readFileSync } from "fs";
import { SOLANA_DOMAIN, VERSION } from "../constants";

describe("GatewayMinter: initialize", () => {
  let svm: LiteSVM;
  let client: GatewayMinterTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayMinterTestClient(svm);
  });

  it("should initialize the gateway minter", async () => {
    const txSignature = await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    const gatewayMinterAccount =
      await client.gatewayMinterProgram.account.gatewayMinter.fetch(
        client.pdas.gatewayMinter.publicKey
      );
    expect(gatewayMinterAccount.localDomain).to.equal(SOLANA_DOMAIN);
    expect(gatewayMinterAccount.version).to.equal(VERSION);
    expect(gatewayMinterAccount.owner).to.deep.equal(client.owner.publicKey);
    expect(gatewayMinterAccount.pauser).to.deep.equal(client.owner.publicKey);
    expect(gatewayMinterAccount.tokenController).to.deep.equal(
      client.owner.publicKey
    );

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayMinterProgram
    );
    expect(events).to.deep.equal([
      {
        name: "gatewayMinterInitialized",
        data: {},
      },
    ]);
  });

  it("should fail if not signed by upgrade authority", async () => {
    // Generate and fund a random key
    const randomKey = Keypair.generate();
    client.svm.airdrop(randomKey.publicKey, BigInt(LAMPORTS_PER_SOL));

    // Attempt to initialize the gateway minter program with the random key
    await expectAnchorError(
      client.initialize(
        {
          localDomain: SOLANA_DOMAIN,
        },
        randomKey
      ),
      "ConstraintRaw"
    );
  });

  it("should fail if invalid program data account is provided", async () => {
    // Generate and fund a random key
    const randomKey = Keypair.generate();
    client.svm.airdrop(randomKey.publicKey, BigInt(LAMPORTS_PER_SOL));

    // Deploy a fake gateway minter program where the random key is the upgrade authority
    const newProgramId = Keypair.generate().publicKey;
    const newProgramBytes = readFileSync(
      path.join(process.cwd(), "target/deploy/gateway_minter.so")
    );
    const newProgramDataAccount = findPDA(
      [newProgramId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
    );
    deployProgram(
      client.svm,
      newProgramId,
      newProgramBytes,
      randomKey.publicKey
    );

    // Attempt to initialize the gateway minter program, passing in the fake program data account
    client.svm.expireBlockhash();
    await expectAnchorError(
      client.gatewayMinterProgram.methods
        .initialize({
          localDomain: SOLANA_DOMAIN,
        })
        .accountsPartial({
          payer: randomKey.publicKey,
          upgradeAuthority: randomKey.publicKey,
          gatewayMinter: client.pdas.gatewayMinter.publicKey,
          gatewayMinterProgramData: newProgramDataAccount.publicKey,
          gatewayMinterProgram: client.gatewayMinterProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([randomKey])
        .rpc(),
      "ConstraintRaw"
    );
  });

  it("should fail if initialized twice", async () => {
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    await expectAccountExistsError(
      client.initialize({
        localDomain: SOLANA_DOMAIN,
      })
    );
  });
});
