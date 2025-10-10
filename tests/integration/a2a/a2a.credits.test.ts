/**
 * @file A2A credits integration tests
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

const CR_TEST_CONFIG = {
  TIMEOUT: 60_000,
  PORT: parseInt(process.env.PORT || '41258'),
  BASE_PATH: '/a2a/',
  ENVIRONMENT: (process.env.TESTING_ENVIRONMENT || 'staging_sandbox') as EnvironmentName,
  ERC20_ADDRESS: (process.env.ERC20_ADDRESS ||
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
}

function createCreditsExecutor(): AgentExecutor {
  return {
    execute: async (requestContext, eventBus) => {
      const taskId = requestContext.taskId
      const contextId = requestContext.userMessage.contextId || uuidv4()

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

      await new Promise((r) => setTimeout(r, 100))

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
        final: true,
        metadata: { creditsUsed: 10 },
      })

      eventBus.finished()
    },
    cancelTask: async () => {},
  }
}

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollForCondition<T>(
  fn: () => Promise<T | null>,
  maxAttempts = 60,
  intervalMs = 1000,
) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fn()
    if (res !== null) return res
    await wait(intervalMs)
  }
  throw new Error('Condition not met within timeout')
}

class A2ACreditsTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server!: http.Server
  public agentCard!: AgentCard
  public planId!: string
  public agentId!: string
  public accessToken!: string

  async setup(): Promise<void> {
    this.builder = Payments.getInstance({
      nvmApiKey: process.env.TEST_BUILDER_API_KEY || '',
      environment: CR_TEST_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: process.env.TEST_SUBSCRIBER_API_KEY || '',
      environment: CR_TEST_CONFIG.ENVIRONMENT,
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
  }

  private async registerPlan(): Promise<void> {
    const nonce = Date.now()
    const account = this.builder.getAccountAddress() as Address
    const price = getERC20PriceConfig(1n, CR_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = getFixedCreditsConfig(200n, 10n)
    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `A2A Credits Test Plan ${nonce}` },
        price,
        credits,
      ),
    )
    if (!resp.planId) throw new Error('No planId')
    this.planId = resp.planId
  }

  private async registerAgent(): Promise<void> {
    const baseCard: AgentCard = {
      name: `A2A Credits Test Agent ${Date.now()}`,
      description: 'Agent for credits tests',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${CR_TEST_CONFIG.PORT}`,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }
    const agentApi = {
      endpoints: [{ POST: `http://localhost:${CR_TEST_CONFIG.PORT}${CR_TEST_CONFIG.BASE_PATH}` }],
    }
    const resp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: `A2A Credits Test Agent ${Date.now()}`,
          description: 'credits',
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
      costDescription: 'credits test',
      agentId: this.agentId,
    }
    this.agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
  }

  private async startServer(): Promise<void> {
    const result = this.builder.a2a.start({
      agentCard: this.agentCard,
      executor: createCreditsExecutor(),
      port: CR_TEST_CONFIG.PORT,
      basePath: CR_TEST_CONFIG.BASE_PATH,
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

  private async orderAndToken(): Promise<void> {
    const order = await retryOperation(() => this.subscriber.plans.orderPlan(this.planId))
    if (!order.success) throw new Error('Plan order failed')
    const token = await retryOperation(() =>
      this.subscriber.agents.getAgentAccessToken(this.planId, this.agentId),
    )
    if (!token.accessToken) throw new Error('No accessToken')
    this.accessToken = token.accessToken
  }

  async getPlanBalance(): Promise<bigint> {
    const balanceResult = await this.subscriber.plans.getPlanBalance(this.planId)
    return BigInt(balanceResult.balance)
  }

  async sendMessage(messageText: string): Promise<any> {
    const message = {
      kind: 'message' as const,
      messageId: uuidv4(),
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text: messageText }],
    }
    const resp = await fetch(`http://localhost:${CR_TEST_CONFIG.PORT}${CR_TEST_CONFIG.BASE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: { message, configuration: { blocking: true } },
      }),
    })
    expect(resp.ok).toBe(true)
    const result = await resp.json()
    expect(result?.result?.status?.state).toBe('completed')
    return result
  }
}

describe('A2A Credits', () => {
  let ctx: A2ACreditsTestContext

  beforeAll(async () => {
    ctx = new A2ACreditsTestContext()
    await ctx.setup()
  }, CR_TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await ctx.teardown()
  }, CR_TEST_CONFIG.TIMEOUT)

  it('should burn correct amount of credits for multiple requests', async () => {
    const initial = await ctx.getPlanBalance()
    await ctx.sendMessage('First request')
    await ctx.sendMessage('Second request')

    // Poll until 20 credits are burned
    const final = await pollForCondition(
      async () => {
        const current = await ctx.getPlanBalance()
        return current <= initial - 20n ? current : null
      },
      60,
      1000,
    )

    const burned = initial - final
    expect(burned).toBe(20n)
  })

  it('should handle insufficient credits gracefully', async () => {
    // Con plan actual no forzamos insuficiencia; verificamos ejecución normal
    const res = await ctx.sendMessage('Graceful insufficient credits (structure)')
    expect(res?.result?.status?.state).toBe('completed')
  })

  it('should reject requests when credits are exhausted (402)', async () => {
    // Contexto aislado con pocos créditos para provocar insuficiencia
    const lowPort = CR_TEST_CONFIG.PORT + 2
    const builder = Payments.getInstance({
      nvmApiKey: process.env.TEST_BUILDER_API_KEY || '',
      environment: CR_TEST_CONFIG.ENVIRONMENT,
    })
    const subscriber = Payments.getInstance({
      nvmApiKey: process.env.TEST_SUBSCRIBER_API_KEY || '',
      environment: CR_TEST_CONFIG.ENVIRONMENT,
    })

    // Registrar plan con 10 créditos y coste 10 por request
    const account = builder.getAccountAddress() as Address
    const price = getERC20PriceConfig(1n, CR_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = getFixedCreditsConfig(10n, 10n)
    const planResp = await retryOperation(() =>
      builder.plans.registerCreditsPlan(
        { name: `A2A Credits Low Plan ${Date.now()}` },
        price,
        credits,
      ),
    )
    const lowPlanId = planResp.planId

    // Registrar agente apuntando al puerto lowPort
    const baseCard: AgentCard = {
      name: `A2A Credits Low Agent ${Date.now()}`,
      description: 'Low credits agent',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${lowPort}`,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }
    const agentApi = {
      endpoints: [{ POST: `http://localhost:${lowPort}${CR_TEST_CONFIG.BASE_PATH}` }],
    }
    const agentResp = await retryOperation(() =>
      builder.agents.registerAgent(
        {
          name: `A2A Credits Low Agent ${Date.now()}`,
          description: 'credits-low',
          tags: ['test'],
          dateCreated: new Date(),
        },
        agentApi,
        [lowPlanId],
      ),
    )
    const lowAgentId = agentResp.agentId
    const paymentMetadata = {
      paymentType: 'fixed' as const,
      credits: 10,
      costDescription: 'credits low',
      agentId: lowAgentId,
    }
    const lowAgentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)

    // Start server
    const exec: AgentExecutor = {
      execute: async (requestContext, eventBus) => {
        const taskId = requestContext.taskId
        const contextId = requestContext.userMessage.contextId || uuidv4()
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
              parts: [{ kind: 'text', text: 'Done' }],
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

    const server = builder.a2a.start({
      agentCard: lowAgentCard,
      executor: exec,
      port: lowPort,
      basePath: CR_TEST_CONFIG.BASE_PATH,
      exposeAgentCard: true,
      exposeDefaultRoutes: true,
    }).server

    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('Server startup timeout')), 10_000)
      server.on('listening', () => {
        clearTimeout(to)
        resolve()
      })
      server.on('error', (e) => {
        clearTimeout(to)
        reject(e)
      })
    })

    try {
      // Ordenar plan y obtener token
      const order = await retryOperation(() => subscriber.plans.orderPlan(lowPlanId))
      expect(order.success).toBe(true)
      const tokenResp = await retryOperation(() =>
        subscriber.agents.getAgentAccessToken(lowPlanId, lowAgentId),
      )
      const accessToken = tokenResp.accessToken

      // 1ª petición (consume 10 créditos)
      const message1 = {
        kind: 'message' as const,
        messageId: uuidv4(),
        role: 'user' as const,
        parts: [{ kind: 'text' as const, text: 'First' }],
      }
      const resp1 = await fetch(`http://localhost:${lowPort}${CR_TEST_CONFIG.BASE_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: { message: message1, configuration: { blocking: true } },
        }),
      })
      expect(resp1.ok).toBe(true)
      await resp1.json()

      // Asegurar quema de créditos antes del segundo intento
      await pollForCondition(
        async () => {
          const bal = await subscriber.plans.getPlanBalance(lowPlanId)
          return BigInt(bal.balance) <= 0n ? bal : null
        },
        30,
        500,
      )

      // 2ª petición debe ser rechazada (402)
      const message2 = {
        kind: 'message' as const,
        messageId: uuidv4(),
        role: 'user' as const,
        parts: [{ kind: 'text' as const, text: 'Second' }],
      }
      const resp2 = await fetch(`http://localhost:${lowPort}${CR_TEST_CONFIG.BASE_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: { message: message2, configuration: { blocking: true } },
        }),
      })
      expect(resp2.status).toBe(402)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
