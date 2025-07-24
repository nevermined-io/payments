---
sidebar_position: 3
description: How AI Builders can register Payment Plans and Agents?
---

# How to Register Payment Plans and Agents

Once you have a Payments instance, you can start registering Payment Plans and AI Agents.

## Registering a Payment Plan

Payment Plans give AI Builders the ability to control how and when users can access an AI agent or service. They are entirely controlled and managed by the AI Builder who creates them, with no interference from Nevermined.

Nevermined Payment Plans enable the setup of time-based or request-based gating for a Builder's AI.

* **Request-Based or Credits-Based**: Provides user access with request-gating. Builders can manage the number of requests a user can make to access their AI service. This is done by setting the number of credits required to make a request to the AI service/app when adding that service to a Payment Plan. Each time a request is made, Nevermined will redeem the specified number of credits. If the user does not have enough credits, they will be prompted to purchase more and denied access until they do.
* **Time-Based**: Provides user access with time-gating. Builders can set the time period that a user is allowed access to the AI (e.g., 1 year, 1 month, 1 week, 1 day, 1 hour, etc.). When a user makes a request, the corresponding access credit is redeemed, granting access for the designated period. Once the time period has elapsed, the user will no longer have access and will need to redeem another credit for continued access.

### Registering a Credit-Based Payment Plan

```typescript
const USDC_ERC20_TESTING = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // USDC ERC20 address on the testing network

const planMetadata = {
  name: 'My Credits Plan',
  tags: ['test']
}
// The price is 20 USDC (20_000_000) on the testing network
const priceConfig = getERC20PriceConfig(20_000_000n, USDC_ERC20_TESTING, builderAddress)
// The subscriber receives 100 credits upon purchasing the plan
const creditsConfig = getFixedCreditsConfig(100n)
// Register the plan
const { planId } = await payments.plans.registerCreditsPlan(
  planMetadata, 
  priceConfig, 
  creditsConfig
)
```

### Registering a Time-Based Payment Plan

```typescript
// The price is 5 USDC (5_000_000) on the testing network
const priceConfig = getERC20PriceConfig(5_000_000n, ERC20_ADDRESS, builderAddress)
// The plan is valid for 1 day
const oneDayPlanConfig = getExpirableDurationConfig(ONE_DAY_DURATION)
// Register the plan
const { planId } = await payments.plans.registerTimePlan(
  planMetadata, 
  priceConfig, 
  oneDayPlanConfig
)
```

### Registering a Trial Plan

A Trial Plan is a special type of Payment Plan that allows users to try out an AI Agent for a limited time (typically for free). A Trial Plan can only be obtained once by each user.

```typescript
const trialPlanMetadata: PlanMetadata = {
  name: 'Try it for one day before you buy it',
}
// The price is free
const freeConfig = getFreePriceConfig()
// The plan is valid for 1 day
const oneDayPlanConfig = getExpirableDurationConfig(ONE_DAY_DURATION)
// Register the trial plan
const { planId } = await payments.plans.registerTimeTrialPlan(
  trialPlanMetadata, 
  freeConfig, 
  oneDayPlanConfig
)
```

### Registering an AI Agent

```typescript
// When you create an agent, you need to provide the endpoints that the agent exposes and are protected by the Payment Plan
// You must specify the HTTP method and the URL pattern that the agent exposes
// You can use wildcards (like :agentId in the example) to match any string
// See more information about the wildcards supported here: https://github.com/pillarjs/path-to-regexp

const agentMetadata: AgentMetadata = {
  name: 'E2E Payments Agent',
  tags: ['test'],
  dateCreated: new Date()
}
const agentApi = {
  endpoints: [
    { 'POST': 'https://example.com/api/v1/agents/:agentId/tasks' },
    { 'GET': 'https://example.com/api/v1/agents/:agentId/tasks/invoke' }
  ],
  openEndpoints: ['https://example.com/api/v1/rest/docs-json']
}
const paymentPlans = [creditsPlanId, expirablePlanId]

const { agentId } = await payments.agents.registerAgent(
  agentMetadata, 
  agentApi, 
  paymentPlans
)
```

### Creating a Credit-Based Payment Plan and an AI Agent in One Step

```typescript
const agentMetadata = { name: 'My AI Payments Agent', tags: ['test2'] }
const agentApi = { endpoints: [{ 'POST': 'http://example.com/test/:agentId/tasks' }] }

const cryptoPriceConfig = getNativeTokenPriceConfig(500n, builderAddress)
// Non expirable payment plan
const nonExpirableConfig = getNonExpirableDurationConfig()

const { agentId, planId } = await paymentsBuilder.agents.registerAgentAndPlan(
  agentMetadata,
  agentApi,
  planMetadata,
  cryptoPriceConfig,
  nonExpirableConfig,
)
```
