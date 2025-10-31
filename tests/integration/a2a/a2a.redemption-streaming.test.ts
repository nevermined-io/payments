import { getApiKeysForFile } from '../../utils/apiKeysPool.js'
import { Payments } from '../../../src/payments.js'
import { buildPaymentAgentCard } from '../../../src/a2a/agent-card.js'
import { PaymentsA2AServer } from '../../../src/a2a/server.js'
import {
  getERC20PriceConfig,
  getFixedCreditsConfig,
  getDynamicCreditsConfig,
} from '../../../src/plans.js'
import { retryOperation } from '../../utils/retry-operation.js'
import { Address } from '../../../src/common/types.js'
import { PaymentRedemptionConfig } from '../../../src/a2a/types.js'
import { EnvironmentName } from '../../../src/environments.js'
import { v4 as uuidv4 } from 'uuid'

const STREAMING_REDEMPTION_TEST_CONFIG = {
  ENVIRONMENT: 'staging_sandbox' as EnvironmentName,
  ERC20_ADDRESS: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
  TIMEOUT: 60000,
}

const testApiKeys = getApiKeysForFile(__filename)

class StreamingRedemptionTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server: any
  public agentId!: string
  public accessToken!: string
  public planId!: string
  public agentCard!: any
  public port!: number

  async setup(redemptionConfig: PaymentRedemptionConfig): Promise<void> {
    this.port = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000

    this.builder = Payments.getInstance({
      nvmApiKey: testApiKeys.builder,
      environment: STREAMING_REDEMPTION_TEST_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: testApiKeys.subscriber,
      environment: STREAMING_REDEMPTION_TEST_CONFIG.ENVIRONMENT,
    })

    await this.registerPlan(redemptionConfig)
    await this.registerAgent(redemptionConfig)
    await this.startServer(redemptionConfig)
    await this.orderAndToken()
  }

  async teardown(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => {
          setTimeout(resolve, 100)
        })
      })
    }

    if (this.builder) {
      ;(this.builder as any).clearCache?.()
    }
    if (this.subscriber) {
      ;(this.subscriber as any).clearCache?.()
    }
  }

  private async registerPlan(redemptionConfig: PaymentRedemptionConfig): Promise<void> {
    const nonce = Date.now()
    const account = this.builder.getAccountAddress() as Address
    const price = getERC20PriceConfig(1n, STREAMING_REDEMPTION_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = redemptionConfig.useMargin
      ? getDynamicCreditsConfig(200n, 1n, 20n)
      : getFixedCreditsConfig(200n, 10n)

    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `test-plan-${nonce}`, description: 'Test plan for streaming redemption config' },
        price,
        credits,
      ),
    )
    if (!resp.planId) throw new Error('No planId')
    this.planId = resp.planId
  }

  private async registerAgent(redemptionConfig: PaymentRedemptionConfig): Promise<void> {
    const nonce = Date.now()

    const resp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: 'Streaming Redemption Agent ' + nonce,
          tags: ['test'],
          description: 'Test agent for streaming redemption config',
        },
        { endpoints: [{ POST: `http://localhost:${this.port}/a2a/` }] },
        [this.planId],
      ),
    )
    this.agentId = resp.agentId

    const baseCard = {
      name: 'Streaming Redemption Agent',
      description: 'Test agent for streaming redemption config',
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
        tools: ['text-generation'],
        extensions: [],
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${this.port}`,
    }

    const paymentMetadata = {
      paymentType: 'fixed' as const,
      credits: 10,
      planId: this.planId,
      agentId: this.agentId,
      costDescription: '10 credits per request',
      redemptionConfig,
    }

    const agentCard = buildPaymentAgentCard(baseCard, paymentMetadata)
    this.agentCard = agentCard
  }

  private async startServer(redemptionConfig: PaymentRedemptionConfig): Promise<void> {
    const result = this.builder.a2a.start({
      agentCard: this.agentCard,
      executor: {
        execute: async (requestContext: any, eventBus: any) => {
          const taskId = requestContext.taskId
          const contextId = requestContext.userMessage.contextId || uuidv4()

          eventBus.publish({
            kind: 'task',
            id: taskId,
            contextId,
            status: { state: 'submitted', timestamp: new Date().toISOString() },
            artifacts: [],
            history: [requestContext.userMessage],
            metadata: requestContext.userMessage.metadata,
          })

          // Emit some working updates to simulate streaming
          for (let i = 0; i < 2; i++) {
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
                  parts: [{ kind: 'text', text: `Working ${i + 1}` }],
                  taskId,
                  contextId,
                },
                timestamp: new Date().toISOString(),
              },
              final: false,
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
                parts: [{ kind: 'text', text: 'Streaming redemption done' }],
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: true,
            metadata: { creditsUsed: 10, operationType: 'streaming-redemption' },
          })

          eventBus.finished()
        },
        cancelTask: async () => {},
      },
      port: this.port,
      basePath: '/a2a/',
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
      this.server.on('error', (err: unknown) => {
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
    const balance = await this.subscriber.plans.getPlanBalance(this.planId)
    return BigInt(balance.balance)
  }

  async sendStreamingMessage(messageText: string): Promise<any[]> {
    const serverAddress = this.server.address()
    const port =
      typeof serverAddress === 'string' ? serverAddress.split(':').pop() : serverAddress.port
    const response = await fetch(`http://localhost:${port}/a2a/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/stream',
        params: {
          message: {
            kind: 'message',
            messageId: uuidv4(),
            role: 'user',
            parts: [{ kind: 'text', text: messageText }],
          },
        },
      }),
    })

    if (!response.ok || !response.body) {
      throw new Error('Streaming request failed')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const events: any[] = []

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              events.push(data)
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return events
  }
}

describe('A2A Server-Side Redemption Configuration with Streaming', () => {
  let ctx: StreamingRedemptionTestContext

  afterEach(async () => {
    if (ctx) {
      await ctx.teardown()
    }
  }, STREAMING_REDEMPTION_TEST_CONFIG.TIMEOUT)

  it('should handle streaming with server-side redemption configuration', async () => {
    ctx = new StreamingRedemptionTestContext()
    await ctx.setup({}) // Default configuration

    const initial = await ctx.getPlanBalance()
    const events = await ctx.sendStreamingMessage('Test streaming with server-side config')

    // Verify we received streaming events
    expect(events.length).toBeGreaterThan(0)

    // Find the final event with payment metadata
    const finalEvent = events.find(
      (event) =>
        event.result?.kind === 'status-update' &&
        event.result?.final &&
        event.result?.metadata?.txHash,
    )

    expect(finalEvent).toBeDefined()
    // Note: redemptionMethod is server-only information, not sent to client
    expect(finalEvent?.result?.metadata?.txHash).toBeDefined()

    // Wait for credits to be burned
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const final = await ctx.getPlanBalance()
    expect(final).toBeLessThan(initial)
  })

  it('should respect server-level handler options in streaming', async () => {
    // Test that server configuration works with streaming
    ctx = new StreamingRedemptionTestContext()
    await ctx.setup({}) // Agent card with default config

    // Start a new server with different handler options
    const baseCard = {
      name: 'Test Streaming Agent',
      description: 'Test agent for streaming server config',
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
        tools: ['text-generation'],
        extensions: [],
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: 'https://example.com',
    }

    const paymentMetadata = {
      paymentType: 'fixed' as const,
      credits: 10,
      planId: ctx.planId,
      agentId: 'test-streaming-agent-id',
      costDescription: '10 credits per request',
    }

    const agentCard = buildPaymentAgentCard(baseCard, paymentMetadata)

    const executor = {
      execute: async (requestContext: any, eventBus: any) => {
        const taskId = requestContext.taskId
        const contextId = requestContext.userMessage.contextId || uuidv4()

        eventBus.publish({
          kind: 'task',
          id: taskId,
          contextId: contextId,
          status: {
            state: 'submitted',
            timestamp: new Date().toISOString(),
          },
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
              parts: [{ kind: 'text', text: 'Server config streaming test completed' }],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
          metadata: {
            creditsUsed: 10,
            planId: ctx.planId,
            costDescription: 'Server config streaming test',
          },
        })
      },
    }

    const serverResult = PaymentsA2AServer.start({
      agentCard,
      executor,
      paymentsService: ctx.subscriber,
      port: 0,
      basePath: '/a2a/',
      exposeAgentCard: true,
      exposeDefaultRoutes: true,
      handlerOptions: {
        defaultBatch: true,
        defaultMarginPercent: 10,
      },
    })

    const server = serverResult.server

    try {
      const events = await ctx.sendStreamingMessage('Test server config with streaming')

      // Verify we received streaming events
      expect(events.length).toBeGreaterThan(0)

      // Find the final event with payment metadata
      const finalEvent = events.find(
        (event) =>
          event.result?.kind === 'status-update' &&
          event.result?.final &&
          event.result?.metadata?.txHash,
      )

      expect(finalEvent).toBeDefined()
      // The server-level configuration should override the agent card config
      // Note: redemptionMethod is server-only information, not sent to client
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
