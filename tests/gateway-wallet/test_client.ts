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

import { LiteSVMProvider } from "anchor-litesvm";
import { LiteSVM } from "litesvm";
import * as path from "path";
import { readFileSync } from "fs";
import {
  Ed25519Program,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
} from "@solana/web3.js";
import {
  Program,
  Wallet,
  web3,
  utils,
  translateError,
} from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import type { GatewayWallet } from "../../target/types/gateway_wallet";
import {
  Account as TokenAccount,
  createInitializeAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAccount,
  getAccountLenForMint,
  getMinimumBalanceForRentExemptMint,
  getMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import gatewayWalletIdl from "../../target/idl/gateway_wallet.json";
import {
  deployProgram,
  EvmKeypair,
  findPDA,
  PDA,
  signAttestation,
} from "../utils";
import {
  BURN_INTENT_MESSAGE_PREFIX,
  encodeBurnSignerMessage,
  encodeEd25519InstructionData,
} from "../burn_data";

export class GatewayWalletTestClient {
  svm: LiteSVM;

  owner: Keypair;

  provider: LiteSVMProvider;
  gatewayWalletProgram: Program<GatewayWallet>;

  // PDAs, [publicKey, bump]
  pdas: {
    gatewayWallet: PDA;
    gatewayWalletEventAuthority: PDA;
    gatewayWalletProgramData: PDA;
  };

  constructor(svm: LiteSVM) {
    this.svm = svm;
    this.owner = Keypair.generate();

    [this.owner].forEach((keypair) => {
      this.svm.airdrop(keypair.publicKey, BigInt(10 * web3.LAMPORTS_PER_SOL));
    });

    const wallet = new Wallet(this.owner);
    this.provider = new LiteSVMProvider(svm, wallet);
    this.gatewayWalletProgram = new Program<GatewayWallet>(
      gatewayWalletIdl as GatewayWallet,
      this.provider
    );

    this.pdas = {
      gatewayWallet: findPDA(
        [Buffer.from(utils.bytes.utf8.encode("gateway_wallet"))],
        this.gatewayWalletProgram.programId
      ),
      gatewayWalletEventAuthority: findPDA(
        [Buffer.from(utils.bytes.utf8.encode("__event_authority"))],
        this.gatewayWalletProgram.programId
      ),
      gatewayWalletProgramData: findPDA(
        [this.gatewayWalletProgram.programId.toBuffer()],
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
      ),
    };

    // Deploy gateway wallet program
    const gatewayWalletProgramId = this.gatewayWalletProgram.programId;
    const gatewayWalletProgramBytes = readFileSync(
      path.join(process.cwd(), "target/deploy/gateway_wallet.so")
    );
    deployProgram(
      this.svm,
      gatewayWalletProgramId,
      gatewayWalletProgramBytes,
      this.owner.publicKey
    );
  }

  async initialize(
    params: {
      localDomain: number;
      withdrawalDelay?: number;
    },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .initialize({
        localDomain: params.localDomain,
        withdrawalDelay: new anchor.BN(params.withdrawalDelay ?? 1),
      })
      .accountsPartial({
        payer: signer.publicKey,
        upgradeAuthority: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
        gatewayWalletProgramData: this.pdas.gatewayWalletProgramData.publicKey,
        gatewayWalletProgram: this.gatewayWalletProgram.programId,
        systemProgram: SystemProgram.programId,
      })
      .signers([signer])
      .rpc();
  }

  async transferOwnership(
    params: { newOwner: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .transferOwnership(params)
      .accountsPartial({
        owner: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async acceptOwnership(signer: Keypair) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .acceptOwnership({})
      .accountsPartial({
        pendingOwner: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async updatePauser(
    params: { newPauser: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .updatePauser({ newPauser: params.newPauser })
      .accountsPartial({
        owner: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async updateDenylister(
    params: { newDenylister: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .updateDenylister({ newDenylister: params.newDenylister })
      .accountsPartial({
        owner: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async updateTokenController(
    params: { newTokenController: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .updateTokenController({ newTokenController: params.newTokenController })
      .accountsPartial({
        owner: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async updateWithdrawalDelay(
    params: { newWithdrawalDelay: anchor.BN },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .updateWithdrawalDelay({ newDelay: params.newWithdrawalDelay })
      .accountsPartial({
        owner: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async updateFeeRecipient(
    params: { newFeeRecipient: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .updateFeeRecipient({ newFeeRecipient: params.newFeeRecipient })
      .accountsPartial({
        owner: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async addToken(
    params: {
      tokenMint: PublicKey;
      custodyTokenAccount?: PublicKey;
    },
    signers: {
      payer?: Keypair;
      tokenController?: Keypair;
    } = {}
  ) {
    const payer = signers.payer || this.owner;
    const tokenController = signers.tokenController || this.owner;

    const custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_wallet_custody"), params.tokenMint.toBuffer()],
      this.gatewayWalletProgram.programId
    );

    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .addToken()
      .accountsPartial({
        payer: payer.publicKey,
        tokenController: tokenController.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
        tokenMint: params.tokenMint,
        custodyTokenAccount:
          params.custodyTokenAccount || custodyTokenAccountPDA.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer, tokenController])
      .rpc();
  }

  async createTokenMint(
    mintAuthority: PublicKey,
    decimals: number
  ): Promise<PublicKey> {
    const payer = Keypair.generate();
    const keypair = Keypair.generate();
    this.svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    const lamports = await getMinimumBalanceForRentExemptMint(
      this.provider.connection
    );

    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: keypair.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        keypair.publicKey,
        decimals,
        mintAuthority,
        mintAuthority
      )
    );

    await this.provider.sendAndConfirm(transaction, [payer, keypair]);

    return keypair.publicKey;
  }

  async mintToken(
    mint: PublicKey,
    destination: PublicKey,
    amount: number | bigint,
    authority: Signer
  ): Promise<TransactionSignature> {
    const transaction = new Transaction().add(
      createMintToInstruction(mint, destination, authority.publicKey, amount)
    );
    return this.provider.sendAndConfirm(transaction, [authority]);
  }

  async createTokenAccount(
    mint: PublicKey,
    owner: PublicKey
  ): Promise<PublicKey> {
    const account = Keypair.generate();
    const payer = Keypair.generate();
    this.svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    const mintState = await getMint(this.provider.connection, mint);
    const space = getAccountLenForMint(mintState);
    const lamports =
      await this.provider.connection.getMinimumBalanceForRentExemption(space);

    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: account.publicKey,
        space,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccountInstruction(
        account.publicKey,
        mint,
        owner,
        TOKEN_PROGRAM_ID
      )
    );

    await this.provider.sendAndConfirm(transaction, [account, payer]);

    return account.publicKey;
  }

  async createAssociatedTokenAccount(
    mint: PublicKey,
    owner: PublicKey
  ): Promise<PublicKey> {
    const associatedTokenAccount = getAssociatedTokenAddressSync(
      mint,
      owner,
      false
    );
    const payer = Keypair.generate();
    this.svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        associatedTokenAccount,
        owner,
        mint
      )
    );

    await this.provider.sendAndConfirm(transaction, [payer]);

    return associatedTokenAccount;
  }

  async getTokenAccount(address: PublicKey): Promise<TokenAccount> {
    return getAccount(this.provider.connection, address);
  }

  async getTokenAccountBalance(address: PublicKey): Promise<bigint> {
    const account = await getAccount(this.provider.connection, address);
    return account.amount;
  }

  async deposit(
    params: {
      tokenMint: PublicKey;
      amount: number | bigint;
      fromTokenAccount: PublicKey;
      forDepositor?: PublicKey;
    },
    signers: {
      payer?: Keypair;
      owner?: Keypair;
    } = {}
  ) {
    const payer = signers.payer || this.owner;
    const owner = signers.owner || this.owner;

    const custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_wallet_custody"), params.tokenMint.toBuffer()],
      this.gatewayWalletProgram.programId
    );

    const depositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        params.tokenMint.toBuffer(),
        params.forDepositor
          ? params.forDepositor.toBuffer()
          : owner.publicKey.toBuffer(),
      ],
      this.gatewayWalletProgram.programId
    );

    // Create denylist PDAs for checking (optional accounts)
    const ownerDenylistPDA = findPDA(
      [Buffer.from("denylist"), owner.publicKey.toBuffer()],
      this.gatewayWalletProgram.programId
    );

    let depositorDenylistPDA = null;
    if (params.forDepositor) {
      depositorDenylistPDA = findPDA(
        [Buffer.from("denylist"), params.forDepositor.toBuffer()],
        this.gatewayWalletProgram.programId
      );
    }

    this.svm.expireBlockhash();
    const builder = params.forDepositor
      ? this.gatewayWalletProgram.methods.depositFor(
          new anchor.BN(params.amount.toString()),
          params.forDepositor
        )
      : this.gatewayWalletProgram.methods.deposit(
          new anchor.BN(params.amount.toString())
        );

    const accounts: Record<string, PublicKey | null> = {
      payer: payer.publicKey,
      owner: owner.publicKey,
      gatewayWallet: this.pdas.gatewayWallet.publicKey,
      tokenMint: params.tokenMint,
      ownerTokenAccount: params.fromTokenAccount,
      custodyTokenAccount: custodyTokenAccountPDA.publicKey,
      deposit: depositPDA.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };

    if (params.forDepositor) {
      // For depositFor: provide both sender and depositor denylist PDAs
      accounts.senderDenylist = ownerDenylistPDA.publicKey;
      if (depositorDenylistPDA) {
        accounts.depositorDenylist = depositorDenylistPDA.publicKey;
      }
    } else {
      // For regular deposit: provide the depositor's denylist PDA
      accounts.depositorDenylist = ownerDenylistPDA.publicKey;
    }

    return builder
      .accountsPartial(accounts)
      .signers(
        [payer, owner].filter(
          (s, i, arr) =>
            arr.findIndex((x) => x.publicKey.equals(s.publicKey)) === i
        )
      )
      .rpc();
  }

  async denylist(
    params: { account: PublicKey },
    signers: {
      payer?: Keypair;
      denylister?: Keypair;
    } = {}
  ) {
    const payer = signers.payer || this.owner;
    const denylister = signers.denylister || this.owner;

    const denylistPDA = findPDA(
      [Buffer.from("denylist"), params.account.toBuffer()],
      this.gatewayWalletProgram.programId
    );

    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .denylist({ account: params.account })
      .accountsPartial({
        payer: payer.publicKey,
        denylister: denylister.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
        denylist: denylistPDA.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers(
        [payer, denylister].filter(
          (s, i, arr) =>
            arr.findIndex((x) => x.publicKey.equals(s.publicKey)) === i
        )
      )
      .rpc();
  }

  async gatewayBurn(
    params: {
      burnIntent: Buffer;
      userSignature: Buffer;
      tokenMint: PublicKey;
      custodyTokenAccount: PublicKey;
      feeRecipientTokenAccount: PublicKey;
      deposit: PublicKey;
      delegateAccount?: PublicKey;
      fee?: number | bigint;
      burnIntentMessagePrefix?: Buffer;
      excludeEd25519Instruction?: boolean;
      remainingAccounts?: {
        pubkey: PublicKey;
        isWritable: boolean;
        isSigner: boolean;
      }[];
    },
    burnSigner: EvmKeypair,
    feePayer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    const encodedBurnData = encodeBurnSignerMessage(
      BigInt(params.fee || 0),
      params.userSignature,
      params.burnIntent,
      params.burnIntentMessagePrefix || BURN_INTENT_MESSAGE_PREFIX
    );
    const burnSignature = signAttestation(
      encodedBurnData,
      burnSigner.privateKey
    );

    const ed25519Instruction = new TransactionInstruction({
      keys: [],
      programId: Ed25519Program.programId,
      data: encodeEd25519InstructionData(params.burnIntent.length),
    });

    const burnInstruction = await this.gatewayWalletProgram.methods
      .gatewayBurn({
        encodedBurnData,
        burnSignature,
      })
      .accountsPartial({
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
        tokenMint: params.tokenMint,
        custodyTokenAccount: params.custodyTokenAccount,
        feeRecipientTokenAccount: params.feeRecipientTokenAccount,
        deposit: params.deposit,
        delegateAccount: params.delegateAccount || null,
      })
      .remainingAccounts(params.remainingAccounts || [])
      .instruction();

    const transaction = new Transaction();
    if (!params.excludeEd25519Instruction) {
      transaction.add(ed25519Instruction);
    }
    transaction.add(burnInstruction);

    return this.sendTransaction(transaction, [feePayer]);
  }

  async addDelegate(
    params: {
      tokenMint: PublicKey;
      delegate: PublicKey;
    },
    signers: {
      payer?: Keypair;
      depositor?: Keypair;
    } = {}
  ) {
    const payer = signers.payer || this.owner;
    const depositor = signers.depositor || this.owner;

    const delegateAccountPDA = findPDA(
      [
        Buffer.from("gateway_delegate"),
        params.tokenMint.toBuffer(),
        depositor.publicKey.toBuffer(),
        params.delegate.toBuffer(),
      ],
      this.gatewayWalletProgram.programId
    );

    const depositorDenylistPDA = findPDA(
      [Buffer.from("denylist"), depositor.publicKey.toBuffer()],
      this.gatewayWalletProgram.programId
    );

    const delegateDenylistPDA = findPDA(
      [Buffer.from("denylist"), params.delegate.toBuffer()],
      this.gatewayWalletProgram.programId
    );

    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .addDelegate(params.delegate)
      .accountsPartial({
        payer: payer.publicKey,
        depositor: depositor.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
        tokenMint: params.tokenMint,
        delegateAccount: delegateAccountPDA.publicKey,
        depositorDenylist: depositorDenylistPDA.publicKey,
        delegateDenylist: delegateDenylistPDA.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers(
        [payer, depositor].filter(
          (s, i, arr) =>
            arr.findIndex((x) => x.publicKey.equals(s.publicKey)) === i
        )
      )
      .rpc();
  }

  async undenylist(
    params: { account: PublicKey },
    signers: {
      payer?: Keypair;
      denylister?: Keypair;
    } = {}
  ) {
    const payer = signers.payer || this.owner;
    const denylister = signers.denylister || this.owner;

    const denylistPDA = findPDA(
      [Buffer.from("denylist"), params.account.toBuffer()],
      this.gatewayWalletProgram.programId
    );

    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .undenylist({ account: params.account })
      .accountsPartial({
        payer: payer.publicKey,
        denylister: denylister.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
        denylist: denylistPDA.publicKey,
      })
      .signers(
        [payer, denylister].filter(
          (s, i, arr) =>
            arr.findIndex((x) => x.publicKey.equals(s.publicKey)) === i
        )
      )
      .rpc();
  }

  async removeDelegate(
    params: {
      tokenMint: PublicKey;
      delegate: PublicKey;
    },
    signer: Keypair = this.owner
  ) {
    const delegateAccountPDA = findPDA(
      [
        Buffer.from("gateway_delegate"),
        params.tokenMint.toBuffer(),
        signer.publicKey.toBuffer(),
        params.delegate.toBuffer(),
      ],
      this.gatewayWalletProgram.programId
    );

    const depositorDenylistPDA = findPDA(
      [Buffer.from("denylist"), signer.publicKey.toBuffer()],
      this.gatewayWalletProgram.programId
    );

    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .removeDelegate(params.delegate)
      .accountsPartial({
        depositor: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
        tokenMint: params.tokenMint,
        delegateAccount: delegateAccountPDA.publicKey,
        depositorDenylist: depositorDenylistPDA.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async getDelegateAccount(
    tokenMint: PublicKey,
    depositor: PublicKey,
    delegate: PublicKey
  ) {
    const delegateAccountPDA = findPDA(
      [
        Buffer.from("gateway_delegate"),
        tokenMint.toBuffer(),
        depositor.toBuffer(),
        delegate.toBuffer(),
      ],
      this.gatewayWalletProgram.programId
    );
    return this.gatewayWalletProgram.account.gatewayDelegate.fetch(
      delegateAccountPDA.publicKey
    );
  }

  async initiateWithdrawal(
    params: {
      tokenMint: PublicKey;
      amount: number | bigint;
    },
    signer: Keypair = this.owner
  ) {
    const depositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        params.tokenMint.toBuffer(),
        signer.publicKey.toBuffer(),
      ],
      this.gatewayWalletProgram.programId
    );

    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .initiateWithdrawal(new anchor.BN(params.amount.toString()))
      .accountsPartial({
        depositor: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
        deposit: depositPDA.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async withdraw(
    params: {
      tokenMint: PublicKey;
      toTokenAccount: PublicKey;
    },
    signer: Keypair = this.owner
  ) {
    const depositPDA = findPDA(
      [
        Buffer.from("gateway_deposit"),
        params.tokenMint.toBuffer(),
        signer.publicKey.toBuffer(),
      ],
      this.gatewayWalletProgram.programId
    );

    const custodyTokenAccountPDA = findPDA(
      [Buffer.from("gateway_wallet_custody"), params.tokenMint.toBuffer()],
      this.gatewayWalletProgram.programId
    );

    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .withdraw()
      .accountsPartial({
        depositor: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
        custodyTokenAccount: custodyTokenAccountPDA.publicKey,
        depositorTokenAccount: params.toTokenAccount,
        deposit: depositPDA.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer])
      .rpc();
  }

  getDepositPDA(tokenMint: PublicKey, depositor: PublicKey): PDA {
    return findPDA(
      [
        Buffer.from("gateway_deposit"),
        tokenMint.toBuffer(),
        depositor.toBuffer(),
      ],
      this.gatewayWalletProgram.programId
    );
  }

  async getDenylistAccount(account: PublicKey) {
    const denylistPDA = findPDA(
      [Buffer.from("denylist"), account.toBuffer()],
      this.gatewayWalletProgram.programId
    );

    try {
      return await this.gatewayWalletProgram.account.denylist.fetch(
        denylistPDA.publicKey
      );
    } catch {
      return null;
    }
  }

  findDenylistPDA(account: PublicKey): PDA {
    return findPDA(
      [Buffer.from("denylist"), account.toBuffer()],
      this.gatewayWalletProgram.programId
    );
  }

  getCustodyTokenAccount(tokenMint: PublicKey): PublicKey {
    return findPDA(
      [Buffer.from("gateway_wallet_custody"), tokenMint.toBuffer()],
      this.gatewayWalletProgram.programId
    ).publicKey;
  }

  async addBurnSigner(
    params: { signer: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .addBurnSigner({ signer: params.signer })
      .accountsPartial({
        owner: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async removeBurnSigner(
    params: { signer: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .removeBurnSigner({ signer: params.signer })
      .accountsPartial({
        owner: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async pause(signer: Keypair = this.owner) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .pause()
      .accountsPartial({
        pauser: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async unpause(signer: Keypair = this.owner) {
    this.svm.expireBlockhash();
    return this.gatewayWalletProgram.methods
      .unpause()
      .accountsPartial({
        pauser: signer.publicKey,
        gatewayWallet: this.pdas.gatewayWallet.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async sendTransaction(
    transaction: Transaction,
    signers: Keypair[] = [this.owner]
  ) {
    try {
      return await this.provider.sendAndConfirm(transaction, signers);
    } catch (err) {
      throw translateError(
        err,
        new Map(
          this.gatewayWalletProgram.idl.errors.map((e) => [e.code, e.msg])
        )
      );
    }
  }
}
