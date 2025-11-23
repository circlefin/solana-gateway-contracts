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
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expectAnchorError, getEvents } from "../utils";
import { SOLANA_DOMAIN } from "../constants";
import * as anchor from "@coral-xyz/anchor";

describe("GatewayWallet: updateWithdrawalDelay", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;
  const DEFAULT_WITHDRAWAL_DELAY = 500;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
      withdrawalDelay: DEFAULT_WITHDRAWAL_DELAY,
    });
  });

  it("owner can update withdrawal delay and emits event", async () => {
    const newWithdrawalDelay = new anchor.BN(1000);
    const txSignature = await client.updateWithdrawalDelay({
      newWithdrawalDelay,
    });

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.withdrawalDelay.toString()).to.equal(
      newWithdrawalDelay.toString()
    );

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("withdrawalDelayChanged");
    expect(events[0].data.oldDelay.toString()).to.equal(
      DEFAULT_WITHDRAWAL_DELAY.toString()
    );
    expect(events[0].data.newDelay.toString()).to.equal(
      newWithdrawalDelay.toString()
    );
  });

  it("non-owner cannot update withdrawal delay", async () => {
    const newWithdrawalDelay = new anchor.BN(1000);
    const nonOwner = Keypair.generate();
    client.svm.airdrop(nonOwner.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(
      client.updateWithdrawalDelay({ newWithdrawalDelay }, nonOwner),
      "InvalidAuthority"
    );
  });

  it("owner can set withdrawal delay to same value (idempotent)", async () => {
    const acct1 = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );

    const txSignature = await client.updateWithdrawalDelay({
      newWithdrawalDelay: acct1.withdrawalDelay,
    });

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("withdrawalDelayChanged");
    expect(events[0].data.oldDelay.toString()).to.equal(
      acct1.withdrawalDelay.toString()
    );
    expect(events[0].data.newDelay.toString()).to.equal(
      acct1.withdrawalDelay.toString()
    );
  });

  it("owner cannot set withdrawal delay to zero", async () => {
    const newWithdrawalDelay = new anchor.BN(0);
    await expectAnchorError(
      client.updateWithdrawalDelay({ newWithdrawalDelay }),
      "InvalidWithdrawalDelay"
    );

    // Verify state was not changed
    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.withdrawalDelay.toString()).to.equal(
      DEFAULT_WITHDRAWAL_DELAY.toString()
    );
  });

  it("owner can set withdrawal delay to very large value", async () => {
    const newWithdrawalDelay = new anchor.BN("18446744073709551615"); // max u64
    const txSignature = await client.updateWithdrawalDelay({
      newWithdrawalDelay,
    });

    const state = await client.gatewayWalletProgram.account.gatewayWallet.fetch(
      client.pdas.gatewayWallet.publicKey
    );
    expect(state.withdrawalDelay.toString()).to.equal(
      newWithdrawalDelay.toString()
    );

    const events = getEvents(
      client.svm,
      txSignature,
      client.gatewayWalletProgram
    );
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("withdrawalDelayChanged");
    expect(events[0].data.oldDelay.toString()).to.equal(
      DEFAULT_WITHDRAWAL_DELAY.toString()
    );
    expect(events[0].data.newDelay.toString()).to.equal(
      newWithdrawalDelay.toString()
    );
  });
});
