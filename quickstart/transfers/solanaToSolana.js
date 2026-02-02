import {
  solanaAccount1 as solanaSender,
  solanaAccount1 as solanaFeePayer,
  solanaAccount2 as solanaRecipient,
} from "../solana/setup.js";
import { GatewayClient } from "../gateway-client.js";
import { burnIntent, transformBurnIntent } from "../burnIntentTransformers.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

// Initialize a lightweight API client for interacting with Gateway
const gatewayClient = new GatewayClient();

// Check the info endpoint to confirm which chains are supported
// Not necessary for the transfer, but useful information
console.log("Fetching Gateway API info...");
const info = await gatewayClient.info();
for (const domain of info.domains) {
  console.log(
    `  - ${domain.chain} ${domain.network}`,
    `(wallet: ${"walletContract" in domain}, minter: ${
      "minterContract" in domain
    })`
  );
}

// Check the account's balances with the Gateway API
console.log(`Checking balances...`);
const { balances: solanaBalances } = await gatewayClient.balances(
  "USDC",
  solanaSender.address,
  [GatewayClient.DOMAINS.solanaDevnet]
);

console.log("Solana balances:", solanaBalances);
console.log(`  - Solana:`, `${solanaBalances[0].balance} USDC`);

// This is the amount we intend to transfer
const fromSolanaAmount = 0.1;

// Check to see if Gateway has picked up the Solana deposit yet
const solanaBalance = solanaBalances.find(
  (b) => b.domain === GatewayClient.DOMAINS.solanaDevnet
).balance;
if (parseFloat(solanaBalance) < fromSolanaAmount) {
  console.error(
    "Gateway deposit not yet picked up on Solana, wait until finalization"
  );
  process.exit(1);
} else {
  console.log("Gateway deposit picked up on Solana!");
}

// Note that Solana does not support BurnIntentSets
console.log("Constructing burn intent...");
const defaultRecipientAta = getAssociatedTokenAddressSync(
  solanaRecipient.usdc.publicKey,
  solanaRecipient.publicKey
);

console.log(
  "Creating the recipient's Associated Token Account (ATA) if it does not exist. ATA:",
  defaultRecipientAta.toBase58()
);
const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
  solanaFeePayer.publicKey,
  defaultRecipientAta,
  solanaRecipient.publicKey,
  solanaRecipient.usdc.publicKey
);
const tx = new Transaction().add(createAtaIx);
await sendAndConfirmTransaction(solanaFeePayer.connection, tx, [
  solanaFeePayer.keypair,
]);

const solanaBurnIntent = burnIntent({
  account: solanaSender,
  from: solanaSender,
  to: solanaRecipient,
  amount: fromSolanaAmount,
  recipient: defaultRecipientAta.toBase58(),
});

const isSourceSolana = true;
const isDestinationSolana = true;

console.log("Signing burn intent...");
const transformedIntent = transformBurnIntent(
  solanaBurnIntent,
  isSourceSolana,
  isDestinationSolana
);
const burnIntentSignature =
  solanaSender.gatewayWallet.signBurnIntent(transformedIntent);
const request = [
  { burnIntent: transformedIntent, signature: burnIntentSignature },
];

// Request the attestation
console.log("Requesting attestation from Gateway API...");
const start = performance.now();
const response = await gatewayClient.transfer(request);
const end = performance.now();
if (response.success === false) {
  console.error("Error from Gateway API:", response.message);
  process.exit(1);
}
console.log(
  "Received attestation from Gateway API in",
  (end - start).toFixed(2),
  "ms"
);

// Mint the funds on Solana
console.log("Minting funds on Solana...");

const { attestation, signature: mintSignature } = response;
// We use solanaAccount1 as the fee payer to mint the funds so that we only need to
// fund one account during setup.
const mintTx = await solanaFeePayer.gatewayMinter.gatewayMint(
  attestation,
  mintSignature
);
console.log("Transaction hash:", mintTx);
await solanaFeePayer.gatewayMinter.waitForConfirmation(mintTx);
console.log("Mint successful!");
process.exit(0);
