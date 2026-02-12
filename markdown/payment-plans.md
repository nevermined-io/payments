---
title: "Payment Plans"
description: "Create and manage flexible payment plans with credits, time-based access, and multiple pricing options"
icon: "credit-card"
---

# Payment Plans

Payment plans define how subscribers access your AI agents. The Nevermined Payments Library provides a flexible Plans API for registering different types of plans with various pricing and credit configurations.

## Overview of Payment Plans API

The Plans API (`payments.plans`) allows AI builders to:
- Define pricing structures (fiat, crypto, ERC20 tokens, or free)
- Configure credit allocation (fixed, dynamic, time-based)
- Register plans with the Nevermined protocol
- Retrieve and manage existing plans
- Associate plans with agents

## Types of Payment Plans

### Credits Plans
Grant subscribers a specific number of credits to use across multiple requests. Each agent request burns a defined number of credits.

**Use cases**: API calls, LLM queries, data processing tasks

### Time Plans
Provide unlimited access for a fixed duration. No per-request credit deduction during the validity period.

**Use cases**: Subscriptions, unlimited access periods, trial memberships

### Trial Plans
Free plans with time limitations, perfect for demos and user onboarding.

**Use cases**: Free trials, demonstrations, testing

### Pay-As-You-Go Plans
Dynamic pricing where subscribers pay per request without pre-purchasing credits.

**Use cases**: Variable usage patterns, enterprise integrations

## Price Configuration

The library provides helper functions for different payment methods:

### Crypto Payment (Native Token)

```typescript
import { Payments } from '@nevermined-io/payments'
import { ZeroAddress } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox',
})

const builderAddress = payments.getAccountAddress()

// Native token pricing (ETH, MATIC, etc.)
const priceConfig = payments.plans.getCryptoPriceConfig(
  100n,           // Amount in wei
  builderAddress, // Receiver address
  ZeroAddress     // Native token
)
```

### ERC20 Token Payment

```typescript
// ERC20 token pricing (USDC, DAI, etc.)
const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // USDC on Base

const priceConfig = payments.plans.getERC20PriceConfig(
  20n,            // Amount in token's smallest unit
  ERC20_ADDRESS,  // Token contract address
  builderAddress  // Receiver address
)
```

### Fiat Payment (Stripe)

```typescript
// Fiat pricing (USD via Stripe)
const priceConfig = payments.plans.getFiatPriceConfig(
  1000n,          // Amount in cents ($10.00)
  builderAddress
)
```

### Free Plans

```typescript
// Free plan (no payment required)
const priceConfig = payments.plans.getFreePriceConfig()
```

### Pay-As-You-Go Pricing

```typescript
// Get template address for PAYG plans
const templateAddress = await payments.contracts.getPayAsYouGoTemplateAddress()

const priceConfig = payments.plans.getPayAsYouGoPriceConfig(
  100n,              // Cost per request
  builderAddress,
  ZeroAddress,       // Token address (optional)
  templateAddress
)
```

## Credits Configuration

### Fixed Credits

Grants a specific number of credits with a fixed burn rate per request.

```typescript
import { ONE_DAY_DURATION } from '@nevermined-io/payments'

// Grant 100 credits, burn 1 credit per request
const creditsConfig = payments.plans.getFixedCreditsConfig(
  100n,  // Total credits granted
  1n     // Credits per request
)
```

### Dynamic Credits

Allows variable credit consumption per request within a range.

```typescript
// Grant 10 credits, burn 1-2 credits per request (agent decides)
const creditsConfig = payments.plans.getDynamicCreditsConfig(
  10n,  // Total credits granted
  1n,   // Minimum credits per request
  2n    // Maximum credits per request
)
```

### Time-Based Credits (Expirable)

Provides unlimited access for a fixed duration.

```typescript
import { ONE_DAY_DURATION, ONE_WEEK_DURATION, ONE_MONTH_DURATION } from '@nevermined-io/payments'

// Unlimited access for 24 hours
const creditsConfig = payments.plans.getExpirableDurationConfig(
  ONE_DAY_DURATION  // Duration in seconds
)

// Other durations
const weeklyConfig = payments.plans.getExpirableDurationConfig(ONE_WEEK_DURATION)
const monthlyConfig = payments.plans.getExpirableDurationConfig(ONE_MONTH_DURATION)
```

### Non-Expirable Duration

```typescript
// Unlimited access with no expiration
const creditsConfig = payments.plans.getNonExpirableDurationConfig()
```

## Registering Plans

### Register a Credits Plan

```typescript
import { Payments } from '@nevermined-io/payments'
import { PlanMetadata } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox',
})

const builderAddress = payments.getAccountAddress()
const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

// Define plan metadata
const planMetadata: PlanMetadata = {
  name: 'Basic AI Agent Access',
  description: 'Get 100 credits to query our AI agent',
}

// Configure pricing and credits
const priceConfig = payments.plans.getERC20PriceConfig(
  20n,
  ERC20_ADDRESS,
  builderAddress
)

const creditsConfig = payments.plans.getFixedCreditsConfig(100n, 1n)

// Register the plan
const { planId } = await payments.plans.registerCreditsPlan(
  planMetadata,
  priceConfig,
  creditsConfig
)

console.log(`Credits plan registered with ID: ${planId}`)
```

### Register a Time Plan

```typescript
import { ONE_DAY_DURATION, PlanMetadata } from '@nevermined-io/payments'

const planMetadata: PlanMetadata = {
  name: '24-Hour Unlimited Access',
  description: 'Unlimited queries for 24 hours',
}

const priceConfig = payments.plans.getERC20PriceConfig(
  50n,
  ERC20_ADDRESS,
  builderAddress
)

const creditsConfig = payments.plans.getExpirableDurationConfig(ONE_DAY_DURATION)

const { planId } = await payments.plans.registerTimePlan(
  planMetadata,
  priceConfig,
  creditsConfig
)

console.log(`Time plan registered with ID: ${planId}`)
```

### Register a Trial Plan

```typescript
import { ONE_DAY_DURATION, PlanMetadata } from '@nevermined-io/payments'

const planMetadata: PlanMetadata = {
  name: 'Free 24-Hour Trial',
  description: 'Try our AI agent free for 24 hours',
}

// Free pricing
const priceConfig = payments.plans.getFreePriceConfig()

// Limited duration
const creditsConfig = payments.plans.getExpirableDurationConfig(ONE_DAY_DURATION)

const { planId } = await payments.plans.registerTimeTrialPlan(
  planMetadata,
  priceConfig,
  creditsConfig
)

console.log(`Trial plan registered with ID: ${planId}`)
```

## Retrieving Plans

### Get a Specific Plan

```typescript
// Retrieve plan details by ID
const plan = await payments.plans.getPlan(planId)

console.log(`Plan: ${plan.name}`)
console.log(`Price: ${plan.price}`)
console.log(`Credits: ${plan.credits}`)
```

### Get All Published Plans

```typescript
// Get all plans published by your account
const plans = await payments.plans.getPlans()

plans.forEach(plan => {
  console.log(`${plan.name}: ${plan.planId}`)
})
```

### Get Plans for an Agent

To find plans associated with an agent, use the agents API:

```typescript
// Get all payment plans associated with an agent
const plans = await payments.agents.getAgentPlans(agentId)

plans.forEach(plan => {
  console.log(`Plan: ${plan.name} (${plan.planId})`)
})
```

## Duration Constants

The library provides convenient duration constants:

```typescript
import {
  ONE_DAY_DURATION,     // 86,400 seconds (24 hours)
  ONE_WEEK_DURATION,    // 604,800 seconds (7 days)
  ONE_MONTH_DURATION,   // 2,629,746 seconds (~30.44 days)
  ONE_YEAR_DURATION     // 31,557,600 seconds (~365.25 days)
} from '@nevermined-io/payments'
```

## Complete Example: Multi-Tier Plans

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'
import { ONE_DAY_DURATION, ONE_MONTH_DURATION } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

const builderAddress = payments.getAccountAddress()
const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

// Free trial plan
const { planId: trialPlanId } = await payments.plans.registerTimeTrialPlan(
  { name: 'Free Trial', description: '24 hours free access' },
  payments.plans.getFreePriceConfig(),
  payments.plans.getExpirableDurationConfig(ONE_DAY_DURATION)
)

// Basic tier - 100 credits
const { planId: basicPlanId } = await payments.plans.registerCreditsPlan(
  { name: 'Basic Plan', description: '100 credits for basic usage' },
  payments.plans.getERC20PriceConfig(10n, ERC20_ADDRESS, builderAddress),
  payments.plans.getFixedCreditsConfig(100n, 1n)
)

// Pro tier - unlimited monthly access
const { planId: proPlanId } = await payments.plans.registerTimePlan(
  { name: 'Pro Plan', description: 'Unlimited access for 30 days' },
  payments.plans.getERC20PriceConfig(50n, ERC20_ADDRESS, builderAddress),
  payments.plans.getExpirableDurationConfig(ONE_MONTH_DURATION)
)

console.log('Multi-tier plans created:')
console.log(`Trial: ${trialPlanId}`)
console.log(`Basic: ${basicPlanId}`)
console.log(`Pro: ${proPlanId}`)
```

## Related Documentation

- [Agents](./agents) - Associate plans with agents
- [Payments and Balance](./payments-and-balance) - How subscribers order plans

---

**Source References**:
- `src/plans.ts` (helper functions, duration constants)
- `src/api/plans-api.ts` (Plans API methods)
- `tests/e2e/test_payments_e2e.test.ts` (lines 277-369)
