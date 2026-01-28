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

The agent card is published at `/.well-known/agent.json` and includes payment metadata:

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// Build agent card with payment extension
const agentCard = payments.a2a.buildPaymentAgentCard(
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

The agent card includes a Nevermined payment extension in `capabilities.extensions`:

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
      }
    ]
  }
}
```

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
const agentCard = payments.a2a.buildPaymentAgentCard(
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
  exposeAgentCard: true,        // Expose /.well-known/agent.json
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
const agentCard = payments.a2a.buildPaymentAgentCard(
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
console.log('Agent card: http://localhost:6000/a2a/.well-known/agent.json')

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
  exposeAgentCard: true,          // Expose /.well-known/agent.json (optional)
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

- [Agents](agents.md) - Register your A2A agent in Nevermined
- [Payment Plans](payment-plans.md) - Configure pricing for your agent
- [Validation of Requests](validation-of-requests.md) - Understanding credit settlement

---

**Source References**:
- `RUN.md` (A2A Server section, lines 88-156)
- `src/a2a/server.ts` (PaymentsA2AServer)
- `src/a2a/agent-card.ts` (buildPaymentAgentCard)
- `tests/integration/a2a/complete-message-send-flow.test.ts` (executor patterns)
- `tests/e2e/helpers/a2a-setup-helpers.ts` (setup examples)
