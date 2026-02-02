import { account as evmAccount, avalanche } from "../evm/setup.js";
import {
  solanaAccount1 as solanaFeePayer,
  solanaAccount2 as solanaRecipient,
} from "../solana/setup.js";
import { GatewayClient } from "../gateway-client.js";
import { burnIntent } from "../burnIntentTransformers.js";
import { burnIntentTypedData } from "../evm/typed-data.js";
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
const { balances: evmBalances } = await gatewayClient.balances(
  "USDC",
  evmAccount.address,
  [GatewayClient.DOMAINS.avalancheFuji]
);

// Check if Gateway has picked up the Avalanche deposit yet
// Since Avalanche has instant finality, this should be quick
const avalancheBalance = evmBalances.find(
  (b) => b.domain === GatewayClient.DOMAINS.avalancheFuji
).balance;

// This is the amount we intend to transfer
const fromAvalancheAmount = 0.2;

if (
  !avalancheBalance ||
  parseFloat(avalancheBalance.balance) < fromAvalancheAmount
) {
  console.error(
    "Gateway deposit not yet picked up on Avalanche, wait until finalization"
  );
  process.exit(1);
} else {
  console.log(
    "Gateway deposit picked up on Avalanche! Current balance: ",
    avalancheBalance
  );
}

// Construct the burn intents
console.log("Constructing burn intent ...");

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

const burnIntents = [
  burnIntent({
    account: evmAccount,
    from: avalanche,
    to: solanaRecipient,
    amount: fromAvalancheAmount,
    recipient: defaultRecipientAta.toBase58(),
  }),
];

const isSourceSolana = false;
const isDestinationSolana = true;

// Sign the burn intents
console.log("Signing burn intents...");
const request = await Promise.all(
  burnIntents.map(async (intent) => {
    console.log("Signing burn intent:", intent);
    const typedData = burnIntentTypedData(
      intent,
      isSourceSolana,
      isDestinationSolana
    );
    const signature = await evmAccount.signTypedData(typedData);
    return { burnIntent: typedData.message, signature };
  })
);

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

const { attestation, signature } = response;
const mintTx = await solanaFeePayer.gatewayMinter.gatewayMint(
  attestation,
  signature
);
console.log("Transaction hash:", mintTx);
await solanaFeePayer.gatewayMinter.waitForConfirmation(mintTx);
console.log("Mint successful!");
process.exit(0);
