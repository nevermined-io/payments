---
title: "Commands"
description: "All available tools and slash commands in the Nevermined OpenClaw plugin"
icon: "terminal"
---

# Commands

The plugin provides slash commands for chat channels and tools that agents can invoke on behalf of users. Slash commands are triggered directly by users with the `/` prefix, while tools are called by the AI agent in response to natural language requests.

## Authentication Commands

### Log In — `/nvm_login`

Authenticate with the Nevermined platform to enable all payment tools. The plugin supports three authentication flows: automatic browser login, environment selection, and direct API key input.

When using browser login, the plugin starts a temporary local server, opens your default browser to the Nevermined login page, and captures the API key automatically after you sign in. On headless servers where no browser is available, paste your API key directly.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `sandbox` | `sandbox` or `live` |

**Example:**
```
/nvm_login
/nvm_login live
/nvm_login sandbox:eyJhbG...
```

---

### Log Out — `/nvm_logout`

End your Nevermined session and remove the stored API key from memory. After logging out, all payment tools will be unavailable until you authenticate again. Use this when switching accounts or when you want to revoke the current session for security.

---

## Subscriber Tools

These tools are designed for users who consume paid AI agent services. They handle the full lifecycle of subscribing to a plan, paying for access, and querying agents.

### Check Credit Balance — `nevermined_checkBalance`

Retrieve the current credit balance for a payment plan. This is useful to verify how many credits remain before making requests, or to confirm that a recent purchase was credited to your account. The response includes the plan name, remaining balance, and whether you are an active subscriber.

If a `planId` is configured in the plugin settings, it is used by default. You can override it per call.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | No | Config `planId` | The payment plan ID to check |

**Example prompt:**
> How many credits do I have left on my Weather Forecast plan?

**Returns:**
```json
{
  "planId": "did:nv:abc123...",
  "planName": "Basic Plan",
  "balance": "95",
  "isSubscriber": true
}
```

---

### Get Access Token — `nevermined_getAccessToken`

Generate an x402 access token that authorizes requests to a paid Nevermined agent. The token is cryptographically signed and contains delegated permissions (order, burn) that allow the agent to verify and settle payments on your behalf.

This tool supports two payment schemes. **Crypto** (the default) uses the `nvm:erc4337` on-chain scheme with session keys and smart accounts. **Fiat** uses the `nvm:card-delegation` scheme, which charges a previously enrolled credit card via Stripe delegation. When using fiat, the plugin automatically looks up your enrolled payment methods and selects the first one unless you specify a `paymentMethodId`.

Most users will not need to call this tool directly — `nevermined_queryAgent` handles token acquisition automatically. Use this tool when you need the raw token for custom integrations or debugging.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | No | Config `planId` | The payment plan ID |
| `agentId` | string | No | Config `agentId` | The agent ID |
| `paymentType` | string | No | Config `paymentType` or `"crypto"` | `"crypto"` (nvm:erc4337 scheme) or `"fiat"` (nvm:card-delegation scheme) |
| `paymentMethodId` | string | No | Auto-selects first enrolled card | Stripe payment method ID (`pm_...`). Only used for fiat. |
| `spendingLimitCents` | number | No | Config `defaultSpendingLimitCents` or `1000` | Max spend in cents. Only used for fiat. |
| `delegationDurationSecs` | number | No | Config `defaultDelegationDurationSecs` or `3600` | Delegation duration in seconds. Only used for fiat. |

**Example prompt:**
> Get me an access token for the Weather Oracle agent so I can call it from my script.

**Returns:**
```json
{
  "accessToken": "eyJhbG..."
}
```

---

### Purchase a Crypto Plan — `nevermined_orderPlan`

Purchase a payment plan using cryptocurrency. This initiates an on-chain transaction that transfers the plan's price to the builder's wallet and credits your account with the plan's allotted credits. The transaction is processed through the Nevermined Protocol smart contracts.

Use this for plans priced in native tokens (ETH, MATIC) or ERC-20 tokens (USDC). For plans priced in fiat currency, use `nevermined_orderFiatPlan` instead.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | No | Config `planId` | The plan ID to purchase |

**Example prompt:**
> Buy the Weather Forecast plan so I can start querying the agent.

**Returns:** Order confirmation with transaction hash.

---

### Purchase a Fiat Plan — `nevermined_orderFiatPlan`

Purchase a payment plan using fiat currency (USD). Instead of executing an on-chain transaction, this tool returns a Stripe checkout URL where you complete the payment in a browser. Once the payment is confirmed, credits are added to your account.

Use this for plans that have been created with `pricingType: fiat`. For crypto-priced plans, use `nevermined_orderPlan` instead.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | No | Config `planId` | The plan ID to purchase |

**Example prompt:**
> I want to subscribe to the Premium Agent plan using my credit card.

**Returns:**
```json
{
  "result": {
    "checkoutUrl": "https://checkout.stripe.com/..."
  }
}
```

---

### List Payment Methods — `nevermined_listPaymentMethods`

Retrieve the list of credit cards you have enrolled for fiat payments. Cards are enrolled through the [Nevermined App](https://nevermined.app) under Settings > Payment Methods. Each entry includes the card brand, last four digits, and expiration date.

This is useful to verify which cards are available before making a fiat payment, or to find the `paymentMethodId` for a specific card when you have multiple cards enrolled.

No parameters required.

**Example prompt:**
> Which credit cards do I have on file for Nevermined payments?

**Returns:**
```json
[
  {
    "id": "pm_...",
    "brand": "visa",
    "last4": "4242",
    "expMonth": 12,
    "expYear": 2027
  }
]
```

---

### Query a Paid Agent — `nevermined_queryAgent`

Send a prompt to a paid Nevermined AI agent and get the response. This is the main tool for interacting with agents — it handles the full payment lifecycle in a single call:

1. Acquires an x402 access token (crypto or fiat, depending on `paymentType`)
2. Sends the prompt to the agent's URL with the `PAYMENT-SIGNATURE` header
3. Returns the agent's response

If the agent returns a 402 (Payment Required) response, the tool returns an error suggesting you purchase credits first. This typically means your plan has run out of credits or you haven't subscribed yet.

Like `nevermined_getAccessToken`, this tool supports both crypto and fiat payment types. When using fiat, it automatically resolves your enrolled card and builds the delegation config.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `agentUrl` | string | **Yes** | — | The URL of the agent to query |
| `prompt` | string | **Yes** | — | The prompt to send to the agent |
| `planId` | string | No | Config `planId` | The payment plan ID |
| `agentId` | string | No | Config `agentId` | The agent ID |
| `method` | string | No | `POST` | HTTP method |
| `paymentType` | string | No | Config `paymentType` or `"crypto"` | `"crypto"` (nvm:erc4337 scheme) or `"fiat"` (nvm:card-delegation scheme) |
| `paymentMethodId` | string | No | Auto-selects first enrolled card | Stripe payment method ID (`pm_...`). Only used for fiat. |
| `spendingLimitCents` | number | No | Config `defaultSpendingLimitCents` or `1000` | Max spend in cents. Only used for fiat. |
| `delegationDurationSecs` | number | No | Config `defaultDelegationDurationSecs` or `3600` | Delegation duration in seconds. Only used for fiat. |

**Example prompts:**
> Ask the Weather Oracle at https://weather.example.com/agent what the forecast is for Barcelona.

> Query the translation agent at https://translate.example.com/tasks to translate "hello world" into French, and pay with my credit card.

---

## Builder Tools

These tools are designed for agent builders who want to register their AI agents on the Nevermined marketplace and create payment plans that subscribers can purchase.

### Register an Agent — `nevermined_registerAgent`

Register a new AI agent on Nevermined and create an associated payment plan in a single operation. This publishes your agent to the Nevermined marketplace, making it discoverable and purchasable by subscribers.

The tool creates both the agent record (with its endpoint URL) and a payment plan (with pricing and credit allocation). The `pricingType` parameter controls how the plan is priced: `"crypto"` for native blockchain tokens, `"erc20"` for stablecoins like USDC, or `"fiat"` for USD pricing via Stripe.

After registration, the returned `agentId` and `planId` should be saved in your plugin config for the paid endpoint to work.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **Yes** | Agent name |
| `description` | string | No | Agent description |
| `agentUrl` | string | **Yes** | The endpoint URL for the agent |
| `planName` | string | **Yes** | Name for the payment plan |
| `priceAmounts` | string | **Yes** | Comma-separated price amounts in wei (crypto) or cents (fiat) |
| `priceReceivers` | string | **Yes** | Comma-separated receiver addresses |
| `creditsAmount` | number | **Yes** | Number of credits in the plan |
| `tokenAddress` | string | No | ERC20 token address (e.g. USDC). Omit for native token. |
| `pricingType` | string | No | `"crypto"` (default), `"erc20"`, or `"fiat"` |

**Example prompt:**
> Register a new agent called "Code Review Bot" at https://my-server.com/nevermined/agent with a plan named "Code Review" priced at 1000000 (1 USDC) to address 0xABC... with token 0x036CbD...  granting 10 credits.

**Returns:**
```json
{
  "agentId": "did:nv:...",
  "planId": "did:nv:...",
  "txHash": "0x..."
}
```

---

### Create a Payment Plan — `nevermined_createPlan`

Create a standalone payment plan without associating it with an agent. This is useful when you want to manage plans separately from agents, or when a single plan should grant access to multiple agents.

The plan can be priced in three ways: `"fiat"` sets the price in USD cents (e.g. `"100"` = $1.00) and subscribers pay via Stripe, `"erc20"` sets the price in an ERC-20 token's smallest unit (e.g. `"1000000"` = 1 USDC) and requires a `tokenAddress`, and `"crypto"` (the default) sets the price in the blockchain's native token.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **Yes** | Plan name |
| `description` | string | No | Plan description |
| `priceAmount` | string | **Yes** | Price in cents for fiat (e.g. "100" = $1.00), in token smallest unit for crypto |
| `receiver` | string | **Yes** | Receiver wallet address (0x...) |
| `creditsAmount` | number | **Yes** | Number of credits in the plan |
| `pricingType` | string | No | `"fiat"` for Stripe/USD, `"erc20"` for ERC20 tokens, `"crypto"` for native token (default) |
| `accessLimit` | string | No | `"credits"` (default) or `"time"` |
| `tokenAddress` | string | No | ERC20 token contract address. Required when pricingType is "erc20". |

**Example prompt:**
> Create a fiat payment plan called "Pro Tier" at $5.00 (500 cents) to wallet 0xABC... with 50 credits.

**Returns:**
```json
{
  "planId": "did:nv:..."
}
```

---

### List My Plans — `nevermined_listPlans`

Retrieve all payment plans owned by the authenticated builder. This returns the full list of plans you have created, including their IDs, names, and configuration. Useful for finding a `planId` to use with other tools or to review your current offerings.

No parameters required.

**Example prompt:**
> Show me all the payment plans I've created on Nevermined.

**Returns:** Array of plan objects.
