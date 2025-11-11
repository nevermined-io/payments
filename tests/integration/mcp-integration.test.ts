/**
 * Integration tests for MCP integration.
 */

import { buildMcpIntegration } from '../../src/mcp/index.js'
import type { Payments } from '../../src/payments.js'

class PaymentsMinimal {
  public requests: any
  public agents: any

  constructor(subscriber = true) {
    class Req {
      private outer: PaymentsMinimal
      private subscriber: boolean

      constructor(outer: PaymentsMinimal, subscriber: boolean) {
        this.outer = outer
        this.subscriber = subscriber
      }

      async startProcessingRequest(agentId: string, token: string, url: string, method: string) {
        return {
          agentRequestId: 'req-xyz',
          balance: { isSubscriber: this.subscriber },
        }
      }

      async redeemCreditsFromRequest(requestId: string, token: string, credits: bigint) {
        return { success: true }
      }
    }

    class Agents {
      async getAgentPlans(agentId: string) {
        return { plans: [] }
      }
    }

    this.requests = new Req(this, subscriber)
    this.agents = new Agents()
  }
}

describe('MCP Integration', () => {
  test('should validate and burn credits with minimal mocks', async () => {
    const payments = new PaymentsMinimal() as any as Payments
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:agent', serverName: 'mcp-int' })

    const handler = async (_args: any) => {
      return { content: [{ type: 'text', text: 'hello' }] }
    }

    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'test', credits: 1n })
    const extra = { requestInfo: { headers: { Authorization: 'Bearer abc' } } }
    const out = await wrapped({ city: 'Madrid' }, extra)

    expect(out).toBeDefined()
  })

  test('should trigger payment required when not subscriber', async () => {
    const payments = new PaymentsMinimal(false) as any as Payments
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:agent', serverName: 'mcp-int' })

    const handler = async (_args: any) => {
      return { content: [{ type: 'text', text: 'hello' }] }
    }

    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'test', credits: 1n })

    await expect(
      wrapped({ city: 'Madrid' }, { requestInfo: { headers: { Authorization: 'Bearer tok' } } }),
    ).rejects.toMatchObject({
      code: -32003,
    })
  })

  test('should provide PaywallContext with realistic agent request data', async () => {
    class PaymentsWithAgentRequest {
      public requests: any
      public agents: any

      constructor(subscriber = true, balance = 1000) {
        class Req {
          private outer: PaymentsWithAgentRequest
          private subscriber: boolean
          private balance: number

          constructor(outer: PaymentsWithAgentRequest, subscriber: boolean, balance: number) {
            this.outer = outer
            this.subscriber = subscriber
            this.balance = balance
          }

          async startProcessingRequest(
            agentId: string,
            token: string,
            url: string,
            method: string,
          ) {
            const hash = token.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
            return {
              agentRequestId: `req-${agentId}-${hash % 10000}`,
              agentName: `Agent ${agentId.split(':').pop()}`,
              agentId: agentId,
              balance: {
                balance: this.balance,
                creditsContract: '0x1234567890abcdef',
                isSubscriber: this.subscriber,
                pricePerCredit: 0.01,
              },
              urlMatching: url,
              verbMatching: method,
              batch: false,
            }
          }

          async redeemCreditsFromRequest(requestId: string, token: string, credits: bigint) {
            const hash = `${requestId}-${token}-${credits}`
              .split('')
              .reduce((acc, char) => acc + char.charCodeAt(0), 0)
            return {
              success: true,
              txHash: `0x${(hash % 1000000000).toString(16)}`,
            }
          }
        }

        class Agents {
          async getAgentPlans(agentId: string) {
            return {
              plans: [
                { id: 'plan-1', name: 'Basic Plan' },
                { id: 'plan-2', name: 'Premium Plan' },
              ],
            }
          }
        }

        this.requests = new Req(this, subscriber, balance)
        this.agents = new Agents()
      }
    }

    const payments = new PaymentsWithAgentRequest(true, 5000) as any as Payments
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:agent:abc123', serverName: 'weather-service' })

    const capturedContexts: any[] = []

    const weatherHandler = async (args: any, extra?: any, context?: any) => {
      capturedContexts.push(context)

      if (!context) {
        return { error: 'No context provided' }
      }

      const agentRequest = context.agentRequest
      const authResult = context.authResult
      const credits = context.credits

      // Simulate business logic using context data
      const city = args.city || 'Unknown'

      // Check if agent has sufficient balance
      if (agentRequest.balance.balance < Number(credits)) {
        return {
          error: 'Insufficient balance',
          required: Number(credits),
          available: agentRequest.balance.balance,
        }
      }

      // Generate weather response with metadata
      const weatherData = {
        city: city,
        temperature: 22,
        condition: 'sunny',
        humidity: 65,
      }

      return {
        content: [
          {
            type: 'text',
            text: `Weather in ${city}: ${weatherData.temperature}°C, ${weatherData.condition}`,
          },
        ],
        metadata: {
          agentName: agentRequest.agentName,
          requestId: authResult.requestId,
          creditsUsed: Number(credits),
          balanceRemaining: agentRequest.balance.balance - Number(credits),
          isSubscriber: agentRequest.balance.isSubscriber,
          pricePerCredit: agentRequest.balance.pricePerCredit,
          weatherData: weatherData,
        },
      }
    }

    const wrapped = mcp.withPaywall(weatherHandler, {
      kind: 'tool',
      name: 'get-weather',
      credits: 5n,
    })

    const extra = { requestInfo: { headers: { authorization: 'Bearer weather-token-123' } } }
    const result = await wrapped({ city: 'Madrid' }, extra)

    // Verify the handler executed successfully
    expect(result.error).toBeUndefined()
    expect(result.content[0].text).toContain('Weather in Madrid: 22°C, sunny')

    // Verify context was captured
    expect(capturedContexts.length).toBe(1)
    const context = capturedContexts[0]

    // Verify PaywallContext structure
    expect(context.authResult.requestId).toMatch(/^req-did:nv:agent:abc123-/)
    expect(context.authResult.token).toBe('weather-token-123')
    expect(context.authResult.agentId).toBe('did:nv:agent:abc123')
    expect(context.authResult.logicalUrl).toContain('mcp://weather-service/tools/get-weather')

    // Verify agent request data
    expect(context.agentRequest.agentName).toBe('Agent abc123')
    expect(context.agentRequest.agentId).toBe('did:nv:agent:abc123')
    expect(context.agentRequest.balance.balance).toBe(5000)
    expect(context.agentRequest.balance.isSubscriber).toBe(true)
    expect(context.agentRequest.balance.pricePerCredit).toBe(0.01)
    expect(context.agentRequest.urlMatching).toContain('mcp://weather-service/tools/get-weather')
    expect(context.agentRequest.verbMatching).toBe('POST')
    expect(context.agentRequest.batch).toBe(false)

    // Verify credits
    expect(context.credits).toBe(5n)

    // Verify metadata in result
    expect(result.metadata.agentName).toBe('Agent abc123')
    expect(result.metadata.creditsUsed).toBe(5)
    expect(result.metadata.balanceRemaining).toBe(4995) // 5000 - 5
    expect(result.metadata.isSubscriber).toBe(true)
    expect(result.metadata.pricePerCredit).toBe(0.01)
  })
})
