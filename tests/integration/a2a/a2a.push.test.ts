/**
 * @file A2A push notifications integration tests
 */

import http from 'http'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getApiKeysForFile } from '../../utils/apiKeysPool.js'
import { Payments } from '../../../src/payments.js'
import type { AgentCard } from '../../../src/a2a/types.js'
import type { AgentExecutor } from '../../../src/a2a/types.js'
import { EnvironmentName } from '../../../src/environments.js'
import type { Address } from '../../../src/common/types.js'
import { getERC20PriceConfig, getFixedCreditsConfig } from '../../../src/plans.js'
import { retryOperation } from '../../utils/retry-operation.js'

const PUSH_TEST_CONFIG = {
  TIMEOUT: 60_000,
  PORT: parseInt(process.env.PORT || '41255'),
  BASE_PATH: '/a2a/',
  WEBHOOK_PORT: 4002,
  ENVIRONMENT: (process.env.TESTING_ENVIRONMENT || 'staging_sandbox') as EnvironmentName,
  ERC20_ADDRESS: (process.env.ERC20_ADDRESS ||
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
}

const testApiKeys = getApiKeysForFile(__filename)

function createPushExecutor(): AgentExecutor {
  return {
    execute: async (requestContext, eventBus) => {
      const taskId = requestContext.taskId
      const contextId = requestContext.userMessage.contextId || uuidv4()
      // Publish task immediately
      eventBus.publish({
        kind: 'task',
        id: taskId,
        contextId,
        status: { state: 'submitted', timestamp: new Date().toISOString() },
        history: [requestContext.userMessage],
        metadata: requestContext.userMessage.metadata,
      })
      // Final update
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
            parts: [{ kind: 'text', text: 'Push configured and completed!' }],
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

class WebhookServer {
  private app = express()
  private server!: http.Server
  private notifications: any[] = []
  // logging removed

  constructor(private port: number) {
    this.app.use(express.json())
    this.app.post('/webhook', (req, res) => {
      this.notifications.push(req.body)
      res.status(200).send('OK')
    })
  }

  start(): Promise<string> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => resolve(this.url()))
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  url(): string {
    return `http://localhost:${this.port}/webhook`
  }

  async waitFor(taskId: string, timeoutMs = 30000): Promise<any> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const match = this.notifications.find((n) => n.taskId === taskId)
      if (match) return match
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error('Notification not received in time')
  }
}

class A2APushTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server!: http.Server
  public agentCard!: AgentCard
  public planId!: string
  public agentId!: string
  public accessToken!: string
  public webhook!: WebhookServer
  public port!: number
  // logging removed

  async setup(): Promise<void> {
    this.port = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000
    this.webhook = new WebhookServer(PUSH_TEST_CONFIG.WEBHOOK_PORT)
    await this.webhook.start()

    this.builder = Payments.getInstance({
      nvmApiKey: testApiKeys.builder,
      environment: PUSH_TEST_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: testApiKeys.subscriber,
      environment: PUSH_TEST_CONFIG.ENVIRONMENT,
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
    if (this.webhook) await this.webhook.stop()
    // logging removed
  }

  private async registerPlan(): Promise<void> {
    const nonce = Date.now()
    const account = this.builder.getAccountAddress() as Address
    const price = getERC20PriceConfig(1n, PUSH_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = getFixedCreditsConfig(200n, 10n)
    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `A2A Push Test Plan ${nonce}` },
        price,
        credits,
      ),
    )
    if (!resp.planId) throw new Error('No planId')
    this.planId = resp.planId
  }

  private async registerAgent(): Promise<void> {
    const baseCard: AgentCard = {
      name: `A2A Push Test Agent ${Date.now()}`,
      description: 'Agent for push tests',
      capabilities: { streaming: false, pushNotifications: true, stateTransitionHistory: true },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${this.port}`,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }
    const agentApi = {
      endpoints: [{ POST: `http://localhost:${this.port}${PUSH_TEST_CONFIG.BASE_PATH}` }],
    }
    const agentResp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: `A2A Push Test Agent ${Date.now()}`,
          description: 'push',
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
      costDescription: 'push test',
      agentId: this.agentId,
    }
    this.agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
  }

  private async startServer(): Promise<void> {
    const result = this.builder.a2a.start({
      agentCard: this.agentCard,
      executor: createPushExecutor(),
      port: this.port,
      basePath: PUSH_TEST_CONFIG.BASE_PATH,
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
    const tokenResp = await retryOperation(() =>
      this.subscriber.agents.getAgentAccessToken(this.planId, this.agentId),
    )
    if (!tokenResp.accessToken) throw new Error('No accessToken')
    this.accessToken = tokenResp.accessToken
  }
}

describe('A2A Push Notifications', () => {
  let ctx: A2APushTestContext

  beforeAll(async () => {
    ctx = new A2APushTestContext()
    await ctx.setup()
  }, PUSH_TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await ctx.teardown()
  }, PUSH_TEST_CONFIG.TIMEOUT)

  it('should set and get push notification configuration and receive notification', async () => {
    // 1) Create a task (non-blocking)
    const createResp = await fetch(`http://localhost:${ctx.port}${PUSH_TEST_CONFIG.BASE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          configuration: { blocking: false },
          message: {
            kind: 'message',
            messageId: uuidv4(),
            role: 'user',
            parts: [{ kind: 'text', text: 'Push test' }],
          },
        },
      }),
    })
    expect(createResp.ok).toBe(true)
    const createJson = await createResp.json()
    const taskId = createJson.result.id

    // 2) Set push config
    const setResp = await fetch(`http://localhost:${ctx.port}${PUSH_TEST_CONFIG.BASE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tasks/pushNotificationConfig/set',
        params: {
          taskId,
          pushNotificationConfig: {
            url: ctx.webhook.url(),
            token: 'test-token-abc',
            authentication: { credentials: 'test-token-abc', schemes: ['bearer'] },
          },
        },
      }),
    })
    expect(setResp.ok).toBe(true)

    // 3) Get push config
    const getResp = await fetch(`http://localhost:${ctx.port}${PUSH_TEST_CONFIG.BASE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tasks/pushNotificationConfig/get',
        params: { id: taskId },
      }),
    })
    expect(getResp.ok).toBe(true)
    const getJson = await getResp.json()
    expect(getJson.result?.pushNotificationConfig?.url).toBe(ctx.webhook.url())

    // 4) Wait for push notification
    const notif = await ctx.webhook.waitFor(taskId)
    expect(notif).toBeDefined()
    expect(notif.taskId).toBe(taskId)
    expect(notif.state).toBe('completed')
  })
})
