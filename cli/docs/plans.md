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
nvm plans get-plans

# JSON output for scripting
nvm plans get-plans --format json

# With pagination and sorting
nvm plans get-plans --page 1 --offset 10 --sort-by name --sort-order asc
```

## Getting Plan Details

Retrieve detailed information about a specific plan:

```bash
nvm plans get-plan <plan-id>
```

Example:

```bash
nvm plans get-plan "did:nvm:abc123"
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
nvm plans get-plan-balance <plan-id>

# Check balance for specific address
nvm plans get-plan-balance <plan-id> --account-address "0x1234..."
```

## Getting Agents for a Plan

List all agents accessible through a specific plan:

```bash
nvm plans get-agents-associated-to-a-plan <plan-id>

# With pagination
nvm plans get-agents-associated-to-a-plan <plan-id> --pagination '{"page": 1, "offset": 10}'
```

## Creating Plans

### Flexible Plan Registration

Register a plan with full control over price and credits/duration configuration:

```bash
nvm plans register-plan \
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
nvm plans register-credits-plan \
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

**price-config.json**:

```json
{
  "tokenAddress": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "price": 1000000,
  "amountOfCredits": 100
}
```

**credits-config.json**:

```json
{
  "subscriptionType": "credits",
  "accessType": "credits",
  "minCreditsToCharge": 1,
  "maxCreditsToCharge": 10
}
```

### Time-Based Plan

Create a subscription plan with time-limited access:

```bash
nvm plans register-time-plan \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

**credits-config.json** (for time plan):

```json
{
  "subscriptionType": "time",
  "accessType": "time",
  "duration": 2592000
}
```

Duration is in seconds (2592000 = 30 days).

### Trial Plans

Trial plans can only be purchased once per user and are useful for letting users test your agents.

**Credits trial** (limited by credits):

```bash
nvm plans register-credits-trial-plan \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

**Time trial** (limited by duration):

```bash
nvm plans register-time-trial-plan \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

## Ordering Plans

### Crypto Payment

Purchase a plan with cryptocurrency:

```bash
nvm plans order-plan <plan-id>
```

### Fiat Payment

Initiate a plan purchase with fiat payment. Returns a URL where the user can complete the payment:

```bash
nvm plans order-fiat-plan <plan-id>
```

## Minting Credits

### Mint Credits

Add credits to a plan and transfer them to a receiver (plan owner only):

```bash
nvm plans mint-plan-credits <plan-id> \
  --credits-amount 1000 \
  --credits-receiver "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
```

### Mint Expirable Credits

Add time-limited credits:

```bash
nvm plans mint-plan-expirable <plan-id> \
  --credits-amount 1000 \
  --credits-receiver "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb" \
  --credits-duration 2592000
```

The `--credits-duration` flag is optional and specifies duration in seconds.

## Redeeming Credits

Burn/redeem credits for a given payment plan:

```bash
nvm plans redeem-credits <agent-request-id> \
  --plan-id <plan-id> \
  --credits-amount-to-redeem 5 \
  --redeem-from "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
```

## Price Configuration Helpers

The CLI provides helper commands to build price configuration objects:

```bash
# Free (no payment required)
nvm plans get-free-price-config

# Fiat price
nvm plans get-fiat-price-config --amount 1000 --receiver "0x123..."

# Crypto price
nvm plans get-crypto-price-config --amount 1000 --receiver "0x123..."

# Crypto with specific token
nvm plans get-crypto-price-config --amount 1000 --receiver "0x123..." --token-address "0xToken..."

# Native token price
nvm plans get-native-token-price-config --amount 1000 --receiver "0x123..."

# ERC20 token price
nvm plans get-erc20-price-config --amount 1000 --receiver "0x123..." --token-address "0xToken..."

# Pay-as-you-go price
nvm plans get-pay-as-you-go-price-config --amount 1000 --receiver "0x123..."
```

## Credits Configuration Helpers

Helper commands to build credits configuration objects:

```bash
# Fixed credits (same amount per request)
nvm plans get-fixed-credits-config --credits-granted 100 --credits-per-request 1

# Dynamic credits (range per request)
nvm plans get-dynamic-credits-config --credits-granted 100 \
  --min-credits-per-request 1 --max-credits-per-request 10

# Pay-as-you-go credits
nvm plans get-pay-as-you-go-credits-config

# Expirable duration
nvm plans get-expirable-duration-config --duration-of-plan 2592000

# Non-expirable
nvm plans get-non-expirable-duration-config
```

## Advanced Operations

### Set Proof Required

Mark whether proof is required in a credits configuration:

```bash
nvm plans set-proof-required \
  --credits-config credits-config.json \
  --proof-required
```

### Set Redemption Type

Set the redemption type in a credits configuration:

```bash
nvm plans set-redemption-type \
  --credits-config credits-config.json \
  --redemption-type "fixed"
```

## JSON Output for Scripting

Use `--format json` for machine-readable output:

```bash
# Get plan details as JSON
PLAN_DATA=$(nvm plans get-plan "did:nvm:abc123" --format json)

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

# 2. Create price configuration
cat > price.json << EOF
{
  "tokenAddress": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "price": 10000000,
  "amountOfCredits": 100
}
EOF

# 3. Create credits configuration
cat > credits.json << EOF
{
  "subscriptionType": "credits",
  "accessType": "credits",
  "minCreditsToCharge": 1,
  "maxCreditsToCharge": 5
}
EOF

# 4. Register the plan
nvm plans register-credits-plan \
  --plan-metadata plan.json \
  --price-config price.json \
  --credits-config credits.json
```

### Example 2: Monitor Plan Balance

```bash
#!/bin/bash
PLAN_ID="did:nvm:abc123"
MIN_CREDITS=10

BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

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

Configure min/max credits to prevent abuse:

```json
{
  "minCreditsToCharge": 1,
  "maxCreditsToCharge": 10
}
```

### 3. Test in Sandbox First

Always test new plans in sandbox before going live:

```bash
# Test in sandbox
nvm --profile sandbox plans register-credits-plan \
  --plan-metadata metadata.json \
  --price-config price.json \
  --credits-config credits.json

# Verify it works
nvm --profile sandbox plans get-plan <plan-id>
```

## Common Issues

### "Insufficient balance"

When registering plans, ensure you have enough credits or tokens in your account.

### "Plan not found"

Ensure you're using the correct environment and plan ID:

```bash
# Check which environment you're using
nvm config show

# Try the correct profile
nvm --profile sandbox plans get-plan <plan-id>
```

## Next Steps

- [Agents](./agents.md) - Register agents with your plans
- [Purchases](./purchases.md) - Order plans and make payments
- [Querying](./querying.md) - Query agents with access tokens
