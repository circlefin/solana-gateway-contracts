import { account, avalanche } from "./setup.js";
import { InsufficientFundsError } from "viem";

const DEPOSIT_AMOUNT = 500000n; // 0.5 USDC

// Deposit into the GatewayWallet contract on all chains
for (const chain of [avalanche]) {
  // Get the wallet's current USDC balance
  console.log(`Checking USDC balance on ${chain.name}...`);
  const balance = await chain.usdc.read.balanceOf([account.address]);

  // Ensure the balance is sufficient for the deposit
  if (balance < DEPOSIT_AMOUNT) {
    console.error(`Insufficient USDC balance on ${chain.name}!`);
    console.error("Please top up at https://faucet.circle.com.");
    process.exit(1);
  }

  // Attempt to approve and deposit USDC into the GatewayWallet contract, and
  // handle the error if the wallet does not have enough funds to pay for gas
  try {
    // Approve the GatewayWallet contract for the wallet's USDC
    console.log("Approving the GatewayWallet contract for USDC...");
    const approvalTx = await chain.usdc.write.approve([
      chain.gatewayWallet.address,
      DEPOSIT_AMOUNT,
    ]);
    await chain.client.waitForTransactionReceipt({ hash: approvalTx });
    console.log("Done! Transaction hash:", approvalTx);

    // Deposit USDC into the GatewayWallet contract
    console.log("Depositing USDC into the GatewayWallet contract...");
    const depositTx = await chain.gatewayWallet.write.deposit([
      chain.usdc.address,
      DEPOSIT_AMOUNT,
    ]);
    await chain.client.waitForTransactionReceipt({ hash: depositTx });
    console.log("Done! Transaction hash:", depositTx);
  } catch (error) {
    if (error.cause instanceof InsufficientFundsError) {
      console.error(
        `The wallet does not have enough ${chain.currency} to pay for gas on ${chain.name}!`
      );
      console.error(`Please top up using a faucet.`);
    } else {
      // Log any other errors for debugging
      console.error(error);
    }
    process.exit(1);
  }
}
