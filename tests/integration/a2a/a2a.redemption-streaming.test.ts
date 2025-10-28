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
  ERC20_ADDRESS: '0x6B175474E89094C44Da98b954EedeAC495271d0F' as Address,
  TIMEOUT: 60000,
}

class StreamingRedemptionTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server: any
  public agentId!: string
  public accessToken!: string
  public planId!: string
  public agentCard!: any

  async setup(redemptionConfig: PaymentRedemptionConfig): Promise<void> {
    this.builder = Payments.getInstance({
      nvmApiKey: process.env.TEST_BUILDER_API_KEY || '',
      environment: STREAMING_REDEMPTION_TEST_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: process.env.TEST_SUBSCRIBER_API_KEY || '',
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
          // Give a moment for all connections to close
          setTimeout(resolve, 100)
        })
      })
    }

    // Clear any cached connections in Payments instances
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

    // Use dynamic credits when margin is enabled
    const credits = redemptionConfig.useMargin
      ? getDynamicCreditsConfig(200n, 1n, 20n) // min 1, max 20 credits per request
      : getFixedCreditsConfig(200n, 10n)

    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `test-plan-${nonce}`, description: 'Test plan for streaming redemption config' },
        price,
        credits,
      ),
    )
    this.planId = resp.planId
  }

  private async registerAgent(redemptionConfig: PaymentRedemptionConfig): Promise<void> {
    const nonce = Date.now()

    // Generate a random port for this test instance
    const randomPort = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000

    // First register the agent to get the real agentId
    const resp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: 'Test Streaming Agent ' + nonce,
          tags: ['test', 'streaming'],
          description: 'Test agent for streaming redemption config',
        },
        {
          endpoints: [{ POST: `http://localhost:${randomPort}/a2a/` }],
        },
        [this.planId],
      ),
    )
    this.agentId = resp.agentId

    // Now create the agent card with the real agentId and random port
    const baseCard = {
      name: 'Test Streaming Agent',
      description: 'Test agent for streaming redemption config',
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
      capabilities: {
        tools: ['text-generation'],
        extensions: [],
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${randomPort}`,
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
    // Store the agentCard for later use
    this.agentCard = agentCard
  }

  private async startServer(redemptionConfig: PaymentRedemptionConfig): Promise<void> {
    // Use the agentCard created in registerAgent
    const agentCard = this.agentCard

    // Extract port from the agentCard URL
    const urlObj = new URL(agentCard.url)
    const port = parseInt(urlObj.port, 10)

    const executor = {
      execute: async (requestContext: any, eventBus: any) => {
        const taskId = requestContext.taskId
        const contextId = requestContext.userMessage.contextId || uuidv4()
        const userText = requestContext.userMessage.parts[0].text

        // Publish initial task
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

        // Publish working status
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
              parts: [{ kind: 'text', text: 'Processing your streaming request...' }],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: false,
        })

        // Simulate processing time
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Publish final completed status
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
              parts: [
                { kind: 'text', text: `I've processed your streaming request: "${userText}"` },
              ],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
          metadata: {
            creditsUsed: 10,
            planId: this.planId,
            costDescription: 'Streaming AI processing',
          },
        })
      },
    }

    const serverResult = PaymentsA2AServer.start({
      agentCard,
      executor,
      paymentsService: this.subscriber,
      port: port,
      basePath: '/a2a/',
      exposeAgentCard: true,
      exposeDefaultRoutes: true,
      handlerOptions: {
        defaultBatch: redemptionConfig.useBatch || false,
        defaultMarginPercent: redemptionConfig.marginPercent || undefined,
      },
    })

    this.server = serverResult.server
  }

  private async orderAndToken(): Promise<void> {
    const orderResp = await retryOperation(() => this.subscriber.plans.orderPlan(this.planId))
    const tokenResp = await retryOperation(() =>
      this.subscriber.agents.getAgentAccessToken(this.planId, this.agentId),
    )
    if (!tokenResp.accessToken) throw new Error('No accessToken')
    this.accessToken = tokenResp.accessToken
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
