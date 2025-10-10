/**
 * @file A2A streaming integration tests (SSE)
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

const STR_TEST_CONFIG = {
  TIMEOUT: 60_000,
  PORT: parseInt(process.env.PORT || '41254'),
  BASE_PATH: '/a2a/',
  ENVIRONMENT: (process.env.TESTING_ENVIRONMENT || 'staging_sandbox') as EnvironmentName,
  ERC20_ADDRESS: (process.env.ERC20_ADDRESS ||
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
}

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createStreamingExecutor(): AgentExecutor {
  return {
    execute: async (requestContext, eventBus) => {
      const taskId = requestContext.taskId
      const contextId = requestContext.userMessage.contextId || uuidv4()

      // Initial task
      eventBus.publish({
        kind: 'task',
        id: taskId,
        contextId,
        status: { state: 'submitted', timestamp: new Date().toISOString() },
        artifacts: [],
        history: [requestContext.userMessage],
        metadata: requestContext.userMessage.metadata,
      })

      // Few streaming chunks
      for (let i = 1; i <= 3; i++) {
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
              parts: [{ kind: 'text', text: `Streaming message ${i}/3` }],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: false,
        })
        await wait(100)
      }

      // Final status
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
            parts: [{ kind: 'text', text: '🚀 Streaming completed successfully!' }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
        metadata: { creditsUsed: 10, operationType: 'streaming', streamingType: 'text' },
      })

      eventBus.finished()
    },
    cancelTask: async () => {},
  }
}

class A2AStreamingTestContext {
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
      environment: STR_TEST_CONFIG.ENVIRONMENT,
    })
    this.subscriber = Payments.getInstance({
      nvmApiKey: process.env.TEST_SUBSCRIBER_API_KEY || '',
      environment: STR_TEST_CONFIG.ENVIRONMENT,
    })

    await this.registerPlan()
    console.timeEnd('[STREAMING] registerPlan')
    console.time('[STREAMING] registerAgent')
    await this.registerAgent()
    console.timeEnd('[STREAMING] registerAgent')
    console.time('[STREAMING] startServer')
    await this.startServer()
    console.timeEnd('[STREAMING] startServer')
    console.time('[STREAMING] orderAndToken')
    await this.orderAndToken()
    console.timeEnd('[STREAMING] orderAndToken')
    console.debug('[STREAMING] setup end')
  }

  async teardown(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server.close(() => resolve()))
    }
  }

  private async registerPlan(): Promise<void> {
    const nonce = Date.now()
    const account = this.builder.getAccountAddress() as Address
    const price = getERC20PriceConfig(1n, STR_TEST_CONFIG.ERC20_ADDRESS, account)
    const credits = getFixedCreditsConfig(200n, 10n)
    const resp = await retryOperation(() =>
      this.builder.plans.registerCreditsPlan(
        { name: `A2A Streaming Test Plan ${nonce}` },
        price,
        credits,
      ),
    )
    if (!resp.planId) throw new Error('No planId')
    this.planId = resp.planId
  }

  private async registerAgent(): Promise<void> {
    const baseCard: AgentCard = {
      name: `A2A Streaming Test Agent ${Date.now()}`,
      description: 'Agent for streaming tests',
      capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: `http://localhost:${STR_TEST_CONFIG.PORT}`,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }
    const agentApi = {
      endpoints: [{ POST: `http://localhost:${STR_TEST_CONFIG.PORT}${STR_TEST_CONFIG.BASE_PATH}` }],
    }
    const agentResp = await retryOperation(() =>
      this.builder.agents.registerAgent(
        {
          name: `A2A Streaming Test Agent ${Date.now()}`,
          description: 'streaming',
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
      costDescription: 'streaming test',
      agentId: this.agentId,
    }
    this.agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
  }

  private async startServer(): Promise<void> {
    const result = this.builder.a2a.start({
      agentCard: this.agentCard,
      executor: createStreamingExecutor(),
      port: STR_TEST_CONFIG.PORT,
      basePath: STR_TEST_CONFIG.BASE_PATH,
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

  async sendStreamingMessage(text: string): Promise<any> {
    const response = await fetch(
      `http://localhost:${STR_TEST_CONFIG.PORT}${STR_TEST_CONFIG.BASE_PATH}`,
      {
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
              parts: [{ kind: 'text', text }],
            },
          },
        }),
      },
    )

    if (!response.ok || !response.body) {
      throw new Error('Streaming request failed')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalResult: any = null

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
              if (data.result && data.result.final) {
                finalResult = data
                break
              }
            } catch {}
          }
        }
        if (finalResult) break
      }
    } finally {
      reader.releaseLock()
    }

    if (!finalResult) throw new Error('No final result received from streaming response')
    return finalResult
  }
}

describe('A2A Streaming (SSE)', () => {
  let ctx: A2AStreamingTestContext

  beforeAll(async () => {
    ctx = new A2AStreamingTestContext()
    await ctx.setup()
  }, STR_TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await ctx.teardown()
  }, STR_TEST_CONFIG.TIMEOUT)

  it('should handle streaming requests with SSE events and complete', async () => {
    const initial = await ctx.subscriber.plans
      .getPlanBalance(ctx.planId)
      .then((b) => BigInt(b.balance))
    const result = await ctx.sendStreamingMessage('Start streaming')
    expect(result.jsonrpc).toBe('2.0')
    expect(result.result).toBeDefined()
    expect(result.result.kind).toBe('status-update')
    expect(result.result.final).toBe(true)
    expect(result.result.status.state).toBe('completed')
    expect(result.result.metadata.creditsUsed).toBe(10)
    expect(result.result.metadata.operationType).toBe('streaming')
    // Credits burned (poll via retryOperation-like loop)
    // Simple poll loop here to avoid adding another util
    let attempts = 0
    let finalBalance = initial
    while (attempts < 20) {
      await wait(500)
      finalBalance = await ctx.subscriber.plans
        .getPlanBalance(ctx.planId)
        .then((b) => BigInt(b.balance))
      if (finalBalance <= initial - 10n) break
      attempts++
    }
    expect(finalBalance).toBeLessThan(initial)
    expect(initial - finalBalance).toBe(10n)
  })
})
