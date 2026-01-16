/////////////////////////////////////////////////////////////////
// A lightweight API client for interacting with the Gateway API.

export class GatewayClient {
  static GATEWAY_API_BASE_URL = "https://gateway-api-testnet.circle.com/v1";

  // Identifiers used for supported blockchains
  // See https://developers.circle.com/cctp/cctp-supported-blockchains#cctp-supported-domains
  static DOMAINS = {
    ethereum: 0,
    mainnet: 0,
    sepolia: 0,
    avalanche: 1,
    avalancheFuji: 1,
    solana: 5,
    solanaDevnet: 5,
    base: 6,
    baseSepolia: 6,
  };

  // Human-readable names for the supported blockchains, by domain
  static CHAINS = {
    0: "Ethereum",
    1: "Avalanche",
    5: "Solana",
    6: "Base",
  };

  // Gets info about supported chains and contracts
  async info() {
    return this.#get("/info");
  }

  // Checks balances for a given depositor for the given domains. If no domains
  // are specified, it defaults to all supported domains.
  async balances(token, depositor, domains) {
    return this.#post("/balances", {
      token,
      sources: domains.map((domain) => ({ depositor, domain })),
    });
  }

  // Sends burn intents to the API to retrieve an attestation
  async transfer(body) {
    return this.#post("/transfer", body);
  }

  // Private method to do a GET request to the Gateway API
  async #get(path) {
    const url = GatewayClient.GATEWAY_API_BASE_URL + path;
    const response = await fetch(url);
    return response.json();
  }

  // Private method to do a POST request to the Gateway API
  async #post(path, body) {
    const url = GatewayClient.GATEWAY_API_BASE_URL + path;
    const headers = { "Content-Type": "application/json" };
    const response = await fetch(url, {
      method: "POST",
      headers,
      // Serialize bigints as strings
      body: JSON.stringify(body, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      ),
    });
    return response.json();
  }
}
