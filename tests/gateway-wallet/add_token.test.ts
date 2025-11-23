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
import { expectAnchorError, findPDA, getEvents } from "../utils";
import { SOLANA_DOMAIN } from "../constants";

describe("GatewayWallet: addToken", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;
  let tokenMint: PublicKey;
  let mintAuthority: Keypair;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    // Create a test token mint
    mintAuthority = Keypair.generate();
    tokenMint = await client.createTokenMint(mintAuthority.publicKey, 6);
  });

  it("should successfully add a new token", async () => {
    const custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
      client.gatewayWalletProgram.programId
    );

    const txSignature = await client.addToken({
      tokenMint: tokenMint,
    });

    // Verify the token was added to the gateway wallet state
    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );

    expect(gatewayWalletAccount.supportedTokens).to.have.length(1);
    expect(gatewayWalletAccount.supportedTokens[0]).to.deep.equal(tokenMint);
    expect(gatewayWalletAccount.custodyTokenAccountBumps).to.have.length(1);
    expect(gatewayWalletAccount.custodyTokenAccountBumps[0]).to.equal(
      custodyTokenAccountPDA.bump
    );

    // Verify the custody token account was created
    const custodyTokenAccount = await client.provider.connection.getAccountInfo(
      custodyTokenAccountPDA.publicKey
    );
    expect(custodyTokenAccount).to.not.equal(null);

    // Verify TokenSupported event was emitted
    const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: "tokenSupported",
      data: {
        token: tokenMint,
        custodyTokenAccount: custodyTokenAccountPDA.publicKey,
      },
    });
  });

  it("should fail if not signed by token controller", async () => {
    const randomKey = Keypair.generate();
    svm.airdrop(randomKey.publicKey, BigInt(LAMPORTS_PER_SOL));

    await expectAnchorError(
      client.addToken(
        {
          tokenMint: tokenMint,
        },
        {
          payer: randomKey,
          tokenController: randomKey,
        }
      ),
      "InvalidAuthority"
    );
  });

  it("should be idempotent when token is already supported", async () => {
    // First, add the token successfully
    const firstTxSignature = await client.addToken({
      tokenMint: tokenMint,
    });

    // Verify the token was added
    let gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.supportedTokens).to.have.length(1);

    // Try to add the same token again - should succeed (idempotent)
    const secondTxSignature = await client.addToken({
      tokenMint: tokenMint,
    });

    // Verify the token count is still 1 (not added twice)
    gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.supportedTokens).to.have.length(1);

    // Verify both transactions emitted TokenSupported events for idempotency
    const firstEvents = getEvents(
      svm,
      firstTxSignature,
      client.gatewayWalletProgram
    );
    expect(firstEvents).to.have.length(1);
    expect(firstEvents[0].name).to.equal("tokenSupported");

    const secondEvents = getEvents(
      svm,
      secondTxSignature,
      client.gatewayWalletProgram
    );
    expect(secondEvents).to.have.length(1);
    expect(secondEvents[0].name).to.equal("tokenSupported");
  });

  it("should be able to add multiple different tokens", async () => {
    // Create a second token mint
    const secondTokenMint = await client.createTokenMint(
      mintAuthority.publicKey,
      9
    );

    // Add first token
    const firstTxSignature = await client.addToken({
      tokenMint: tokenMint,
    });

    // Add second token
    const secondTxSignature = await client.addToken({
      tokenMint: secondTokenMint,
    });

    // Verify both tokens were added
    const gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );

    expect(gatewayWalletAccount.supportedTokens).to.have.length(2);
    expect(gatewayWalletAccount.supportedTokens).to.include.deep.members([
      tokenMint,
      secondTokenMint,
    ]);
    expect(gatewayWalletAccount.custodyTokenAccountBumps).to.have.length(2);

    // Verify both TokenSupported events were emitted
    const firstEvents = getEvents(
      svm,
      firstTxSignature,
      client.gatewayWalletProgram
    );
    expect(firstEvents).to.have.length(1);
    const firstCustodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
      client.gatewayWalletProgram.programId
    );
    expect(firstEvents[0]).to.deep.equal({
      name: "tokenSupported",
      data: {
        token: tokenMint,
        custodyTokenAccount: firstCustodyTokenAccountPDA.publicKey,
      },
    });

    const secondEvents = getEvents(
      svm,
      secondTxSignature,
      client.gatewayWalletProgram
    );
    expect(secondEvents).to.have.length(1);
    const secondCustodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_wallet_custody"), secondTokenMint.toBuffer()],
      client.gatewayWalletProgram.programId
    );
    expect(secondEvents[0]).to.deep.equal({
      name: "tokenSupported",
      data: {
        token: secondTokenMint,
        custodyTokenAccount: secondCustodyTokenAccountPDA.publicKey,
      },
    });
  });

  it("should fail if custody token account seeds don't match", async () => {
    // Create custody token account with wrong seeds
    const wrongCustodyTokenAccountPDA = findPDA(
      [Buffer.from("wrong_seed"), tokenMint.toBuffer()],
      client.gatewayWalletProgram.programId
    );

    await expectAnchorError(
      client.addToken({
        tokenMint: tokenMint,
        custodyTokenAccount: wrongCustodyTokenAccountPDA.publicKey,
      }),
      "ConstraintSeeds"
    );
  });

  it("should be idempotent when max number of tokens is already supported", async () => {
    // Add 10 tokens (the maximum)
    const addedTokens: PublicKey[] = [];
    for (let i = 0; i < 10; i++) {
      const newTokenMint = await client.createTokenMint(
        mintAuthority.publicKey,
        6
      );
      addedTokens.push(newTokenMint);

      await client.addToken({
        tokenMint: newTokenMint,
      });
    }

    // Verify we have 10 tokens
    let gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.supportedTokens).to.have.length(10);

    // Try to add the first token again - should succeed (idempotent)
    await client.addToken({
      tokenMint: addedTokens[0],
    });

    // Verify we still have 10 tokens
    gatewayWalletAccount =
      await client.gatewayWalletProgram.account.gatewayWallet.fetch(
        client.pdas.gatewayWallet.publicKey
      );
    expect(gatewayWalletAccount.supportedTokens).to.have.length(10);
  });
});
