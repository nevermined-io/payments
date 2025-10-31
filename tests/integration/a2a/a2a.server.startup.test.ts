/**
 * @file A2A server startup integration tests (suite 1)
 */

import http from 'http'
import { getApiKeysForFile } from '../../utils/apiKeysPool.js'
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

const testApiKeys = getApiKeysForFile(__filename)

function buildBaseTestAgentCard(port: number): AgentCard {
  return {
    name: `A2A Server Startup Test Agent`,
    description: 'Agent used for server startup tests',
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: `http://localhost:${port}`,
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
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
  public port!: number

  async setup(): Promise<void> {
    this.port = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000
    this.payments = Payments.getInstance({
      nvmApiKey: testApiKeys.builder,
      environment: SERVER_TEST_CONFIG.ENVIRONMENT,
    })

    const baseCard = buildBaseTestAgentCard(this.port)
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
      port: this.port,
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
}

describe('A2A Server Startup', () => {
  it('should start server successfully', async () => {
    const ctx = new A2AServerTestContext()
    await ctx.setup()
    expect(ctx.server).toBeDefined()
    await new Promise<void>((resolve) => ctx.server.close(() => resolve()))
  })
})
