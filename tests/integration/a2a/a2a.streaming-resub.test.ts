/**
 * @file A2A streaming resubscribe integration tests
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
import { getApiKeysForFile } from '../../utils/apiKeysPool.js'

const testApiKeys = getApiKeysForFile(__filename)

const STREAMING_RESUB_TEST_CONFIG = {
  ENVIRONMENT: 'staging_sandbox' as EnvironmentName,
  TIMEOUT: 60000,
  PORT: parseInt(process.env.PORT || '41259'),
  BASE_PATH: '/a2a/',
  ERC20_ADDRESS: (process.env.ERC20_ADDRESS ||
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
}

function createStreamingExecutor(): AgentExecutor {
  return {
    execute: async (requestContext, eventBus) => {
      const taskId = requestContext.taskId
      const contextId = requestContext.userMessage.contextId || uuidv4()

      // task
      eventBus.publish({
        kind: 'task',
        id: taskId,
        contextId,
        status: { state: 'submitted', timestamp: new Date().toISOString() },
        artifacts: [],
        history: [requestContext.userMessage],
        metadata: requestContext.userMessage.metadata,
      })

      // a couple of working updates
      for (let i = 1; i <= 2; i++) {
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
              parts: [{ kind: 'text', text: `Streaming ${i}` }],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: false,
        })
        await new Promise((r) => setTimeout(r, 80))
      }

      await new Promise((r) => setTimeout(r, 2000))

      // final
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
            parts: [{ kind: 'text', text: 'Streaming completed!' }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
        metadata: { creditsUsed: 10, operationType: 'streaming' },
      })
      eventBus.finished()
    },
    cancelTask: async () => {},
  }
}

class A2AStreamingResubTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server!: http.Server
  public agentCard!: AgentCard
  public planId!: string
  public agentId!: string
  public accessToken!: string
  public port!: number

  async setup(): Promise<void> {
    this.port = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000
    this.builder = Payments.getInstance({
      nvmApiKey: testApiKeys.builder,
      environment: STREAMING_RESUB_TEST_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: testApiKeys.subscriber,
      environment: STREAMING_RESUB_TEST_CONFIG.ENVIRONMENT,
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
    const price = getERC20PriceConfig(1n, STREAMING_RESUB_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = getFixedCreditsConfig(200n, 10n)
    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `A2A Streaming Resub Test Plan ${nonce}` },
        price,
        credits,
      ),
    )
    if (!resp.planId) throw new Error('No planId')
    this.planId = resp.planId
  }

  private async registerAgent(): Promise<void> {
    const baseCard: AgentCard = {
      name: `A2A Streaming Resub Test Agent ${Date.now()}`,
      description: 'Agent for streaming resubscribe tests',
      capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${this.port}/a2a/`,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }
    const agentApi = {
      endpoints: [
        {
          POST: `http://localhost:${this.port}${STREAMING_RESUB_TEST_CONFIG.BASE_PATH}`,
        },
      ],
    }
    const resp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: `A2A Streaming Resub Test Agent ${Date.now()}`,
          description: 'streaming-resub',
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
      costDescription: 'streaming resub test',
      agentId: this.agentId,
    }
    this.agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
  }

  private async startServer(): Promise<void> {
    const result = this.builder.a2a.start({
      agentCard: this.agentCard,
      executor: createStreamingExecutor(),
      port: this.port,
      basePath: STREAMING_RESUB_TEST_CONFIG.BASE_PATH,
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

describe('A2A Streaming Resubscribe', () => {
  let ctx: A2AStreamingResubTestContext

  beforeAll(async () => {
    ctx = new A2AStreamingResubTestContext()
    await ctx.setup()
  }, STREAMING_RESUB_TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await ctx.teardown()
  }, STREAMING_RESUB_TEST_CONFIG.TIMEOUT)

  it('should resubscribe to streaming task and complete successfully', async () => {
    // Ensure server is accessible before creating the client to avoid 404 race conditions
    await retryOperation(async () => {
      const health = await fetch(
        `http://localhost:${ctx.port}${STREAMING_RESUB_TEST_CONFIG.BASE_PATH}.well-known/agent-card.json`,
      )
      if (!health.ok) throw new Error('Server not ready')
      return true
    })

    const client = await ctx.subscriber.a2a.getClient({
      agentBaseUrl: `http://localhost:${ctx.port}${STREAMING_RESUB_TEST_CONFIG.BASE_PATH}`,
      agentId: ctx.agentId,
      planId: ctx.planId,
    })

    const message = {
      kind: 'message' as const,
      messageId: uuidv4(),
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text: 'Start streaming (resubscribe)' }],
    }

    const initialEvents: any[] = []
    let taskId: string | null = null
    let consumed = 0
    const maxInitialEvents = 1

    for await (const event of client.sendA2AMessageStream({ message })) {
      initialEvents.push(event)
      consumed++
      if (!taskId) {
        taskId = event.result?.id ?? event.result?.taskId ?? null
      }
      if (consumed >= maxInitialEvents || (event.result && event.result.final)) {
        break
      }
    }

    expect(taskId).toBeTruthy()
    expect(initialEvents.length).toBeGreaterThan(0)

    await new Promise((r) => setTimeout(r, 50))

    const resubscribeEvents: any[] = []
    let resubscribeFinal: any = null
    for await (const event of client.resubscribeA2ATask({ id: taskId! })) {
      resubscribeEvents.push(event)
      const isFinal = !!(
        event.result &&
        (event.result.final || event.result.status?.state === 'completed')
      )
      if (isFinal) {
        resubscribeFinal = event
        break
      }
    }

    expect(resubscribeEvents.length).toBeGreaterThan(0)
    expect(resubscribeFinal).toBeDefined()
    const finalTaskId = resubscribeFinal.result.taskId ?? resubscribeFinal.result.id
    expect(finalTaskId).toBe(taskId)
    expect(resubscribeFinal.result.status.state).toBe('completed')
    expect(resubscribeFinal.result.metadata.creditsUsed).toBe(10)
  })
})
