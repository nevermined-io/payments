/**
 * @file A2A server startup integration tests (suite 1)
 */

import http from 'http'
import { Payments } from '../../../src/payments.js'
import type { AgentCard } from '../../../src/a2a/types.js'
import type { AgentExecutor } from '../../../src/a2a/types.js'
import type { EnvironmentName } from '../../../src/environments.js'

const SERVER_TEST_CONFIG = {
  TIMEOUT: 30_000,
  PORT: parseInt(process.env.PORT || '41251'),
  BASE_PATH: '/a2a/',
  ENVIRONMENT: 'staging_sandbox' as EnvironmentName,
}

function buildBaseTestAgentCard(): AgentCard {
  return {
    name: `A2A Server Startup Test Agent`,
    description: 'Agent used for server startup tests',
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: `http://localhost:${SERVER_TEST_CONFIG.PORT}`,
    version: '1.0.0',
  }
}

function createNoopExecutor(): AgentExecutor {
  return {
    execute: async (_requestContext, eventBus) => {
      eventBus.finished()
    },
    cancelTask: async () => {},
  }
}

class A2AServerTestContext {
  public payments!: Payments
  public server!: http.Server
  public agentCard!: AgentCard

  async setup(): Promise<void> {
    this.payments = Payments.getInstance({
      nvmApiKey: process.env.TEST_BUILDER_API_KEY || 'test-key',
      environment: SERVER_TEST_CONFIG.ENVIRONMENT,
    })

    const baseCard = buildBaseTestAgentCard()
    const paymentMetadata = {
      paymentType: 'fixed' as const,
      credits: 1,
      costDescription: 'Server startup test',
      agentId: `did:nv:test-agent-${Date.now()}`,
    }

    this.agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)

    const result = this.payments.a2a.start({
      agentCard: this.agentCard,
      executor: createNoopExecutor(),
      port: SERVER_TEST_CONFIG.PORT,
      basePath: SERVER_TEST_CONFIG.BASE_PATH,
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

  async teardown(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server.close(() => resolve()))
    }
  }
}

describe('A2A Server Startup', () => {
  let ctx: A2AServerTestContext

  beforeAll(async () => {
    ctx = new A2AServerTestContext()
    await ctx.setup()
  }, SERVER_TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await ctx.teardown()
  }, SERVER_TEST_CONFIG.TIMEOUT)

  it('should start the A2A server and be listening', async () => {
    expect(ctx.server).toBeDefined()
    expect(ctx.server.listening).toBe(true)
  })

  it('should expose agent card at .well-known/agent.json', async () => {
    const res = await fetch(
      `http://localhost:${SERVER_TEST_CONFIG.PORT}${SERVER_TEST_CONFIG.BASE_PATH}.well-known/agent.json`,
    )
    expect(res.ok).toBe(true)
    const card = await res.json()
    expect(card?.name).toBe('A2A Server Startup Test Agent')
    // Payment extension should be present because we used buildPaymentAgentCard
    const ext = card?.capabilities?.extensions?.[0]
    expect(ext?.uri).toBe('urn:nevermined:payment')
    expect(ext?.params?.paymentType).toBe('fixed')
  })
})
