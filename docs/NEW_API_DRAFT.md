
# Documentation of a new potential API

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
  
2. The configuration of the credits of the plan. This is done by the `CreditsConfig` object. This allows to specify what is what a subscriber is going to get in return of the payment. For example,  if the plan is restricted by time or usage (credits), how many credits are going to be given to the user when they purchase the plan, and how many credits are going to be redeemed when using the plan.

The AI Builder can specify different options in the `PriceConfig` and `CreditsConfig` objects to adapt to different scenarios:

```typescript
// This price config ask for a fixed price of 10 USDC that is going to be paid to the receiver (builderAddress)
const priceInUSDC:PlanPriceConfig = {
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

const oneMonthPlan:PlanCreditsConfig = {
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
const priceInUSDC = getERC20PriceConfig(10_000_000n, USDC_ERC20_ADDRESS, builderAddress )

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
  dateCreated: new Date('2024-12-31')
}

const agentApi: AgentApi = {
  endpoints: [
    { 'POST': `https://example.com/api/query` }
  ]
}

const { did } = await payments.registerAgent(agentMetadata, agentApi, [ expirablePlanId, anotherPlanId ])
```

#### Register an AI Agent

You can also register

```typescript
const { did, planId } = await paymentsBuilder.registerAgentAndPlan(
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

const agent: Agent = await payments.getAgent(did)

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
const balance = await payments.getPlanBalance(planDID)
// OR if you provide the address of a different user
const balance = await payments.getPlanBalance(planDID, userAddress)
```

## Subscribers Querying Agents

```typescript
const accessCredentials = await payments.query.getAgentAccessCredentials(agentId)

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
