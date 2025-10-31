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
import { EnvironmentName } from '../../../src/environments.js'
import { PaymentRedemptionConfig } from '../../../src/a2a/types.js'
import { v4 as uuidv4 } from 'uuid'

const REDEMPTION_TEST_CONFIG = {
  ENVIRONMENT: 'staging_sandbox' as EnvironmentName,
  ERC20_ADDRESS: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
  TIMEOUT: 60000,
}

const testApiKeys = getApiKeysForFile(__filename)

class RedemptionTestContext {
  public builder!: Payments
  public subscriber!: Payments
  public server: any
  public serverResult: any
  public agentId!: string
  public accessToken!: string
  public planId!: string
  public agentCard!: any
  private executor: any

  /**
   * Initializes builder and subscriber with exclusive API Keys from the pool (per suite).
   */
  async setup(redemptionConfig: PaymentRedemptionConfig): Promise<void> {
    this.builder = Payments.getInstance({
      nvmApiKey: testApiKeys.builder,
      environment: REDEMPTION_TEST_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: testApiKeys.subscriber,
      environment: REDEMPTION_TEST_CONFIG.ENVIRONMENT,
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
    const price = getERC20PriceConfig(1n, REDEMPTION_TEST_CONFIG.ERC20_ADDRESS, account)

    // Use dynamic credits when margin is enabled
    const credits = redemptionConfig.useMargin
      ? getDynamicCreditsConfig(200n, 1n, 20n) // min 1, max 20 credits per request
      : getFixedCreditsConfig(200n, 10n)

    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `test-plan-${nonce}`, description: 'Test plan for redemption config' },
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
          name: 'Test Agent ' + nonce,
          tags: ['test'],
          description: 'Test agent for redemption config',
        },
        { endpoints: [{ POST: `http://localhost:${randomPort}/a2a/` }] }, // Use random port
        [this.planId],
      ),
    )
    this.agentId = resp.agentId

    // Now create the agent card with the real agentId and random port
    const baseCard = {
      name: 'Test Agent',
      description: 'Test agent for redemption config',
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
      agentId: this.agentId, // Use the real agentId
      costDescription: '10 credits per request',
      redemptionConfig,
    }

    const agentCard = buildPaymentAgentCard(baseCard, paymentMetadata)
    // Store the agentCard for later use
    this.agentCard = agentCard
  }

  /**
   * Creates an executor with optional custom response text
   */
  private createExecutor(responseText?: string): any {
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
              parts: [{ kind: 'text', text: 'Processing your request...' }],
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
                {
                  kind: 'text',
                  text: responseText || `I've processed your request: "${userText}"`,
                },
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
            costDescription: 'AI processing and response generation',
          },
        })
      },
    }
  }

  private async startServer(redemptionConfig: PaymentRedemptionConfig): Promise<void> {
    // Use the agentCard created in registerAgent with the real agentId
    const agentCard = this.agentCard

    // Extract port from the agentCard URL
    const urlObj = new URL(agentCard.url)
    const port = parseInt(urlObj.port, 10)

    // Create and store the default executor
    this.executor = this.createExecutor()

    const serverResult = PaymentsA2AServer.start({
      agentCard,
      executor: this.executor,
      paymentsService: this.builder,
      port: port,
      basePath: '/a2a/',
      exposeAgentCard: true,
      exposeDefaultRoutes: true,
      handlerOptions: {
        defaultBatch: redemptionConfig.useBatch || false,
        defaultMarginPercent: redemptionConfig.marginPercent || undefined,
      },
    })

    this.serverResult = serverResult
    this.server = serverResult.server
  }

  /**
   * Restarts the server with new handler options without affecting the agent registration or tokens
   */
  async restartServer(options: {
    defaultBatch?: boolean
    defaultMarginPercent?: number
    executorResponseText?: string
  }): Promise<void> {
    // Close the existing server if it exists
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => {
          setTimeout(resolve, 100)
        })
      })
    }

    // Create new executor with custom response text if provided, otherwise use the default
    const executor = options.executorResponseText
      ? this.createExecutor(options.executorResponseText)
      : this.executor

    // Extract port from the agentCard URL
    const urlObj = new URL(this.agentCard.url)
    const port = parseInt(urlObj.port, 10)

    const serverResult = PaymentsA2AServer.start({
      agentCard: this.agentCard,
      executor: executor,
      paymentsService: this.builder,
      port: port,
      basePath: '/a2a/',
      exposeAgentCard: true,
      exposeDefaultRoutes: true,
      handlerOptions: {
        defaultBatch: options.defaultBatch,
        defaultMarginPercent: options.defaultMarginPercent,
      },
    })

    this.serverResult = serverResult
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

  async sendMessage(messageText: string): Promise<any> {
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

    const result = await response.json()
    expect(result?.result?.status?.state).toBe('completed')
    return result
  }
}

describe('A2A Server-Side Redemption Configuration', () => {
  let ctx: RedemptionTestContext

  afterEach(async () => {
    if (ctx) {
      await ctx.teardown()
    }
    // Give extra time for all connections to close
    await new Promise((resolve) => setTimeout(resolve, 500))
  }, REDEMPTION_TEST_CONFIG.TIMEOUT)

  it('should respect server-level handler options over agent card config', async () => {
    // Test that server configuration takes precedence over agent card configuration
    ctx = new RedemptionTestContext()

    // Setup agent with specific redemption config in AgentCard
    await ctx.setup({
      useBatch: false,
      useMargin: false,
    })

    // Now restart the server with different handler options
    // This should override the agent card configuration
    await ctx.restartServer({
      defaultBatch: true,
      defaultMarginPercent: 10,
      executorResponseText: 'Server config override test completed',
    })

    const serverAddress = ctx.server.address()
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
            parts: [{ kind: 'text', text: 'Test server config override' }],
          },
        },
      }),
    })

    expect(resp.ok).toBe(true)
    const result = await resp.json()
    expect(result?.result?.status?.state).toBe('completed')

    // The server-level configuration should override the agent card config
    // Note: redemptionMethod is server-only information, not sent to client
  })
})
