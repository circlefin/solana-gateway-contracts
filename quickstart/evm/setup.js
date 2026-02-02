import "dotenv/config";
import { createPublicClient, getContract, http, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as chains from "viem/chains";
import { GatewayClient } from "../gateway-client.js";
import { gatewayWalletAbi, gatewayMinterAbi } from "./abis.js";

// Addresses that are needed across testnet networks
const gatewayWalletAddress = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const gatewayMinterAddress = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const usdcAddresses = {
  sepolia: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
};

// Sets up a client and contracts for the given chain and account
function setup(chainName, account) {
  const chain = chains[chainName];
  const client = createPublicClient({
    chain,
    account,
    // Use the flashblocks-aware RPC for Base Sepolia, otherwise use the default RPC
    transport:
      chainName === "baseSepolia"
        ? http("https://sepolia-preconf.base.org")
        : http(),
  });

  return {
    client,
    name: chain.name,
    domain: GatewayClient.DOMAINS[chainName],
    currency: chain.nativeCurrency.symbol,
    usdc: getContract({
      address: usdcAddresses[chainName],
      abi: erc20Abi,
      client,
    }),
    gatewayWallet: getContract({
      address: gatewayWalletAddress,
      abi: gatewayWalletAbi,
      client,
    }),
    gatewayMinter: getContract({
      address: gatewayMinterAddress,
      abi: gatewayMinterAbi,
      client,
    }),
  };
}

// Create an account from the private key set in .env
export const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
console.log(`Using account: ${account.address}`);

// Set up clients and contracts for each chain
export const avalanche = setup("avalancheFuji", account);
