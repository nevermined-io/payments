---
title: "Commands"
description: "All available tools and slash commands in the Nevermined OpenClaw plugin"
icon: "terminal"
---

# Commands

The plugin provides slash commands for chat channels and gateway methods for programmatic access. Each command is available in both forms.

## Authentication

### `/nvm_login [environment]`

Authenticate with Nevermined via browser login.

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

### `/nvm_logout`

Log out from Nevermined and remove the stored API key.

---

## Subscriber Tools

These tools are for users who want to subscribe to plans, check balances, and query agents.

### `nevermined_checkBalance`

Check the credit balance for a payment plan.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | No | Config `planId` | The payment plan ID to check |

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

### `nevermined_getAccessToken`

Get an x402 access token for authenticating requests to a Nevermined agent.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | No | Config `planId` | The payment plan ID |
| `agentId` | string | No | Config `agentId` | The agent ID |

**Returns:**
```json
{
  "accessToken": "eyJhbG..."
}
```

---

### `nevermined_orderPlan`

Purchase (order) a Nevermined payment plan.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | No | Config `planId` | The plan ID to purchase |

**Returns:** Order confirmation with transaction hash.

---

### `nevermined_queryAgent`

End-to-end agent query: acquires an x402 access token, sends the prompt to the agent URL with the `PAYMENT-SIGNATURE` header, and returns the response.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `agentUrl` | string | **Yes** | — | The URL of the agent to query |
| `prompt` | string | **Yes** | — | The prompt to send to the agent |
| `planId` | string | No | Config `planId` | The payment plan ID |
| `agentId` | string | No | Config `agentId` | The agent ID |
| `method` | string | No | `POST` | HTTP method |

If the agent returns a 402 (Payment Required) response, the tool returns an error indicating insufficient credits.

---

## Builder Tools

These tools are for agent builders who want to register agents and create payment plans.

### `nevermined_registerAgent`

Register a new AI agent with an associated payment plan.

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

**Returns:**
```json
{
  "agentId": "did:nv:...",
  "planId": "did:nv:...",
  "txHash": "0x..."
}
```

---

### `nevermined_createPlan`

Create a standalone payment plan (without an agent).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **Yes** | Plan name |
| `description` | string | No | Plan description |
| `priceAmounts` | string | **Yes** | Comma-separated price amounts in wei |
| `priceReceivers` | string | **Yes** | Comma-separated receiver addresses |
| `creditsAmount` | number | **Yes** | Number of credits in the plan |
| `accessLimit` | string | No | `"credits"` (default) or `"time"` |
| `tokenAddress` | string | No | ERC20 token address (e.g. USDC). Omit for native token. |

**Returns:**
```json
{
  "planId": "did:nv:..."
}
```

---

### `nevermined_listPlans`

List the builder's payment plans. No parameters required.

**Returns:** Array of plan objects.
