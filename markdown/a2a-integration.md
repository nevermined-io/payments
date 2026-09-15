---
title: "A2A Integration"
description: "Enable agent-to-agent communication with payment-protected streaming and task execution"
icon: "share-nodes"
---

# A2A Integration

The Agent-to-Agent (A2A) protocol integration enables AI agents to communicate with each other using payment-protected message streams. The Nevermined Payments Library provides complete A2A server functionality with automatic payment handling.

## Overview of A2A Integration

The A2A integration provides:
- **Agent Card**: Payment metadata extension for discovery
- **Streaming Support**: Real-time task updates via Server-Sent Events
- **Task Management**: Async execution with status tracking
- **Credit Burning**: Automatic credit settlement after task completion
- **EventBus Pattern**: Clean event-driven architecture for task execution

## Build Payment Agent Card

The agent card is published at the canonical `/.well-known/agent-card.json` (A2A 0.3+), with the legacy `/.well-known/agent.json` kept as a backward-compat alias. It includes payment metadata. Before sending a paid request, **clients should fetch and validate the target agent's card** to confirm the expected `agentId`, the `capabilities`, and the supported X402 schemes — this protects against routing payment tokens to a typosquatted or unauthorised endpoint:

```typescript
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

const cardUrl = new URL('/.well-known/agent-card.json', agentUrl)
const card = await fetch(cardUrl, { method: 'GET' }).then((r) => r.json())

if (card.agentId !== expectedAgentId) {
  throw new Error(`Agent card mismatch: expected ${expectedAgentId}, got ${card.agentId}`)
}
if (cardUrl.protocol !== 'https:' && !LOOPBACK_HOSTS.has(cardUrl.hostname)) {
  console.warn(`Agent card fetched over ${cardUrl.protocol} — production traffic must use HTTPS.`)
}
```



```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// Build agent card with payment extension
const agentCard = Payments.a2a.buildPaymentAgentCard(
  {
    name: 'Weather AI Agent',
    description: 'Real-time weather forecasts and analysis',
    version: '1.0.0',
    protocolVersion: '0.3.0',
    url: 'http://localhost:6000/a2a/',
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
  },
  {
    agentId: process.env.NVM_AGENT_ID!,
    planId: process.env.NVM_PLAN_ID!,
    credits: 5,                      // Fixed credit cost
    paymentType: 'fixed',            // 'fixed' or 'dynamic'
    costDescription: '5 credits per request (optional)',
  }
)
```

## Payment Extension Structure

The agent card declares two extensions in `capabilities.extensions`: the Nevermined payment extension (pricing metadata) and the official a2a-x402 extension (`https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2`), which signals support for the standards-compliant in-band x402 v2 flow (see below). Both are emitted for one release; `urn:nevermined:payment` will be dropped once clients migrate to v0.2 only.

```json
{
  "capabilities": {
    "streaming": true,
    "extensions": [
      {
        "uri": "urn:nevermined:payment",
        "required": false,
        "params": {
          "paymentType": "fixed",
          "credits": 5,
          "agentId": "did:nv:agent-123",
          "planId": "plan-456",
          "costDescription": "5 credits per request"
        }
      },
      {
        "uri": "https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2",
        "required": false
      }
    ]
  }
}
```

## x402 v2 In-Band Payments (Standards Flow)

Payment is signalled **in band** following the [Coinbase x402 v2 A2A transport spec](https://github.com/coinbase/x402/blob/main/specs/transports-v2/a2a.md) and the official [a2a-x402 extension](https://github.com/google-agentic-commerce/a2a-x402). No HTTP 402 is involved — the whole handshake rides on A2A task/message metadata, correlated by `taskId`. This is automatic when you use `payments.a2a.start`; nothing changes in your executor.

Lifecycle:

1. **Payment required** — a payment-gated `message/send` arrives with no payment. The server returns a Task with `status.state = "input-required"` and `status.message.metadata`:

   ```json
   {
     "x402.payment.status": "payment-required",
     "x402.payment.required": { /* X402PaymentRequired (accepts[] of plans) */ }
   }
   ```

2. **Payment submitted** — the client sends a follow-up `message/send` whose `message.metadata` carries the payload, correlated via `message.taskId`:

   ```json
   {
     "x402.payment.status": "payment-submitted",
     "x402.payment.payload": { /* PaymentPayload */ }
   }
   ```

3. **Completed / failed** — on success the final Task carries `x402.payment.status: "payment-completed"` plus `x402.payment.receipts` (array of settle receipts). On failure it is `failed` / `x402.payment.status: "payment-failed"` with the error under `x402.payment.error`, and paid content is suppressed.

Metadata keys: `x402.payment.status`, `x402.payment.required`, `x402.payment.payload`, `x402.payment.receipts`, `x402.payment.error`.

> **Batch (deferred) settlement.** If the server settles credits in batch, a successful call returns `x402.payment.status: "payment-verified"` (not `payment-completed`) plus the Nevermined marker `x402.payment.settlement: "deferred"` — the payment was verified but settled out-of-band, so there is no in-band receipt. Spec-only clients ignore the unknown key.

> ⚠️ **Header flow deprecated.** The legacy `payment-signature` HTTP header still works but is now a **deprecated fallback, kept for one release**. New integrations should rely on the in-band metadata flow above.

## Implement Executor

The executor contains your agent's business logic and emits events via the EventBus:

```typescript
const executor = {
  async execute(context, eventBus) {
    const taskId = context.task?.id

    // Emit working status
    eventBus.publish({
      kind: 'status-update',
      taskId,
      status: { state: 'working' },
      final: false,
    })

    try {
      // Process the task
      const userMessage = context.history?.[0]
      const prompt = userMessage?.parts?.find(p => p.kind === 'text')?.text

      const result = await processPrompt(prompt)

      // Emit completion with credits used
      eventBus.publish({
        kind: 'status-update',
        taskId,
        status: {
          state: 'completed',
          message: {
            role: 'agent',
            parts: [{ kind: 'text', text: result }],
          },
        },
        final: true,
        metadata: { creditsUsed: 5 },  // Report credits consumed
      })

    } catch (error) {
      // Emit failure
      eventBus.publish({
        kind: 'status-update',
        taskId,
        status: {
          state: 'failed',
          message: {
            role: 'agent',
            parts: [{ kind: 'text', text: `Error: ${error.message}` }],
          },
        },
        final: true,
      })
    }

    // Signal completion
    eventBus.finished()
  },

  async cancelTask(taskId, eventBus) {
    // Handle task cancellation
    eventBus.publish({
      kind: 'status-update',
      taskId,
      status: { state: 'canceled' },
      final: true,
    })
    eventBus.finished()
  },
}
```

## EventBus Events

The executor communicates via event publishing:

### Task Event

```typescript
eventBus.publish({
  kind: 'task',
  id: taskId,
  contextId: contextId,
  status: { state: 'working' },
  history: [userMessage],
})
```

### Status Update Event

```typescript
eventBus.publish({
  kind: 'status-update',
  taskId,
  status: {
    state: 'completed',  // or 'working', 'failed', 'canceled'
    message: {
      role: 'agent',
      parts: [{ kind: 'text', text: 'Result here' }],
    },
  },
  final: true,           // Set true when task is done
  metadata: {
    creditsUsed: 5,      // Required for credit settlement
  },
})
```

### Message Event (Streaming)

```typescript
eventBus.publish({
  kind: 'message',
  messageId: generateId(),
  role: 'agent',
  parts: [{ kind: 'text', text: 'Partial result...' }],
})
```

### Signal Completion

```typescript
eventBus.finished()  // Must call when done
```

## Start A2A Server

Start the complete A2A server with payment integration:

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// Build agent card
const agentCard = Payments.a2a.buildPaymentAgentCard(
  {
    name: 'Weather Agent',
    description: 'Weather forecasts and analysis',
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

// Define executor
const executor = {
  async execute(context, eventBus) {
    const taskId = context.task?.id

    eventBus.publish({
      kind: 'status-update',
      taskId,
      status: { state: 'working' },
      final: false,
    })

    // Your logic here
    const result = await processTask(context)

    eventBus.publish({
      kind: 'status-update',
      taskId,
      status: {
        state: 'completed',
        message: { role: 'agent', parts: [{ kind: 'text', text: result }] },
      },
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
const { server, close } = await payments.a2a.start({
  agentCard,
  executor,
  port: 6000,
  basePath: '/a2a/',
  exposeAgentCard: true,        // Expose /.well-known/agent-card.json (+ legacy /.well-known/agent.json alias)
  exposeDefaultRoutes: true,    // Expose health and info routes
})

console.log('A2A Server running on port 6000')

// Graceful shutdown
process.on('SIGINT', async () => {
  await close()
  console.log('Server stopped')
  process.exit(0)
})
```

> 🔐 **Run behind a reverse proxy with HTTPS in production.** A2A peers exchange paid tokens — in band via `x402.payment.payload`, or over the deprecated `payment-signature` header — so never expose the raw server on a public hostname without TLS. Bind the dev server to `127.0.0.1` (e.g. by running it inside a container with no published port, or behind a localhost-bound proxy).

## Credit Reporting

The executor reports credits used in the final status update:

### Fixed Credits

```typescript
eventBus.publish({
  kind: 'status-update',
  taskId,
  status: { state: 'completed', message: {...} },
  final: true,
  metadata: { creditsUsed: 5 },  // Always 5 credits
})
```

### Dynamic Credits

Calculate credits based on actual usage:

```typescript
async execute(context, eventBus) {
  const taskId = context.task?.id

  // Execute task
  const result = await processTask(context)

  // Calculate credits based on result
  const creditsUsed = calculateCredits(result)

  eventBus.publish({
    kind: 'status-update',
    taskId,
    status: { state: 'completed', message: {...} },
    final: true,
    metadata: { creditsUsed },  // Variable credits
  })

  eventBus.finished()
}

function calculateCredits(result: string): number {
  // Example: charge based on response length
  return Math.ceil(result.length / 1000)  // 1 credit per KB
}
```

## Streaming Example

For long-running tasks, stream partial results:

```typescript
const executor = {
  async execute(context, eventBus) {
    const taskId = context.task?.id

    eventBus.publish({
      kind: 'status-update',
      taskId,
      status: { state: 'working' },
      final: false,
    })

    // Stream partial results
    const chunks = await processInChunks(context)
    for (const chunk of chunks) {
      eventBus.publish({
        kind: 'message',
        messageId: generateId(),
        role: 'agent',
        parts: [{ kind: 'text', text: chunk }],
      })
    }

    // Final result
    eventBus.publish({
      kind: 'status-update',
      taskId,
      status: {
        state: 'completed',
        message: { role: 'agent', parts: [{ kind: 'text', text: 'Done!' }] },
      },
      final: true,
      metadata: { creditsUsed: 5 },
    })

    eventBus.finished()
  },
}
```

## Complete Example: Weather A2A Agent

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// Build agent card
const agentCard = Payments.a2a.buildPaymentAgentCard(
  {
    name: 'Weather Forecast Agent',
    description: 'Get weather forecasts for any location',
    version: '1.0.0',
    protocolVersion: '0.3.0',
    url: 'http://localhost:6000/a2a/',
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
      {
        name: 'weather_forecast',
        description: 'Get weather forecast',
      },
    ],
  },
  {
    agentId: process.env.NVM_AGENT_ID!,
    planId: process.env.NVM_PLAN_ID!,
    credits: 3,
    paymentType: 'fixed',
    costDescription: '3 credits per forecast request',
  }
)

// Implement executor
const executor = {
  async execute(context, eventBus) {
    const taskId = context.task?.id

    // Extract user message
    const userMessage = context.history?.[0]
    const prompt = userMessage?.parts?.find(p => p.kind === 'text')?.text

    if (!prompt) {
      eventBus.publish({
        kind: 'status-update',
        taskId,
        status: {
          state: 'failed',
          message: {
            role: 'agent',
            parts: [{ kind: 'text', text: 'No prompt provided' }],
          },
        },
        final: true,
      })
      eventBus.finished()
      return
    }

    // Emit working status
    eventBus.publish({
      kind: 'status-update',
      taskId,
      status: { state: 'working' },
      final: false,
    })

    try {
      // Process weather request
      const city = extractCity(prompt)
      const forecast = await getWeatherForecast(city)

      // Emit completion
      eventBus.publish({
        kind: 'status-update',
        taskId,
        status: {
          state: 'completed',
          message: {
            role: 'agent',
            parts: [{ kind: 'text', text: formatForecast(forecast) }],
          },
        },
        final: true,
        metadata: { creditsUsed: 3 },
      })

    } catch (error) {
      eventBus.publish({
        kind: 'status-update',
        taskId,
        status: {
          state: 'failed',
          message: {
            role: 'agent',
            parts: [{ kind: 'text', text: `Error: ${error.message}` }],
          },
        },
        final: true,
      })
    }

    eventBus.finished()
  },

  async cancelTask(taskId, eventBus) {
    eventBus.publish({
      kind: 'status-update',
      taskId,
      status: { state: 'canceled' },
      final: true,
    })
    eventBus.finished()
  },
}

// Start server
const { server, close } = await payments.a2a.start({
  agentCard,
  executor,
  port: 6000,
  basePath: '/a2a/',
})

console.log('Weather A2A Agent running on http://localhost:6000/a2a/')
console.log('Agent card: http://localhost:6000/a2a/.well-known/agent-card.json')

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...')
  await close()
  process.exit(0)
})

// Helper functions
function extractCity(prompt: string): string {
  // Simple extraction logic
  const match = prompt.match(/weather (?:in|for) (.+)/i)
  return match?.[1] || 'San Francisco'
}

async function getWeatherForecast(city: string) {
  // Mock weather API call
  return {
    city,
    temperature: 72,
    condition: 'Sunny',
    forecast: ['Mon: 70°F', 'Tue: 68°F', 'Wed: 73°F'],
  }
}

function formatForecast(forecast: any): string {
  return `Weather in ${forecast.city}:
Current: ${forecast.temperature}°F, ${forecast.condition}
Forecast: ${forecast.forecast.join(', ')}`
}
```

## Server Configuration Options

```typescript
const { server, close } = await payments.a2a.start({
  agentCard,                      // Payment agent card (required)
  executor,                       // Task executor (required)
  port: 6000,                     // Server port (required)
  basePath: '/a2a/',              // Base path (optional, default: '/')
  exposeAgentCard: true,          // Expose /.well-known/agent-card.json + legacy alias (optional)
  exposeDefaultRoutes: true,      // Expose /health, /info (optional)
  paymentsService: payments,      // Custom payments instance (optional)
  handlerOptions: {
    asyncExecution: false,        // Async task execution (optional)
    defaultBatch: false,          // Batch credit settlement (optional)
    defaultMarginPercent: 5,      // Add 5% margin to credits (optional)
  },
})
```

## Best Practices

1. **Always Report Credits**: Include `creditsUsed` in final status updates
2. **Handle Errors**: Emit 'failed' status on errors
3. **Signal Completion**: Always call `eventBus.finished()`
4. **Streaming for Long Tasks**: Use message events for real-time updates
5. **Graceful Shutdown**: Implement proper server cleanup
6. **Descriptive Agent Cards**: Provide clear descriptions and skills
7. **Version Control**: Include version in agent card metadata

## Related Documentation

- [Agents](./agents) - Register your A2A agent in Nevermined
- [Payment Plans](./payment-plans) - Configure pricing for your agent
- [Validation of Requests](./validation-of-requests) - Understanding credit settlement

---

**Source References**:
- `RUN.md` (A2A Server section, lines 88-156)
- `src/a2a/server.ts` (PaymentsA2AServer)
- `src/a2a/agent-card.ts` (buildPaymentAgentCard)
- `tests/integration/a2a/complete-message-send-flow.test.ts` (executor patterns)
- `tests/e2e/helpers/a2a-setup-helpers.ts` (setup examples)
