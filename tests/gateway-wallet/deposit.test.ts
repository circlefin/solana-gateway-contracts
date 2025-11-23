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
  expectAnchorError,
  expectSPLTokenInsufficientFundsError,
  findPDA,
  getEvents,
} from "../utils";
import { SOLANA_DOMAIN } from "../constants";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

describe("GatewayWallet: deposit", () => {
  let svm: LiteSVM;
  let client: GatewayWalletTestClient;
  let tokenMint: PublicKey;
  let mintAuthority: Keypair;
  let depositor: Keypair;
  let depositorTokenAccount: PublicKey;
  let custodyTokenAccount: PublicKey;

  const depositorPrefundAmount = 1000000;

  beforeEach(async () => {
    svm = new LiteSVM();
    client = new GatewayWalletTestClient(svm);
    await client.initialize({
      localDomain: SOLANA_DOMAIN,
    });

    // Create a test token mint
    mintAuthority = Keypair.generate();
    tokenMint = await client.createTokenMint(mintAuthority.publicKey, 6);

    // Add token to gateway wallet
    await client.addToken({
      tokenMint: tokenMint,
    });
    custodyTokenAccount = findPDA(
      [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
      client.gatewayWalletProgram.programId
    ).publicKey;

    // Create depositor and their token account
    depositor = Keypair.generate();
    svm.airdrop(depositor.publicKey, BigInt(LAMPORTS_PER_SOL));
    depositorTokenAccount = await client.createTokenAccount(
      tokenMint,
      depositor.publicKey
    );

    // Mint some tokens to depositor
    await client.mintToken(
      tokenMint,
      depositorTokenAccount,
      depositorPrefundAmount,
      mintAuthority
    );
  });

  it("should successfully deposit tokens", async () => {
    const depositAmount = 100000;

    const txSignature = await client.deposit(
      {
        tokenMint: tokenMint,
        amount: depositAmount,
        fromTokenAccount: depositorTokenAccount,
      },
      { owner: depositor }
    );

    // Verify the deposit account was created and updated
    const depositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        tokenMint.toBuffer(),
        depositor.publicKey.toBuffer(),
      ],
      client.gatewayWalletProgram.programId
    );
    const depositData =
      await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    expect(depositData.depositor).to.deep.equal(depositor.publicKey);
    expect(depositData.availableAmount.toNumber()).to.equal(depositAmount);
    expect(depositData.withdrawingAmount.toNumber()).to.equal(0);
    expect(depositData.withdrawalBlock.toNumber()).to.equal(0);

    // Verify tokens were transferred to custody account
    const custodyTokenAccountData = await client.getTokenAccount(
      custodyTokenAccount
    );
    expect(custodyTokenAccountData.amount).to.equal(BigInt(depositAmount));

    // Verify depositor token account balance decreased
    const depositorTokenAccountData = await client.getTokenAccount(
      depositorTokenAccount
    );
    expect(depositorTokenAccountData.amount).to.equal(
      BigInt(depositorPrefundAmount - depositAmount)
    );

    // Verify an event was emitted
    const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
    expect(events).to.have.length(1);
    expect(events[0].name).to.equal("deposited");
    expect(events[0].data.token).to.deep.equal(tokenMint);
    expect(events[0].data.sender).to.deep.equal(depositor.publicKey);
    expect(events[0].data.depositor).to.deep.equal(depositor.publicKey);
    expect(events[0].data.value.toString()).to.equal(depositAmount.toString());
  });

  it("should accumulate multiple deposits", async () => {
    const firstDepositAmount = 50000;
    const secondDepositAmount = 75000;

    // First deposit
    await client.deposit(
      {
        tokenMint: tokenMint,
        amount: firstDepositAmount,
        fromTokenAccount: depositorTokenAccount,
      },
      { owner: depositor }
    );

    // Second deposit
    await client.deposit(
      {
        tokenMint: tokenMint,
        amount: secondDepositAmount,
        fromTokenAccount: depositorTokenAccount,
      },
      { owner: depositor }
    );

    // Verify the deposit account shows accumulated amount
    const depositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        tokenMint.toBuffer(),
        depositor.publicKey.toBuffer(),
      ],
      client.gatewayWalletProgram.programId
    );

    const depositAccount =
      await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
        depositPDA.publicKey
      );

    expect(depositAccount.availableAmount.toNumber()).to.equal(
      firstDepositAmount + secondDepositAmount
    );

    // Verify custody account has total amount
    const custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
      client.gatewayWalletProgram.programId
    );

    const custodyTokenAccount = await client.getTokenAccount(
      custodyTokenAccountPDA.publicKey
    );
    expect(custodyTokenAccount.amount).to.equal(
      BigInt(firstDepositAmount + secondDepositAmount)
    );
  });

  it("should fail if deposit amount is zero", async () => {
    await expectAnchorError(
      client.deposit(
        {
          tokenMint: tokenMint,
          amount: 0,
          fromTokenAccount: depositorTokenAccount,
        },
        { owner: depositor }
      ),
      "InvalidDepositAmount"
    );
  });

  it("should fail if depositor has insufficient tokens", async () => {
    const depositAmount = 2000000; // More than the 1000000 minted

    await expectSPLTokenInsufficientFundsError(
      client.deposit(
        {
          tokenMint: tokenMint,
          amount: depositAmount,
          fromTokenAccount: depositorTokenAccount,
        },
        { owner: depositor }
      )
    );
  });

  it("should fail if token is not supported by gateway", async () => {
    // Create a new token that is not added to the gateway
    const unsupportedTokenMint = await client.createTokenMint(
      mintAuthority.publicKey,
      6
    );

    const depositorUnsupportedTokenAccount = await client.createTokenAccount(
      unsupportedTokenMint,
      depositor.publicKey
    );
    await client.mintToken(
      unsupportedTokenMint,
      depositorUnsupportedTokenAccount,
      100000,
      mintAuthority
    );

    // Create a fake custody token account for the unsupported token
    const fakeCustodyTokenAccount = await client.createTokenAccount(
      unsupportedTokenMint,
      depositor.publicKey
    );

    const depositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        unsupportedTokenMint.toBuffer(),
        depositor.publicKey.toBuffer(),
      ],
      client.gatewayWalletProgram.programId
    );

    const depositorDenylistPDA = findPDA(
      [Buffer.from("denylist"), depositor.publicKey.toBuffer()],
      client.gatewayWalletProgram.programId
    );

    await expectAnchorError(
      client.gatewayWalletProgram.methods
        .deposit(new BN(50000))
        .accountsPartial({
          owner: depositor.publicKey,
          gatewayWallet: client.pdas.gatewayWallet.publicKey,
          ownerTokenAccount: depositorUnsupportedTokenAccount,
          custodyTokenAccount: fakeCustodyTokenAccount,
          deposit: depositPDA.publicKey,
          depositorDenylist: depositorDenylistPDA.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor])
        .rpc(),
      "TokenNotSupported"
    );
  });

  it("should fail if wrong depositor token account is provided", async () => {
    // Create another depositor with their own token account
    const anotherDepositor = Keypair.generate();
    svm.airdrop(anotherDepositor.publicKey, BigInt(LAMPORTS_PER_SOL));

    const anotherDepositorTokenAccount = await client.createTokenAccount(
      tokenMint,
      anotherDepositor.publicKey
    );
    await client.mintToken(
      tokenMint,
      anotherDepositorTokenAccount,
      100000,
      mintAuthority
    );

    // Try to deposit using another depositor's token account
    await expectAnchorError(
      client.deposit(
        {
          tokenMint: tokenMint,
          amount: 50000,
          fromTokenAccount: anotherDepositorTokenAccount,
        },
        { owner: depositor }
      ),
      "ConstraintTokenOwner"
    );
  });

  it("should fail if wrong custody token account is provided", async () => {
    const randomCustodyTokenAccount = await client.createTokenAccount(
      tokenMint,
      Keypair.generate().publicKey
    );

    const depositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        tokenMint.toBuffer(),
        depositor.publicKey.toBuffer(),
      ],
      client.gatewayWalletProgram.programId
    );

    svm.expireBlockhash();

    expectAnchorError(
      client.gatewayWalletProgram.methods
        .deposit(new BN(50000))
        .accountsPartial({
          owner: depositor.publicKey,
          gatewayWallet: client.pdas.gatewayWallet.publicKey,
          ownerTokenAccount: depositorTokenAccount,
          custodyTokenAccount: randomCustodyTokenAccount,
          deposit: depositPDA.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor])
        .rpc(),
      "ConstraintSeeds"
    );
  });

  it("should work for multiple depositors with the same token", async () => {
    const secondDepositor = Keypair.generate();
    svm.airdrop(secondDepositor.publicKey, BigInt(LAMPORTS_PER_SOL));

    const secondDepositorTokenAccount = await client.createTokenAccount(
      tokenMint,
      secondDepositor.publicKey
    );
    await client.mintToken(
      tokenMint,
      secondDepositorTokenAccount,
      500000,
      mintAuthority
    );

    const firstDepositAmount = 100000;
    const secondDepositAmount = 200000;

    // First depositor deposits
    await client.deposit(
      {
        tokenMint: tokenMint,
        amount: firstDepositAmount,
        fromTokenAccount: depositorTokenAccount,
      },
      { owner: depositor }
    );

    // Second depositor deposits
    await client.deposit(
      {
        tokenMint: tokenMint,
        amount: secondDepositAmount,
        fromTokenAccount: secondDepositorTokenAccount,
      },
      { owner: secondDepositor }
    );

    // Verify both deposit accounts exist with correct amounts
    const firstDepositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        tokenMint.toBuffer(),
        depositor.publicKey.toBuffer(),
      ],
      client.gatewayWalletProgram.programId
    );

    const secondDepositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        tokenMint.toBuffer(),
        secondDepositor.publicKey.toBuffer(),
      ],
      client.gatewayWalletProgram.programId
    );

    const firstDepositAccount =
      await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
        firstDepositPDA.publicKey
      );
    const secondDepositAccount =
      await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
        secondDepositPDA.publicKey
      );

    expect(firstDepositAccount.availableAmount.toNumber()).to.equal(
      firstDepositAmount
    );
    expect(secondDepositAccount.availableAmount.toNumber()).to.equal(
      secondDepositAmount
    );

    // Verify custody account has total from both depositors
    const custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
      client.gatewayWalletProgram.programId
    );

    const custodyTokenAccount = await client.getTokenAccount(
      custodyTokenAccountPDA.publicKey
    );
    expect(custodyTokenAccount.amount).to.equal(
      BigInt(firstDepositAmount + secondDepositAmount)
    );
  });

  describe("depositFor", () => {
    let sender: Keypair;
    let senderTokenAccount: PublicKey;
    let beneficiary: Keypair;

    beforeEach(async () => {
      // Create sender with tokens
      sender = Keypair.generate();
      svm.airdrop(sender.publicKey, BigInt(LAMPORTS_PER_SOL));
      senderTokenAccount = await client.createTokenAccount(
        tokenMint,
        sender.publicKey
      );
      await client.mintToken(
        tokenMint,
        senderTokenAccount,
        depositorPrefundAmount,
        mintAuthority
      );

      // Create beneficiary (doesn't need tokens)
      beneficiary = Keypair.generate();
      svm.airdrop(beneficiary.publicKey, BigInt(LAMPORTS_PER_SOL));
    });

    it("should successfully deposit tokens for another user", async () => {
      const depositAmount = 100000;

      const txSignature = await client.deposit(
        {
          tokenMint: tokenMint,
          amount: depositAmount,
          fromTokenAccount: senderTokenAccount,
          forDepositor: beneficiary.publicKey,
        },
        { owner: sender }
      );

      // Verify the deposit account was created for the beneficiary
      const depositPDA = findPDA(
        [
          Buffer.from("gateway_deposit"),
          tokenMint.toBuffer(),
          beneficiary.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );
      const depositData =
        await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
          depositPDA.publicKey
        );

      expect(depositData.depositor).to.deep.equal(beneficiary.publicKey);
      expect(depositData.availableAmount.toNumber()).to.equal(depositAmount);
      expect(depositData.withdrawingAmount.toNumber()).to.equal(0);
      expect(depositData.withdrawalBlock.toNumber()).to.equal(0);

      // Verify tokens were transferred to custody account
      const custodyTokenAccountData = await client.getTokenAccount(
        custodyTokenAccount
      );
      expect(custodyTokenAccountData.amount).to.equal(BigInt(depositAmount));

      // Verify sender's token account balance decreased
      const senderTokenAccountData = await client.getTokenAccount(
        senderTokenAccount
      );
      expect(senderTokenAccountData.amount).to.equal(
        BigInt(depositorPrefundAmount - depositAmount)
      );

      // Verify an event was emitted with correct depositor and sender
      const events = getEvents(svm, txSignature, client.gatewayWalletProgram);
      expect(events).to.have.length(1);
      expect(events[0].name).to.equal("deposited");
      expect(events[0].data.token).to.deep.equal(tokenMint);
      expect(events[0].data.sender).to.deep.equal(sender.publicKey);
      expect(events[0].data.depositor).to.deep.equal(beneficiary.publicKey);
      expect(events[0].data.value.toString()).to.equal(
        depositAmount.toString()
      );
    });

    it("should accumulate multiple deposits for the same depositor", async () => {
      const firstDepositAmount = 50000;
      const secondDepositAmount = 75000;

      // First deposit from sender
      await client.deposit(
        {
          tokenMint: tokenMint,
          amount: firstDepositAmount,
          fromTokenAccount: senderTokenAccount,
          forDepositor: beneficiary.publicKey,
        },
        { owner: sender }
      );

      // Second deposit from sender for same beneficiary
      await client.deposit(
        {
          tokenMint: tokenMint,
          amount: secondDepositAmount,
          fromTokenAccount: senderTokenAccount,
          forDepositor: beneficiary.publicKey,
        },
        { owner: sender }
      );

      // Verify the deposit account shows accumulated amount
      const depositPDA = findPDA(
        [
          Buffer.from("gateway_deposit"),
          tokenMint.toBuffer(),
          beneficiary.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      const depositAccount =
        await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
          depositPDA.publicKey
        );

      expect(depositAccount.availableAmount.toNumber()).to.equal(
        firstDepositAmount + secondDepositAmount
      );

      // Verify custody account has total amount
      const custodyTokenAccountData = await client.getTokenAccount(
        custodyTokenAccount
      );
      expect(custodyTokenAccountData.amount).to.equal(
        BigInt(firstDepositAmount + secondDepositAmount)
      );
    });

    it("should fail if deposit amount is zero", async () => {
      await expectAnchorError(
        client.deposit(
          {
            tokenMint: tokenMint,
            amount: 0,
            fromTokenAccount: senderTokenAccount,
            forDepositor: beneficiary.publicKey,
          },
          { owner: sender }
        ),
        "InvalidDepositAmount"
      );
    });

    it("should fail if depositor is the default pubkey", async () => {
      const depositAmount = 50000;

      await expectAnchorError(
        client.deposit(
          {
            tokenMint: tokenMint,
            amount: depositAmount,
            fromTokenAccount: senderTokenAccount,
            forDepositor: PublicKey.default,
          },
          { owner: sender }
        ),
        "InvalidDepositor"
      );
    });

    it("should fail if sender has insufficient tokens", async () => {
      const depositAmount = 2000000; // More than the 1000000 minted

      await expectSPLTokenInsufficientFundsError(
        client.deposit(
          {
            tokenMint: tokenMint,
            amount: depositAmount,
            fromTokenAccount: senderTokenAccount,
            forDepositor: beneficiary.publicKey,
          },
          { owner: sender }
        )
      );
    });

    it("should fail if token is not supported by gateway", async () => {
      // Create a new token that is not added to the gateway
      const unsupportedTokenMint = await client.createTokenMint(
        mintAuthority.publicKey,
        6
      );

      const senderUnsupportedTokenAccount = await client.createTokenAccount(
        unsupportedTokenMint,
        sender.publicKey
      );
      await client.mintToken(
        unsupportedTokenMint,
        senderUnsupportedTokenAccount,
        100000,
        mintAuthority
      );

      // Create a fake custody token account for the unsupported token
      const fakeCustodyTokenAccount = await client.createTokenAccount(
        unsupportedTokenMint,
        sender.publicKey
      );

      const depositPDA = findPDA(
        [
          Buffer.from("gateway_deposit"),
          unsupportedTokenMint.toBuffer(),
          beneficiary.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      const senderDenylistPDA = findPDA(
        [Buffer.from("denylist"), sender.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      );
      const beneficiaryDenylistPDA = findPDA(
        [Buffer.from("denylist"), beneficiary.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      );

      await expectAnchorError(
        client.gatewayWalletProgram.methods
          .depositFor(new BN(50000), beneficiary.publicKey)
          .accountsPartial({
            owner: sender.publicKey,
            gatewayWallet: client.pdas.gatewayWallet.publicKey,
            ownerTokenAccount: senderUnsupportedTokenAccount,
            custodyTokenAccount: fakeCustodyTokenAccount,
            deposit: depositPDA.publicKey,
            senderDenylist: senderDenylistPDA.publicKey,
            depositorDenylist: beneficiaryDenylistPDA.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([sender])
          .rpc(),
        "TokenNotSupported"
      );
    });

    it("should fail if wrong sender token account is provided", async () => {
      // Create another sender with their own token account
      const anotherSender = Keypair.generate();
      svm.airdrop(anotherSender.publicKey, BigInt(LAMPORTS_PER_SOL));

      const anotherSenderTokenAccount = await client.createTokenAccount(
        tokenMint,
        anotherSender.publicKey
      );
      await client.mintToken(
        tokenMint,
        anotherSenderTokenAccount,
        100000,
        mintAuthority
      );

      // Try to deposit using another sender's token account
      await expectAnchorError(
        client.deposit(
          {
            tokenMint: tokenMint,
            amount: 50000,
            fromTokenAccount: anotherSenderTokenAccount,
            forDepositor: beneficiary.publicKey,
          },
          { owner: sender }
        ),
        "ConstraintTokenOwner"
      );
    });

    it("should fail if wrong custody token account is provided", async () => {
      const randomCustodyTokenAccount = await client.createTokenAccount(
        tokenMint,
        Keypair.generate().publicKey
      );

      const depositPDA = findPDA(
        [
          Buffer.from("gateway_deposit"),
          tokenMint.toBuffer(),
          beneficiary.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );

      const senderDenylistPDA = findPDA(
        [Buffer.from("denylist"), sender.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      );
      const beneficiaryDenylistPDA = findPDA(
        [Buffer.from("denylist"), beneficiary.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      );

      svm.expireBlockhash();

      await expectAnchorError(
        client.gatewayWalletProgram.methods
          .depositFor(new BN(50000), beneficiary.publicKey)
          .accountsPartial({
            owner: sender.publicKey,
            gatewayWallet: client.pdas.gatewayWallet.publicKey,
            ownerTokenAccount: senderTokenAccount,
            custodyTokenAccount: randomCustodyTokenAccount,
            deposit: depositPDA.publicKey,
            senderDenylist: senderDenylistPDA.publicKey,
            depositorDenylist: beneficiaryDenylistPDA.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([sender])
          .rpc(),
        "ConstraintSeeds"
      );
    });
  });

  describe("denylist enforcement", () => {
    let denylister: Keypair;

    beforeEach(async () => {
      // Create a denylister (different from owner)
      denylister = Keypair.generate();
      svm.airdrop(denylister.publicKey, BigInt(LAMPORTS_PER_SOL));

      // Set the denylister
      await client.updateDenylister({ newDenylister: denylister.publicKey });
    });

    it("denylisted account cannot make deposits", async () => {
      // Denylist the depositor
      await client.denylist({ account: depositor.publicKey }, { denylister });

      // Verify depositor is denylisted
      const denylistAccount = await client.getDenylistAccount(
        depositor.publicKey
      );
      expect(denylistAccount).to.not.equal(null);

      // Deposit should fail
      await expectAnchorError(
        client.deposit(
          {
            tokenMint: tokenMint,
            amount: 50000,
            fromTokenAccount: depositorTokenAccount,
          },
          { owner: depositor }
        ),
        "AccountDenylisted"
      );
    });

    it("depositor can deposit after being undenylisted", async () => {
      const depositAmount = 100000;

      // Denylist then undenylist the depositor
      await client.denylist({ account: depositor.publicKey }, { denylister });
      await client.undenylist({ account: depositor.publicKey }, { denylister });

      // Verify depositor is no longer denylisted
      const denylistAccount = await client.getDenylistAccount(
        depositor.publicKey
      );
      expect(denylistAccount).to.equal(null);

      // Deposit should now succeed
      await client.deposit(
        {
          tokenMint: tokenMint,
          amount: depositAmount,
          fromTokenAccount: depositorTokenAccount,
        },
        { owner: depositor }
      );

      // Verify the deposit was successful
      const depositPDA = findPDA(
        [
          Buffer.from("gateway_deposit"),
          tokenMint.toBuffer(),
          depositor.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      );
      const depositData =
        await client.gatewayWalletProgram.account.gatewayDeposit.fetch(
          depositPDA.publicKey
        );

      expect(depositData.availableAmount.toNumber()).to.equal(depositAmount);
    });

    it("should fail when wrong denylist PDA is provided", async () => {
      const depositAmount = 50000;

      const wrongAccount = Keypair.generate();
      const wrongDenylistPDA = findPDA(
        [Buffer.from("denylist"), wrongAccount.publicKey.toBuffer()],
        client.gatewayWalletProgram.programId
      ).publicKey;

      const depositPDA = findPDA(
        [
          Buffer.from("gateway_deposit"),
          tokenMint.toBuffer(),
          depositor.publicKey.toBuffer(),
        ],
        client.gatewayWalletProgram.programId
      ).publicKey;

      svm.expireBlockhash();
      try {
        await client.gatewayWalletProgram.methods
          .deposit(new BN(depositAmount))
          .accountsPartial({
            owner: depositor.publicKey,
            gatewayWallet: client.pdas.gatewayWallet.publicKey,
            ownerTokenAccount: depositorTokenAccount,
            custodyTokenAccount: custodyTokenAccount,
            deposit: depositPDA,
            depositorDenylist: wrongDenylistPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([depositor])
          .rpc();

        expect.fail("Should have thrown a ConstraintSeeds error");
      } catch (error: unknown) {
        expect((error as Error).toString()).to.match(
          /AnchorError.*ConstraintSeeds|A seeds constraint was violated/
        );
      }
    });

    describe("depositFor denylist enforcement", () => {
      let sender: Keypair;
      let senderTokenAccount: PublicKey;

      beforeEach(async () => {
        // Create sender with tokens
        sender = Keypair.generate();
        svm.airdrop(sender.publicKey, BigInt(LAMPORTS_PER_SOL));
        senderTokenAccount = await client.createTokenAccount(
          tokenMint,
          sender.publicKey
        );
        await client.mintToken(
          tokenMint,
          senderTokenAccount,
          depositorPrefundAmount,
          mintAuthority
        );
      });

      it("denylisted sender cannot use depositFor", async () => {
        const depositAmount = 100000;

        // Denylist the sender
        await client.denylist({ account: sender.publicKey }, { denylister });

        // DepositFor should fail
        await expectAnchorError(
          client.deposit(
            {
              tokenMint: tokenMint,
              amount: depositAmount,
              fromTokenAccount: senderTokenAccount,
              forDepositor: depositor.publicKey,
            },
            { owner: sender }
          ),
          "AccountDenylisted"
        );
      });

      it("sender cannot deposit for denylisted beneficiary", async () => {
        const depositAmount = 100000;

        // Denylist the beneficiary
        await client.denylist({ account: depositor.publicKey }, { denylister });

        // DepositFor should fail
        await expectAnchorError(
          client.deposit(
            {
              tokenMint: tokenMint,
              amount: depositAmount,
              fromTokenAccount: senderTokenAccount,
              forDepositor: depositor.publicKey,
            },
            { owner: sender }
          ),
          "AccountDenylisted"
        );
      });

      it("should fail when wrong sender denylist PDA is provided", async () => {
        const depositAmount = 50000;

        const wrongAccount = Keypair.generate();
        const wrongSenderDenylistPDA = findPDA(
          [Buffer.from("denylist"), wrongAccount.publicKey.toBuffer()],
          client.gatewayWalletProgram.programId
        ).publicKey;

        const depositPDA = findPDA(
          [
            Buffer.from("gateway_deposit"),
            tokenMint.toBuffer(),
            depositor.publicKey.toBuffer(),
          ],
          client.gatewayWalletProgram.programId
        ).publicKey;

        const correctDepositorDenylistPDA = findPDA(
          [Buffer.from("denylist"), depositor.publicKey.toBuffer()],
          client.gatewayWalletProgram.programId
        ).publicKey;

        svm.expireBlockhash();
        try {
          await client.gatewayWalletProgram.methods
            .depositFor(new BN(depositAmount), depositor.publicKey)
            .accountsPartial({
              owner: sender.publicKey,
              gatewayWallet: client.pdas.gatewayWallet.publicKey,
              ownerTokenAccount: senderTokenAccount,
              custodyTokenAccount: custodyTokenAccount,
              deposit: depositPDA,
              senderDenylist: wrongSenderDenylistPDA,
              depositorDenylist: correctDepositorDenylistPDA,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([sender])
            .rpc();

          expect.fail("Should have thrown a ConstraintSeeds error");
        } catch (error: unknown) {
          expect((error as Error).toString()).to.match(
            /AnchorError.*ConstraintSeeds|A seeds constraint was violated/
          );
        }
      });

      it("should fail when wrong depositor denylist PDA is provided", async () => {
        const depositAmount = 50000;

        const wrongAccount = Keypair.generate();
        const wrongDepositorDenylistPDA = findPDA(
          [Buffer.from("denylist"), wrongAccount.publicKey.toBuffer()],
          client.gatewayWalletProgram.programId
        ).publicKey;

        const depositPDA = findPDA(
          [
            Buffer.from("gateway_deposit"),
            tokenMint.toBuffer(),
            depositor.publicKey.toBuffer(),
          ],
          client.gatewayWalletProgram.programId
        ).publicKey;

        const correctSenderDenylistPDA = findPDA(
          [Buffer.from("denylist"), sender.publicKey.toBuffer()],
          client.gatewayWalletProgram.programId
        ).publicKey;

        svm.expireBlockhash();
        try {
          await client.gatewayWalletProgram.methods
            .depositFor(new BN(depositAmount), depositor.publicKey)
            .accountsPartial({
              owner: sender.publicKey,
              gatewayWallet: client.pdas.gatewayWallet.publicKey,
              ownerTokenAccount: senderTokenAccount,
              custodyTokenAccount: custodyTokenAccount,
              deposit: depositPDA,
              senderDenylist: correctSenderDenylistPDA,
              depositorDenylist: wrongDepositorDenylistPDA,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([sender])
            .rpc();

          expect.fail("Should have thrown a ConstraintSeeds error");
        } catch (error: unknown) {
          expect((error as Error).toString()).to.match(
            /AnchorError.*ConstraintSeeds|A seeds constraint was violated/
          );
        }
      });
    });
  });
});
