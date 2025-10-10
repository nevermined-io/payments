/**
 * @file A2A push notifications error cases integration tests
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

/**
 * Basic configuration for the push errors suite
 */
const PUSH_ERR_TEST_CONFIG = {
  TIMEOUT: 60_000,
  PORT: parseInt(process.env.PORT || '41256'),
  BASE_PATH: '/a2a/',
  ENVIRONMENT: (process.env.TESTING_ENVIRONMENT || 'staging_sandbox') as EnvironmentName,
  ERC20_ADDRESS: (process.env.ERC20_ADDRESS ||
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
}

/**
 * Creates an executor that publishes a simple submitted->completed flow.
 * Used only to ensure routes exist; tests focus on error responses of push endpoints.
 */
function createMinimalExecutor(): AgentExecutor {
  return {
    execute: async (requestContext, eventBus) => {
      const taskId = requestContext.taskId
      const contextId = requestContext.userMessage.contextId || uuidv4()
      eventBus.publish({
        kind: 'task',
        id: taskId,
        contextId,
        status: { state: 'submitted', timestamp: new Date().toISOString() },
        history: [requestContext.userMessage],
        metadata: requestContext.userMessage.metadata,
      })
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
            parts: [{ kind: 'text', text: 'Completed' }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
        metadata: { creditsUsed: 10 },
      })
      eventBus.finished()
    },
    cancelTask: async () => {},
  }
}

/**
 * Test context that encapsulates registration, server lifecycle and token management.
 */
class A2APushErrorsTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server!: http.Server
  public agentCard!: AgentCard
  public planId!: string
  public agentId!: string
  public accessToken!: string

  /**
   * Initialize clients, register plan/agent, start server and get access token.
   */
  async setup(): Promise<void> {
    this.builder = Payments.getInstance({
      nvmApiKey: process.env.TEST_BUILDER_API_KEY || '',
      environment: PUSH_ERR_TEST_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: process.env.TEST_SUBSCRIBER_API_KEY || '',
      environment: PUSH_ERR_TEST_CONFIG.ENVIRONMENT,
    })

    await this.registerPlan()
    await this.registerAgent()
    await this.startServer()
    await this.orderAndToken()
  }

  /**
   * Stop the HTTP server.
   */
  async teardown(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server.close(() => resolve()))
    }
  }

  /**
   * Register a credits plan with nonce for uniqueness.
   */
  private async registerPlan(): Promise<void> {
    const nonce = Date.now()
    const account = this.builder.getAccountAddress() as Address
    const price = getERC20PriceConfig(1n, PUSH_ERR_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = getFixedCreditsConfig(200n, 10n)
    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `A2A Push Errors Plan ${nonce}` },
        price,
        credits,
      ),
    )
    if (!resp.planId) throw new Error('No planId')
    this.planId = resp.planId
  }

  /**
   * Register an agent with push capabilities and attach payment metadata.
   */
  private async registerAgent(): Promise<void> {
    const baseCard: AgentCard = {
      name: `A2A Push Errors Agent ${Date.now()}`,
      description: 'Agent for push error tests',
      capabilities: { streaming: false, pushNotifications: true, stateTransitionHistory: true },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${PUSH_ERR_TEST_CONFIG.PORT}`,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }
    const agentApi = {
      endpoints: [
        { POST: `http://localhost:${PUSH_ERR_TEST_CONFIG.PORT}${PUSH_ERR_TEST_CONFIG.BASE_PATH}` },
      ],
    }
    const resp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: `A2A Push Errors Agent ${Date.now()}`,
          description: 'push-errors',
          tags: ['test'],
          dateCreated: new Date(),
        },
        agentApi,
        [this.planId],
      ),
    )
    if (!resp.agentId) throw new Error('No agentId')
    this.agentId = resp.agentId

    const paymentMetadata = {
      paymentType: 'fixed' as const,
      credits: 10,
      costDescription: 'push errors',
      agentId: this.agentId,
    }
    this.agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
  }

  /**
   * Start the A2A server with default routes and agent card exposure.
   */
  private async startServer(): Promise<void> {
    const result = this.builder.a2a.start({
      agentCard: this.agentCard,
      executor: createMinimalExecutor(),
      port: PUSH_ERR_TEST_CONFIG.PORT,
      basePath: PUSH_ERR_TEST_CONFIG.BASE_PATH,
      exposeAgentCard: true,
      exposeDefaultRoutes: true,
    })
    this.server = result.server

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10_000)
      this.server.on('listening', () => {
        clearTimeout(timeout)
        resolve()
      })
      this.server.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  /**
   * Order the plan and obtain an access token for the agent.
   */
  private async orderAndToken(): Promise<void> {
    const order = await retryOperation(() => this.subscriber.plans.orderPlan(this.planId))
    if (!order.success) throw new Error('Plan order failed')
    const token = await retryOperation(() =>
      this.subscriber.agents.getAgentAccessToken(this.planId, this.agentId),
    )
    if (!token.accessToken) throw new Error('No accessToken')
    this.accessToken = token.accessToken
  }
}

describe('A2A Push Notifications - Error cases', () => {
  let ctx: A2APushErrorsTestContext

  beforeAll(async () => {
    ctx = new A2APushErrorsTestContext()
    await ctx.setup()
  }, PUSH_ERR_TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await ctx.teardown()
  }, PUSH_ERR_TEST_CONFIG.TIMEOUT)

  it('should return error when setting push config for non-existent task', async () => {
    const nonExistentTaskId = uuidv4()
    const response = await fetch(
      `http://localhost:${PUSH_ERR_TEST_CONFIG.PORT}${PUSH_ERR_TEST_CONFIG.BASE_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/set',
          params: {
            taskId: nonExistentTaskId,
            pushNotificationConfig: {
              url: `http://localhost:4009/webhook`,
              token: 'push-errors-token',
              authentication: { credentials: 'push-errors-token', schemes: ['bearer'] },
            },
          },
        }),
      },
    )
    expect(response.ok).toBe(true)
    const json = await response.json()
    expect(json.jsonrpc).toBe('2.0')
    expect(json.error).toBeDefined()
    expect(json.error.code).toBe(-32001) // task not found
  })

  it('should return error when getting push config for non-existent task', async () => {
    const nonExistentTaskId = uuidv4()
    const response = await fetch(
      `http://localhost:${PUSH_ERR_TEST_CONFIG.PORT}${PUSH_ERR_TEST_CONFIG.BASE_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/get',
          params: { id: nonExistentTaskId },
        }),
      },
    )
    expect(response.ok).toBe(true)
    const json = await response.json()
    expect(json.jsonrpc).toBe('2.0')
    expect(json.error).toBeDefined()
    expect(json.error.code).toBe(-32001) // task not found
  })
})
