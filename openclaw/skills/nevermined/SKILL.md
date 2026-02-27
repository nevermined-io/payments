---
metadata:
  openclaw:
    requires:
      config: ["plugins.openclaw-plugin"]
---

# Nevermined Tools

This plugin provides gateway tools for interacting with Nevermined AI agent payments. Supports both crypto (on-chain) and fiat (credit card) payment flows.

## Authentication

### `/nvm_login [environment]`
Authenticate with Nevermined via browser login. Opens a browser window to obtain an API key. You can also paste an API key directly: `/nvm_login <api-key>`.
- `environment` (optional) — `sandbox` or `live` (default: from config)

### `/nvm_logout`
Log out from Nevermined and remove the stored API key.

## Subscriber Tools

### `nevermined_checkBalance`
Check credit balance for a payment plan.
- `planId` (optional if set in config) — the plan to check

### `nevermined_getAccessToken`
Get an x402 access token for authenticating agent requests. Supports crypto and fiat payment types.
- `planId` (optional if set in config)
- `agentId` (optional if set in config)
- `paymentType` (optional) — `"crypto"` (default) or `"fiat"`
- `paymentMethodId` (optional) — Stripe payment method ID for fiat. Auto-selects first enrolled card if omitted.
- `spendingLimitCents` (optional) — max spend in cents for fiat (default: 1000)
- `delegationDurationSecs` (optional) — delegation duration in seconds for fiat (default: 3600)

### `nevermined_orderPlan`
Purchase a crypto payment plan.
- `planId` (optional if set in config)

### `nevermined_orderFiatPlan`
Order a fiat payment plan — returns a Stripe checkout URL.
- `planId` (optional if set in config)

### `nevermined_listPaymentMethods`
List enrolled credit cards available for fiat payments. No parameters.

### `nevermined_queryAgent`
End-to-end agent query — acquires a token, calls the agent, returns the response. Supports crypto and fiat.
- `agentUrl` (required) — the agent endpoint URL
- `prompt` (required) — the prompt to send
- `planId` (optional if set in config)
- `agentId` (optional if set in config)
- `method` (optional, default `POST`)
- `paymentType` (optional) — `"crypto"` (default) or `"fiat"`
- `paymentMethodId` (optional) — Stripe payment method ID for fiat
- `spendingLimitCents` (optional) — max spend in cents for fiat
- `delegationDurationSecs` (optional) — delegation duration in seconds for fiat

## Builder Tools

### `nevermined_registerAgent`
Register a new AI agent with a payment plan.
- `name` (required) — agent name
- `agentUrl` (required) — agent endpoint
- `planName` (required) — plan name
- `priceAmounts` (required) — comma-separated prices in wei (crypto) or cents (fiat)
- `priceReceivers` (required) — comma-separated receiver addresses
- `creditsAmount` (required) — number of credits
- `tokenAddress` (optional) — ERC20 token address (e.g. USDC). Omit for native token.
- `pricingType` (optional) — `"crypto"` (default), `"erc20"`, or `"fiat"`

### `nevermined_createPlan`
Create a standalone payment plan. Supports fiat (Stripe), ERC20 tokens (USDC), and native crypto pricing.
- `name` (required) — plan name
- `priceAmount` (required) — price in cents for fiat (e.g. "100" = $1.00), in token smallest unit for crypto (e.g. "1000000" = 1 USDC)
- `receiver` (required) — receiver wallet address (0x...)
- `creditsAmount` (required) — number of credits
- `pricingType` (optional) — `"fiat"` for Stripe/USD, `"erc20"` for ERC20 tokens like USDC, `"crypto"` for native token (default: crypto)
- `accessLimit` (optional) — `"credits"` or `"time"`
- `tokenAddress` (optional) — ERC20 token contract address. Required when pricingType is "erc20".

### `nevermined_listPlans`
List your payment plans. No parameters.
