# Managing Payment Plans

Complete guide to creating and managing payment plans with the Nevermined CLI.

## Overview

Payment plans define how users can access your AI agents and services. Plans can be:
- **Credits-based**: Pay per API call or credit consumed
- **Time-based**: Subscription access for a duration
- **Service-based**: Access to specific services

## Listing Plans

View all available payment plans:

```bash
# Table output (default)
nvm plans list

# JSON output for scripting
nvm plans list --format json

# Quiet output (IDs only)
nvm plans list --format quiet
```

Example output:

```
Payment Plans
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Plan ID                  Name              Type      Price
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
did:nvm:abc123          Basic Plan        Credits   $10.00
did:nvm:xyz789          Pro Plan          Credits   $50.00
did:nvm:def456          Enterprise        Time      $100.00
```

## Getting Plan Details

Retrieve detailed information about a specific plan:

```bash
nvm plans get-plan <plan-id>
```

Example:

```bash
nvm plans get-plan did:nvm:abc123
```

Output includes:
- Plan metadata (name, description, creator)
- Pricing configuration
- Credits configuration
- Service details
- Payment token information

## Checking Plan Balance

Check your credit balance for a plan:

```bash
# Your balance
nvm plans get-plan-balance <plan-id>

# Check balance for specific address
nvm plans get-plan-balance <plan-id> --account-address 0x1234...
```

Example:

```bash
nvm plans get-plan-balance did:nvm:abc123
```

Output:

```
Plan Balance
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Credits Remaining: 1000
Plan ID: did:nvm:abc123
Account: 0xYourAddress...
```

## Creating Plans

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
  "creditType": "api_calls",
  "minCreditsRequired": 1,
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
  --time-config time-config.json
```

**time-config.json**:

```json
{
  "subscriptionType": "time",
  "accessType": "time",
  "duration": 2592000
}
```

Duration is in seconds (2592000 = 30 days).

### Service Plan

Create a plan for accessing specific AI services:

```bash
nvm plans register-service-plan \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --service-config service-config.json
```

**service-config.json**:

```json
{
  "subscriptionType": "service",
  "accessType": "service",
  "serviceHost": "https://api.example.com",
  "nftTransfer": false,
  "nftHolder": false
}
```

## Updating Plans

### Update Plan Metadata

Modify plan name, description, or tags:

```bash
nvm plans update-plan-metadata <plan-id> \
  --plan-metadata updated-metadata.json
```

**updated-metadata.json**:

```json
{
  "name": "My AI Agent - Premium Plan",
  "description": "Upgraded with more features",
  "tags": ["ai", "assistant", "premium"]
}
```

### Update Plan Price

Change plan pricing:

```bash
nvm plans update-plan-price <plan-id> \
  --price-config new-price.json
```

**new-price.json**:

```json
{
  "tokenAddress": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "price": 2000000,
  "amountOfCredits": 200
}
```

## Plan Files and Transfers

### Download Plan Files

Download files associated with a plan (if it includes static resources):

```bash
nvm plans download-plan-files <plan-id> --destination ./downloads
```

### Transfer Plan Ownership

Transfer plan ownership to another address:

```bash
nvm plans transfer-plan-ownership <plan-id> \
  --new-owner 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
```

## Advanced Plan Operations

### Get Plan Dependencies

List other plans or services this plan depends on:

```bash
nvm plans get-plan-dependencies <plan-id>
```

### Register File Plan

Create a plan with downloadable files:

```bash
nvm plans register-file-plan \
  --plan-metadata metadata.json \
  --price-config price.json \
  --file-urls "https://example.com/file1.pdf,https://example.com/file2.zip"
```

### Mint Credits

Add credits to an existing plan (plan owner only):

```bash
nvm plans mint-credits <plan-id> \
  --receiver-address 0x123... \
  --amount 1000
```

### Burn Credits

Remove credits from a plan:

```bash
nvm plans burn-credits <plan-id> \
  --amount 100
```

## JSON Output for Scripting

Use `--format json` for machine-readable output:

```bash
# Get plan details as JSON
PLAN_DATA=$(nvm plans get-plan did:nvm:abc123 --format json)

# Extract specific field with jq
PLAN_NAME=$(echo $PLAN_DATA | jq -r '.name')
PLAN_PRICE=$(echo $PLAN_DATA | jq -r '.price')

echo "Plan: $PLAN_NAME costs $PLAN_PRICE"
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
  "creditType": "api_calls",
  "minCreditsRequired": 1,
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

### Example 2: List All Plans and Get First Plan Details

```bash
# Get all plans as JSON
PLANS=$(nvm plans list --format json)

# Extract first plan ID
FIRST_PLAN=$(echo $PLANS | jq -r '.[0].id')

# Get detailed info
nvm plans get-plan $FIRST_PLAN
```

### Example 3: Monitor Plan Balance

```bash
#!/bin/bash
# Script to monitor plan balance

PLAN_ID="did:nvm:abc123"
MIN_CREDITS=10

BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

if [ "$BALANCE" -lt "$MIN_CREDITS" ]; then
  echo "⚠️  Low balance: $BALANCE credits remaining"
  echo "Consider ordering more credits"
else
  echo "✅ Balance healthy: $BALANCE credits"
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
  "minCreditsRequired": 1,
  "minCreditsToCharge": 1,
  "maxCreditsToCharge": 10
}
```

### 3. Store Configuration Files

Keep plan configurations in version control:

```
plans/
├── basic-plan/
│   ├── metadata.json
│   ├── price.json
│   └── credits.json
├── pro-plan/
│   ├── metadata.json
│   ├── price.json
│   └── credits.json
└── enterprise-plan/
    ├── metadata.json
    ├── price.json
    └── time.json
```

### 4. Test in Staging First

Always test new plans in staging_sandbox before production:

```bash
# Test in staging
nvm --profile staging plans register-credits-plan \
  --plan-metadata metadata.json \
  --price-config price.json \
  --credits-config credits.json

# Verify it works
nvm --profile staging plans get-plan <plan-id>

# Then deploy to production
nvm --profile production plans register-credits-plan \
  --plan-metadata metadata.json \
  --price-config price.json \
  --credits-config credits.json
```

## Common Issues

### "Insufficient balance"

When registering plans, ensure you have enough credits or tokens in your account.

### "Invalid token address"

Verify the payment token address matches your environment:
- Staging: Use test token addresses
- Production: Use mainnet token addresses

### "Plan not found"

Ensure you're using the correct environment and plan ID:

```bash
# Check which environment you're using
nvm config show

# Try the correct profile
nvm --profile staging plans get-plan <plan-id>
```

## Next Steps

- [Agents](./03-agents.md) - Register agents with your plans
- [Purchases](./04-purchases.md) - Order plans and make payments
- [Querying](./05-querying.md) - Query agents with access tokens
