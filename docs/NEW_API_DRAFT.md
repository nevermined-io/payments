# Documentation of a new potential API

## New API Structure

The library is initialized by calling the `getInstance` method, which returns an instance of the `Payments` class. This instance is used to interact with the Payments API.

The library requires an API key to be passed as an argument when calling `getInstance`. This API key is used to authenticate/authorize the requests made to the Backend API.

The library is structured in the following modules:

* `payments`: The main module that provides the instance of the Payments class and methods. It exposes to methods to connect/disconnect.
* `plans`: This module provides methods to register and manage payment plans.
* `agents`: This module provides methods to register and manage agents.
* `a2a`: This module provides methods to facilitate the integration with Google A2A agents.
* `mcp`: This module provides methods to manage the integration with MCP agents.

```
const payments = Payments.getInstance()
payments.isLoggedIn()
payments.logout()

payments.registerAgentAndPlan()

payments.plans.registerPlan()
payments.plans.registerCreditsPlan()
payments.plans.registerTimePlan()
payments.plans.registerCreditsTrialPlan
payments.plans.registerTimeTrialPlan
payments.plans.getPlan()
payments.plans.getAgentsAssociatedToAPlan()
payments.plans.getPlanBalance()
payments.plans.orderPlan()
payments.plans.mintPlanCredits()
payments.plans.mintPlanExpirable()
payments.plans.redeemCredits()


payments.agents.registerAgent()
payments.agents.getAgent()
payments.agents.getAgentPlans()
payments.agents.addPlanToAgent()
payments.agents.removePlanFromAgent()
payments.agents.getAgentAccessToken()

payments.requests.initializeSubscriberRequest()
payments.requests.updateSubscriberRequest()
payments.requests.finishSubscriberRequest()

payments.a2a.xxx
payments.mcp.xxx


```


## Connect

We only support 4 environments:

- local
- testing (base-sepolia)
- production (base-mainnet)
- custom, to connect any other EVM network (custom object passed as attribute which specifies required parameters)

```typescript
const payments = Payments.getInstance({
  nvmApiKey,
  environment: 'production', // 'local' 'testing' | | 'production' | 'custom'
})
```

## Registration

This actions are used by the users who want to make available an Agent with a Payment Plan associatge

### Configure your Payment Plan

Payment Plans are defined by 2 different configurations:

1. The configuration of the price of the plan. This is done by the `PriceConfig` object and allow the builder to specify how much is going to charge for the plan, and how the payment is going to be distributed (for example if all the amount is going to be paid to one user or if it's going to be distributed across several users).

2. The configuration of the credits of the plan. This is done by the `CreditsConfig` object. This allows to specify what is what a subscriber is going to get in return of the payment. For example, if the plan is restricted by time or usage (credits), how many credits are going to be given to the user when they purchase the plan, and how many credits are going to be redeemed when using the plan.

The AI Builder can specify different options in the `PriceConfig` and `CreditsConfig` objects to adapt to different scenarios:

```typescript
// This price config ask for a fixed price of 10 USDC that is going to be paid to the receiver (builderAddress)
const priceInUSDC: PlanPriceConfig = {
  priceType: PlanPriceType.FIXED_PRICE,
  tokenAddress: USDC_ERC20_ADDRESS, // The address of the ERC20 token that will be used to pay for the plan
  amounts: [10_000_000n], // 10 USDC
  receivers: [builderAddress], // The address of the user that is going to receive the payment
}

const priceConfig: PlanPriceConfig = {
  priceType: PlanPriceType.FIXED_PRICE, // It can be FIXED, EXPIRABLE, DYNAMIC
  tokenAddress: USDC_ERC20_TESTING, // The address of the token that will be used to pay for the plan
  price: 15_000_000n, // 15 USDC

  // OPTIONAL PARAMETERS:
  amounts: [10_000_000n, 5_000_000n], // OPTIONAL: In case the payment is distributted across several accounts
  receivers: ['0x1', '0x2'], // OPTIONAL: In case the payment is distributted across several accounts
  contractAddress: '0x1', // OPTIONAL: In case the priceType is DYNAMIC and it's calculated calling a Smart Contract, here we put the contract address. (NOT IMPLEMENTED YET)
}

const oneMonthPlan: PlanCreditsConfig = {
  creditsType: PlanCreditsType.EXPIRABLE,
  amount: 1n, // Because the plan is expirable, only 1 credit is going to be given to the user when they purchase the plan
  durationOfThePlan: 86400n * 30n, // 1 month in seconds
}

const fixedCreditsConfig: CreditsConfig = {
  creditsType: PlanCreditsType.FIXED, // It can be FIXED, EXPIRABLE, DYNAMIC
  amount: 100n, // The amount of credits that will be given to the user when they purchase the plan
  // OPTIONAL PARAMETERS:
  minAmount: 1n, // OPTIONAL: Default 1. The minimum number of credits redeemed when using the plan
  maxAmount: 1n, // OPTIONAL: Default 1. The maximum number of credits redeemed when using the plan
  durationOfThePlan: 0n, // OPTIONAL: IF creditsType = EXPIRABLE. The number of seconds the plan is active until it expires
}
```

To facilitate the configuration for the most common scenarios, we have defined some utility functions that can be used to configure the `PlanPriceConfig` and `PlanCreditsConfig` objects. These functions are in the `plans.ts` file:

```typescript
// Same as above, 10 USDC going to the builderAddress
const priceInUSDC = getERC20PriceConfig(10_000_000n, USDC_ERC20_ADDRESS, builderAddress)

// Same as above, 1 month plan
const oneMonthPlan = getExpirablePlanCreditsConfig(86400n * 30n)

// Fifty USD to be paid via Stripe (fiat payment)
const fiftyUSD = getFiatPriceConfig(50_000_000n, builderAddress)

// 100 credits granted when the plan is purchased and 5 credits redeemed per request
const fiveCreditsPerRequest = getFixedCreditsConfig(100n, 5n)
```

### Register Agent & Plan

Using the above configurations, a builder can register plans and agents asscoaited to them

#### Register a Payment Plan

```typescript
// We register a plan in which we ask for 10 USDC and give 1 month of access to the user
const { planId } = await payments.registerTimePlan(priceInUSDC, oneMonthPlan)

// OR also we register a plan in which we ask for 50 USD and give 100 credits to the user and charge 5 credits per request
const { planId } = await payments.registerCreditsPlan(fiftyUSD, fiveCreditsPerRequest)
```

#### Register an Agent and associate it to a Plan

Having previously registered a payment plan, we can register an agent and associate it to the plan:

```typescript
const agentMetadata: AgentMetadata = {
  name: 'Corporate Swiss Law assistant ',
  tags: ['legal', 'assistant'],
  dateCreated: new Date('2024-12-31'),
}

const agentApi: AgentApi = {
  endpoints: [{ POST: `https://example.com/api/query` }],
}

const { did } = await payments.registerAgent(agentMetadata, agentApi, [
  expirablePlanId,
  anotherPlanId,
])
```

#### Register an AI Agent

You can also register a new AI Agent and a Payment Plan in one go:

```typescript
const { agentId, planId } = await paymentsBuilder.registerAgentAndPlan(
  agentMetadata,
  agentApi,
  priceInUSDC,
  oneMonthPlan,
)
```

## Get information about a Plan or an Agent

### Get Agent

```typescript
interface Agent {
  agentId: string
  metadata: AgentMetadata
  plans: PaymentPlan[]
}

interface AgentMetadata {
  title: string
  description: string
  image: string
}

interface PaymentPlan {
  planId: string
  metadata: PlanMetadata
  price: PriceConfig
  credits: CreditsConfig
  nftAddress: string
}

const agent: Agent = await payments.getAgent(agentId)
```

### Get Plan

```typescript
const agent: Agent = await payments.getPlan(planId)
```

## Payments

### Order a Payment Plan

```typescript
const orderResult = await payments.orderPlan(planId)
```

### Get credits balance of a Payment Plan

```typescript
const balance = await payments.getPlanBalance(planId)
// OR if you provide the address of a different user
const balance = await payments.getPlanBalance(planId, userAddress)
```

## Usage scenarios

### As Subscriber (HUMAN or AGENT) I want to order & query an Agent

```typescript
payments.getAgent(agentId)
payments.getPlan(planId)
payments.orderPlan(planId)
payments.getPlanBalance(planId)
const queryOptions = await payments.getAgentHTTPOptions(planId, agentId)

await fetch(url, queryOptions)
```

### Is a valid request from a subscriber?

```typescript
const isValid = await payments.isValidRequest(agentId, request.headers['Authorization'])

// const isValid = await payments.isValidRequest(planId, agentId, subscriberAddress, request.headers['x-nvm-query-signature'])
if (!isValid) {
  const paymentCard = payments.getAgentPaymentCard(agentId)
  return response.status(402).send(paymentCard)
}

function isValidRequest(
  planId: string,
  agentId: string,
  subscriberAddress: string,
  signature: string,
): Promise<boolean> {
  // Validate the plan is part of the agent
  const agent = await payments.getAgent(agentId)
  if (!agent.registry.plans.some((plan) => plan.planId === planId)) {
    return false
  }

  // Validate the balance of the plan for the subscriber
  const balance = await payments.getPlanBalance(planId, subscriberAddress)
  if (!balance.isSubscriber) {
    return false
  }
  // Validate the request signature against the plan and agent
  const isValidSignature = await payments.validateSignature(
    planId,
    agentId,
    subscriberAddress,
    signature,
  )
  if (!isValidSignature) {
    return false
  }

  return true
}
```

### As Builder I want my Agent the ability to expose an API to subscribers

```typescript
// We authorize the subscriber checking if is a subscriber of the plan associated to the agent
const balance = await payments.getPlanBalance(planId)
if (!balance.isSubscriber) {
  const paymentCard = payments.getAgentPaymentCard(agentId)
  return response.status(402).send(paymentCard)
}

// process the request
```

### As Builder I want my Agent to be able to redeem credits

```typescript
// Authorize the user ....
// Process the AI request
// Redeem credits
const creditsToRedeem = 5n
const payments.redeemCredits(planId, creditsToRedeem, proof)
```

### As Builder I want to have an Agent that can be accessed by subscribers having different payment plans

```typescript

```

## Subscribers Querying Agents

```typescript
const accessCredentials = await payments.query.getAgentHTTPOptions(planId, agentId)

// OUTPUT: accessCredentials:
// {
//   accessToken: 'eJyNj0sKgDAURP9lJQ ....',
//   neverminedProxyUri: 'https://proxy.testing.nevermined.app'
// }

const result = await payments.query(agentId, accessCredentials, httpOptions)
```

## Agent Builders/Owners can redeem credits

```typescript
const credits = await payments.redeemCredits(planId, amount, proof)
```
