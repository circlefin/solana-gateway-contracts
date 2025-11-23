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
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expectAnchorError, getEvents, findPDA } from "../utils";
import { SOLANA_DOMAIN } from "../constants";

describe("GatewayWallet: addDelegate", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;
  let tokenMint: PublicKey;
  let mintAuthority: Keypair;
  let depositor: Keypair;
  let delegate: Keypair;
  let anotherDelegate: Keypair;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    mintAuthority = Keypair.generate();
    depositor = Keypair.generate();
    delegate = Keypair.generate();
    anotherDelegate = Keypair.generate();

    await client.initialize({ localDomain: SOLANA_DOMAIN });
    tokenMint = await client.createTokenMint(mintAuthority.publicKey, 6);
    await client.addToken({ tokenMint });

    svm.airdrop(depositor.publicKey, BigInt(10 * 1_000_000_000));
  });

  describe("Success Cases", () => {
    it("should successfully add a delegate", async () => {
      const txSignature = await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      expect(txSignature).to.be.a("string");

      const delegateAccount = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount.status).to.deep.equal({ authorized: {} });
      expect(delegateAccount.closeableAtBlock.toString()).to.equal("0");
      expect(delegateAccount.token.toString()).to.equal(tokenMint.toString());
      expect(delegateAccount.depositor.toString()).to.equal(
        depositor.publicKey.toString()
      );
      expect(delegateAccount.delegate.toString()).to.equal(
        delegate.publicKey.toString()
      );

      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.lengthOf(1);
      expect(events[0].name).to.equal("delegateAdded");
      expect(events[0].data.token.toString()).to.equal(tokenMint.toString());
      expect(events[0].data.depositor.toString()).to.equal(
        depositor.publicKey.toString()
      );
      expect(events[0].data.delegate.toString()).to.equal(
        delegate.publicKey.toString()
      );
    });

    it("should be idempotent - adding the same delegate multiple times", async () => {
      await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      const txSignature = await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      expect(txSignature).to.be.a("string");

      const delegateAccount = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount.status).to.deep.equal({ authorized: {} });
      expect(delegateAccount.token.toString()).to.equal(tokenMint.toString());
      expect(delegateAccount.depositor.toString()).to.equal(
        depositor.publicKey.toString()
      );
      expect(delegateAccount.delegate.toString()).to.equal(
        delegate.publicKey.toString()
      );

      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.lengthOf(1);
      expect(events[0].name).to.equal("delegateAdded");
    });

    it("should allow multiple different delegates for the same token", async () => {
      await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      await client.addDelegate(
        {
          tokenMint,
          delegate: anotherDelegate.publicKey,
        },
        { depositor }
      );

      const delegateAccount1 = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount1.status).to.deep.equal({ authorized: {} });
      expect(delegateAccount1.token.toString()).to.equal(tokenMint.toString());
      expect(delegateAccount1.depositor.toString()).to.equal(
        depositor.publicKey.toString()
      );
      expect(delegateAccount1.delegate.toString()).to.equal(
        delegate.publicKey.toString()
      );

      const delegateAccount2 = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        anotherDelegate.publicKey
      );
      expect(delegateAccount2.status).to.deep.equal({ authorized: {} });
      expect(delegateAccount2.token.toString()).to.equal(tokenMint.toString());
      expect(delegateAccount2.depositor.toString()).to.equal(
        depositor.publicKey.toString()
      );
      expect(delegateAccount2.delegate.toString()).to.equal(
        anotherDelegate.publicKey.toString()
      );
    });

    it("should allow the same delegate for different tokens", async () => {
      const anotherTokenMint = await client.createTokenMint(
        mintAuthority.publicKey,
        18
      );
      await client.addToken({ tokenMint: anotherTokenMint });

      await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      await client.addDelegate(
        {
          tokenMint: anotherTokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      const delegateAccount1 = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount1.status).to.deep.equal({ authorized: {} });
      expect(delegateAccount1.token.toString()).to.equal(tokenMint.toString());
      expect(delegateAccount1.depositor.toString()).to.equal(
        depositor.publicKey.toString()
      );
      expect(delegateAccount1.delegate.toString()).to.equal(
        delegate.publicKey.toString()
      );

      const delegateAccount2 = await client.getDelegateAccount(
        anotherTokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount2.status).to.deep.equal({ authorized: {} });
      expect(delegateAccount2.token.toString()).to.equal(
        anotherTokenMint.toString()
      );
      expect(delegateAccount2.depositor.toString()).to.equal(
        depositor.publicKey.toString()
      );
      expect(delegateAccount2.delegate.toString()).to.equal(
        delegate.publicKey.toString()
      );
    });

    it("should re-authorize a previously revoked delegate", async () => {
      await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      await client.removeDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        depositor
      );

      let delegateAccount = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount.status).to.deep.equal({ revoked: {} });

      const txSignature = await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      delegateAccount = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount.status).to.deep.equal({ authorized: {} });
      expect(delegateAccount.token.toString()).to.equal(tokenMint.toString());
      expect(delegateAccount.depositor.toString()).to.equal(
        depositor.publicKey.toString()
      );
      expect(delegateAccount.delegate.toString()).to.equal(
        delegate.publicKey.toString()
      );

      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.lengthOf(1);
      expect(events[0].name).to.equal("delegateAdded");
    });
  });

  describe("Error Cases", () => {
    it("should fail when delegate is zero address", async () => {
      await expectAnchorError(
        client.addDelegate(
          {
            tokenMint,
            delegate: PublicKey.default,
          },
          { depositor }
        ),
        "InvalidDelegate"
      );
    });

    it("should fail when delegate is the same as depositor (self-delegation)", async () => {
      await expectAnchorError(
        client.addDelegate(
          {
            tokenMint,
            delegate: depositor.publicKey,
          },
          { depositor }
        ),
        "CannotDelegateToSelf"
      );
    });

    it("should fail when token is not supported", async () => {
      const unsupportedToken = await client.createTokenMint(
        mintAuthority.publicKey,
        6
      );

      await expectAnchorError(
        client.addDelegate(
          {
            tokenMint: unsupportedToken,
            delegate: delegate.publicKey,
          },
          { depositor }
        ),
        "TokenNotSupported"
      );
    });

    it("should fail when using delegate account with wrong depositor", async () => {
      const anotherDepositor = Keypair.generate();
      client.svm.airdrop(anotherDepositor.publicKey, BigInt(LAMPORTS_PER_SOL));

      await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor: anotherDepositor }
      );

      const wrongDelegateAccountPDA = findPDA(
        [
          Buffer.from("gateway_delegate"),
          tokenMint.toBuffer(),
          anotherDepositor.publicKey.toBuffer(),
          delegate.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      const depositorDenylistPDA = findPDA(
        [Buffer.from("denylist"), depositor.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      );
      const delegateDenylistPDA = findPDA(
        [Buffer.from("denylist"), delegate.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      );

      await expectAnchorError(
        client.gatewayWalletProgram.methods
          .addDelegate(delegate.publicKey)
          .accountsPartial({
            depositor: depositor.publicKey,
            gatewayWallet: client.pdas.gatewayWallet.publicKey,
            tokenMint,
            delegateAccount: wrongDelegateAccountPDA.publicKey,
            depositorDenylist: depositorDenylistPDA.publicKey,
            delegateDenylist: delegateDenylistPDA.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([depositor])
          .rpc(),
        "ConstraintSeeds"
      );
    });

    it("should fail when using delegate account with wrong token", async () => {
      const anotherToken = await client.createTokenMint(
        mintAuthority.publicKey,
        6
      );
      await client.addToken({ tokenMint: anotherToken });

      await client.addDelegate(
        {
          tokenMint: anotherToken,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      const wrongTokenDelegateAccountPDA = findPDA(
        [
          Buffer.from("gateway_delegate"),
          anotherToken.toBuffer(),
          depositor.publicKey.toBuffer(),
          delegate.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      const depositorDenylistPDA = findPDA(
        [Buffer.from("denylist"), depositor.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      );
      const delegateDenylistPDA = findPDA(
        [Buffer.from("denylist"), delegate.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      );

      await expectAnchorError(
        client.gatewayWalletProgram.methods
          .addDelegate(delegate.publicKey)
          .accountsPartial({
            depositor: depositor.publicKey,
            gatewayWallet: client.pdas.gatewayWallet.publicKey,
            tokenMint,
            delegateAccount: wrongTokenDelegateAccountPDA.publicKey,
            depositorDenylist: depositorDenylistPDA.publicKey,
            delegateDenylist: delegateDenylistPDA.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([depositor])
          .rpc(),
        "ConstraintSeeds"
      );
    });

    it("should fail when using delegate account with wrong delegate address", async () => {
      const anotherDelegate = Keypair.generate();

      await client.addDelegate(
        {
          tokenMint,
          delegate: anotherDelegate.publicKey,
        },
        { depositor }
      );

      const wrongDelegatePDA = findPDA(
        [
          Buffer.from("gateway_delegate"),
          tokenMint.toBuffer(),
          depositor.publicKey.toBuffer(),
          anotherDelegate.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      const depositorDenylistPDA = findPDA(
        [Buffer.from("denylist"), depositor.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      );
      const delegateDenylistPDA = findPDA(
        [Buffer.from("denylist"), delegate.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      );

      await expectAnchorError(
        client.gatewayWalletProgram.methods
          .addDelegate(delegate.publicKey)
          .accountsPartial({
            depositor: depositor.publicKey,
            gatewayWallet: client.pdas.gatewayWallet.publicKey,
            tokenMint,
            delegateAccount: wrongDelegatePDA.publicKey,
            depositorDenylist: depositorDenylistPDA.publicKey,
            delegateDenylist: delegateDenylistPDA.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([depositor])
          .rpc(),
        "ConstraintSeeds"
      );
    });
  });

  describe("denylist checks for add delegate", () => {
    let denylister: Keypair;

    beforeEach(async () => {
      // Create and set denylister
      denylister = Keypair.generate();
      client.svm.airdrop(denylister.publicKey, BigInt(LAMPORTS_PER_SOL));
      await client.updateDenylister({ newDenylister: denylister.publicKey });
    });

    it("denylisted depositor cannot add delegate", async () => {
      // Denylist the depositor
      await client.denylist({ account: depositor.publicKey }, { denylister });

      // Verify depositor is denylisted
      const denylistAccount = await client.getDenylistAccount(
        depositor.publicKey
      );
      expect(denylistAccount).to.not.equal(null);

      // Add delegate should fail
      await expectAnchorError(
        client.addDelegate(
          {
            tokenMint,
            delegate: delegate.publicKey,
          },
          { depositor }
        ),
        "AccountDenylisted"
      );
    });

    it("depositor cannot add denylisted delegate", async () => {
      // Denylist the delegate
      await client.denylist({ account: delegate.publicKey }, { denylister });

      // Add delegate should fail
      await expectAnchorError(
        client.addDelegate(
          {
            tokenMint,
            delegate: delegate.publicKey,
          },
          { depositor }
        ),
        "AccountDenylisted"
      );
    });

    it("depositor can add delegate after being undenylisted", async () => {
      // Denylist then undenylist the depositor
      await client.denylist({ account: depositor.publicKey }, { denylister });
      await client.undenylist({ account: depositor.publicKey }, { denylister });

      // Verify depositor is no longer denylisted
      const denylistAccount = await client.getDenylistAccount(
        depositor.publicKey
      );
      expect(denylistAccount).to.equal(null);

      // Add delegate should succeed
      await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      // Verify delegate was added
      const delegateAccount = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount.status).to.deep.equal({ authorized: {} });
      expect(delegateAccount.token.toString()).to.equal(tokenMint.toString());
      expect(delegateAccount.depositor.toString()).to.equal(
        depositor.publicKey.toString()
      );
      expect(delegateAccount.delegate.toString()).to.equal(
        delegate.publicKey.toString()
      );
    });
  });
});
