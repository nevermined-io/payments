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
## A2A Integration (Agents‑to‑Agents)

Nevermined Payments integrates with the A2A protocol to authorize and charge per request between agents:

- Discovery: publish the Agent Card at `/.well-known/agent.json`.
- Streaming and resubscribe: set `capabilities.streaming: true` for `message/stream` and `tasks/resubscribe`.
- Authentication: credentials travel in HTTP headers (e.g., `Authorization: Bearer ...`), not in the JSON‑RPC payload.
- Authorization/charging: the agent emits a final event with `metadata.creditsUsed`; Nevermined validates and burns credits accordingly.

### Payment extension required in the Agent Card

Add a payment extension under `capabilities.extensions` carrying Nevermined metadata:

```json
{
  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "extensions": [
      {
        "uri": "urn:nevermined:payment",
        "description": "Dynamic cost per request",
        "required": false,
        "params": {
          "paymentType": "dynamic",
          "credits": 1,
          "planId": "<planId>",
          "agentId": "<agentId>"
        }
      }
    ]
  },
  "url": "https://your-agent.example.com/a2a/"
}
```

Important notes:
- The `url` must match exactly the URL registered in Nevermined for the agent/plan.
- The final streaming event must include `metadata.creditsUsed` with the consumed cost.


## Requirements

To use the Nevermined Payments Library, you need to get your Nevermined API key. You can get yours freely from the  [Nevermined App](https://nevermined.app).

### Environments

- Public environments: `sandbox`, `live`.
- Internal/validation: `staging_sandbox`, `staging_live`.

Pick the environment that matches where your agent and plans are registered. The agent card `url` must belong to that environment.

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
const priceConfig = payments.plans.getERC20PriceConfig(20n, ERC20_ADDRESS, builderAddress)
const creditsConfig = payments.plans.getFixedCreditsConfig(100n)
const { planId } = await payments.plans.registerCreditsPlan(planMetadata, priceConfig, creditsConfig)
```

Or register a plan limited by time:

```typescript
const priceConfig = payments.plans.getERC20PriceConfig(50n, ERC20_ADDRESS, builderAddress)
const expirablePlanConfig = payments.plans.getExpirableDurationConfig(payments.plans.ONE_DAY_DURATION) // 1 day
const response = await payments.plans.registerTimePlan(planMetadata, priceConfig, expirablePlanConfig)
```

You can also create trial plans (free plans that can only be purchased once):

```typescript
import { ONE_DAY_DURATION } from '@nevermined-io/payments'

// Credits-based trial plan
const trialPlanMetadata = { name: 'Free Trial Plan' }
const freePriceConfig = payments.plans.getFreePriceConfig()
const trialCreditsConfig = payments.plans.getFixedCreditsConfig(10n)

const trialPlan = await payments.plans.registerCreditsTrialPlan(
  trialPlanMetadata,
  freePriceConfig,
  trialCreditsConfig
)

// Time-based trial plan
const timeTrialConfig = payments.plans.getExpirableDurationConfig(ONE_DAY_DURATION)
const timeTrialPlan = await payments.plans.registerTimeTrialPlan(
  trialPlanMetadata,
  freePriceConfig,
  timeTrialConfig
)
```

### Create an AI Agent/Service

You can register an agent with existing payment plans:

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
const result = await payments.agents.registerAgent(agentMetadata, agentApi, paymentPlans)
```

Or register an agent and plan together in one step:

```typescript
import { ONE_DAY_DURATION } from '@nevermined-io/payments'

const agentMetadata = {
  name: 'My AI Payments Agent',
  tags: ['ai', 'assistant'],
}

const agentApi = {
  endpoints: [
    { 'POST': 'https://example.com/api/v1/agents/:agentId/tasks' }
  ]
}

const planMetadata = { name: 'Basic Plan' }
const priceConfig = payments.plans.getERC20PriceConfig(20n, ERC20_ADDRESS, builderAddress)
const creditsConfig = payments.plans.getExpirableDurationConfig(ONE_DAY_DURATION)

// Register agent and plan together
const { agentId, planId, txHash } = await payments.agents.registerAgentAndPlan(
  agentMetadata,
  agentApi,
  planMetadata,
  priceConfig,
  creditsConfig,
  'time' // Oexplicitly set access limit to 'time' or 'credits'
)
```

The `accessLimit` parameter is optional. If not specified, it's automatically inferred:
- `'credits'` if `creditsConfig.durationSecs === 0n` (non-expirable)
- `'time'` if `creditsConfig.durationSecs > 0n` (expirable)

### Purchase a Payment Plan

```typescript
const orderResult = await payments.plans.orderPlan(creditsPlanId)
```

And get the balance of the purchased plan:

```typescript
const balance = await payments.plans.getPlanBalance(creditsPlanId)
console.log(`Balance: ${balance}`)
```

### Query an AI Agent

Once the user has purchased a plan, they can query the agent:

```typescript
const params = await payments.agents.getAgentAccessToken(creditsPlanId, agentId)

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

## MCP (Model Context Protocol)

### What is MCP

- MCP is a protocol for LLM apps to call external tools/resources/prompts via JSON‑RPC over HTTP (plus SSE streams). Think of it as an USB-C interface for LLMs
- MCP servers expose handlers (tools/resources/prompts) with their logical urls, such as mcp://mcp-server/tools/my-tooling. Clients send requests with `Authorization: Bearer <token>`, protected by Nevermined Payments Engine and receive JSON‑RPC results or errors.

### Integration API

Nevermined integration to protect MCP handlers and burn credits.

### Steps

```ts
import { Payments } from '@nevermined-io/payments'

// 1) Create Payments on the server
const payments = Payments.getInstance({ nvmApiKey, environment })

// 2) Configure the MCP wrapper
payments.mcp.configure({ agentId: process.env.NVM_AGENT_ID!, serverName: 'my-mcp' })

// 3) Wrap your handlers (works for both high-level and low-level servers)
// Tool
const toolHandler = async ({ city }: { city: string }) => ({
  content: [{ type: 'text', text: `Weather for ${city}` }],
})
const protectedTool = payments.mcp.withPaywall(toolHandler, {
  kind: 'tool',
  name: 'weather.today',
  credits: 2n, // or (ctx) => bigint
})
// High-level: server.registerTool('weather.today', config, protectedTool)
// Low-level: const tools = new Map([[ 'weather.today', protectedTool ]])

// Alternative registration:
const { registerResource } = payments.mcp.attach(server)
const resourceHandler = async (uri: URL, vars: Record<string, string | string[]>) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ city: vars.city }) }],
})
registerResource('weather-today', template, config, resourceHandler, { credits: 1n })
```

Notes:
 - Low-level servers should keep their own routing tables (e.g., Maps) and call protected handlers directly, passing an `extra` object with `headers.Authorization` (e.g., `extra = { headers: req.headers }`). 

### JSON‑RPC errors

- **-32003 Payment required** (missing/invalid token, not a subscriber)
- **-32002 Network/other** (unexpected or redeem failure if `onRedeemError: 'propagate'`)
- Domain codes are fine (e.g., -32004 “City not found”)

### Notes

- The wrapper reads `Authorization`, calls Nevermined `startProcessingRequest`, executes the handler, and calls `redeemCreditsFromRequest`.
- `credits` can be a `bigint` or `(ctx) => bigint` with `{ args, result }`. Use `args` for input-based pricing and `result` for output-based pricing.
- `name` builds the logical URL `mcp://{serverName}/{kind}/{name}`.

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
