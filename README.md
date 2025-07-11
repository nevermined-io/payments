[![banner](https://raw.githubusercontent.com/nevermined-io/assets/main/images/logo/banner_logo.png)](https://nevermined.io)

# Library for Activating AI Agent Payments Using the Nevermined Protocol

> TypeScript SDK to interact with the Nevermined Payments Protocol  
> [nevermined.io](https://nevermined.io)

## Motivation

The evolution of AI-native commerce is inevitable, but the infrastructure to support it is currently lacking. Today, AI agents require seamless, automated payment systems for individual transactions. As demand grows, these agents will scale into swarms, transacting and operating autonomously.

Existing solutions are designed for human use with physical money. This does not reflect the new reality, where AI Agents need to make and receive payments quickly and efficiently, without the limitations of traditional payment systems.

Nevermined provides a solution that seamlessly evolves from single-agent needs to complex AI economies, eliminating friction and supporting a fully autonomous, composable future for AI-driven commerce.

## What is the Nevermined Payments Library?

The Nevermined Payments Library is a TypeScript SDK that allows AI Builders and Subscribers to make AI Agents available for querying and use by other agents or humans. It is designed to be used alongside the Nevermined protocol, which provides a decentralized infrastructure for managing AI agents and their interactions.

The Payments Library enables:

* Easy registration and discovery of AI agents and the payment plans required to access them. All agents registered in Nevermined expose their metadata in a generic way, making them searchable and discoverable for specific purposes.
* Flexible definition of pricing options and how AI agents can be queried. This is achieved through payment plans (based on time or credits) and consumption costs (fixed per request or dynamic). All of this can be defined by the AI builder or agent during the registration process.
* Subscribers (humans or other agents) to purchase credits that grant access to AI agent services. Payments can be made in crypto or fiat via Stripe integration. The protocol registers the payment and credits distribution settlement on-chain.
* Agents or users with access credits to query other AI agents. Nevermined authorizes only users with sufficient balance and keeps track of their credit usage.

[![banner](docs/images/nvm_hl.png)]

The library is designed for use in browser environments or as part of AI Agents:

* In a browser, the library provides a simple way to connect to the Nevermined protocol, allowing users to query AI Agents or publish their own.
* As part of an AI Agent, the library allows the agent to query other agents programmatically. Additionally, agents can use the library to expose their own services and make them available to other agents or humans.

## Quickstart

```bash
# yarn
yarn add @nevermined-io/payments

# npm
npm install @nevermined-io/payments
```

## Requirements

To use the Nevermined Payments Library, you need to get your Nevermined API key. You can get yours freely from the  [Nevermined App](https://nevermined.app).

### Initialize the Payments library in the Browser

This is a browser only method. Here we have an example using react.
For a full example please refer to [payments-nextjs-example](https://github.com/nevermined-io/tutorials/tree/main/payments-nextjs-example)

```typescript
import { useEffect } from "react";
import { Payments } from "@nevermined-io/payments";

export default function Home() {
  const payments = new Payments({
    returnUrl: "http://localhost:8080",
    environment: "staging",
  });

  const onLogin = () => {
    payments.connect();
  };

  useEffect(() => {
    payments.init();
  }, []);

  return (
    <main>
      <div>
        <button onClick={onLogin}>Login</button>
      </div>
    </main>
  );
}
```

The `init()` method should be called immediately after the app returns the user to `returnUrl`.

### Initialize the Payments library in an AI Agent

```typescript
import { Payments } from "@nevermined-io/payments";

const payments = Payments.getInstance({
  nvmApiKey,
  environment: 'testing' as EnvironmentName,
})
```

### Create a Payments Plan

Once the app is initialized we can create a payment plan:

```typescript
const planMetadata: PlanMetadata = {
    name: 'E2E test Payments Plan',
  }
const priceConfig = getERC20PriceConfig(20n, ERC20_ADDRESS, builderAddress)
const creditsConfig = getFixedCreditsConfig(100n)
const { planId } = await payments.registerCreditsPlan(planMetadata, priceConfig, creditsConfig)
```

Or register a plan limited by time:

```typescript
const priceConfig = getERC20PriceConfig(50n, ERC20_ADDRESS, builderAddress)
const expirablePlanConfig = getExpirableDurationConfig(ONE_DAY_DURATION) // 1 day
const response = await payments.registerTimePlan(planMetadata, priceConfig, expirablePlanConfig)
```

### Create an AI Agent/Service

```typescript
// Some metadata about the agent
const agentMetadata = {
  name: 'E2E Payments Agent',
  tags: ['test'],
}

// The API that the agent will expose
const agentApi = {
  endpoints: [
    { 'POST': `https://example.com/api/v1/agents/:agentId/tasks` },
    { 'GET': `https://example.com/api/v1/agents/:agentId/tasks/invoke` }
]}

// This is the list of payment plans that the agent will accept
const paymentPlans = [ creditsPlanId, expirablePlanId ]
const result = await payments.registerAgent(agentMetadata, agentApi, paymentPlans)

```

### Purchase a Payment Plan

```typescript
const orderResult = await payments.orderPlan(creditsPlanId)
```

And get the balabce of the purchased plan:

```typescript
const balance = await payments.getPlanBalance(creditsPlanId)
console.log(`Balance: ${balance}`)
```

### Query an AI Agent

Once the user has purchased a plan, they can query the agent:

```typescript
const params = await payments.getAgentAccessToken(creditsPlanId, agentId)

const agentHTTPOptions = {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${params.accessToken}`
  },
}
const response = await fetch(new URL(agentURL), agentHTTPOptions)

```

## License

```text
Copyright 2025 Nevermined AG

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
