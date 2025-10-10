/**
 * @file A2A auth/protocol errors integration tests
 */

import http from 'http'
import { Payments } from '../../../src/payments.js'
import type { AgentCard } from '../../../src/a2a/types.js'
import type { AgentExecutor } from '../../../src/a2a/types.js'
import type { EnvironmentName } from '../../../src/environments.js'
import type { Address } from '../../../src/common/types.js'
import { getERC20PriceConfig, getFixedCreditsConfig } from '../../../src/plans.js'
import { retryOperation } from '../../utils/retry-operation.js'

const ERR_TEST_CONFIG = {
  TIMEOUT: 60_000,
  PORT: parseInt(process.env.PORT || '41257'),
  BASE_PATH: '/a2a/',
  ENVIRONMENT: (process.env.TESTING_ENVIRONMENT || 'staging_sandbox') as EnvironmentName,
  ERC20_ADDRESS: (process.env.ERC20_ADDRESS ||
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
}

function createNoopExecutor(): AgentExecutor {
  return {
    execute: async (_requestContext, eventBus) => {
      eventBus.finished()
    },
    cancelTask: async () => {},
  }
}

class A2AErrorsTestContext {
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
      environment: ERR_TEST_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: process.env.TEST_SUBSCRIBER_API_KEY || '',
      environment: ERR_TEST_CONFIG.ENVIRONMENT,
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
    const price = getERC20PriceConfig(1n, ERR_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = getFixedCreditsConfig(200n, 10n)
    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `A2A Errors Test Plan ${nonce}` },
        price,
        credits,
      ),
    )
    if (!resp.planId) throw new Error('No planId')
    this.planId = resp.planId
  }

  private async registerAgent(): Promise<void> {
    const baseCard: AgentCard = {
      name: `A2A Errors Test Agent ${Date.now()}`,
      description: 'Agent for errors tests',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${ERR_TEST_CONFIG.PORT}`,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }
    const agentApi = {
      endpoints: [{ POST: `http://localhost:${ERR_TEST_CONFIG.PORT}${ERR_TEST_CONFIG.BASE_PATH}` }],
    }
    const resp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: `A2A Errors Test Agent ${Date.now()}`,
          description: 'errors',
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
      costDescription: 'errors test',
      agentId: this.agentId,
    }
    this.agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
  }

  private async startServer(): Promise<void> {
    const result = this.builder.a2a.start({
      agentCard: this.agentCard,
      executor: createNoopExecutor(),
      port: ERR_TEST_CONFIG.PORT,
      basePath: ERR_TEST_CONFIG.BASE_PATH,
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
}

describe('A2A Auth/Protocol Errors', () => {
  let ctx: A2AErrorsTestContext

  beforeAll(async () => {
    ctx = new A2AErrorsTestContext()
    await ctx.setup()
  }, ERR_TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await ctx.teardown()
  }, ERR_TEST_CONFIG.TIMEOUT)

  it('should reject requests without valid token (402)', async () => {
    const response = await fetch(
      `http://localhost:${ERR_TEST_CONFIG.PORT}${ERR_TEST_CONFIG.BASE_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer invalid-token`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              kind: 'message',
              messageId: 'm1',
              role: 'user',
              parts: [{ kind: 'text', text: 'Hello' }],
            },
          },
        }),
      },
    )
    expect(response.status).toBe(402)
  })

  it('should handle invalid JSON body (400)', async () => {
    const response = await fetch(
      `http://localhost:${ERR_TEST_CONFIG.PORT}${ERR_TEST_CONFIG.BASE_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.accessToken}`,
        },
        body: 'invalid json',
      },
    )
    expect(response.status).toBe(400)
  })

  it('should return JSON-RPC error for missing params (-32602)', async () => {
    const response = await fetch(
      `http://localhost:${ERR_TEST_CONFIG.PORT}${ERR_TEST_CONFIG.BASE_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.accessToken}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'message/send', params: {} }),
      },
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.error?.code).toBe(-32602)
  })

  it('should reject when Authorization header is missing (401)', async () => {
    const response = await fetch(
      `http://localhost:${ERR_TEST_CONFIG.PORT}${ERR_TEST_CONFIG.BASE_PATH}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              kind: 'message',
              messageId: 'm2',
              role: 'user',
              parts: [{ kind: 'text', text: 'Hi' }],
            },
          },
        }),
      },
    )
    expect(response.status).toBe(401)
  })

  it('should return JSON-RPC error for unknown method', async () => {
    const response = await fetch(
      `http://localhost:${ERR_TEST_CONFIG.PORT}${ERR_TEST_CONFIG.BASE_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.accessToken}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'unknown/method', params: {} }),
      },
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.error).toBeDefined()
    expect(typeof json.error.code).toBe('number')
  })

  it('should return 404 on GET to JSON-RPC base path', async () => {
    const response = await fetch(
      `http://localhost:${ERR_TEST_CONFIG.PORT}${ERR_TEST_CONFIG.BASE_PATH}`,
      { method: 'GET' },
    )
    expect(response.status === 404 || response.status === 405).toBe(true)
  })
})
