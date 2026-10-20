# Discriminator Summary

This document summarizes the 2-byte discriminator scheme used across the Gateway programs.

## Design Principle

To avoid conflicts and improve clarity, we use different prefixes for different program types:
- **Minter events**: Prefix `10` (decimal)
- **Wallet events**: Prefix `20` (decimal)
- **Minter accounts**: Prefix `11` (decimal)
- **Wallet accounts**: Prefix `21` (decimal)
- **Minter instructions**: Prefix `12` (decimal)
- **Wallet instructions**: Prefix `22` (decimal)

**Pattern:** In the base-10 representation of the first byte:
- **First digit**: Distinguishes the program (`1` for Minter, `2` for Wallet)
- **Second digit**: Distinguishes the type (`0` for Events, `1` for Accounts, `2` for Instructions)

This ensures:
1. All discriminators are unique across the entire project
2. No conflicts between programs
3. Clear separation for off-chain clients and tools
4. No all-zero discriminators (which are not allowed by Anchor)
5. Logical, systematic grouping with an easy-to-remember pattern

## Account Discriminators

### GatewayWallet Program Accounts (Prefix 21)
| Account Type | Discriminator | Notes |
|--------------|---------------|-------|
| `GatewayWallet` | `[21, 0]` | Main wallet state |
| `GatewayDeposit` | `[21, 1]` | Individual depositor state |
| `GatewayDelegate` | `[21, 2]` | Delegate authorization |
| `Denylist` | `[21, 3]` | Denylisted accounts |
| `UsedTransferSpecHash` | `[21, 4]` | Replay protection for burns |

### GatewayMinter Program Accounts (Prefix 11)
| Account Type | Discriminator | Notes |
|--------------|---------------|-------|
| `GatewayMinter` | `[11, 0]` | Main minter state |
| `UsedTransferSpecHash` | `[11, 1]` | Replay protection for mints |

## Event Discriminators

### GatewayMinter Events (Prefix 10)
All minter events use prefix `10`:
- `OwnershipTransferStarted`: `[10, 0]`
- `OwnershipTransferred`: `[10, 1]`
- `GatewayMinterInitialized`: `[10, 2]`
- `PauserChanged`: `[10, 3]`
- `AttestationSignerAdded`: `[10, 4]`
- `AttestationSignerRemoved`: `[10, 5]`
- `TokenControllerUpdated`: `[10, 6]`
- `TokenSupported`: `[10, 7]`
- `TokenCustodyBurned`: `[10, 8]`
- `Paused`: `[10, 9]`
- `Unpaused`: `[10, 10]`
- `AttestationUsed`: `[10, 11]`

### GatewayWallet Events (Prefix 20)
All wallet events use prefix `20`:
- `GatewayWalletInitialized`: `[20, 0]`
- `OwnershipTransferStarted`: `[20, 1]`
- `OwnershipTransferred`: `[20, 2]`
- `PauserChanged`: `[20, 3]`
- `DenylisterChanged`: `[20, 4]`
- `TokenControllerUpdated`: `[20, 5]`
- `TokenSupported`: `[20, 6]`
- `Deposited`: `[20, 7]`
- `DelegateAdded`: `[20, 8]`
- `DelegateRemoved`: `[20, 9]`
- `Denylisted`: `[20, 10]`
- `UnDenylisted`: `[20, 11]`
- `WithdrawalInitiated`: `[20, 12]`
- `BurnSignerAdded`: `[20, 13]`
- `BurnSignerRemoved`: `[20, 14]`
- `WithdrawalCompleted`: `[20, 15]`
- `WithdrawalDelayChanged`: `[20, 16]`
- `FeeRecipientChanged`: `[20, 17]`
- `Paused`: `[20, 18]`
- `Unpaused`: `[20, 19]`
- `GatewayBurned`: `[20, 20]`
- `InsufficientBalance`: `[20, 21]`

## Instruction Discriminators

### GatewayMinter Instructions (Prefix 12)
All minter instructions use prefix `12`:
- `gateway_mint`: `[12, 0]`
- `gateway_mint_with_params`: `[12, 1]`
- `initialize`: `[12, 2]`
- `transfer_ownership`: `[12, 3]`
- `accept_ownership`: `[12, 4]`
- `update_pauser`: `[12, 5]`
- `update_token_controller`: `[12, 6]`
- `add_attester`: `[12, 7]`
- `remove_attester`: `[12, 8]`
- `add_token`: `[12, 9]`
- `burn_token_custody`: `[12, 10]`
- `pause`: `[12, 11]`
- `unpause`: `[12, 12]`

### GatewayWallet Instructions (Prefix 22)
All wallet instructions use prefix `22`:
- `deposit`: `[22, 0]`
- `deposit_for`: `[22, 1]`
- `gateway_burn`: `[22, 2]`
- `withdraw`: `[22, 3]`
- `initiate_withdrawal`: `[22, 4]`
- `initialize`: `[22, 5]`
- `transfer_ownership`: `[22, 6]`
- `accept_ownership`: `[22, 7]`
- `update_pauser`: `[22, 8]`
- `update_denylister`: `[22, 9]`
- `update_token_controller`: `[22, 10]`
- `update_withdrawal_delay`: `[22, 11]`
- `add_token`: `[22, 12]`
- `add_burn_signer`: `[22, 13]`
- `remove_burn_signer`: `[22, 14]`
- `add_delegate`: `[22, 15]`
- `remove_delegate`: `[22, 16]`
- `denylist`: `[22, 17]`
- `undenylist`: `[22, 18]`
- `pause`: `[22, 19]`
- `unpause`: `[22, 20]`
- `update_fee_recipient`: `[22, 21]`

## Quick Reference Table

| Type | Minter Prefix | Wallet Prefix |
|------|---------------|---------------|
| Events | `10` | `20` |
| Accounts | `11` | `21` |
| Instructions | `12` | `22` |
