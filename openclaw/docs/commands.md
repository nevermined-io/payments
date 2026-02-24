---
title: "API Reference"
description: "All available tools and slash commands in the Nevermined OpenClaw plugin"
icon: "terminal"
---

# API Reference

The plugin provides slash commands for chat channels and tools for programmatic access. Each command is available in both forms.

## Authentication

### Login

Authenticate with Nevermined via browser login. Once authenticated, your API key is stored locally for subsequent requests.

**Slash command:** `/nvm_login [environment]`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `sandbox` | `sandbox` or `live` |

> **Example prompt:** "Log me in to Nevermined"

```
/nvm_login
/nvm_login live
/nvm_login sandbox:eyJhbG...
```

---

### Logout

Log out from Nevermined and remove the stored API key from the local session.

**Slash command:** `/nvm_logout`

> **Example prompt:** "Log me out of Nevermined"

---

## Subscriber Tools

Tools for users who want to discover plans, subscribe, check balances, and query AI agents.

### Check Credit Balance

Retrieve the current credit balance for a payment plan. Useful for checking how many credits remain before querying an agent or deciding whether to top up.

**Tool name:** `nevermined_checkBalance`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | No | Config `planId` | The payment plan ID to check |

> **Example prompt:** "How many credits do I have left on my plan?"

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

### Get Access Token

Generate an x402 access token for authenticating requests to a Nevermined agent. The token is included in the `PAYMENT-SIGNATURE` header when calling an agent endpoint directly.

**Tool name:** `nevermined_getAccessToken`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | No | Config `planId` | The payment plan ID |
| `agentId` | string | No | Config `agentId` | The agent ID |

> **Example prompt:** "Get me an access token for the translation agent"

**Returns:**
```json
{
  "accessToken": "eyJhbG..."
}
```

---

### Order a Plan

Purchase a Nevermined payment plan. This subscribes you to the plan and grants the associated credits, enabling you to query any agent linked to it.

**Tool name:** `nevermined_orderPlan`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | No | Config `planId` | The plan ID to purchase |

> **Example prompt:** "Subscribe me to the AI Assistant plan"

**Returns:** Order confirmation with transaction hash.

---

### Query an Agent

Send a prompt to a Nevermined AI agent end-to-end. This tool handles the full flow automatically: acquires an x402 access token, sends the prompt to the agent URL with the `PAYMENT-SIGNATURE` header, and returns the agent's response.

**Tool name:** `nevermined_queryAgent`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `agentUrl` | string | **Yes** | — | The URL of the agent to query |
| `prompt` | string | **Yes** | — | The prompt to send to the agent |
| `planId` | string | No | Config `planId` | The payment plan ID |
| `agentId` | string | No | Config `agentId` | The agent ID |
| `method` | string | No | `POST` | HTTP method |

> **Example prompt:** "Ask the translation agent at https://agent.example.com to translate 'hello' to French"

If the agent returns a 402 (Payment Required) response, the tool returns an error indicating insufficient credits.

---

## Builder Tools

Tools for agent builders who want to register agents and create payment plans on Nevermined.

### Register an Agent

Register a new AI agent on Nevermined with an associated payment plan in a single step. This creates both the agent entry and its payment plan, making the agent discoverable and monetizable.

**Tool name:** `nevermined_registerAgent`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **Yes** | Agent name |
| `description` | string | No | Agent description |
| `agentUrl` | string | **Yes** | The endpoint URL for the agent |
| `planName` | string | **Yes** | Name for the payment plan |
| `priceAmounts` | string | **Yes** | Comma-separated price amounts in wei |
| `priceReceivers` | string | **Yes** | Comma-separated receiver addresses |
| `creditsAmount` | number | **Yes** | Number of credits in the plan |
| `tokenAddress` | string | No | ERC20 token address (e.g. USDC). Omit for native token. |

> **Example prompt:** "Register my translation agent hosted at https://agent.example.com with a plan that costs 1 USDC for 100 credits"

**Returns:**
```json
{
  "agentId": "did:nv:...",
  "planId": "did:nv:...",
  "txHash": "0x..."
}
```

---

### Create a Payment Plan

Create a standalone payment plan without associating it to an agent. Supports fiat pricing (via Stripe), ERC20 tokens (e.g. USDC), and native cryptocurrency. Plans created separately can be linked to agents later.

**Tool name:** `nevermined_createPlan`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **Yes** | Plan name |
| `description` | string | No | Plan description |
| `priceAmount` | string | **Yes** | Price amount — in cents for fiat (e.g. "100" = $1.00), in token smallest unit for crypto (e.g. "1000000" = 1 USDC) |
| `receiver` | string | **Yes** | Receiver wallet address (0x...) |
| `creditsAmount` | number | **Yes** | Number of credits in the plan |
| `pricingType` | string | No | `"fiat"` for Stripe/USD, `"erc20"` for ERC20 tokens, `"crypto"` for native token (default) |
| `accessLimit` | string | No | `"credits"` (default) or `"time"` |
| `tokenAddress` | string | No | ERC20 token contract address. Required when pricingType is `"erc20"`. |

> **Example prompt:** "Create a payment plan called 'Pro Tier' that costs $5 for 500 credits"

**Returns:**
```json
{
  "planId": "did:nv:..."
}
```

---

### List Payment Plans

List all payment plans owned by the authenticated builder. Useful for reviewing existing plans before creating new ones or linking them to agents.

**Tool name:** `nevermined_listPlans`

No parameters required.

> **Example prompt:** "Show me all my payment plans"

**Returns:** Array of plan objects.
