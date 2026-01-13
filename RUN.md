# Running Agents with Nevermined Payments

This guide explains how to run AI agents protected by the Nevermined Payments Library.

## Prerequisites

1. **Nevermined API Key**: Get yours from [Nevermined App](https://nevermined.app)
2. **Registered Agent and Plan**: Your agent and payment plan must be registered on Nevermined
3. **Environment Variables**:
   ```bash
   export NVM_API_KEY="your-nevermined-api-key"
   export NVM_ENVIRONMENT="sandbox"  # or "live" for production
   export NVM_AGENT_ID="your-agent-id"  # Your registered agent ID
   ```

## MCP Server

The simplest way to run a payment-protected agent is using the MCP integration:

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'
import { z } from 'zod'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: process.env.NVM_ENVIRONMENT as EnvironmentName,
})

// Register your tools
payments.mcp.registerTool(
  'my-tool',
  {
    title: 'My Tool',
    description: 'Does something useful',
    inputSchema: z.object({ input: z.string() }),
  },
  async (args) => ({
    content: [{ type: 'text', text: `Result: ${args.input}` }],
  }),
  { credits: 1n }
)

// Start the server
const { info, stop } = await payments.mcp.start({
  port: 3000,
  agentId: process.env.NVM_AGENT_ID!,
  serverName: 'my-agent',
  version: '1.0.0',
})

console.log(`Server running at ${info.baseUrl}`)

// Graceful shutdown
process.on('SIGINT', async () => {
  await stop()
  process.exit(0)
})
```

### Registering MCP Endpoints

When registering your agent at [nevermined.app](https://nevermined.app), use MCP logical URIs instead of HTTP URLs. The format is `mcp://<serverName>/<type>/<name>`:

| Type | URI Format | Example |
|------|------------|---------|
| Tools | `mcp://<serverName>/tools/<toolName>` | `mcp://my-agent/tools/my-tool` |
| Resources | `mcp://<serverName>/resources/<resourceUri>` | `mcp://my-agent/resources/weather://today` |
| Prompts | `mcp://<serverName>/prompts/<promptName>` | `mcp://my-agent/prompts/ask-weather` |

You can also use wildcards to cover all endpoints of a type: `mcp://my-agent/tools/*`

### What the Server Provides

When you call `payments.mcp.start()`, the library automatically sets up:

| Endpoint | Description |
|----------|-------------|
| `POST /mcp` | MCP JSON-RPC endpoint for tool/resource/prompt calls |
| `GET /mcp` | SSE endpoint for streaming |
| `DELETE /mcp` | Session cleanup |
| `GET /` | Server info |
| `GET /health` | Health check |
| `/.well-known/oauth-protected-resource` | OAuth 2.1 protected resource metadata |
| `/.well-known/oauth-authorization-server` | OAuth 2.1 authorization server metadata |
| `/.well-known/openid-configuration` | OpenID Connect discovery |
| `POST /register` | Dynamic client registration |

## A2A Server

For Agent-to-Agent protocol:

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'
import { buildPaymentAgentCard } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: process.env.NVM_ENVIRONMENT as EnvironmentName,
})

// Build agent card with payment metadata
const agentCard = Payments.a2a.buildPaymentAgentCard(
  {
    name: 'My A2A Agent',
    description: 'Agent with payments',
    version: '1.0.0',
    protocolVersion: '0.3.0',
    url: 'http://localhost:6000/a2a/',
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
  },
  {
    agentId: process.env.NVM_AGENT_ID!,
    planId: process.env.NVM_PLAN_ID!,
    credits: 5,
    paymentType: 'fixed',
  }
)

// Create executor
const executor = {
  async execute(context, eventBus) {
    // Publish working status
    eventBus.publish({
      kind: 'status-update',
      taskId: context.taskId,
      status: { state: 'working' },
      final: false,
    })

    // Do your work here...

    // Publish completion with credits used
    eventBus.publish({
      kind: 'status-update',
      taskId: context.taskId,
      status: { state: 'completed', message: { role: 'agent', parts: [{ kind: 'text', text: 'Done!' }] } },
      final: true,
      metadata: { creditsUsed: 5 },
    })
    eventBus.finished()
  },
  async cancelTask(taskId, eventBus) {
    // Handle cancellation
  },
}

// Start server
const { stop } = payments.a2a.start({
  agentCard,
  executor,
  port: 6000,
})
```

## HTTP Agent with Manual Verification

For custom HTTP endpoints with manual credit management:

```typescript
import express from 'express'
import { Payments, EnvironmentName } from '@nevermined-io/payments'

const app = express()
app.use(express.json())

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: process.env.NVM_ENVIRONMENT as EnvironmentName,
})


app.post('/api/task', async (req, res) => {
  const authHeader = req.headers.authorization
  const token = authHeader?.replace('Bearer ', '')

  // Missing or invalid token: return 402 with X402 payment header
  if (!token) {
    const paymentHeader = buildPaymentRequiredHeader(req, 'Authorization header is required')
    return res
      .status(402)
      .set('PAYMENT-REQUIRED', paymentHeader)
      .json({ error: 'Payment required' })
  }

  try {
    // Verify the subscriber has access
    const verifyResult = await payments.facilitator.verifyPermissions({
      planId: process.env.NVM_PLAN_ID!,
      agentId: process.env.NVM_AGENT_ID!,
      x402AccessToken: token,
      subscriberAddress: req.body.subscriberAddress,
      endpoint: req.originalUrl,
      httpVerb: req.method,
      maxAmount: 1n,
    })

    if (!verifyResult.success) {
      const paymentHeader = buildPaymentRequiredHeader(req, 'Insufficient credits or invalid token')
      return res
        .status(402)
        .set('PAYMENT-REQUIRED', paymentHeader)
        .json({ error: 'Payment required' })
    }

    // Execute your task
    const result = await doWork(req.body)

    // Burn credits after successful execution
    await payments.facilitator.settlePermissions({
      planId: process.env.NVM_PLAN_ID!,
      agentId: process.env.NVM_AGENT_ID!,
      x402AccessToken: token,
      subscriberAddress: req.body.subscriberAddress,
      endpoint: req.originalUrl,
      httpVerb: req.method,
      maxAmount: 1n,
    })

    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.listen(3000)
```

### X402 Payment Required Response

When payment is required, the server returns HTTP 402 with a `PAYMENT-REQUIRED` header containing a base64-encoded JSON payload:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Miw...
```

The decoded header contains payment instructions:

```json
{
  "x402Version": 2,
  "error": "Authorization header is required",
  "resource": {
    "url": "https://api.example.com/api/task",
    "description": "Access to protected API endpoint",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "amount": "10000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "version": "2" }
    }
  ]
}
```

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `NVM_API_KEY` | Nevermined API key from nevermined.app | Yes |
| `NVM_ENVIRONMENT` | `sandbox` or `live` | Yes |
| `NVM_AGENT_ID` | Registered agent DID | Yes |
| `NVM_PLAN_ID` | Associated payment plan ID | For A2A/HTTP |
| `PORT` | Server port | No (default varies) |

## Subscriber Access

Subscribers access your agent by:

1. Ordering your payment plan via `payments.plans.orderPlan(planId)`
2. Getting an access token via `payments.x402.getX402AccessToken(planId, agentId)`
3. Including the token in requests: `Authorization: Bearer <token>`

Example subscriber code:

```typescript
const payments = Payments.getInstance({ nvmApiKey: subscriberKey, environment: 'sandbox' })

// Order the plan (one-time)
await payments.plans.orderPlan(planId)

// Get access token
const { accessToken } = await payments.x402.getX402AccessToken(planId, agentId)

// Call the agent
const response = await fetch('http://agent-url/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'my-tool', arguments: { input: 'hello' } },
  }),
})
```
