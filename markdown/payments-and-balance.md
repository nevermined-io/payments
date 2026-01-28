---
title: "Payments & Balance"
description: "Purchase payment plans and manage credit balances for accessing AI agents"
icon: "wallet"
---

# Payments and Balance

This guide explains how subscribers purchase payment plans and check their credit balances. These operations are typically performed by users who want to access AI agents.

## Overview

The payment flow consists of:
1. **Discovering Plans**: Browse available payment plans for agents
2. **Ordering Plans**: Purchase a plan to receive credits
3. **Checking Balance**: Monitor available credits and subscription status

## Get Plan Balance

Subscribers can check their available credits for a specific plan:

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

// Initialize with subscriber's API key
const subscriberPayments = Payments.getInstance({
  nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// Get balance for a plan
const balance = await subscriberPayments.plans.getPlanBalance(planId)

console.log(`Available credits: ${balance.balance}`)
console.log(`Is owner: ${balance.isOwner}`)
console.log(`Is subscriber: ${balance.isSubscriber}`)
```

### Balance Response Structure

The balance response contains:

```typescript
interface PlanBalance {
  balance: string        // Available credits as string
  isOwner: boolean      // True if you're the plan creator
  isSubscriber: boolean // True if you have an active subscription
}
```

### Working with Balance

```typescript
// Get balance
const balance = await subscriberPayments.plans.getPlanBalance(planId)

// Convert to BigInt for calculations
const creditsAvailable = BigInt(balance.balance)

// Check if sufficient credits
const creditsNeeded = 10n
if (creditsAvailable >= creditsNeeded) {
  console.log('Sufficient credits available')
} else {
  console.log(`Need ${creditsNeeded - creditsAvailable} more credits`)
}
```

## Order a Plan

Subscribers purchase plans to receive credits:

### Crypto Payment

For plans priced in cryptocurrency:

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

const subscriberPayments = Payments.getInstance({
  nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// Order the plan
const orderResult = await subscriberPayments.plans.orderPlan(planId)

if (orderResult.success) {
  console.log('Plan ordered successfully!')
  console.log(`Transaction: ${orderResult.transaction}`)
} else {
  console.error('Failed to order plan')
}
```

### Fiat Payment (Stripe)

For plans priced in fiat currency, use Stripe checkout:

```typescript
// Get Stripe checkout session
const { clientSecret, checkoutUrl } = await subscriberPayments.plans.getStripeCheckout(
  planId,
  'https://myapp.example/success',  // Success redirect URL
  'https://myapp.example/cancel'    // Cancel redirect URL
)

// Redirect user to Stripe checkout
window.location.href = checkoutUrl
```

### Complete Purchase Flow

```typescript
async function purchaseAndVerify(planId: string) {
  const subscriberPayments = Payments.getInstance({
    nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
    environment: 'sandbox',
  })

  // Check current balance
  const beforeBalance = await subscriberPayments.plans.getPlanBalance(planId)
  console.log(`Balance before: ${beforeBalance.balance} credits`)

  // Order the plan
  const orderResult = await subscriberPayments.plans.orderPlan(planId)

  if (!orderResult.success) {
    throw new Error('Failed to order plan')
  }

  console.log('Plan ordered successfully')

  // Wait for credits to be allocated (blockchain settlement)
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Check new balance
  const afterBalance = await subscriberPayments.plans.getPlanBalance(planId)
  console.log(`Balance after: ${afterBalance.balance} credits`)
}
```

## Waiting for Balance Updates

After ordering a plan, credits are allocated on-chain, which may take a few seconds:

```typescript
async function waitForCredits(
  payments: Payments,
  planId: string,
  timeoutMs: number = 60000
): Promise<bigint> {
  const startTime = Date.now()
  const checkInterval = 2000 // Check every 2 seconds

  while (Date.now() - startTime < timeoutMs) {
    const balance = await payments.plans.getPlanBalance(planId)
    const credits = BigInt(balance.balance)

    if (credits > 0n) {
      return credits
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval))
  }

  throw new Error('Timeout waiting for credits')
}

// Usage
const credits = await waitForCredits(subscriberPayments, planId)
console.log(`Received ${credits} credits`)
```

## Check Multiple Plan Balances

If a subscriber has multiple plans:

```typescript
async function checkAllBalances(planIds: string[]) {
  const subscriberPayments = Payments.getInstance({
    nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
    environment: 'sandbox',
  })

  for (const planId of planIds) {
    const balance = await subscriberPayments.plans.getPlanBalance(planId)
    console.log(`Plan ${planId}: ${balance.balance} credits`)
  }
}

await checkAllBalances([planId1, planId2, planId3])
```

## Stripe Checkout Integration

### Complete Stripe Flow

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

// Initialize
const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// Create checkout session
async function initiateStripeCheckout(planId: string) {
  const successUrl = `${window.location.origin}/payment-success`
  const cancelUrl = `${window.location.origin}/payment-cancelled`

  const { clientSecret, checkoutUrl } = await payments.plans.getStripeCheckout(
    planId,
    successUrl,
    cancelUrl
  )

  // Save client secret for later verification (optional)
  sessionStorage.setItem('stripe_client_secret', clientSecret)

  // Redirect to Stripe
  window.location.href = checkoutUrl
}

// Handle success callback
async function handlePaymentSuccess(planId: string) {
  // Wait for credits to be allocated
  const credits = await waitForCredits(payments, planId)

  console.log(`Payment successful! Received ${credits} credits`)

  // Redirect to agent interface
  window.location.href = '/agents'
}
```

## Plan Information

Before ordering, subscribers might want to view plan details:

```typescript
// Get plan details
const plan = await subscriberPayments.plans.getPlan(planId)

console.log(`Plan: ${plan.name}`)
console.log(`Description: ${plan.description}`)
console.log(`Price: ${plan.price}`)
console.log(`Credits: ${plan.credits}`)

// Check if already subscribed
const balance = await subscriberPayments.plans.getPlanBalance(planId)

if (balance.isSubscriber && BigInt(balance.balance) > 0n) {
  console.log('Already subscribed with available credits')
} else {
  console.log('Need to order plan')
}
```

## Complete Example: Purchase Flow with UI

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

class PlanPurchaseManager {
  private payments: Payments

  constructor(apiKey: string, environment: EnvironmentName) {
    this.payments = Payments.getInstance({
      nvmApiKey: apiKey,
      environment,
    })
  }

  async checkBalance(planId: string): Promise<bigint> {
    const balance = await this.payments.plans.getPlanBalance(planId)
    return BigInt(balance.balance)
  }

  async purchasePlan(planId: string): Promise<boolean> {
    try {
      // Get plan details
      const plan = await this.payments.plans.getPlan(planId)
      console.log(`Purchasing: ${plan.name}`)

      // Check if already subscribed
      const currentBalance = await this.checkBalance(planId)
      if (currentBalance > 0n) {
        console.log(`Already have ${currentBalance} credits`)
        return true
      }

      // Order the plan
      const orderResult = await this.payments.plans.orderPlan(planId)

      if (!orderResult.success) {
        throw new Error('Order failed')
      }

      console.log(`Order successful: ${orderResult.transaction}`)

      // Wait for credits
      const credits = await this.waitForCredits(planId)
      console.log(`Received ${credits} credits`)

      return true
    } catch (error) {
      console.error('Purchase failed:', error)
      return false
    }
  }

  private async waitForCredits(
    planId: string,
    timeoutMs: number = 60000
  ): Promise<bigint> {
    const startTime = Date.now()
    const checkInterval = 2000

    while (Date.now() - startTime < timeoutMs) {
      const credits = await this.checkBalance(planId)
      if (credits > 0n) return credits
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    throw new Error('Timeout waiting for credits')
  }
}

// Usage
const manager = new PlanPurchaseManager(
  process.env.SUBSCRIBER_API_KEY!,
  'sandbox'
)

const success = await manager.purchasePlan(planId)
if (success) {
  const balance = await manager.checkBalance(planId)
  console.log(`Ready to use agent with ${balance} credits`)
}
```

## Best Practices

1. **Check Balance First**: Always check existing balance before ordering
2. **Wait for Settlement**: Allow time for on-chain credit allocation after purchase
3. **Handle Errors**: Wrap order operations in try-catch blocks
4. **User Feedback**: Provide clear feedback during the purchase process
5. **Balance Monitoring**: Check balance before each agent request
6. **Stripe Redirects**: Use absolute URLs for Stripe success/cancel URLs

## Related Documentation

- [Payment Plans](./payment-plans) - Understanding plan types and pricing
- [Querying an Agent](./querying-an-agent) - Using credits to access agents

---

**Source References**:
- `src/api/plans-api.ts` (orderPlan, getPlanBalance, getStripeCheckout methods)
- `tests/e2e/test_payments_e2e.test.ts` (ordering and balance verification)
