import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { gatewayMinterIdl } from "./idls.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { decodeAttestationSet } from "./attestation.js";

export class SolanaMinterClient {
  account;
  connection;
  anchorProvider;
  program;
  address;
  minterPda;

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
      { ...gatewayMinterIdl, address: programId.toBase58() },
      this.anchorProvider
    );

    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from(anchor.utils.bytes.utf8.encode("gateway_minter"))],
      this.program.programId
    );
    this.minterPda = pda;
  }

  findCustodyPda(mint) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("gateway_minter_custody"), mint.toBuffer()],
      this.program.programId
    )[0];
  }

  findTransferSpecHashPda(transferSpecHash) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("used_transfer_spec_hash"), transferSpecHash],
      this.program.programId
    )[0];
  }

  // Assume a single destination recipient and token
  gatewayMint = async (attestation, signature) => {
    const decoded = decodeAttestationSet(attestation);

    console.log("=== Decoded Attestation Details ===\n");
    decoded.attestations.forEach((att, index) => {
      console.log(`Attestation ${index + 1}:`);
      console.log(`  Destination Token: ${att.destinationToken.toBase58()}`);
      console.log(
        `  Destination Recipient: ${att.destinationRecipient.toBase58()}`
      );
      console.log(`  Value: ${att.value.toString()} USDC base units`);
      console.log(
        `  Transfer Spec Hash: ${att.transferSpecHash.toString("hex")}`
      );
      console.log(`  Hook Data Length: ${att.hookDataLength}`);
      console.log(
        `  Hook Data: 0x${Buffer.from(att.hookData).toString("hex")}`
      );
    });

    // Create remaining accounts list
    const remainingAccountsList = decoded.attestations.flatMap((e) => {
      return [
        {
          pubkey: this.findCustodyPda(e.destinationToken),
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: e.destinationRecipient,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: this.findTransferSpecHashPda(e.transferSpecHash),
          isWritable: true,
          isSigner: false,
        },
      ];
    });

    const attestationBytes = Buffer.from(attestation.slice(2), "hex");
    const signatureBytes = Buffer.from(signature.slice(2), "hex");

    return this.program.methods
      .gatewayMint({ attestation: attestationBytes, signature: signatureBytes })
      .accountsPartial({
        gatewayMinter: this.minterPda,
        destinationCaller: this.account.publicKey,
        payer: this.account.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(remainingAccountsList)
      .signers([this.account])
      .rpc();
  };

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
}
