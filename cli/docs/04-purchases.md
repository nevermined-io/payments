# Making Purchases

Complete guide to ordering payment plans and managing subscriptions with the Nevermined CLI.

## Overview

Purchasing a payment plan gives you access to AI agents and services. Once you order a plan, you receive credits or time-based access that you can use to query agents.

## Ordering a Plan

### Basic Plan Order

Purchase a payment plan:

```bash
nvm plans order-plan <plan-id>
```

Example:

```bash
nvm plans order-plan did:nvm:abc123
```

Output:

```
Plan Order Success
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Plan ID: did:nvm:abc123
Credits Purchased: 100
Transaction Hash: 0x1234567890abcdef...
Status: Confirmed

✨ Next steps:
   1. Get your X402 access token: nvm x402token get-x402-access-token did:nvm:abc123
   2. Use the token to query the agent
   3. Check your balance: nvm plans get-plan-balance did:nvm:abc123
```

### Order with Specific Payment Method

Specify payment method or options:

```bash
nvm plans order-plan <plan-id> \
  --payment-method "credit-card" \
  --payment-data payment.json
```

**payment.json**:

```json
{
  "tokenAddress": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "amount": 1000000,
  "billingAddress": {
    "country": "US",
    "zip": "12345"
  }
}
```

## Checking Your Credits

### View Plan Balance

Check how many credits you have remaining:

```bash
# Your balance
nvm plans get-plan-balance <plan-id>

# Balance for specific address
nvm plans get-plan-balance <plan-id> --account-address 0x123...
```

Example output:

```
Plan Balance
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Plan ID: did:nvm:abc123
Plan Name: Basic Plan
Credits Remaining: 75
Credits Used: 25
Total Credits: 100
Last Updated: 2024-03-15 10:30:00 UTC
```

### Monitor Multiple Plans

Check balances for all your plans:

```bash
#!/bin/bash
# Check all plan balances

# Get all plans you've ordered (from transaction history or saved list)
PLANS=("did:nvm:plan1" "did:nvm:plan2" "did:nvm:plan3")

for PLAN in "${PLANS[@]}"; do
  echo "Checking balance for $PLAN..."
  nvm plans get-plan-balance $PLAN
  echo ""
done
```

## Managing Subscriptions

### View Active Subscriptions

List all your active subscriptions:

```bash
nvm plans list --filter active
```

### Subscription Details

Get detailed information about a specific subscription:

```bash
nvm plans get-plan <plan-id>
```

Output includes:
- Subscription status (active, expired, cancelled)
- Expiration date (for time-based plans)
- Remaining credits (for credits-based plans)
- Auto-renewal settings
- Payment history

## Refilling Credits

### Purchase Additional Credits

Add more credits to an existing plan:

```bash
nvm plans order-plan <plan-id>
```

This adds credits to your existing balance rather than creating a new subscription.

### Bulk Credit Purchase

Order multiple plans at once:

```bash
#!/bin/bash
# Purchase credits for multiple plans

PLANS=("did:nvm:plan1" "did:nvm:plan2")

for PLAN in "${PLANS[@]}"; do
  echo "Ordering $PLAN..."
  nvm plans order-plan $PLAN
done
```

## Transaction History

### View Purchase History

See your past purchases:

```bash
nvm plans list-purchases
```

Example output:

```
Purchase History
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Date                Plan ID              Credits    Amount    Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2024-03-15 10:30    did:nvm:abc123      100        $10.00    Confirmed
2024-03-10 14:20    did:nvm:xyz789      500        $50.00    Confirmed
2024-03-05 09:15    did:nvm:def456      1000       $90.00    Confirmed
```

### Export Transaction Data

Export purchase history as JSON:

```bash
nvm plans list-purchases --format json > purchases.json
```

Use with analytics tools:

```bash
# Get total spending
TOTAL=$(nvm plans list-purchases --format json | jq '[.[] | .amount] | add')
echo "Total spent: \$$TOTAL"

# Count purchases by plan
nvm plans list-purchases --format json | jq 'group_by(.planId) | map({plan: .[0].planId, count: length})'
```

## Credit Usage Analytics

### Track Credit Consumption

Monitor how your credits are being used:

```bash
nvm plans get-credit-usage <plan-id>
```

Example output:

```
Credit Usage Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Plan: Basic Plan (did:nvm:abc123)
Period: Last 30 days

Total Credits Used: 250
Average per Day: 8.3
Peak Day: 35 (March 10)

Usage by Service:
  - Agent Queries: 200 credits (80%)
  - File Downloads: 30 credits (12%)
  - API Calls: 20 credits (8%)
```

### Set Usage Alerts

Create a script to alert when credits run low:

```bash
#!/bin/bash
# Credit monitoring script

PLAN_ID="did:nvm:abc123"
MIN_CREDITS=10
EMAIL="your@email.com"

BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

if [ "$BALANCE" -lt "$MIN_CREDITS" ]; then
  echo "⚠️  LOW CREDITS ALERT"
  echo "Plan: $PLAN_ID"
  echo "Remaining: $BALANCE credits"
  echo "Threshold: $MIN_CREDITS credits"

  # Send email or notification
  # mail -s "Low Credits Alert" $EMAIL <<< "Only $BALANCE credits remaining"

  # Optionally auto-refill
  # nvm plans order-plan $PLAN_ID
fi
```

## Automated Purchases

### Auto-Refill Script

Automatically refill credits when low:

```bash
#!/bin/bash
# Auto-refill credits script
# Run as cron job: 0 */6 * * * /path/to/auto-refill.sh

PLAN_ID="did:nvm:abc123"
MIN_CREDITS=20
REFILL_AMOUNT=100

BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

if [ "$BALANCE" -lt "$MIN_CREDITS" ]; then
  echo "$(date): Credits low ($BALANCE), initiating refill..."

  # Order more credits
  RESULT=$(nvm plans order-plan $PLAN_ID --format json)

  if [ $? -eq 0 ]; then
    echo "$(date): Successfully ordered $REFILL_AMOUNT credits"
    NEW_BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')
    echo "$(date): New balance: $NEW_BALANCE credits"
  else
    echo "$(date): ERROR - Failed to order credits"
    echo "$RESULT"
  fi
else
  echo "$(date): Balance healthy: $BALANCE credits"
fi
```

### Subscription Renewal

For time-based plans, set up auto-renewal:

```bash
#!/bin/bash
# Check and renew expiring subscriptions

PLANS=("did:nvm:plan1" "did:nvm:plan2")
DAYS_BEFORE_EXPIRY=7

for PLAN in "${PLANS[@]}"; do
  DETAILS=$(nvm plans get-plan $PLAN --format json)
  EXPIRY=$(echo $DETAILS | jq -r '.expiryDate')

  # Calculate days until expiry
  DAYS_LEFT=$(( ($(date -d "$EXPIRY" +%s) - $(date +%s)) / 86400 ))

  if [ "$DAYS_LEFT" -le "$DAYS_BEFORE_EXPIRY" ]; then
    echo "Plan $PLAN expires in $DAYS_LEFT days. Renewing..."
    nvm plans order-plan $PLAN
  else
    echo "Plan $PLAN: $DAYS_LEFT days remaining"
  fi
done
```

## Payment Methods

### Crypto Payments

Pay with cryptocurrency (default):

```bash
nvm plans order-plan <plan-id>
```

Supported tokens:
- USDC
- ETH
- Custom ERC-20 tokens

### Credit Card Payments

Pay with credit card through payment gateway:

```bash
nvm plans order-plan <plan-id> \
  --payment-method "card" \
  --card-data card.json
```

**card.json** (processed securely):

```json
{
  "gateway": "stripe",
  "successUrl": "https://yourapp.com/success",
  "cancelUrl": "https://yourapp.com/cancel"
}
```

## Budgeting and Cost Control

### Set Monthly Budget

Track spending against budget:

```bash
#!/bin/bash
# Monthly budget tracker

MONTHLY_BUDGET=100
CURRENT_MONTH=$(date +%Y-%m)

# Get all purchases for current month
PURCHASES=$(nvm plans list-purchases --format json | jq --arg month "$CURRENT_MONTH" '[.[] | select(.date | startswith($month))]')

TOTAL_SPENT=$(echo $PURCHASES | jq '[.[] | .amount] | add')

echo "Monthly Budget: \$$MONTHLY_BUDGET"
echo "Spent This Month: \$$TOTAL_SPENT"

REMAINING=$(echo "$MONTHLY_BUDGET - $TOTAL_SPENT" | bc)
echo "Remaining: \$$REMAINING"

if (( $(echo "$TOTAL_SPENT > $MONTHLY_BUDGET" | bc -l) )); then
  echo "⚠️  Budget exceeded!"
fi
```

### Cost Optimization

Analyze which plans provide best value:

```bash
#!/bin/bash
# Calculate cost per credit for each plan

PLANS=$(nvm plans list --format json)

echo "Plan Cost Analysis"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo $PLANS | jq -r '.[] |
  "\(.name): $\(.price / .credits | . * 100 | round / 100) per credit
  (Total: $\(.price) for \(.credits) credits)"'
```

## Examples

### Example 1: Complete Purchase Flow

```bash
#!/bin/bash
# Complete purchase workflow

# 1. Browse available plans
echo "Available Plans:"
nvm plans list

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

### Example 2: Multi-Tier Purchase

```bash
#!/bin/bash
# Purchase different tiers based on usage needs

# Light user: Basic plan
nvm plans order-plan did:nvm:basic-plan

# Power user: Pro plan
nvm plans order-plan did:nvm:pro-plan

# Enterprise: Custom plan
nvm plans order-plan did:nvm:enterprise-plan

# Check all balances
echo "Current Balances:"
nvm plans get-plan-balance did:nvm:basic-plan
nvm plans get-plan-balance did:nvm:pro-plan
nvm plans get-plan-balance did:nvm:enterprise-plan
```

### Example 3: Team Purchase Management

```bash
#!/bin/bash
# Manage purchases for a team

TEAM_PLANS=(
  "did:nvm:dev-plan"
  "did:nvm:qa-plan"
  "did:nvm:prod-plan"
)

# Purchase for entire team
for PLAN in "${TEAM_PLANS[@]}"; do
  echo "Ordering $PLAN for team..."
  nvm plans order-plan $PLAN
done

# Generate team usage report
echo "Team Usage Report"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for PLAN in "${TEAM_PLANS[@]}"; do
  BALANCE=$(nvm plans get-plan-balance $PLAN --format json)
  echo $BALANCE | jq '{plan: .planId, remaining: .balance, used: .used}'
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

### 4. Track Spending

Regularly review purchase history:

```bash
# Weekly spending report
nvm plans list-purchases --format json | \
  jq 'group_by(.date | split("T")[0]) |
      map({date: .[0].date, total: map(.amount) | add})'
```

### 5. Optimize Costs

Choose plans that match your usage patterns:

```bash
# Compare cost efficiency
nvm plans list --format json | \
  jq 'map({name, costPerCredit: (.price / .credits)}) |
      sort_by(.costPerCredit)'
```

## Common Issues

### "Insufficient funds"

Ensure your wallet has enough balance:

```bash
# Check wallet balance
nvm wallet get-balance

# Fund your wallet first
```

### "Plan not available"

The plan may be sold out or no longer active:

```bash
# Verify plan status
nvm plans get-plan <plan-id>

# Look for alternative plans
nvm plans list
```

### "Transaction failed"

Network issues or gas price problems:

```bash
# Retry the purchase
nvm plans order-plan <plan-id>

# Check transaction status
nvm plans get-transaction-status <tx-hash>
```

## Next Steps

- [Querying](./05-querying.md) - Use your credits to query agents
- [Plans](./02-plans.md) - Learn about different plan types
- [Agents](./03-agents.md) - Discover available agents
