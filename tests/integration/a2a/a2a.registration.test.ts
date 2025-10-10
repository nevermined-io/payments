/**
 * @file A2A registration integration tests (plan, agent, token)
 */

import http from 'http'
import { Payments } from '../../../src/payments.js'
import type { AgentCard } from '../../../src/a2a/types.js'
import type { AgentExecutor } from '../../../src/a2a/types.js'
import type { EnvironmentName } from '../../../src/environments.js'
import type { Address } from '../../../src/common/types.js'
import { getERC20PriceConfig, getFixedCreditsConfig } from '../../../src/plans.js'
import { retryOperation } from '../../utils/retry-operation.js'

const REG_TEST_CONFIG = {
  TIMEOUT: 60_000,
  PORT: parseInt(process.env.PORT || '41252'),
  BASE_PATH: '/a2a/',
  ENVIRONMENT: (process.env.TESTING_ENVIRONMENT || 'staging_sandbox') as EnvironmentName,
  ERC20_ADDRESS: (process.env.ERC20_ADDRESS ||
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
}

function createRegistrationExecutor(): AgentExecutor {
  return {
    execute: async (_requestContext, eventBus) => {
      eventBus.finished()
    },
    cancelTask: async () => {},
  }
}

class A2ARegistrationTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server!: http.Server
  public agentCard!: AgentCard
  public planId!: string
  public agentId!: string
  public accessToken!: string
  // logging removed

  async setup(): Promise<void> {
    // logging removed
    this.builder = Payments.getInstance({
      nvmApiKey: process.env.TEST_BUILDER_API_KEY || '',
      environment: REG_TEST_CONFIG.ENVIRONMENT,
    })

    this.subscriber = Payments.getInstance({
      nvmApiKey: process.env.TEST_SUBSCRIBER_API_KEY || '',
      environment: REG_TEST_CONFIG.ENVIRONMENT,
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
    const price = getERC20PriceConfig(1n, REG_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = getFixedCreditsConfig(200n, 10n)

    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `A2A Registration Test Plan ${nonce}` },
        price,
        credits,
      ),
    )
    if (!resp.planId) throw new Error('No planId')
    this.planId = resp.planId
  }

  private async registerAgent(): Promise<void> {
    const baseCard: AgentCard = {
      name: 'A2A Registration Test Agent',
      description: 'Agent used for registration tests',
      capabilities: { streaming: true, pushNotifications: true, stateTransitionHistory: true },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${REG_TEST_CONFIG.PORT}`,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }

    const agentApi = {
      endpoints: [{ POST: `http://localhost:${REG_TEST_CONFIG.PORT}${REG_TEST_CONFIG.BASE_PATH}` }],
    }

    const agentResp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: `A2A Registration Test Agent ${Date.now()}`,
          description: 'registration',
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
      costDescription: 'reg test',
      agentId: this.agentId,
    }
    this.agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
  }

  private async startServer(): Promise<void> {
    const result = this.builder.a2a.start({
      agentCard: this.agentCard,
      executor: createRegistrationExecutor(),
      port: REG_TEST_CONFIG.PORT,
      basePath: REG_TEST_CONFIG.BASE_PATH,
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

describe('A2A Registration (plan, agent, token)', () => {
  let ctx: A2ARegistrationTestContext

  beforeAll(async () => {
    ctx = new A2ARegistrationTestContext()
    await ctx.setup()
  }, REG_TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await ctx.teardown()
  }, REG_TEST_CONFIG.TIMEOUT)

  it('should have registered plan and agent', async () => {
    expect(ctx.planId).toBeDefined()
    expect(ctx.agentId).toBeDefined()
  })

  it('should expose agent card with payment extension', async () => {
    const res = await fetch(
      `http://localhost:${REG_TEST_CONFIG.PORT}${REG_TEST_CONFIG.BASE_PATH}.well-known/agent-card.json`,
    )
    expect(res.ok).toBe(true)
    const card = await res.json()
    expect(card?.capabilities?.extensions?.[0]?.uri).toBe('urn:nevermined:payment')
    expect(card?.capabilities?.extensions?.[0]?.params?.agentId).toBe(ctx.agentId)
  })

  it('should get access token for the agent', () => {
    expect(typeof ctx.accessToken).toBe('string')
    expect(ctx.accessToken.length).toBeGreaterThan(0)
  })
})
