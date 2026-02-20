---
metadata:
  openclaw:
    requires:
      config: ["plugins.nevermined.nvmApiKey"]
---

# Nevermined Tools

This plugin provides gateway tools for interacting with Nevermined AI agent payments.

## Subscriber Tools

### `nevermined.checkBalance`
Check credit balance for a payment plan.
- `planId` (optional if set in config) — the plan to check

### `nevermined.getAccessToken`
Get an x402 access token for authenticating agent requests.
- `planId` (optional if set in config)
- `agentId` (optional if set in config)

### `nevermined.orderPlan`
Purchase a payment plan.
- `planId` (optional if set in config)

### `nevermined.queryAgent`
End-to-end agent query — acquires a token, calls the agent, returns the response.
- `agentUrl` (required) — the agent endpoint URL
- `prompt` (required) — the prompt to send
- `planId` (optional if set in config)
- `agentId` (optional if set in config)
- `method` (optional, default `POST`)

## Builder Tools

### `nevermined.registerAgent`
Register a new AI agent with a payment plan.
- `name` (required) — agent name
- `agentUrl` (required) — agent endpoint
- `planName` (required) — plan name
- `priceAmounts` (required) — comma-separated prices in wei
- `priceReceivers` (required) — comma-separated receiver addresses
- `creditsAmount` (required) — number of credits

### `nevermined.createPlan`
Create a standalone payment plan.
- `name` (required) — plan name
- `priceAmounts` (required) — comma-separated prices in wei
- `priceReceivers` (required) — comma-separated receiver addresses
- `creditsAmount` (required) — number of credits
- `accessLimit` (optional) — `"credits"` or `"time"`

### `nevermined.listPlans`
List your payment plans. No parameters.
