---
name: Nevermined Payments
description: Pay-per-use payments and access control for AI agents — x402 access tokens, MCP/A2A bridges, and credit plans for OpenClaw.
metadata:
  clawdis:
    author: Nevermined AG
    homepage: https://nevermined.io
    primaryEnv: NVM_API_KEY
    links:
      homepage: https://nevermined.io
      repository: https://github.com/nevermined-io/payments
      documentation: https://docs.nevermined.io/docs/api-reference/openclaw-plugin
      changelog: https://github.com/nevermined-io/payments/releases
    requires:
      env:
        - NVM_API_KEY
      config:
        - plugins.openclaw-plugin
    envVars:
      - name: NVM_API_KEY
        required: true
        description: "Nevermined API key. Use /nvm_login for browser-based authentication, or set this directly. Tokens are prefixed with sandbox: or live: depending on environment."
      - name: NVM_ENVIRONMENT
        required: false
        description: "Nevermined environment to connect to: sandbox (default) or live."
      - name: NVM_PLAN_ID
        required: false
        description: "Default payment plan ID for subscriber tools (checkBalance, getAccessToken, queryAgent)."
      - name: NVM_AGENT_ID
        required: false
        description: "Default agent ID. Required when querying agents in multi-agent plans."
      - name: BUILDER_ADDRESS
        required: false
        description: "0x-prefixed wallet address that receives plan revenue. Used by builder/registration tools when no priceReceivers are supplied."
    dependencies:
      - name: "@nevermined-io/payments"
        type: npm
        version: ">=1.1.0"
        repository: https://github.com/nevermined-io/payments
      - name: "@nevermined-io/openclaw-plugin"
        type: npm
        version: ">=1.1.0"
        repository: https://github.com/nevermined-io/payments
  openclaw:
    requires:
      config: ["plugins.openclaw-plugin"]
---

# Nevermined Tools

This plugin provides gateway tools for interacting with Nevermined AI agent payments. Supports both crypto (on-chain) and fiat (credit card) payment flows.

> **Official source.** This skill is published from [`nevermined-io/payments`](https://github.com/nevermined-io/payments) (subdirectory `openclaw/`) by Nevermined AG, mirrored to ClawHub at [`clawhub.ai/aaitor/nevermined-payments`](https://clawhub.ai/aaitor/nevermined-payments/openclaw) (publishing handle is a Nevermined admin until ClawHub ships org publishers). The npm package is [`@nevermined-io/openclaw-plugin`](https://www.npmjs.com/package/@nevermined-io/openclaw-plugin) (Apache-2.0).
>
> **Never log payment tokens.** x402 access tokens (the `payment-signature` header) are bearer credentials. Redact them in any debug or telemetry output.

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

The returned token is a bearer credential. Treat it like an API key — never log it, never embed it in URLs, and pass it only over HTTPS.

### `nevermined_orderPlan`
Purchase a crypto payment plan. **Two-step flow:** the first call returns a quote; pass `confirm: true` on the second call to actually order the plan.
- `planId` (optional if set in config)
- `confirm` (optional, default `false`) — set to `true` to execute the on-chain purchase. Without `confirm: true` the tool returns the plan summary (price, credits, paymentType, environment) plus the literal string `"Re-call with confirm: true to proceed."`.

### `nevermined_orderFiatPlan`
Order a fiat payment plan — returns a Stripe checkout URL. **Two-step flow:** the first call returns a quote; pass `confirm: true` on the second call to receive the checkout URL.
- `planId` (optional if set in config)
- `confirm` (optional, default `false`) — set to `true` to receive the Stripe checkout URL. Without `confirm: true` the tool returns the plan summary plus the literal string `"Re-call with confirm: true to proceed."`.

### `nevermined_listPaymentMethods`
List enrolled credit cards available for fiat payments. No parameters.

### `nevermined_queryAgent`
End-to-end agent query — acquires a token, calls the agent, returns the response. Supports crypto and fiat. **Use HTTPS URLs.** The tool warns when `agentUrl` is not `https://`.
- `agentUrl` (required) — the agent endpoint URL. Must use `https://` outside local development.
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
- `priceReceivers` (optional) — comma-separated receiver addresses. Defaults to authenticated user's wallet (or `BUILDER_ADDRESS` env var if set).
- `creditsAmount` (required) — number of credits
- `tokenAddress` (optional) — ERC20 token address (e.g. USDC). Omit for native token.
- `pricingType` (optional) — `"crypto"` (default), `"erc20"`, or `"fiat"`

### `nevermined_createPlan`
Create a standalone payment plan. Supports fiat (Stripe), ERC20 tokens (USDC), and native crypto pricing.
- `name` (required) — plan name
- `priceAmount` (required) — price in cents for fiat (e.g. "100" = $1.00), in token smallest unit for crypto (e.g. "1000000" = 1 USDC)
- `receiver` (optional) — receiver wallet address (0x...). Defaults to authenticated user's wallet (or `BUILDER_ADDRESS` env var if set).
- `creditsAmount` (required) — number of credits
- `pricingType` (optional) — `"fiat"` for Stripe/USD, `"erc20"` for ERC20 tokens like USDC, `"crypto"` for native token (default: crypto)
- `accessLimit` (optional) — `"credits"` or `"time"`
- `tokenAddress` (optional) — ERC20 token contract address. Required when pricingType is "erc20".

### `nevermined_listPlans`
List your payment plans. No parameters.
