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
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import * as path from "path";
import { readFileSync } from "fs";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
  TransactionMessage,
  TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Program, Wallet, web3, utils, BN } from "@coral-xyz/anchor";
import type { GatewayMinter } from "../../target/types/gateway_minter";

import gatewayMinterIdl from "../../target/idl/gateway_minter.json";
import {
  createGatewayMintRemainingAccounts,
  deployProgram,
  findPDA,
  PDA,
  signAttestation,
} from "../utils";
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
} from "@solana/spl-token";
import {
  attestationSetToParams,
  encodeMintAttestationSet,
  MintAttestationSet,
} from "../attestation";
import { expect } from "chai";

export class GatewayMinterTestClient {
  svm: LiteSVM;

  owner: Keypair;

  provider: LiteSVMProvider;
  gatewayMinterProgram: Program<GatewayMinter>;

  // PDAs, [publicKey, bump]
  pdas: {
    gatewayMinter: PDA;
    gatewayMinterEventAuthority: PDA;
    gatewayMinterProgramData: PDA;
  };

  constructor(svm: LiteSVM) {
    this.svm = svm;
    this.owner = Keypair.generate();

    [this.owner].forEach((keypair) => {
      this.svm.airdrop(keypair.publicKey, BigInt(10 * web3.LAMPORTS_PER_SOL));
    });

    const wallet = new Wallet(this.owner);
    this.provider = new LiteSVMProvider(svm, wallet);
    this.gatewayMinterProgram = new Program<GatewayMinter>(
      gatewayMinterIdl as GatewayMinter,
      this.provider
    );

    this.pdas = {
      gatewayMinter: findPDA(
        [Buffer.from(utils.bytes.utf8.encode("gateway_minter"))],
        this.gatewayMinterProgram.programId
      ),
      gatewayMinterEventAuthority: findPDA(
        [Buffer.from(utils.bytes.utf8.encode("__event_authority"))],
        this.gatewayMinterProgram.programId
      ),
      gatewayMinterProgramData: findPDA(
        [this.gatewayMinterProgram.programId.toBuffer()],
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
      ),
    };

    // Deploy gateway minter program
    const gatewayMinterProgramId = this.gatewayMinterProgram.programId;
    const gatewayMinterProgramBytes = readFileSync(
      path.join(process.cwd(), "target/deploy/gateway_minter.so")
    );
    deployProgram(
      this.svm,
      gatewayMinterProgramId,
      gatewayMinterProgramBytes,
      this.owner.publicKey
    );
  }

  async initialize(
    params: {
      localDomain: number;
    },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayMinterProgram.methods
      .initialize(params)
      .accountsPartial({
        payer: signer.publicKey,
        upgradeAuthority: signer.publicKey,
        gatewayMinter: this.pdas.gatewayMinter.publicKey,
        gatewayMinterProgramData: this.pdas.gatewayMinterProgramData.publicKey,
        gatewayMinterProgram: this.gatewayMinterProgram.programId,
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
    return this.gatewayMinterProgram.methods
      .transferOwnership(params)
      .accountsPartial({
        owner: signer.publicKey,
        gatewayMinter: this.pdas.gatewayMinter.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async acceptOwnership(signer: Keypair) {
    this.svm.expireBlockhash();
    return this.gatewayMinterProgram.methods
      .acceptOwnership({})
      .accountsPartial({
        pendingOwner: signer.publicKey,
        gatewayMinter: this.pdas.gatewayMinter.publicKey,
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

    const custodyTokenAccountPDA =
      params.custodyTokenAccount ||
      findPDA(
        [Buffer.from("gateway_minter_custody"), params.tokenMint.toBuffer()],
        this.gatewayMinterProgram.programId
      ).publicKey;

    this.svm.expireBlockhash();
    return this.gatewayMinterProgram.methods
      .addToken()
      .accountsPartial({
        payer: payer.publicKey,
        tokenController: tokenController.publicKey,
        gatewayMinter: this.pdas.gatewayMinter.publicKey,
        tokenMint: params.tokenMint,
        custodyTokenAccount: custodyTokenAccountPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers(
        [payer, tokenController].filter(
          (s, i, arr) =>
            arr.findIndex((x) => x.publicKey.equals(s.publicKey)) === i
        )
      )
      .rpc();
  }

  async updatePauser(
    params: { newPauser: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayMinterProgram.methods
      .updatePauser({ newPauser: params.newPauser })
      .accountsPartial({
        owner: signer.publicKey,
        gatewayMinter: this.pdas.gatewayMinter.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async updateTokenController(
    params: { newTokenController: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayMinterProgram.methods
      .updateTokenController({ newTokenController: params.newTokenController })
      .accountsPartial({
        owner: signer.publicKey,
        gatewayMinter: this.pdas.gatewayMinter.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async addAttester(
    params: { attester: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayMinterProgram.methods
      .addAttester(params)
      .accountsPartial({
        owner: signer.publicKey,
        gatewayMinter: this.pdas.gatewayMinter.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async removeAttester(
    params: { attester: PublicKey },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayMinterProgram.methods
      .removeAttester(params)
      .accountsPartial({
        owner: signer.publicKey,
        gatewayMinter: this.pdas.gatewayMinter.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async burnTokenCustody(
    params: {
      amount: BN;
      tokenMint: PublicKey;
      custodyTokenAccount: PublicKey;
    },
    signer: Keypair = this.owner
  ) {
    this.svm.expireBlockhash();
    return this.gatewayMinterProgram.methods
      .burnTokenCustody(params.amount)
      .accountsPartial({
        tokenController: signer.publicKey,
        gatewayMinter: this.pdas.gatewayMinter.publicKey,
        tokenMint: params.tokenMint,
        custodyTokenAccount: params.custodyTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer])
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
    account: Signer
  ): Promise<PublicKey> {
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
        account.publicKey,
        TOKEN_PROGRAM_ID
      )
    );

    await this.provider.sendAndConfirm(transaction, [account, payer]);

    return account.publicKey;
  }

  async getTokenAccount(address: PublicKey): Promise<TokenAccount> {
    return getAccount(this.provider.connection, address);
  }

  async gatewayMint(params: {
    attestation: MintAttestationSet;
    signature?: Buffer;
    withParams?: boolean;
    accounts?: {
      gatewayMinter?: PublicKey;
      systemProgram?: PublicKey;
      tokenProgram?: PublicKey;
      lookupTable?: AddressLookupTableAccount;
    };
    remainingAccounts?: {
      pubkey: PublicKey;
      isWritable: boolean;
      isSigner: boolean;
    }[];
    signers?: {
      payer?: Keypair;
      destinationCaller?: Keypair;
      attesterKey?: Buffer;
    };
  }) {
    const caller = params.signers?.destinationCaller || this.owner;
    const encoded = encodeMintAttestationSet(params.attestation);

    const sig =
      params.signature ||
      signAttestation(encoded, params.signers!.attesterKey!);
    const minter =
      params.accounts?.gatewayMinter || this.pdas.gatewayMinter.publicKey;
    const system = params.accounts?.systemProgram || SystemProgram.programId;
    const tokenProgram = params.accounts?.tokenProgram || TOKEN_PROGRAM_ID;
    const payer = params.signers?.payer || this.owner;
    const signerList = payer !== caller ? [caller, payer] : [payer];
    const remainingAccountsList =
      params.remainingAccounts ||
      createGatewayMintRemainingAccounts(
        params.attestation,
        this.gatewayMinterProgram.programId
      );

    this.svm.expireBlockhash();
    let methodsBuilder;
    if (params.withParams) {
      const withParams = attestationSetToParams(params.attestation);
      methodsBuilder = this.gatewayMinterProgram.methods
        .gatewayMintWithParams({
          isDefaultDestinationCaller: withParams.isDefaultDestinationCaller,
          maxBlockHeight: new BN(withParams.maxBlockHeight),
          elements: withParams.elements.map((e) => ({
            value: new BN(e.value),
            transferSpecHash: Array.from(e.transferSpecHash),
            hookData: e.hookData,
          })),
          signature: sig,
        })
        .accountsPartial({
          gatewayMinter: minter,
          destinationCaller: caller.publicKey,
          payer: payer.publicKey,
          systemProgram: system,
          tokenProgram,
        })
        .remainingAccounts(remainingAccountsList);
    } else {
      methodsBuilder = this.gatewayMinterProgram.methods
        .gatewayMint({ attestation: encoded, signature: sig })
        .accountsPartial({
          gatewayMinter: minter,
          destinationCaller: caller.publicKey,
          payer: payer.publicKey,
          systemProgram: system,
          tokenProgram,
        })
        .remainingAccounts(remainingAccountsList);
    }

    if (params.accounts?.lookupTable) {
      const instruction = await methodsBuilder.instruction();

      const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: this.svm.latestBlockhash(),
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          instruction,
        ],
      }).compileToV0Message([params.accounts.lookupTable]);

      const versionedTx = new VersionedTransaction(messageV0);
      // Sign with all required signers
      versionedTx.sign(signerList);

      const serialized = versionedTx.serialize();
      console.log("Gateway mint with LuT tx size:", serialized.length);
      expect(serialized.length).to.be.lessThan(1232, "Tx size is too large");

      const result = this.svm.sendTransaction(versionedTx);
      if (result instanceof FailedTransactionMetadata) {
        console.error("Transaction failed:", result.toString());
        throw new Error("Transaction failed");
      }
      return bs58.encode(result.signature());
    } else {
      return await methodsBuilder.signers(signerList).rpc();
    }
  }
}
