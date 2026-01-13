# Testing Applications with Nevermined Payments

This guide covers how to test applications that integrate with the Nevermined Payments Library.

## Environment Setup

Create a `.env` file with your test credentials:

```bash
export NVM_API_KEY="your-api-key"
export NVM_ENVIRONMENT="sandbox" # or "live", for Production Environment
export NVM_AGENT_ID="your-agent-id"
export NVM_PLAN_ID="your-plan-id"
```

Use the `sandbox` environment for all testing. Get API keys from [Nevermined App](https://nevermined.app).

For testing payment flows, you need two accounts:
- **Builder account**: Creates plans and agents
- **Subscriber account**: Purchases plans and accesses agents

## Testing Patterns

### Retry with Backoff

Blockchain operations may take time to sync. Use exponential backoff for reliability:

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<T> {
  const { attempts = 5, baseDelayMs = 500, maxDelayMs = 8000 } = options

  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (error) {
      if (i === attempts) throw error
      const delay = Math.min(baseDelayMs * Math.pow(2, i - 1), maxDelayMs)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw new Error('Retry failed')
}

// Usage
const { planId } = await retryWithBackoff(() =>
  payments.plans.registerCreditsPlan(metadata, priceConfig, creditsConfig)
)
```

### Wait for Condition

Poll until a condition is met (useful for balance updates):

```typescript
async function waitForCondition(
  fn: () => Promise<boolean>,
  timeoutMs = 60000,
  intervalMs = 2000
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('Condition not met within timeout')
}

// Usage: Wait for credits to be available
await waitForCondition(async () => {
  const balance = await payments.plans.getPlanBalance(planId)
  return BigInt(balance.balance) > 0n
})
```

## Testing Plan and Agent Registration

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

describe('Plan Registration', () => {
  let payments: Payments

  beforeAll(() => {
    payments = Payments.getInstance({
      nvmApiKey: process.env.NVM_API_KEY!,
      environment: process.env.NVM_ENVIRONMENT as EnvironmentName,
    })
  })

  test('should register a credits plan', async () => {
    const builderAddress = payments.getAccountAddress()!

    const priceConfig = payments.plans.getFreePriceConfig()
    const creditsConfig = payments.plans.getFixedCreditsConfig(100n)

    const { planId } = await retryWithBackoff(() =>
      payments.plans.registerCreditsPlan(
        { name: `Test Plan ${Date.now()}` },
        priceConfig,
        creditsConfig
      )
    )

    expect(planId).toBeDefined()

    // Verify plan is retrievable
    const plan = await payments.plans.getPlan(planId)
    expect(plan.id).toBe(planId)
  }, 30000)

  test('should register an agent with plan', async () => {
    const { agentId } = await retryWithBackoff(() =>
      payments.agents.registerAgent(
        { name: `Test Agent ${Date.now()}`, tags: ['test'] },
        { endpoints: [{ POST: 'http://localhost:3000/api' }] },
        [existingPlanId]
      )
    )

    expect(agentId).toBeDefined()
  }, 30000)
})
```

## Testing the Payment Flow

```typescript
describe('Payment Flow', () => {
  let builderPayments: Payments
  let subscriberPayments: Payments

  beforeAll(() => {
    builderPayments = Payments.getInstance({
      nvmApiKey: process.env.BUILDER_API_KEY!,
      environment: 'sandbox',
    })
    subscriberPayments = Payments.getInstance({
      nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
      environment: 'sandbox',
    })
  })

  test('subscriber can order plan and get credits', async () => {
    const planId = process.env.NVM_PLAN_ID!

    // Order the plan
    const orderResult = await retryWithBackoff(() =>
      subscriberPayments.plans.orderPlan(planId)
    )
    expect(orderResult.success).toBe(true)

    // Wait for credits
    await waitForCondition(async () => {
      const balance = await subscriberPayments.plans.getPlanBalance(planId)
      return BigInt(balance.balance) > 0n
    })

    const balance = await subscriberPayments.plans.getPlanBalance(planId)
    expect(BigInt(balance.balance)).toBeGreaterThan(0n)
  }, 60000)

  test('subscriber can get access token', async () => {
    const { accessToken } = await subscriberPayments.x402.getX402AccessToken(
      process.env.NVM_PLAN_ID!,
      process.env.NVM_AGENT_ID!
    )

    expect(accessToken).toBeDefined()
    expect(accessToken.length).toBeGreaterThan(0)
  })
})
```

## Testing X402 Token Verification

Test that your agent correctly verifies and settles permissions:

```typescript
describe('X402 Token Flow', () => {
  let agentPayments: Payments
  let subscriberPayments: Payments
  let accessToken: string

  beforeAll(async () => {
    agentPayments = Payments.getInstance({
      nvmApiKey: process.env.BUILDER_API_KEY!,
      environment: 'sandbox',
    })
    subscriberPayments = Payments.getInstance({
      nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
      environment: 'sandbox',
    })

    // Get access token as subscriber
    const result = await subscriberPayments.x402.getX402AccessToken(
      process.env.NVM_PLAN_ID!,
      process.env.NVM_AGENT_ID!
    )
    accessToken = result.accessToken
  })

  test('should verify valid token', async () => {
    const result = await agentPayments.facilitator.verifyPermissions({
      planId: process.env.NVM_PLAN_ID!,
      agentId: process.env.NVM_AGENT_ID!,
      x402AccessToken: accessToken,
      subscriberAddress: subscriberPayments.getAccountAddress()!,
      endpoint: 'http://localhost:3000/api/task',
      httpVerb: 'POST',
      maxAmount: 1n,
    })

    expect(result.success).toBe(true)
  })

  test('should reject invalid token', async () => {
    await expect(
      agentPayments.facilitator.verifyPermissions({
        planId: process.env.NVM_PLAN_ID!,
        agentId: process.env.NVM_AGENT_ID!,
        x402AccessToken: 'invalid-token',
        subscriberAddress: subscriberPayments.getAccountAddress()!,
        endpoint: 'http://localhost:3000/api/task',
        httpVerb: 'POST',
        maxAmount: 1n,
      })
    ).rejects.toThrow()
  })

  test('should settle and burn credits', async () => {
    // Get balance before
    const balanceBefore = await subscriberPayments.plans.getPlanBalance(
      process.env.NVM_PLAN_ID!
    )

    // Settle permissions (burn credits)
    const settleResult = await agentPayments.facilitator.settlePermissions({
      planId: process.env.NVM_PLAN_ID!,
      agentId: process.env.NVM_AGENT_ID!,
      x402AccessToken: accessToken,
      subscriberAddress: subscriberPayments.getAccountAddress()!,
      endpoint: 'http://localhost:3000/api/task',
      httpVerb: 'POST',
      maxAmount: 1n,
    })

    expect(settleResult.success).toBe(true)

    // Verify credits were burned
    await waitForCondition(async () => {
      const balanceAfter = await subscriberPayments.plans.getPlanBalance(
        process.env.NVM_PLAN_ID!
      )
      return BigInt(balanceAfter.balance) < BigInt(balanceBefore.balance)
    })
  }, 30000)
})
```

## Testing MCP Server Endpoints

```typescript
describe('MCP Server Integration', () => {
  let serverUrl: string
  let accessToken: string

  beforeAll(async () => {
    serverUrl = process.env.MCP_SERVER_URL || 'http://localhost:3000'

    const payments = Payments.getInstance({
      nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
      environment: 'sandbox',
    })
    const result = await payments.x402.getX402AccessToken(
      process.env.NVM_PLAN_ID!,
      process.env.NVM_AGENT_ID!
    )
    accessToken = result.accessToken
  })

  test('should reject unauthenticated requests', async () => {
    const response = await fetch(`${serverUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'my-tool', arguments: {} },
      }),
    })

    expect(response.status).toBe(402)
  })

  test('should accept authenticated requests', async () => {
    const response = await fetch(`${serverUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.result.tools).toBeDefined()
  })

  test('should expose OAuth discovery endpoints', async () => {
    const response = await fetch(`${serverUrl}/.well-known/oauth-protected-resource`)

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.scopes_supported).toContain('mcp:tools')
  })
})
```

## Mocking for Unit Tests

For unit tests that shouldn't hit the real API, mock the Payments instance:

```typescript
// Mock setup
const mockPayments = {
  plans: {
    getPlanBalance: jest.fn().mockResolvedValue({ balance: '100', isSubscriber: true }),
    orderPlan: jest.fn().mockResolvedValue({ success: true }),
  },
  facilitator: {
    verifyPermissions: jest.fn().mockResolvedValue({ success: true }),
    settlePermissions: jest.fn().mockResolvedValue({ success: true, data: { creditsBurned: '1' } }),
  },
  x402: {
    getX402AccessToken: jest.fn().mockResolvedValue({ accessToken: 'mock-token' }),
  },
  getAccountAddress: jest.fn().mockReturnValue('0x1234...'),
}

// In your tests
jest.mock('@nevermined-io/payments', () => ({
  Payments: {
    getInstance: () => mockPayments,
  },
}))

describe('My Application', () => {
  test('should handle successful payment flow', async () => {
    const result = await myAppFunction()

    expect(mockPayments.facilitator.verifyPermissions).toHaveBeenCalled()
    expect(result).toBeDefined()
  })
})
```

## Best Practices

1. **Use sandbox environment** for all tests to avoid real charges
2. **Implement retry logic** for blockchain-dependent operations
3. **Use unique names** with timestamps to avoid conflicts
4. **Clean up test resources** when possible
5. **Set appropriate timeouts** (30-60s for API operations)
6. **Test both success and failure paths** for payment verification
