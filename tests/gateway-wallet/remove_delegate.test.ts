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
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expectAnchorError, getEvents, findPDA } from "../utils";
import { SOLANA_DOMAIN } from "../constants";

describe("GatewayWallet: removeDelegate", () => {
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
    it("should successfully remove an authorized delegate", async () => {
      await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );

      let delegateAccount = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount.status).to.deep.equal({ authorized: {} });

      const txSignature = await client.removeDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        depositor
      );

      expect(txSignature).to.be.a("string");

      delegateAccount = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount.status).to.deep.equal({ revoked: {} });
      expect(delegateAccount.closeableAtBlock.toString()).to.equal("0");

      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.lengthOf(1);
      expect(events[0].name).to.equal("delegateRemoved");
      expect(events[0].data.token.toString()).to.equal(tokenMint.toString());
      expect(events[0].data.depositor.toString()).to.equal(
        depositor.publicKey.toString()
      );
      expect(events[0].data.delegate.toString()).to.equal(
        delegate.publicKey.toString()
      );
    });

    it("should be idempotent when removing already revoked delegate", async () => {
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

      // Second removal should succeed (idempotent)
      const txSignature = await client.removeDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        depositor
      );

      expect(txSignature).to.be.a("string");

      delegateAccount = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount.status).to.deep.equal({ revoked: {} });

      // Does not emit an event the second time
      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.lengthOf(0);
    });

    it("should only remove the specific delegate, not affect others", async () => {
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

      await client.removeDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        depositor
      );

      const delegateAccount1 = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount1.status).to.deep.equal({ revoked: {} });

      const delegateAccount2 = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        anotherDelegate.publicKey
      );
      expect(delegateAccount2.status).to.deep.equal({ authorized: {} });
    });

    it("should handle removing delegate across different tokens independently", async () => {
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

      await client.removeDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        depositor
      );

      const delegateAccount1 = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount1.status).to.deep.equal({ revoked: {} });

      const delegateAccount2 = await client.getDelegateAccount(
        anotherTokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount2.status).to.deep.equal({ authorized: {} });
    });
  });

  it("should fail when trying to remove non-existent delegate", async () => {
    await expectAnchorError(
      client.removeDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        depositor
      ),
      "AccountNotInitialized"
    );
  });

  describe("Edge Cases", () => {
    it("should handle removing delegate across different depositors independently", async () => {
      const anotherDepositor = Keypair.generate();
      svm.airdrop(anotherDepositor.publicKey, BigInt(10 * 1_000_000_000));

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
          delegate: delegate.publicKey,
        },
        { depositor: anotherDepositor }
      );

      await client.removeDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        depositor
      );

      const delegateAccount1 = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount1.status).to.deep.equal({ revoked: {} });

      const delegateAccount2 = await client.getDelegateAccount(
        tokenMint,
        anotherDepositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount2.status).to.deep.equal({ authorized: {} });
    });

    it("should fail when using delegate account with wrong depositor", async () => {
      const anotherDepositor = Keypair.generate();
      client.svm.airdrop(anotherDepositor.publicKey, BigInt(LAMPORTS_PER_SOL));

      await client.addDelegate(
        { tokenMint, delegate: delegate.publicKey },
        { depositor }
      );
      await client.addDelegate(
        { tokenMint, delegate: delegate.publicKey },
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

      await expectAnchorError(
        client.gatewayWalletProgram.methods
          .removeDelegate(delegate.publicKey)
          .accountsPartial({
            depositor: depositor.publicKey,
            gatewayWallet: client.pdas.gatewayWallet.publicKey,
            tokenMint,
            delegateAccount: wrongDelegateAccountPDA.publicKey,
            depositorDenylist: depositorDenylistPDA.publicKey,
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
        { tokenMint, delegate: delegate.publicKey },
        { depositor }
      );
      await client.addDelegate(
        { tokenMint: anotherToken, delegate: delegate.publicKey },
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

      await expectAnchorError(
        client.gatewayWalletProgram.methods
          .removeDelegate(delegate.publicKey)
          .accountsPartial({
            depositor: depositor.publicKey,
            gatewayWallet: client.pdas.gatewayWallet.publicKey,
            tokenMint,
            delegateAccount: wrongTokenDelegateAccountPDA.publicKey,
            depositorDenylist: depositorDenylistPDA.publicKey,
          })
          .signers([depositor])
          .rpc(),
        "ConstraintSeeds"
      );
    });

    it("should fail when using delegate account with wrong delegate address", async () => {
      const anotherDelegate = Keypair.generate();

      await client.addDelegate(
        { tokenMint, delegate: delegate.publicKey },
        { depositor }
      );
      await client.addDelegate(
        { tokenMint, delegate: anotherDelegate.publicKey },
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

      await expectAnchorError(
        client.gatewayWalletProgram.methods
          .removeDelegate(delegate.publicKey)
          .accountsPartial({
            depositor: depositor.publicKey,
            gatewayWallet: client.pdas.gatewayWallet.publicKey,
            tokenMint,
            delegateAccount: wrongDelegatePDA.publicKey,
            depositorDenylist: depositorDenylistPDA.publicKey,
          })
          .signers([depositor])
          .rpc(),
        "ConstraintSeeds"
      );
    });
  });

  describe("denylist checks for remove delegate", () => {
    let denylister: Keypair;

    beforeEach(async () => {
      // Create and set denylister
      denylister = Keypair.generate();
      client.svm.airdrop(denylister.publicKey, BigInt(LAMPORTS_PER_SOL));
      await client.updateDenylister({ newDenylister: denylister.publicKey });

      // Add a delegate first so we can test removing it
      await client.addDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        { depositor }
      );
    });

    it("denylisted depositor cannot remove delegate", async () => {
      await client.denylist({ account: depositor.publicKey }, { denylister });

      const denylistAccount = await client.getDenylistAccount(
        depositor.publicKey
      );
      expect(denylistAccount).to.not.equal(null);

      await expectAnchorError(
        client.removeDelegate(
          {
            tokenMint,
            delegate: delegate.publicKey,
          },
          depositor
        ),
        "AccountDenylisted"
      );
    });

    it("depositor can remove delegate after being undenylisted", async () => {
      await client.denylist({ account: depositor.publicKey }, { denylister });
      await client.undenylist({ account: depositor.publicKey }, { denylister });

      const denylistAccount = await client.getDenylistAccount(
        depositor.publicKey
      );
      expect(denylistAccount).to.equal(null);

      await client.removeDelegate(
        {
          tokenMint,
          delegate: delegate.publicKey,
        },
        depositor
      );

      const delegateAccount = await client.getDelegateAccount(
        tokenMint,
        depositor.publicKey,
        delegate.publicKey
      );
      expect(delegateAccount.status).to.deep.equal({ revoked: {} });
    });
  });
});
