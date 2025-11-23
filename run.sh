#!/bin/bash
#
# Copyright 2025 Circle Internet Financial, LTD. All rights reserved.
#
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -e
corepack enable
SOLANA_CLI_VERSION=$(grep "solana_version" Anchor.toml | cut -d'"' -f2)
RUST_VERSION=$(grep "channel" rust-toolchain.toml | cut -d'"' -f2)
ANCHOR_VERSION=$(grep "anchor_version" Anchor.toml | cut -d'"' -f2)

echo "Solana CLI Version: $SOLANA_CLI_VERSION"
echo "Rust Version: $RUST_VERSION"
echo "Anchor Version: $ANCHOR_VERSION"

function setup() {
  echo "=== Setup ==="
  install_rust $RUST_VERSION
  install_solana
  install_avm $ANCHOR_VERSION
  create_key_pair
  yarn install
}

function create_key_pair() {
  if [ -e ~/.config/solana/id.json ]; then
    echo "Local solana keypair already exists"
  else
    echo "No local solana keypair found, creating one"
    mkdir -p ~/.config/solana
    touch ~/.config/solana/id.json
    solana-keygen new -o ~/.config/solana/id.json --force --no-bip39-passphrase
  fi
}

function install_avm() {
  if ! avm --version >/dev/null; then
    echo "INSTALLING AVM -- https://www.anchor-lang.com/docs/installation"
    cargo install --git https://github.com/coral-xyz/anchor --locked --tag v$1 avm --force
    avm --version
    echo -e "AVM successfully installed\n"
  fi

  if ! avm list | grep "$.*installed" > /dev/null; then
    echo "AVM: Installing Anchor version $1"
    avm install "$1"
  fi

  avm use "$1"
}

function install_rust() {
  if ! rustup -V >/dev/null; then
    echo "INSTALLING RUST -- https://www.rust-lang.org/tools/install"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- --default-toolchain="$1" --profile=minimal -y
    source "$HOME/.cargo/env"
    rustup -V
    # Only needed for github action
    rustup component add rustfmt
    rustup component add clippy
  else
    rustup toolchain install "$1" --allow-downgrade
    rustup component add --toolchain "$1" rustfmt
    rustup component add --toolchain "$1" clippy
  fi
  rustup default "$1"
  echo "Rust version $1 successfully installed"
}

function install_solana() {
  if ! which solana 2>/dev/null || ! solana --version >/dev/null; then
    echo "INSTALLING SOLANA-CLI -- https://docs.solana.com/cli/install-solana-cli-tools"
    sh -c "$(curl -sSfL https://release.anza.xyz/v${SOLANA_CLI_VERSION}/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
    solana --version
    echo -e "Solana-CLI successfully installed\n"
  else
    CURRENT_VERSION=$(solana --version | cut -d' ' -f2)
    if [ "$CURRENT_VERSION" != "$SOLANA_CLI_VERSION" ]; then
      echo "Updating Solana CLI from version $CURRENT_VERSION to $SOLANA_CLI_VERSION"
      agave-install init $SOLANA_CLI_VERSION
      echo "Solana CLI updated successfully"
    else
      echo "Solana CLI already installed with correct version $SOLANA_CLI_VERSION"
    fi
  fi
}

# This script takes in a function name as the first argument,
# and runs it in the context of the script.

if [ -z $1 ]; then
  echo "Usage: bash run.sh <function>";
  exit 1;
elif declare -f "$1" > /dev/null; then
  "$@";
else
  echo "Function '$1' does not exist";
  exit 1;
fi
