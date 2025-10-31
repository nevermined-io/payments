/**
 * @file A2A context propagation integration tests
 */

import { getApiKeysForFile } from '../../utils/apiKeysPool.js'
import http from 'http'
import { v4 as uuidv4 } from 'uuid'
import { Payments } from '../../../src/payments.js'
import type { AgentCard } from '../../../src/a2a/types.js'
import type { AgentExecutor } from '../../../src/a2a/types.js'
import type { EnvironmentName } from '../../../src/environments.js'
import type { Address } from '../../../src/common/types.js'
import { getERC20PriceConfig, getFixedCreditsConfig } from '../../../src/plans.js'
import { retryOperation } from '../../utils/retry-operation.js'

const testApiKeys = getApiKeysForFile(__filename)

const CTX_TEST_CONFIG = {
  ENVIRONMENT: 'staging_sandbox' as EnvironmentName,
  TIMEOUT: 60000,
  PORT: parseInt(process.env.PORT || '41252'),
  BASE_PATH: '/a2a/',
  ERC20_ADDRESS: (process.env.ERC20_ADDRESS ||
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
}

function createContextAssertExecutor(): AgentExecutor {
  return {
    execute: async (requestContext, eventBus) => {
      const taskId = requestContext.taskId
      const contextId = requestContext.userMessage.contextId || uuidv4()

      // Assert payments context exists
      if (!requestContext.payments || !requestContext.payments.httpContext) {
        throw new Error('payments context missing in requestContext')
      }

      eventBus.publish({
        kind: 'task',
        id: taskId,
        contextId,
        status: { state: 'submitted', timestamp: new Date().toISOString() },
        artifacts: [],
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
            parts: [{ kind: 'text', text: 'Context ok' }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
        metadata: { creditsUsed: 10, operationType: 'context' },
      })

      eventBus.finished()
    },
    cancelTask: async () => {},
  }
}

class A2AContextTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server!: http.Server
  public agentCard!: AgentCard
  public planId!: string
  public agentId!: string
  public accessToken!: string
  public port!: number
  // logging removed

  async setup(): Promise<void> {
    this.port = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000
    // logging removed
    this.builder = Payments.getInstance({
      nvmApiKey: testApiKeys.builder,
      environment: CTX_TEST_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: testApiKeys.subscriber,
      environment: CTX_TEST_CONFIG.ENVIRONMENT,
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
    const price = getERC20PriceConfig(1n, CTX_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = getFixedCreditsConfig(200n, 10n)
    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `A2A Context Test Plan ${nonce}` },
        price,
        credits,
      ),
    )
    if (!resp.planId) throw new Error('No planId')
    this.planId = resp.planId
  }

  private async registerAgent(): Promise<void> {
    const baseCard: AgentCard = {
      name: `A2A Context Test Agent ${Date.now()}`,
      description: 'Agent for context tests',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${this.port}`,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }
    const agentApi = {
      endpoints: [{ POST: `http://localhost:${this.port}${CTX_TEST_CONFIG.BASE_PATH}` }],
    }
    const agentResp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: `A2A Context Test Agent ${Date.now()}`,
          description: 'context',
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
      costDescription: 'context test',
      agentId: this.agentId,
    }
    this.agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
  }

  private async startServer(): Promise<void> {
    const result = this.builder.a2a.start({
      agentCard: this.agentCard,
      executor: createContextAssertExecutor(),
      port: this.port,
      basePath: CTX_TEST_CONFIG.BASE_PATH,
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
}

describe('A2A Context', () => {
  it('should init clients with per-suite API keys', () => {
    const builder = Payments.getInstance({
      nvmApiKey: testApiKeys.builder,
      environment: 'staging_sandbox' as EnvironmentName,
    })
    const subscriber = Payments.getInstance({
      nvmApiKey: testApiKeys.subscriber,
      environment: 'staging_sandbox' as EnvironmentName,
    })
    expect(builder).toBeDefined()
    expect(subscriber).toBeDefined()
  })

  let ctx: A2AContextTestContext

  beforeAll(async () => {
    ctx = new A2AContextTestContext()
    await ctx.setup()
  }, CTX_TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await ctx.teardown()
  }, CTX_TEST_CONFIG.TIMEOUT)

  it('should pass HttpRequestContext and authResult to executor', async () => {
    const message = {
      kind: 'message' as const,
      messageId: uuidv4(),
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text: 'Check context passing' }],
    }
    const resp = await fetch(`http://localhost:${ctx.port}${CTX_TEST_CONFIG.BASE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: { message, configuration: { blocking: true } },
      }),
    })
    expect(resp.ok).toBe(true)
    const json = await resp.json()
    expect(json.result?.status?.state).toBe('completed')
    expect(json.result?.status?.message?.parts?.[0]?.text).toBe('Context ok')
  })
})
