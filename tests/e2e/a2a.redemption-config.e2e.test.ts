import { Payments } from '../../src/payments.js'
import { buildPaymentAgentCard } from '../../src/a2a/agent-card.js'
import { PaymentsA2AServer } from '../../src/a2a/server.js'
import {
  getERC20PriceConfig,
  getFixedCreditsConfig,
  getDynamicCreditsConfig,
} from '../../src/plans.js'
import { retryOperation } from '../utils/retry-operation.js'
import { Address } from '../../src/common/types.js'
import {
  PaymentRedemptionConfig,
  A2AStreamEvent,
  SendMessageResponse,
} from '../../src/a2a/types.js'
import { EnvironmentName } from '../../src/environments.js'
import { v4 as uuidv4 } from 'uuid'

const E2E_REDEMPTION_CONFIG = {
  ENVIRONMENT: 'staging_sandbox' as EnvironmentName,
  ERC20_ADDRESS: '0x6B175474E89094C44Da98b954EedeAC495271d0F' as Address,
  TIMEOUT: 90000,
}

function createRealisticExecutor(creditsUsed: number = 10): any {
  return {
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

      try {
        // Simulate AI processing stages
        const processingStages = [
          'Analyzing request...',
          'Processing with AI model...',
          'Generating response...',
          'Finalizing output...',
        ]

        for (let i = 0; i < processingStages.length; i++) {
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
                parts: [
                  {
                    kind: 'text',
                    text: processingStages[i],
                  },
                ],
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: false,
          })

          // Simulate processing time
          await new Promise((resolve) => setTimeout(resolve, 200))
        }

        // Final response
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
                {
                  kind: 'text',
                  text: `I've processed your request: "${userText}". Here's my response with AI analysis.`,
                },
              ],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
          metadata: {
            creditsUsed,
            planId: 'e2e-test-plan',
            costDescription: 'AI processing and response generation',
            operationType: 'ai_processing',
            model: 'gpt-4',
            tokensUsed: 150,
          },
        })
      } catch (error) {
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'failed',
            message: {
              kind: 'message',
              role: 'agent',
              messageId: uuidv4(),
              parts: [
                { kind: 'text', text: 'Sorry, I encountered an error processing your request.' },
              ],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
        })
      }
    },
  }
}

class E2ERedemptionTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server: any
  public agentId!: string
  public accessToken!: string
  public planId!: string
  public initialBalance!: bigint
  public agentCard!: any

  async setup(redemptionConfig: PaymentRedemptionConfig): Promise<void> {
    this.builder = Payments.getInstance({
      nvmApiKey: process.env.TEST_BUILDER_API_KEY || '',
      environment: E2E_REDEMPTION_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: process.env.TEST_SUBSCRIBER_API_KEY || '',
      environment: E2E_REDEMPTION_CONFIG.ENVIRONMENT,
    })

    await this.registerPlan(redemptionConfig)
    await this.registerAgent(redemptionConfig)
    await this.startServer(redemptionConfig)
    await this.orderAndToken()
    this.initialBalance = await this.getPlanBalance()
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
    const price = getERC20PriceConfig(1n, E2E_REDEMPTION_CONFIG.ERC20_ADDRESS, account)

    // Use dynamic credits when margin is enabled
    const credits = redemptionConfig.useMargin
      ? getDynamicCreditsConfig(200n, 1n, 20n) // min 1, max 20 credits per request
      : getFixedCreditsConfig(200n, 10n)

    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `e2e-test-plan-${nonce}`, description: 'E2E test plan for redemption config' },
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
          name: 'E2E Test Agent ' + nonce,
          tags: ['test', 'e2e'],
          description: 'E2E test agent for redemption config',
        },
        { endpoints: [{ POST: `http://localhost:${randomPort}/a2a/` }] },
        [this.planId],
      ),
    )
    this.agentId = resp.agentId

    // Now create the agent card with the real agentId and random port
    const baseCard = {
      name: 'E2E Test Agent',
      description: 'E2E test agent for redemption config',
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

    const serverResult = PaymentsA2AServer.start({
      agentCard,
      executor: createRealisticExecutor(10),
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

  async waitForCreditsToBurn(expectedBurned: bigint, timeoutMs: number = 10000): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      const currentBalance = await this.getPlanBalance()
      const burned = this.initialBalance - currentBalance
      if (burned >= expectedBurned) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(
      `Credits not burned within timeout. Expected: ${expectedBurned}, Current balance: ${await this.getPlanBalance()}`,
    )
  }

  async sendBlockingRequest(messageText: string): Promise<any> {
    const response = await fetch(`http://localhost:${this.server.address().port}/a2a/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
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

    return response.json()
  }

  async sendStreamingRequest(messageText: string): Promise<any[]> {
    const response = await fetch(`http://localhost:${this.server.address().port}/a2a/`, {
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

describe('A2A Server-Side Redemption Configuration E2E', () => {
  let ctx: E2ERedemptionTestContext

  afterEach(async () => {
    if (ctx) {
      await ctx.teardown()
    }
  }, E2E_REDEMPTION_CONFIG.TIMEOUT)

  it('should complete full flow with server-side redemption configuration', async () => {
    ctx = new E2ERedemptionTestContext()
    await ctx.setup({}) // Default configuration

    const result = await ctx.sendBlockingRequest('Hello, can you help me with a question?')

    // Verify response structure
    expect(result.jsonrpc).toBe('2.0')
    expect(result.result.kind).toBe('task')
    expect(result.result.status.state).toBe('completed')
    expect(result.result.status.message.role).toBe('agent')
    expect(result.result.status.message.parts[0].text).toContain("I've processed your request")

    // Verify redemption metadata
    // Note: redemptionMethod is server-only information, not sent to client
    expect(result.result.metadata.txHash).toBeDefined()
    expect(result.result.metadata.creditsUsed).toBe(10)

    // Verify credits were actually burned
    await ctx.waitForCreditsToBurn(10n)
    const finalBalance = await ctx.getPlanBalance()
    expect(finalBalance).toBeLessThan(ctx.initialBalance)
  })

  it('should handle streaming requests with server-side configuration', async () => {
    ctx = new E2ERedemptionTestContext()
    await ctx.setup({}) // Default configuration

    const events = await ctx.sendStreamingRequest('Can you help me with a streaming request?')

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
    expect(finalEvent?.result?.metadata?.creditsCharged).toBeDefined()

    // Verify credits were actually burned
    await ctx.waitForCreditsToBurn(10n)
    const finalBalance = await ctx.getPlanBalance()
    expect(finalBalance).toBeLessThan(ctx.initialBalance)
  })

  it('should respect server-level handler options in E2E flow', async () => {
    // Test that server configuration works in full E2E flow
    ctx = new E2ERedemptionTestContext()
    await ctx.setup({}) // Agent card with default config

    // Start a new server with different handler options
    const baseCard = {
      name: 'E2E Test Agent',
      description: 'E2E test agent for server config',
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
      agentId: 'temp-agent-id',
      costDescription: '10 credits per request',
    }

    const agentCard = buildPaymentAgentCard(baseCard, paymentMetadata)

    const serverResult = PaymentsA2AServer.start({
      agentCard,
      executor: createRealisticExecutor(10),
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
      const serverAddress = server.address()
      if (!serverAddress) throw new Error('Server address is null')
      const port =
        typeof serverAddress === 'string' ? serverAddress.split(':').pop() : serverAddress.port
      const resp = await fetch(`http://localhost:${port}/a2a/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              kind: 'message',
              messageId: uuidv4(),
              role: 'user',
              parts: [{ kind: 'text', text: 'Test server config in E2E flow' }],
            },
          },
        }),
      })

      expect(resp.ok).toBe(true)
      const result = await resp.json()
      expect(result?.result?.status?.state).toBe('completed')

      // The server-level configuration should override the agent card config
      // Note: redemptionMethod is server-only information, not sent to client
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
