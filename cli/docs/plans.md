---
title: "Managing Payment Plans"
description: "Complete guide to creating and managing payment plans with the Nevermined CLI"
icon: "credit-card"
---

# Managing Payment Plans

Complete guide to creating and managing payment plans with the Nevermined CLI.

## Overview

Payment plans define how users can access your AI agents and services. Plans can be:
- **Credits-based**: Pay per API call or credit consumed
- **Time-based**: Subscription access for a duration
- **Trial plans**: One-time-use plans for testing (credits or time limited)

## Listing Plans

View all available payment plans:

```bash
# Table output (default)
nevermined plans get-plans

# JSON output for scripting
nevermined plans get-plans --format json

# With pagination and sorting
nevermined plans get-plans --page 1 --offset 10 --sort-by name --sort-order asc
```

## Getting Plan Details

Retrieve detailed information about a specific plan:

```bash
nevermined plans get-plan <plan-id>
```

Example:

```bash
nevermined plans get-plan "did:nvm:abc123"
```

Output includes:
- Plan metadata (name, description, creator)
- Pricing configuration
- Credits configuration
- Payment token information

## Checking Plan Balance

Check your credit balance for a plan:

```bash
# Your balance
nevermined plans get-plan-balance <plan-id>

# Check balance for specific address
nevermined plans get-plan-balance <plan-id> --account-address "0x1234..."
```

## Getting Agents for a Plan

List all agents accessible through a specific plan:

```bash
nevermined plans get-agents-associated-to-a-plan <plan-id>

# With pagination
nevermined plans get-agents-associated-to-a-plan <plan-id> --pagination '{"page": 1, "offset": 10}'
```

## Creating Plans

### Flexible Plan Registration

Register a plan with full control over price and credits/duration configuration:

```bash
nevermined plans register-plan \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

Optional flags:
- `--nonce` — Custom nonce value
- `--access-limit` — Maximum number of times the plan can be ordered

### Credits Plan

Create a pay-per-use plan with credits:

```bash
nevermined plans register-credits-plan \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

**plan-metadata.json**:

```json
{
  "name": "My AI Agent - Basic Plan",
  "description": "100 credits for API access",
  "tags": ["ai", "assistant", "basic"],
  "customData": {
    "category": "AI Assistant"
  }
}
```

**price-config.json** (`PlanPriceConfig`) — charge a fixed crypto price; `amounts` is in the token's smallest unit (e.g. `1000000` = 1 USDC at 6 decimals) and `receivers` collects it (this is what `nevermined plans get-erc20-price-config` / `get-native-token-price-config` emit):

```json
{
  "isCrypto": true,
  "amounts": [1000000],
  "receivers": ["0xYourReceiverWallet"],
  "tokenAddress": "0x0000000000000000000000000000000000000000",
  "contractAddress": "0x0000000000000000000000000000000000000000",
  "feeController": "0x0000000000000000000000000000000000000000",
  "externalPriceAddress": "0x0000000000000000000000000000000000000000",
  "templateAddress": "0x0000000000000000000000000000000000000000"
}
```

**credits-config.json** (`PlanCreditsConfig`) — grant 100 credits, burn 1 per request (what `nevermined plans get-fixed-credits-config` emits):

```json
{
  "isRedemptionAmountFixed": true,
  "redemptionType": 4,
  "onchainMirror": false,
  "durationSecs": 0,
  "amount": 100,
  "minAmount": 1,
  "maxAmount": 1
}
```

### Time-Based Plan

Create a subscription plan with time-limited access:

```bash
nevermined plans register-time-plan \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

**credits-config.json** (for time plan) (`PlanCreditsConfig`) — a time-limited plan sets `durationSecs > 0` (what `nevermined plans get-expirable-duration-config` emits):

```json
{
  "isRedemptionAmountFixed": false,
  "redemptionType": 4,
  "onchainMirror": false,
  "durationSecs": 2592000,
  "amount": 1,
  "minAmount": 1,
  "maxAmount": 1
}
```

`durationSecs` is in seconds (2592000 = 30 days).

### Trial Plans

Trial plans can only be purchased once per user and are useful for letting users test your agents.

**Credits trial** (limited by credits):

```bash
nevermined plans register-credits-trial-plan \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

**Time trial** (limited by duration):

```bash
nevermined plans register-time-trial-plan \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

## Ordering Plans

### Crypto Payment

Purchase a plan with cryptocurrency:

```bash
nevermined plans order-plan <plan-id>
```

### Fiat Payment

Initiate a plan purchase with fiat payment. Returns a URL where the user can complete the payment:

```bash
nevermined plans order-fiat-plan <plan-id>
```

## Minting Credits

### Mint Credits

Add credits to a plan and transfer them to a receiver (plan owner only):

```bash
nevermined plans mint-plan-credits <plan-id> \
  --credits-amount 1000 \
  --credits-receiver "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
```

### Mint Expirable Credits

Add time-limited credits:

```bash
nevermined plans mint-plan-expirable <plan-id> \
  --credits-amount 1000 \
  --credits-receiver "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb" \
  --credits-duration 2592000
```

The `--credits-duration` flag is optional and specifies duration in seconds.

## Redeeming Credits

Credit redemption (burning credits after a paid request) is performed via the x402 facilitator, not via a dedicated `plans` command. The legacy `nevermined plans redeem-credits` command was removed because the backend exposes no direct redeem endpoint — the only burn path is `POST /api/v1/x402/settle`.

Migration (subscriber side — get an access token):

```bash
nevermined x402token get-x402-access-token <plan-id> --format json
# → { "accessToken": "eyJ4NDAyVm..." }
```

Migration (agent side — verify and settle):

```bash
# Build the params JSON once
cat > /tmp/settle-params.json <<EOF
{
  "paymentRequired": {
    "x402Version": 2,
    "resource": { "url": "https://your-agent.example.com/task" },
    "accepts": [{
      "scheme": "nvm:erc4337",
      "network": "eip155:84532",
      "planId": "<plan-id>",
      "extra": { "version": "1" }
    }],
    "extensions": {}
  },
  "x402AccessToken": "<accessToken from previous step>",
  "agentRequestId": "<id from verify-permissions response>",
  "maxAmount": "5"
}
EOF

nevermined facilitator verify-permissions --params "$(cat /tmp/settle-params.json)" --format json
nevermined facilitator settle-permissions --params "$(cat /tmp/settle-params.json)" --format json
# → { "success": true, "creditsRedeemed": "5", "remainingBalance": "...", ... }
```

`settle-permissions` is idempotent on `agentRequestId` — replaying the same id returns the same transaction id without double-burning.

## Price Configuration Helpers

The CLI provides helper commands to build price configuration objects:

```bash
# Free (no payment required)
nevermined plans get-free-price-config

# Fiat price
nevermined plans get-fiat-price-config --amount 1000 --receiver "0x123..."

# Crypto price
nevermined plans get-crypto-price-config --amount 1000 --receiver "0x123..."

# Crypto with specific token
nevermined plans get-crypto-price-config --amount 1000 --receiver "0x123..." --token-address "0xToken..."

# Native token price
nevermined plans get-native-token-price-config --amount 1000 --receiver "0x123..."

# ERC20 token price
nevermined plans get-erc20-price-config --amount 1000 --receiver "0x123..." --token-address "0xToken..."

# EURC (Euro stablecoin) price
nevermined plans get-eurc-price-config --amount 1000 --receiver "0x123..."

# Pay-as-you-go price
nevermined plans get-pay-as-you-go-price-config --amount 1000 --receiver "0x123..."
```

## Credits Configuration Helpers

Helper commands to build credits configuration objects:

```bash
# Fixed credits (same amount per request)
nevermined plans get-fixed-credits-config --credits-granted 100 --credits-per-request 1

# Dynamic credits (range per request)
nevermined plans get-dynamic-credits-config --credits-granted 100 \
  --min-credits-per-request 1 --max-credits-per-request 10

# Pay-as-you-go credits
nevermined plans get-pay-as-you-go-credits-config

# Expirable duration
nevermined plans get-expirable-duration-config --duration-of-plan 2592000

# Non-expirable
nevermined plans get-non-expirable-duration-config
```

## Advanced Operations

### Set Onchain Mirror

Mark whether burns of these credits are mirrored on-chain:

```bash
nevermined plans set-onchain-mirror \
  --credits-config credits-config.json \
  --onchain-mirror
```

### Set Redemption Type

Set the redemption type in a credits configuration:

```bash
nevermined plans set-redemption-type \
  --credits-config credits-config.json \
  --redemption-type "fixed"
```

## JSON Output for Scripting

Use `--format json` for machine-readable output:

```bash
# Get plan details as JSON
PLAN_DATA=$(nevermined plans get-plan "did:nvm:abc123" --format json)

# Extract specific field with jq
PLAN_NAME=$(echo $PLAN_DATA | jq -r '.name')

echo "Plan: $PLAN_NAME"
```

## Examples

### Example 1: Create a Basic AI Agent Plan

```bash
# 1. Create plan metadata file
cat > plan.json << EOF
{
  "name": "ChatBot Basic",
  "description": "100 API calls for $10",
  "tags": ["chatbot", "ai"]
}
EOF

# 2. Create price configuration (PlanPriceConfig)
cat > price.json << EOF
{
  "isCrypto": true,
  "amounts": [10000000],
  "receivers": ["0xYourReceiverWallet"],
  "tokenAddress": "0x0000000000000000000000000000000000000000",
  "contractAddress": "0x0000000000000000000000000000000000000000",
  "feeController": "0x0000000000000000000000000000000000000000",
  "externalPriceAddress": "0x0000000000000000000000000000000000000000",
  "templateAddress": "0x0000000000000000000000000000000000000000"
}
EOF

# 3. Create credits configuration (PlanCreditsConfig) — 100 credits, burn 1-5 per request
cat > credits.json << EOF
{
  "isRedemptionAmountFixed": false,
  "redemptionType": 4,
  "onchainMirror": false,
  "durationSecs": 0,
  "amount": 100,
  "minAmount": 1,
  "maxAmount": 5
}
EOF

# 4. Register the plan
nevermined plans register-credits-plan \
  --plan-metadata plan.json \
  --price-config price.json \
  --credits-config credits.json
```

### Example 2: Monitor Plan Balance

```bash
#!/bin/bash
PLAN_ID="did:nvm:abc123"
MIN_CREDITS=10

BALANCE=$(nevermined plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

if [ "$BALANCE" -lt "$MIN_CREDITS" ]; then
  echo "Low balance: $BALANCE credits remaining"
else
  echo "Balance healthy: $BALANCE credits"
fi
```

## Best Practices

### 1. Use Descriptive Metadata

Make your plans discoverable with clear names and descriptions:

```json
{
  "name": "GPT-4 API Access - Starter",
  "description": "1000 GPT-4 API calls per month with 24/7 support",
  "tags": ["gpt4", "ai", "api", "starter"]
}
```

### 2. Set Appropriate Credit Limits

Configure the min/max credits burned per request to prevent abuse (fields of `PlanCreditsConfig`):

```json
{
  "minAmount": 1,
  "maxAmount": 10
}
```

### 3. Test in Sandbox First

Always test new plans in sandbox before going live:

```bash
# Test in sandbox
nevermined --profile sandbox plans register-credits-plan \
  --plan-metadata metadata.json \
  --price-config price.json \
  --credits-config credits.json

# Verify it works
nevermined --profile sandbox plans get-plan <plan-id>
```

## Common Issues

### "Insufficient balance"

When registering plans, ensure you have enough credits or tokens in your account.

### "Plan not found"

Ensure you're using the correct environment and plan ID:

```bash
# Check which environment you're using
nevermined config show

# Try the correct profile
nevermined --profile sandbox plans get-plan <plan-id>
```

## Next Steps

- [Agents](./agents.md) - Register agents with your plans
- [Purchases](./purchases.md) - Order plans and make payments
- [Querying](./querying.md) - Query agents with access tokens
