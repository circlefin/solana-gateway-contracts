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
import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { expectAnchorError, findPDA, getEvents } from "../utils";
import { SOLANA_DOMAIN } from "../constants";

describe("burnTokenCustody", () => {
  let svm: LiteSVM;
  let client: GatewayMinterTestClient;
  let tokenMint: PublicKey;
  let custodyTokenAccountPDA: { publicKey: PublicKey; bump: number };
  let mintAuthority: Keypair;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayMinterTestClient(svm);
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    // Create a test token mint
    mintAuthority = Keypair.generate();
    svm.airdrop(mintAuthority.publicKey, BigInt(LAMPORTS_PER_SOL));

    tokenMint = await client.createTokenMint(mintAuthority.publicKey, 6);

    // Add the token to the gateway minter
    custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_minter_custody"), tokenMint.toBuffer()],
      client.gatewayMinterProgram.programId
    );

    await client.addToken({
      tokenMint: tokenMint,
      custodyTokenAccount: custodyTokenAccountPDA.publicKey,
    });
  });

  it("should successfully burn tokens from custody account", async () => {
    const burnAmount = 1000000; // 1 token (6 decimals)

    // Mint tokens to custody account
    await client.mintToken(
      tokenMint,
      custodyTokenAccountPDA.publicKey,
      burnAmount,
      mintAuthority
    );

    // Verify initial balance
    const initialAccount = await getAccount(
      client.provider.connection,
      custodyTokenAccountPDA.publicKey
    );
    expect(Number(initialAccount.amount)).to.equal(burnAmount);

    // Burn tokens
    const txSignature = await client.burnTokenCustody({
      amount: new anchor.BN(burnAmount),
      tokenMint: tokenMint,
      custodyTokenAccount: custodyTokenAccountPDA.publicKey,
    });

    // Verify tokens were burned
    const finalAccount = await getAccount(
      client.provider.connection,
      custodyTokenAccountPDA.publicKey
    );
    expect(Number(finalAccount.amount)).to.equal(0);

    // Verify TokenCustodyBurned event was emitted
    const events = getEvents(svm, txSignature, client.gatewayMinterProgram);
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("tokenCustodyBurned");
    expect(events[0].data.token).to.deep.equal(tokenMint);
    expect(events[0].data.custodyTokenAccount).to.deep.equal(
      custodyTokenAccountPDA.publicKey
    );
    expect(events[0].data.amount.toString()).to.equal(burnAmount.toString());
  });

  it("should successfully burn partial amount from custody account", async () => {
    const totalAmount = 2000000; // 2 tokens
    const burnAmount = 500000; // 0.5 tokens
    const expectedRemaining = totalAmount - burnAmount;

    // Mint tokens to custody account
    await client.mintToken(
      tokenMint,
      custodyTokenAccountPDA.publicKey,
      totalAmount,
      mintAuthority
    );

    // Burn partial amount
    const txSignature = await client.burnTokenCustody({
      amount: new anchor.BN(burnAmount),
      tokenMint: tokenMint,
      custodyTokenAccount: custodyTokenAccountPDA.publicKey,
    });

    // Verify remaining balance
    const finalAccount = await getAccount(
      client.provider.connection,
      custodyTokenAccountPDA.publicKey
    );
    expect(Number(finalAccount.amount)).to.equal(expectedRemaining);

    // Verify TokenCustodyBurned event was emitted with correct amount
    const events = getEvents(svm, txSignature, client.gatewayMinterProgram);
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("tokenCustodyBurned");
    expect(events[0].data.token).to.deep.equal(tokenMint);
    expect(events[0].data.custodyTokenAccount).to.deep.equal(
      custodyTokenAccountPDA.publicKey
    );
    expect(events[0].data.amount.toString()).to.equal(burnAmount.toString());
  });

  it("should successfully burn up to the requested amount", async () => {
    const availableAmount = 500000; // 0.5 tokens
    const burnAmount = 1000000; // 1 token (more than available)

    await client.mintToken(
      tokenMint,
      custodyTokenAccountPDA.publicKey,
      availableAmount,
      mintAuthority
    );

    const txSignature = await client.burnTokenCustody({
      amount: new anchor.BN(burnAmount),
      tokenMint: tokenMint,
      custodyTokenAccount: custodyTokenAccountPDA.publicKey,
    });

    // Verify tokens were burned
    const custodyAccount = await client.getTokenAccount(
      custodyTokenAccountPDA.publicKey
    );
    expect(Number(custodyAccount.amount)).to.equal(0);

    // Verify TokenCustodyBurned event was emitted with correct amount
    const events = getEvents(svm, txSignature, client.gatewayMinterProgram);
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("tokenCustodyBurned");
    expect(events[0].data.token).to.deep.equal(tokenMint);
    expect(events[0].data.custodyTokenAccount).to.deep.equal(
      custodyTokenAccountPDA.publicKey
    );

    // Verify that the entire starting balance was burned
    expect(events[0].data.amount.toString()).to.equal(
      availableAmount.toString()
    );
  });

  it("should successfully burn nothing if the custody account has zero balance", async () => {
    // Don't mint any tokens to custody account, so balance is 0 when burning
    const txSignature = await client.burnTokenCustody({
      amount: new anchor.BN(1000000),
      tokenMint: tokenMint,
      custodyTokenAccount: custodyTokenAccountPDA.publicKey,
    });

    // Token custody balance remains zero
    const custodyAccount = await client.getTokenAccount(
      custodyTokenAccountPDA.publicKey
    );
    expect(Number(custodyAccount.amount)).to.equal(0);

    // Verify TokenCustodyBurned event was emitted with correct amount
    const events = getEvents(svm, txSignature, client.gatewayMinterProgram);
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("tokenCustodyBurned");
    expect(events[0].data.token).to.deep.equal(tokenMint);
    expect(events[0].data.custodyTokenAccount).to.deep.equal(
      custodyTokenAccountPDA.publicKey
    );

    // Verify that the burn amount is zero
    expect(events[0].data.amount.toString()).to.equal("0");
  });

  it("should fail if not signed by token controller", async () => {
    const burnAmount = 1000000;
    await client.mintToken(
      tokenMint,
      custodyTokenAccountPDA.publicKey,
      burnAmount,
      mintAuthority
    );

    const randomKey = Keypair.generate();
    svm.airdrop(randomKey.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(
      client.burnTokenCustody(
        {
          amount: new anchor.BN(burnAmount),
          tokenMint: tokenMint,
          custodyTokenAccount: custodyTokenAccountPDA.publicKey,
        },
        randomKey
      ),
      "InvalidAuthority"
    );
  });

  it("should fail if token is not supported", async () => {
    // Create an unsupported token
    const unsupportedTokenMint = await client.createTokenMint(
      mintAuthority.publicKey,
      6
    );

    // Create a token account for the unsupported token
    const unsupportedTokenAccount = await client.createTokenAccount(
      unsupportedTokenMint,
      Keypair.generate()
    );

    await expectAnchorError(
      client.burnTokenCustody({
        amount: new anchor.BN(1000000),
        tokenMint: unsupportedTokenMint,
        custodyTokenAccount: unsupportedTokenAccount,
      }),
      "TokenNotSupported"
    );
  });

  it("should fail if burn amount is zero", async () => {
    await expectAnchorError(
      client.burnTokenCustody({
        amount: new anchor.BN(0),
        tokenMint: tokenMint,
        custodyTokenAccount: custodyTokenAccountPDA.publicKey,
      }),
      "InvalidBurnAmount"
    );
  });

  it("should fail if wrong custody token account is provided", async () => {
    await client.mintToken(
      tokenMint,
      custodyTokenAccountPDA.publicKey,
      1000000,
      mintAuthority
    );

    // Create a random token account
    const randomKey = Keypair.generate();
    const wrongCustodyAccount = await client.createTokenAccount(
      tokenMint,
      randomKey
    );

    await expectAnchorError(
      client.burnTokenCustody({
        amount: new anchor.BN(1000000),
        tokenMint: tokenMint,
        custodyTokenAccount: wrongCustodyAccount,
      }),
      "ConstraintSeeds"
    );
  });
});
