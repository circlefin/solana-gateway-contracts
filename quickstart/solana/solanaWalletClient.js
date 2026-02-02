import * as anchor from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { gatewayWalletIdl } from "./idls.js";
import { encodeBurnIntent } from "./burnIntent.js";
import crypto from "crypto";

export class SolanaWalletClient {
  account;
  connection;
  anchorProvider;
  program;
  walletPda;
  address;

  constructor(account, connection, programId) {
    this.account = account;
    this.connection = connection;
    this.address = programId.toBase58();
    const anchorWallet = new anchor.Wallet(account);
    this.anchorProvider = new anchor.AnchorProvider(
      this.connection,
      anchorWallet,
      anchor.AnchorProvider.defaultOptions()
    );
    anchor.setProvider(this.anchorProvider);

    this.program = new anchor.Program(
      { ...gatewayWalletIdl, address: programId.toBase58() },
      this.anchorProvider
    );
    this.walletPda = this.findGatewayWalletPda();
  }

  findCustodyPda(tokenMint) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("gateway_wallet_custody")),
        tokenMint.toBuffer(),
      ],
      this.program.programId
    )[0];
  }

  findDepositPda(tokenMint, depositor) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("gateway_deposit"),
        tokenMint.toBuffer(),
        depositor.toBuffer(),
      ],
      this.program.programId
    )[0];
  }

  findDenylistPda(address) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("denylist"), address.toBuffer()],
      this.program.programId
    )[0];
  }

  findGatewayWalletPda() {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(anchor.utils.bytes.utf8.encode("gateway_wallet"))],
      this.program.programId
    )[0];
  }

  findATA(tokenMint, owner) {
    return getAssociatedTokenAddressSync(tokenMint, owner);
  }

  async deposit(tokenMint, amount) {
    const owner = this.account.publicKey;
    const beneficiary = owner;

    const custodyPda = this.findCustodyPda(tokenMint);
    const depositPda = this.findDepositPda(tokenMint, beneficiary);
    const beneficiaryDenylistPda = this.findDenylistPda(beneficiary);

    return this.program.methods
      .deposit(amount)
      .accountsPartial({
        payer: owner,
        owner: owner,
        gatewayWallet: this.walletPda,
        ownerTokenAccount: this.findATA(tokenMint, owner),
        custodyTokenAccount: custodyPda,
        deposit: depositPda,
        depositorDenylist: beneficiaryDenylistPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.account])
      .rpc();
  }

  async waitForConfirmation(signature) {
    const latest = await this.connection.getLatestBlockhash();

    await this.connection.confirmTransaction(
      {
        signature: signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );
  }

  signBurnIntent(payload) {
    const encoded = encodeBurnIntent(payload);
    // Per the GatewayWallet program's requirements, the BurnIntent message must be
    // prefixed with a specific 16-byte sequence for signing.
    const prefixed = Buffer.concat([
      Buffer.from([0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      encoded,
    ]);
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"), // PKCS#8 header
        Buffer.from(this.account.secretKey.slice(0, 32)), // The first 32 bytes of a Solana secretKey are the private key
      ]),
      format: "der",
      type: "pkcs8",
    });
    return `0x${crypto.sign(null, prefixed, privateKey).toString("hex")}`;
  }
}
