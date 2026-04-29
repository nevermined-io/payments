---
title: "Agents"
description: "Register and manage AI agents with payment plans, metadata, and API endpoints"
icon: "robot"
---

# Agents

The Agents API allows AI builders to register their AI agents with the Nevermined protocol, making them discoverable and accessible through payment plans.

## Overview of Agents API

The Agents API (`payments.agents`) enables you to:
- Register AI agents with metadata and API endpoints
- Associate agents with one or more payment plans
- Register agents and plans together in a single operation
- Update agent metadata and configuration
- Retrieve agent information
- Manage plan associations (add/remove plans from agents)

## Agent Metadata Structure

Agents require metadata for discovery and identification:

```typescript
import { AgentMetadata } from '@nevermined-io/payments'

const agentMetadata: AgentMetadata = {
  name: 'Weather AI Agent',
  description: 'Provides real-time weather forecasts and climate data',
  tags: ['weather', 'forecast', 'climate'],
  dateCreated: new Date(),
  author: 'Your Company Name',
  // Additional metadata fields...
}
```

## Agent API Configuration

`AgentAPIAttributes` describes how requests to your agent are authenticated and (optionally) which routes are gated by your Payment Plan. **All fields are optional.**

### Minimal (recommended)

Most builders only need to configure how the agent is authenticated. If you integrate with the Payments library and gate paid routes via library annotations or middleware, you do **not** need to declare endpoints or an OpenAPI URL at registration time.

```typescript
import { AgentAPIAttributes } from '@nevermined-io/payments'

const agentApi: AgentAPIAttributes = {
  authType: 'bearer',
  token: process.env.AGENT_BEARER_TOKEN,
}
```

### With Additional Security (opt-in)

If you want the Nevermined platform to enforce a route-level allowlist (defense-in-depth on top of your library-level gating), provide `endpoints`. You can also provide `agentDefinitionUrl` to publish a discoverable OpenAPI / MCP / A2A descriptor.

```typescript
const agentApi: AgentAPIAttributes = {
  authType: 'bearer',
  token: process.env.AGENT_BEARER_TOKEN,

  // Additional Security: only requests matching this allowlist are accepted by
  // x402 verify. Omitted = allow-all (default).
  endpoints: [
    { POST: 'https://api.example.com/v1/agents/:agentId/tasks' },
    { GET: 'https://api.example.com/v1/agents/:agentId/tasks/:taskId' },
  ],
  openEndpoints: ['https://api.example.com/v1/health'],

  // Optional: discoverable agent definition (OpenAPI / MCP Manifest / A2A card).
  agentDefinitionUrl: 'https://api.example.com/openapi.json',
}
```

> **Migration note:** existing agents that registered before April 2026 still have these fields populated and continue to enforce the allowlist as before. Nothing changes for them. Use the Edit Agent screen on app.nevermined.app to add or remove the configuration.

### Endpoint patterns (Additional Security)

When you opt in to the allowlist, you can use path parameters in your endpoint definitions:

```typescript
const agentApi: AgentAPIAttributes = {
  endpoints: [
    { POST: 'https://api.example.com/agents/:agentId/query' },
    { GET: 'https://api.example.com/agents/:agentId/status' },
    { POST: 'https://api.example.com/agents/:agentId/tasks/:taskId/cancel' },
  ],
}
```

## Register Agents

### Register Agent with Existing Plans

If you've already registered payment plans, you can register an agent and associate it with those plans:

```typescript
import { Payments, AgentMetadata, AgentAPIAttributes } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox',
})

// Define agent metadata
const agentMetadata: AgentMetadata = {
  name: 'Weather Forecast Agent',
  description: 'Get accurate weather forecasts for any location',
  tags: ['weather', 'forecast', 'api'],
}

// Configure API authentication. endpoints + agentDefinitionUrl are
// optional — see "Additional Security (opt-in)" above.
const agentApi: AgentAPIAttributes = {
  authType: 'bearer',
  token: process.env.AGENT_BEARER_TOKEN,
}

// Register agent with existing plans
const { agentId } = await payments.agents.registerAgent(
  agentMetadata,
  agentApi,
  [planId1, planId2]  // Array of plan IDs
)

console.log(`Agent registered with ID: ${agentId}`)
```

### Register Agent and Plan Together

For convenience, you can register both an agent and its payment plan in a single operation:

```typescript
import { Payments, AgentMetadata, AgentAPIAttributes, PlanMetadata } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox',
})

const builderAddress = payments.getAccountAddress()
const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

// Define plan
const planMetadata: PlanMetadata = {
  name: 'Weather Agent Access Plan',
  description: 'Get 1000 credits to access weather data',
}

const priceConfig = payments.plans.getCryptoPriceConfig(
  10_000_000n,
  builderAddress,
  ERC20_ADDRESS
)

const creditsConfig = payments.plans.getFixedCreditsConfig(1000n, 1n)

// Define agent
const agentMetadata: AgentMetadata = {
  name: 'Weather Forecast Agent',
  description: 'Real-time weather forecasts powered by AI',
  tags: ['weather', 'ai', 'forecast'],
}

const agentApi: AgentAPIAttributes = {
  authType: 'bearer',
  token: process.env.AGENT_BEARER_TOKEN,
  // Optional: opt in to platform-enforced route allowlist. See
  // "Additional Security (opt-in)" above.
  // endpoints: [
  //   { POST: 'https://weather-api.example.com/v1/agents/:agentId/tasks' },
  // ],
}

// Register both together
const { agentId, planId } = await payments.agents.registerAgentAndPlan(
  agentMetadata,
  agentApi,
  planMetadata,
  priceConfig,
  creditsConfig
)

console.log(`Agent ID: ${agentId}`)
console.log(`Plan ID: ${planId}`)
```

## Retrieve Agents

### Get a Specific Agent

```typescript
// Get agent details by ID
const agent = await payments.agents.getAgent(agentId)

console.log(`Name: ${agent.name}`)
console.log(`Description: ${agent.description}`)
console.log(`Endpoints: ${JSON.stringify(agent.endpoints)}`)
```

### Get Plans for an Agent

```typescript
// Get all payment plans associated with an agent
const plans = await payments.agents.getAgentPlans(agentId)

plans.forEach(plan => {
  console.log(`Plan: ${plan.name} (${plan.planId})`)
})
```

## Update Agent Metadata

You can update agent metadata and API configuration after registration. This is also where builders typically **opt in to Additional Security** by adding an `endpoints` allowlist or an `agentDefinitionUrl` to an existing agent:

```typescript
// Update agent information and opt in to the route-level allowlist.
await payments.agents.updateAgentMetadata(
  agentId,
  {
    description: 'Updated description with new features',
    tags: ['weather', 'forecast', 'climate', 'ai-powered'],
  },
  {
    // Adding `endpoints` activates the platform-enforced allowlist.
    // To later remove it (and return to allow-all), pass `endpoints: []`
    // along with the rest of the API config — but be aware the platform
    // treats configured-but-empty as deny-all unless `openEndpoints`
    // matches, preserving legacy semantics.
    endpoints: [
      { POST: 'https://weather-api.example.com/v2/agents/:agentId/forecast' },
      { GET: 'https://weather-api.example.com/v2/agents/:agentId/history' },
      { GET: 'https://weather-api.example.com/v2/agents/:agentId/alerts' },
    ],
    agentDefinitionUrl: 'https://weather-api.example.com/openapi.json',
  }
)

console.log('Agent updated successfully')
```

## Manage Agent Plans

### Add Plans to an Agent

Associate additional payment plans with an existing agent:

```typescript
// Add new plans to an agent
await payments.agents.addPlanToAgent(newPlanId, agentId)

console.log(`Added plan ${newPlanId} to agent ${agentId}`)
```

### Remove Plans from an Agent

Remove payment plan associations:

```typescript
// Remove a plan from an agent
await payments.agents.removePlanFromAgent(planIdToRemove, agentId)

console.log(`Removed plan ${planIdToRemove} from agent ${agentId}`)
```

## Authentication Types

The Agents API supports multiple authentication types:

```typescript
// No authentication required
const agentApi = {
  endpoints: [{ GET: 'https://api.example.com/public' }],
  authType: 'none',
}

// Basic authentication
const agentApi = {
  endpoints: [{ POST: 'https://api.example.com/agent' }],
  authType: 'basic',
}

// Bearer token (most common for AI agents)
const agentApi = {
  endpoints: [{ POST: 'https://api.example.com/agent' }],
  authType: 'bearer',  // X402 access token in Authorization header
}

// OAuth
const agentApi = {
  endpoints: [{ POST: 'https://api.example.com/agent' }],
  authType: 'oauth',
}
```

## Complete Example: Multi-Endpoint Agent

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'
import { AgentMetadata, AgentAPIAttributes } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// Comprehensive agent configuration
const agentMetadata: AgentMetadata = {
  name: 'Advanced Weather AI',
  description: 'Multi-modal weather analysis with forecasts, alerts, and historical data',
  tags: ['weather', 'forecast', 'climate', 'alerts', 'ai'],
  author: 'Weather Tech Inc.',
  dateCreated: new Date(),
}

const agentApi: AgentAPIAttributes = {
  endpoints: [
    { POST: 'https://api.weather-tech.com/v1/agents/:agentId/forecast' },
    { GET: 'https://api.weather-tech.com/v1/agents/:agentId/forecast/:forecastId' },
    { POST: 'https://api.weather-tech.com/v1/agents/:agentId/alerts' },
    { GET: 'https://api.weather-tech.com/v1/agents/:agentId/history' },
    { DELETE: 'https://api.weather-tech.com/v1/agents/:agentId/alerts/:alertId' },
  ],
  openEndpoints: [
    'https://api.weather-tech.com/v1/health',
    'https://api.weather-tech.com/v1/status',
  ],
  authType: 'bearer',
  agentDefinitionUrl: 'https://api.weather-tech.com/openapi.json',
}

// Register with multiple plans
const { agentId } = await payments.agents.registerAgent(
  agentMetadata,
  agentApi,
  [basicPlanId, proPlanId, enterprisePlanId]
)

console.log(`Advanced agent registered: ${agentId}`)

// Retrieve and verify
const agent = await payments.agents.getAgent(agentId)
const { plans, total, page, offset } = await payments.agents.getAgentPlans(agentId)

console.log(`Agent has ${plans.length} plans on page ${page} (offset ${offset}, total ${total})`)
```

## Best Practices

1. **Descriptive Metadata**: Use clear names and descriptions for better discoverability
2. **Relevant Tags**: Add tags that help users find your agent
3. **RESTful Endpoints**: Follow REST conventions for endpoint paths
4. **OpenAPI Specs**: Provide agent definition URLs for better integration
5. **Multiple Plans**: Offer different pricing tiers for various use cases
6. **Bearer Auth**: Use bearer token authentication for secure access

## Related Documentation

- [Payment Plans](./payment-plans) - Create plans to associate with agents
- [Publishing Static Resources](./publishing-static-resources) - Register static content agents
- [Validation of Requests](./validation-of-requests) - Validate incoming agent requests

---

**Source References**:
- `src/api/agents-api.ts` (Agents API methods)
- `tests/e2e/test_payments_e2e.test.ts` (lines 373-449)
- `tests/e2e/test_x402_e2e.test.ts` (agent registration examples)
