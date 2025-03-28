
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

### Register Agent & Plan

```typescript
const priceConfig: PriceConfig = {
  priceType: FIXED, // It can be FIXED, EXPIRABLE, DYNAMIC
  tokenAddress: USDC_ERC20_TESTING, // The address of the token that will be used to pay for the plan
  price: 15000000n, // 15 USDC

  // OPTIONAL PARAMETERS:
  amounts: [10000000n, 5000000n], // OPTIONAL: In case the payment is distributted across several accounts
  receivers: ['0x1', '0x2'], // OPTIONAL: In case the payment is distributted across several accounts
  contractAddress: '0x1', // OPTIONAL: In case the priceType is DYNAMIC and it's calculated calling a Smart Contract, here we put the contract address. (NOT IMPLEMENTED YET)
}

const creditsConfig: CreditsConfig = {
  creditsType: FIXED, // It can be FIXED, EXPIRABLE, DYNAMIC
  amount: 100n, // The amount of credits that will be given to the user when they purchase the plan

  // OPTIONAL PARAMETERS:
  minAmount: 1n, // OPTIONAL: Default 1. The minimum number of credits redeemed when using the plan
  maxAmount: 1n, // OPTIONAL: Default 1. The maximum number of credits redeemed when using the plan
  durationOfThePlan: 86400n, // OPTIONAL: IF creditsType = EXPIRABLE. The number of seconds the plan is active until it expires
}

const { agentId, planId } = await payments.registerAssetAndPlan({
  metadata, // title, description, image, etc
  priceConfig,
  creditsConfig,
  nftAddress, // OPTIONAL: The address of the NFT1155 Factory that will be used to mint/burn the credits
})
```

### Register a Plan but not an Agent

For scenarios where we want to register a plan but not an agent, we can use the `registerPlan` method. This is useful for cases where we want to create a plan that can be used by multiple agents or when we want to register a plan without associating it with a specific agent.

```typescript
const planId = await paiments.registerPlan({
  planMetadata, // title, description, image, etc
  priceConfig,
  creditsConfig,
  nftAddress, // OPTIONAL: The address of the NFT1155 Factory that will be used to mint/burn the credits
})
```

### Register an Agent but not a Plan

This is useful for cases where we want to create an agent associated to a previously created Plan.

```typescript
const agentId = await paiments.registerAgent({
  agentMetadata, // title, description, image, etc
  planId
})
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
