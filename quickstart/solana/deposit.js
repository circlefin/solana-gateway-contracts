import { solanaAccount1 as solanaSenderAccount } from "./setup.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import BN from "bn.js";

const DEPOSIT_AMOUNT = new BN(500000); // 0.5 USDC (6 decimals)

// Get USDC balance for an account on a Solana chain
async function getUsdcBalance(chain, accountPublicKey) {
  // Get the associated token account for the user's USDC
  const userTokenAccount = await getAssociatedTokenAddress(
    chain.usdc.publicKey,
    accountPublicKey
  );

  // Get the token account info to check balance
  const tokenAccountInfo = await getAccount(chain.connection, userTokenAccount);

  return {
    balance: tokenAccountInfo.amount,
    tokenAccount: userTokenAccount,
  };
}

// Deposit into the GatewayWallet program on Solana
async function depositToSolana() {
  const chain = solanaSenderAccount;

  try {
    // Check USDC balance
    console.log(`Checking USDC balance on ${chain.name}...`);
    const { balance, tokenAccount: userTokenAccount } = await getUsdcBalance(
      chain,
      solanaSenderAccount.publicKey
    );
    console.log("User token account:", userTokenAccount.toBase58());
    console.log(`Current balance: ${balance} USDC (atomic units)`);

    // Ensure the balance is sufficient for the deposit
    if (balance < DEPOSIT_AMOUNT) {
      console.error(`Insufficient USDC balance on ${chain.name}!`);
      console.error("Please top up at https://faucet.circle.com.");
      process.exit(1);
    }

    // Deposit USDC into the GatewayWallet contract
    console.log("Depositing USDC into the GatewayWallet contract...");

    const tx = await chain.gatewayWallet.deposit(
      chain.usdc.publicKey,
      DEPOSIT_AMOUNT
    );
    console.log("Transaction hash:", tx);

    await chain.gatewayWallet.waitForConfirmation(tx);
    console.log("Deposit successful!");
  } catch (error) {
    if (error.error?.InstructionError?.[1] === "InsufficientFunds") {
      // If there wasn't enough for gas, log an error message and exit
      console.error(
        `The wallet does not have enough ${chain.currency} to pay for transaction fees on ${chain.name}!`
      );
      console.error(`Please top up using a faucet.`);
    } else {
      // Log any other errors for debugging
      console.error("Error during deposit:", error);
    }
    process.exit(1);
  }
}

// Run the deposit
depositToSolana();
