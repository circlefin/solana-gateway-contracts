import "dotenv/config";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { SolanaWalletClient } from "./solanaWalletClient.js";
import { SolanaMinterClient } from "./solanaMinterClient.js";
import { GatewayClient } from "../gateway-client.js";

// Addresses that are needed for Solana Devnet
const gatewayWalletAddress = "GATEwdfmYNELfp5wDmmR6noSr2vHnAfBPMm2PvCzX5vu";
const gatewayMinterAddress = "GATEmKK2ECL1brEngQZWCgMWPbvrEYqsV6u29dAaHavr";
const usdcAddresses = {
  solanaDevnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

// RPC endpoints
const rpcEndpoints = {
  solanaDevnet: "https://api.devnet.solana.com",
};

const keypair1 = createKeypairFromEnv(process.env.SOLANA_PRIVATE_KEYPAIR_1);
const keypair2 = createKeypairFromEnv(process.env.SOLANA_PRIVATE_KEYPAIR_2);

function createKeypairFromEnv(privateKey) {
  if (!privateKey) {
    throw new Error("Private key is required");
  }

  // Try to parse as JSON array first (byte array format)
  try {
    const secretKey = JSON.parse(privateKey);
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } catch {
    throw new Error(
      "SOLANA_PRIVATE_KEYPAIR must be a JSON array of bytes, e.g., [1,2,3,...]"
    );
  }
}

function setup(networkName, keypair) {
  const connection = new Connection(rpcEndpoints[networkName], "confirmed");

  return {
    connection,
    name: networkName,
    domain: GatewayClient.DOMAINS[networkName],
    currency: "SOL",
    usdc: {
      address: usdcAddresses["solanaDevnet"],
      publicKey: new PublicKey(usdcAddresses["solanaDevnet"]),
    },
    gatewayWallet: new SolanaWalletClient(
      keypair,
      connection,
      new PublicKey(gatewayWalletAddress)
    ),
    gatewayMinter: new SolanaMinterClient(
      keypair,
      connection,
      new PublicKey(gatewayMinterAddress)
    ),
    address: keypair.publicKey.toBase58(),
    publicKey: keypair.publicKey,
    keypair: keypair,
  };
}

// Set up clients and contracts for Solana Devnet
export const solanaAccount1 = setup("solanaDevnet", keypair1);
console.log(`Using Solana account1: ${solanaAccount1.address}`);

// If you don't need to use another Solana account as a recipient,
// you can comment out the following lines
export const solanaAccount2 = setup("solanaDevnet", keypair2);
console.log(`Using Solana account2: ${solanaAccount2.address}`);
