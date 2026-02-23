---
title: "Making Purchases"
description: "Complete guide to ordering payment plans and managing credits with the Nevermined CLI"
icon: "cart-shopping"
---

# Making Purchases

Complete guide to ordering payment plans and managing credits with the Nevermined CLI.

## Overview

Purchasing a payment plan gives you access to AI agents and services. Once you order a plan, you receive credits or time-based access that you can use to query agents.

## Ordering a Plan

### Crypto Payment

Purchase a payment plan with cryptocurrency:

```bash
nvm plans order-plan <plan-id>
```

Example:

```bash
nvm plans order-plan "did:nvm:abc123"
```

Output:

```
Plan Order Success
Plan ID: did:nvm:abc123
Credits Purchased: 100
Transaction Hash: 0x1234567890abcdef...
Status: Confirmed
```

### Fiat Payment

Initiate a plan purchase with fiat. This returns a URL where you can complete the payment:

```bash
nvm plans order-fiat-plan <plan-id>
```

Example:

```bash
nvm plans order-fiat-plan "did:nvm:abc123"
```

## Checking Your Credits

### View Plan Balance

Check how many credits you have remaining:

```bash
# Your balance
nvm plans get-plan-balance <plan-id>

# Balance for specific address
nvm plans get-plan-balance <plan-id> --account-address "0x123..."
```

Example output:

```
Plan Balance
Plan ID: did:nvm:abc123
Credits Remaining: 75
```

### Monitor Multiple Plans

Check balances for all your plans:

```bash
#!/bin/bash
PLANS=("did:nvm:plan1" "did:nvm:plan2" "did:nvm:plan3")

for PLAN in "${PLANS[@]}"; do
  echo "Checking balance for $PLAN..."
  nvm plans get-plan-balance $PLAN
  echo ""
done
```

## Refilling Credits

### Purchase Additional Credits

Re-order a plan to add more credits to your existing balance:

```bash
nvm plans order-plan <plan-id>
```

### Bulk Credit Purchase

Order multiple plans at once:

```bash
#!/bin/bash
PLANS=("did:nvm:plan1" "did:nvm:plan2")

for PLAN in "${PLANS[@]}"; do
  echo "Ordering $PLAN..."
  nvm plans order-plan $PLAN
done
```

## Credit Usage

### Set Up Balance Monitoring

Create a script to alert when credits run low:

```bash
#!/bin/bash
PLAN_ID="did:nvm:abc123"
MIN_CREDITS=10

BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

if [ "$BALANCE" -lt "$MIN_CREDITS" ]; then
  echo "LOW CREDITS ALERT"
  echo "Plan: $PLAN_ID"
  echo "Remaining: $BALANCE credits"
fi
```

### Auto-Refill Script

Automatically refill credits when low:

```bash
#!/bin/bash
# Run as cron job: 0 */6 * * * /path/to/auto-refill.sh

PLAN_ID="did:nvm:abc123"
MIN_CREDITS=20

BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

if [ "$BALANCE" -lt "$MIN_CREDITS" ]; then
  echo "$(date): Credits low ($BALANCE), ordering more..."
  nvm plans order-plan $PLAN_ID

  if [ $? -eq 0 ]; then
    NEW_BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')
    echo "$(date): New balance: $NEW_BALANCE credits"
  else
    echo "$(date): ERROR - Failed to order credits"
  fi
else
  echo "$(date): Balance healthy: $BALANCE credits"
fi
```

## Examples

### Example 1: Complete Purchase Flow

```bash
#!/bin/bash

# 1. Browse available plans
echo "Available Plans:"
nvm plans get-plans

# 2. Get details about a specific plan
PLAN_ID="did:nvm:abc123"
nvm plans get-plan $PLAN_ID

# 3. Check current balance
echo "Current balance:"
nvm plans get-plan-balance $PLAN_ID

# 4. Purchase the plan
echo "Purchasing plan..."
nvm plans order-plan $PLAN_ID

# 5. Verify purchase
echo "New balance:"
nvm plans get-plan-balance $PLAN_ID

# 6. Get access token for using the service
echo "Getting access token..."
nvm x402token get-x402-access-token $PLAN_ID
```

### Example 2: Team Credit Management

```bash
#!/bin/bash
TEAM_PLANS=("did:nvm:plan1" "did:nvm:plan2" "did:nvm:plan3")

# Purchase for entire team
for PLAN in "${TEAM_PLANS[@]}"; do
  echo "Ordering $PLAN for team..."
  nvm plans order-plan $PLAN
done

# Generate team usage report
echo "Team Balances:"
for PLAN in "${TEAM_PLANS[@]}"; do
  nvm plans get-plan-balance $PLAN --format json | jq '{plan: .planId, remaining: .balance}'
done
```

## Best Practices

### 1. Monitor Credit Levels

Set up monitoring to avoid service interruptions:

```bash
# Daily cron job
0 9 * * * /path/to/check-credits.sh
```

### 2. Plan Ahead

Purchase credits before you need them to avoid delays.

### 3. Use Automation

Implement auto-refill to ensure continuous service:

```bash
# Check every 6 hours
0 */6 * * * /path/to/auto-refill.sh
```

### 4. Use JSON Output for Scripting

Always use `--format json` in scripts:

```bash
BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')
```

## Common Issues

### "Insufficient funds"

Ensure your wallet has enough balance for crypto payments.

### "Plan not available"

The plan may be sold out or no longer active:

```bash
# Verify plan status
nvm plans get-plan <plan-id>

# Look for alternative plans
nvm plans get-plans
```

## Next Steps

- [Querying](./querying.md) - Use your credits to query agents
- [Plans](./plans.md) - Learn about different plan types
- [Agents](./agents.md) - Discover available agents
