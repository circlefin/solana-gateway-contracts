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
import * as anchor from "@coral-xyz/anchor";

describe("GatewayWallet: initialize", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
  });

  it("should initialize the gateway wallet", async () => {
    const txSignature = await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.owner).to.deep.equal(client.owner.publicKey);
    expect(gatewayWalletAccount.pauser).to.deep.equal(client.owner.publicKey);
    expect(gatewayWalletAccount.denylister).to.deep.equal(
      client.owner.publicKey
    );
    expect(gatewayWalletAccount.tokenController).to.deep.equal(
      client.owner.publicKey
    );
    expect(gatewayWalletAccount.pendingOwner).to.deep.equal(PublicKey.default);
    expect(gatewayWalletAccount.localDomain).to.equal(SOLANA_DOMAIN);
    expect(gatewayWalletAccount.version).to.equal(VERSION);
    expect(gatewayWalletAccount.supportedTokens).to.have.length(0);
    expect(gatewayWalletAccount.custodyTokenAccountBumps).to.have.length(0);

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.deep.equal([
      {
        name: "gatewayWalletInitialized",
        data: {},
      },
    ]);
  });

  it("should fail if not signed by upgrade authority", async () => {
    // Generate and fund a random key
    const randomKey = Keypair.generate();
    client.svm.airdrop(randomKey.publicKey, BigInt(LAMPORTS_PER_SOL));

    // Attempt to initialize the gateway wallet program with the random key
    await expectAnchorError(
      client.initialize({ localDomain: SOLANA_DOMAIN }, randomKey),
      "ConstraintRaw"
    );
  });

  it("should fail if invalid program data account is provided", async () => {
    // Generate and fund a random key
    const randomKey = Keypair.generate();
    client.svm.airdrop(randomKey.publicKey, BigInt(LAMPORTS_PER_SOL));

    // Deploy a fake gateway wallet program where the random key is the upgrade authority
    const newProgramId = Keypair.generate().publicKey;
    const newProgramBytes = readFileSync(
      path.join(process.cwd(), "target/deploy/gateway_wallet.so")
    );
    const newProgramDataAccount = findPDA(
      [newProgramId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e111111111111111111111111")
    );
    deployProgram(
      client.svm,
      newProgramId,
      newProgramBytes,
      randomKey.publicKey
    );

    // Attempt to initialize the gateway wallet program, passing in the fake program data account
    client.svm.expireBlockhash();
    await expectAnchorError(
      client.gatewayWalletProgram.methods
        .initialize({
          localDomain: 2,
          withdrawalDelay: new anchor.BN(0),
        })
        .accountsPartial({
          payer: randomKey.publicKey,
          upgradeAuthority: randomKey.publicKey,
          gatewayWallet: client.pdas.gatewayWallet.publicKey,
          gatewayWalletProgramData: newProgramDataAccount.publicKey,
          gatewayWalletProgram: client.gatewayWalletProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([randomKey])
        .rpc(),
      "AccountNotInitialized"
    );
  });

  it("should fail if initialized twice", async () => {
    await client.initialize({ localDomain: SOLANA_DOMAIN });

    await expectAccountExistsError(
      client.initialize({ localDomain: SOLANA_DOMAIN })
    );
  });

  it("should fail if withdrawal delay is 0", async () => {
    await expectAnchorError(
      client.initialize({ localDomain: SOLANA_DOMAIN, withdrawalDelay: 0 }),
      "InvalidWithdrawalDelay"
    );
  });

  it("should succeed with valid withdrawal delay", async () => {
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
      withdrawalDelay: 100,
    });

    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.withdrawalDelay.toNumber()).to.equal(100);
  });
});
