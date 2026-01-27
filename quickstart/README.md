
# Circle Gateway Quickstart (Solana)

This repository contains the runnable code for the Circle Gateway quickstart guide on Solana. It is designed to showcase the capabilities of Gateway that can interact with Solana by first depositing USDC into Gateway on an EVM or Solana chain, and then transferring it instantly to
the Solana chain.

## Instructions

### 1. Install dependencies

```bash
npm install
```

### 2. Prepare ENV variables

**[1] Create private keys/key pairs**

For EVM, if you have Foundry installed, you can run the following command to generate a new private key:
```
cast wallet new 
```

For Solana, you can run the following command to generate the key pair:

```
solana-keygen new -o keypair.json --no-bip39-passphrase
```

**[2] Save to .env**

Create a file called `.env` and add the following private keys. For the Solana keypairs, copy the entire JSON array from your `keypair.json` file.

```env
SOLANA_PRIVATE_KEYPAIR_1="<your-private-keypair>"
SOLANA_PRIVATE_KEYPAIR_2="<your-private-keypair>"
EVM_PRIVATE_KEY="<your-private-key>"
```

Note: If you don't want to test the solana-to-solana case, you only need to have `SOLANA_PRIVATE_KEYPAIR_1`.

### 3. Deposit USDC to sender

Run the deposit script to deposit USDC into Gateway on multiple chains. If you are using a freshly-created wallet,
you'll need to fund it with USDC from the [Circle Faucet](https://faucet.circle.com/) and also with native gas tokens on each chain (ETH for EVM chains and SOL for Solana).

```bash
# If the sender is an EVM chain
node evm/deposit.js

# If the sender is a Solana chain
node solana/deposit.js
```

Once USDC has been deposited, the transactions need to be finalized on each chain before they will be available for use in the Gateway API. 

### 4. Transfer

Once the deposits are finalized, you can transfer USDC from your Gateway balance to the Solana chain using the transfer
scripts:

```bash
# Transfer USDC from Avax to Solana
node transfers/avaxToSolana.js

# Same chain transfer
node transfers/solanaToSolana.js
```
