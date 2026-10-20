# Circle Gateway Contracts on Solana

## Commands

All commands check for installation of [rust](https://www.rust-lang.org/tools/install),
[solana CLI](https://solana.com/docs/intro/installation), and
[anchor CLI](https://www.anchor-lang.com/docs/installation#install-anchor-cli).

```bash
# One-time setup (installs Rust, Solana CLI, Anchor, and creates a keypair)
source ./run.sh setup

# Build all programs (gateway-minter and gateway-wallet)
anchor build

# Clean build artifacts
anchor clean

# Run all tests
anchor test

# Format code (checks both Rust and TypeScript/JavaScript)
yarn format

# Auto-fix formatting issues (fixes both Rust and TypeScript/JavaScript)
yarn format:fix

# Lint code (checks both Rust and TypeScript/JavaScript)
yarn lint
```

The script will automatically use the correct versions of tools as specified in:
- `Anchor.toml` for Solana CLI and Anchor versions
- `rust-toolchain.toml` for Rust version

## Dependencies
To ensure with certainty that packages are not changed unexpectedly as well as to enable reproducible, verifiable builds, all Cargo dependencies are vendored locally in the vendor directory and enabled via the .cargo/config.toml file.

To add a new dependency:
```bash
# remove to allow pulling dependencies from crates-io
rm .cargo/config.toml

# Add your dependency
cargo add <dependency> --package <package>
cargo vendor --locked

# restore to the original
git restore .cargo/config.toml
```
