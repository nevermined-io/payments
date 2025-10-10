/**
 * @file A2A messaging integration tests (blocking & non-blocking with credits)
 */

import http from 'http'
import { v4 as uuidv4 } from 'uuid'
import { Payments } from '../../../src/payments.js'
import type { AgentCard } from '../../../src/a2a/types.js'
import type { AgentExecutor } from '../../../src/a2a/types.js'
import type { EnvironmentName } from '../../../src/environments.js'
import type { Address } from '../../../src/common/types.js'
import { getERC20PriceConfig, getFixedCreditsConfig } from '../../../src/plans.js'
import { retryOperation } from '../../utils/retry-operation.js'

const MSG_TEST_CONFIG = {
  TIMEOUT: 60_000,
  PORT: parseInt(process.env.PORT || '41253'),
  BASE_PATH: '/a2a/',
  ENVIRONMENT: (process.env.TESTING_ENVIRONMENT || 'staging_sandbox') as EnvironmentName,
  ERC20_ADDRESS: (process.env.ERC20_ADDRESS ||
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
}

/**
 * Simple wait utility.
 */
async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Polls a condition until it returns non-null or timeout expires.
 */
async function pollForCondition<T>(
  fn: () => Promise<T | null>,
  maxAttempts = 30,
  intervalMs = 1000,
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await fn()
    if (result !== null) return result
    await wait(intervalMs)
  }
  throw new Error('Condition not met within timeout')
}

/**
 * Creates an executor that simulates processing and completes with a success message.
 */
function createMessagingExecutor(): AgentExecutor {
  return {
    execute: async (requestContext, eventBus) => {
      const taskId = requestContext.taskId
      const contextId = requestContext.userMessage.contextId || uuidv4()

      // Initial task (if not provided)
      if (!requestContext.task) {
        eventBus.publish({
          kind: 'task',
          id: taskId,
          contextId,
          status: { state: 'submitted', timestamp: new Date().toISOString() },
          history: [requestContext.userMessage],
          metadata: requestContext.userMessage.metadata,
        })
      }

      // Working update
      eventBus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'working',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: 'Processing your request...' }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: false,
      })

      await wait(100)

      // Final success
      eventBus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'completed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: 'Request completed successfully!' }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        metadata: { creditsUsed: 10 },
        final: true,
      })

      eventBus.finished()
    },
    cancelTask: async () => {},
  }
}

/**
 * Context to manage full lifecycle for messaging tests (plan, agent, server, token).
 */
class A2AMessagesTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server!: http.Server
  public agentCard!: AgentCard
  public planId!: string
  public agentId!: string
  public accessToken!: string
  // logging removed

  async setup(): Promise<void> {
    this.builder = Payments.getInstance({
      nvmApiKey: process.env.TEST_BUILDER_API_KEY || '',
      environment: MSG_TEST_CONFIG.ENVIRONMENT,
    })

    this.subscriber = Payments.getInstance({
      nvmApiKey: process.env.TEST_SUBSCRIBER_API_KEY || '',
      environment: MSG_TEST_CONFIG.ENVIRONMENT,
    })

    await this.registerPlan()
    await this.registerAgent()
    await this.startServer()
    await this.orderAndToken()
  }

  async teardown(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server.close(() => resolve()))
    }
    // logging removed
  }

  private async registerPlan(): Promise<void> {
    const nonce = Date.now()
    const account = this.builder.getAccountAddress() as Address
    const price = getERC20PriceConfig(1n, MSG_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = getFixedCreditsConfig(200n, 10n)
    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `A2A Messages Test Plan ${nonce}` },
        price,
        credits,
      ),
    )
    if (!resp.planId) throw new Error('No planId')
    this.planId = resp.planId
  }

  private async registerAgent(): Promise<void> {
    const baseCard: AgentCard = {
      name: 'A2A Messages Test Agent',
      description: 'Agent for messages tests',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${MSG_TEST_CONFIG.PORT}`,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }

    const agentApi = {
      endpoints: [{ POST: `http://localhost:${MSG_TEST_CONFIG.PORT}${MSG_TEST_CONFIG.BASE_PATH}` }],
    }
    const agentResp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: `A2A Messages Test Agent ${Date.now()}`,
          description: 'messages',
          tags: ['test'],
          dateCreated: new Date(),
        },
        agentApi,
        [this.planId],
      ),
    )
    if (!agentResp.agentId) throw new Error('No agentId')
    this.agentId = agentResp.agentId

    const paymentMetadata = {
      paymentType: 'fixed' as const,
      credits: 10,
      costDescription: 'messages test',
      agentId: this.agentId,
    }
    this.agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
  }

  private async startServer(): Promise<void> {
    const result = this.builder.a2a.start({
      agentCard: this.agentCard,
      executor: createMessagingExecutor(),
      port: MSG_TEST_CONFIG.PORT,
      basePath: MSG_TEST_CONFIG.BASE_PATH,
      exposeAgentCard: true,
      exposeDefaultRoutes: true,
    })
    this.server = result.server

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10_000)
      this.server.on('listening', () => {
        clearTimeout(timeout)
        // logging removed
        resolve()
      })
      this.server.on('error', (err) => {
        clearTimeout(timeout)
        // logging removed
        reject(err)
      })
    })
  }

  private async orderAndToken(): Promise<void> {
    const order = await retryOperation(() => this.subscriber.plans.orderPlan(this.planId))
    if (!order.success) throw new Error('Plan order failed')
    const tokenResp = await retryOperation(() =>
      this.subscriber.agents.getAgentAccessToken(this.planId, this.agentId),
    )
    if (!tokenResp.accessToken) throw new Error('No accessToken')
    this.accessToken = tokenResp.accessToken
  }

  /**
   * Returns current plan balance as bigint.
   */
  async getPlanBalance(): Promise<bigint> {
    const balanceResult = await this.subscriber.plans.getPlanBalance(this.planId)
    return BigInt(balanceResult.balance)
  }

  /**
   * Validates credits burned by polling until delta is observed or timeout.
   */
  async validateCreditsBurned(initial: bigint, expected: bigint = 10n): Promise<void> {
    const final = await pollForCondition<bigint>(
      async () => {
        const current = await this.getPlanBalance()
        return current <= initial - expected ? current : null
      },
      20,
      500,
    )
    const burned = initial - final
    expect(burned).toBe(expected)
  }

  /**
   * Sends a message via JSON-RPC and returns the parsed result.
   */
  async sendMessage(messageText: string, configuration?: any): Promise<any> {
    // logging removed
    const message = {
      kind: 'message' as const,
      messageId: uuidv4(),
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text: messageText }],
    }
    const resp = await fetch(
      `http://localhost:${MSG_TEST_CONFIG.PORT}${MSG_TEST_CONFIG.BASE_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: { ...(configuration && { configuration }), message },
        }),
      },
    )
    expect(resp.ok).toBe(true)
    // logging removed
    const result = await resp.json()
    // logging removed
    return result
  }

  /**
   * Polls the task status until completed and returns the final task.
   */
  async pollForTaskCompletion(taskId: string): Promise<any> {
    return pollForCondition(
      async () => {
        const resp = await fetch(
          `http://localhost:${MSG_TEST_CONFIG.PORT}${MSG_TEST_CONFIG.BASE_PATH}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.accessToken}`,
            },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'tasks/get', params: { id: taskId } }),
          },
        )
        if (!resp.ok) return null
        const json = await resp.json()
        return json.result?.status?.state === 'completed' ? json.result : null
      },
      20,
      500,
    )
  }
}

describe('A2A Messages (blocking & non-blocking)', () => {
  let ctx: A2AMessagesTestContext

  beforeAll(async () => {
    ctx = new A2AMessagesTestContext()
    await ctx.setup()
  }, MSG_TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await ctx.teardown()
  }, MSG_TEST_CONFIG.TIMEOUT)

  it('should handle blocking requests with credit validation', async () => {
    const initial = await ctx.getPlanBalance()
    const result = await ctx.sendMessage('Blocking message', { blocking: true })
    expect(result?.result?.status?.state).toBe('completed')
    await ctx.validateCreditsBurned(initial, 10n)
  })

  it('should handle non-blocking requests with immediate response and polling', async () => {
    const initial = await ctx.getPlanBalance()
    const result = await ctx.sendMessage('Non-blocking message', { blocking: false })
    expect(result?.result?.status?.state).toBe('submitted')
    const taskId = result.result.id
    const finalTask = await ctx.pollForTaskCompletion(taskId)
    expect(finalTask.status.state).toBe('completed')
    expect(finalTask.status.message.role).toBe('agent')
    expect(finalTask.status.message.parts?.[0]?.text).toBe('Request completed successfully!')
    await ctx.validateCreditsBurned(initial, 10n)
  })
})
