/**
 * Integration tests for MCP integration.
 */

import { buildMcpIntegration } from '../../src/mcp/index.js'
import type { Payments } from '../../src/payments.js'
import * as utils from '../../src/utils.js'

// Mock decodeAccessToken to provide x402-compliant token structure
const mockDecodeToken = (_token: string) => ({
  x402Version: 2,
  accepted: {
    scheme: 'nvm:erc4337',
    network: 'eip155:84532',
    planId: 'plan-123',
    extra: { version: '1' },
  },
  payload: {
    signature: '0x123',
    authorization: {
      from: '0xSubscriber123',
      sessionKeysProvider: 'zerodev',
      sessionKeys: [],
    },
  },
  extensions: {},
})

jest.spyOn(utils, 'decodeAccessToken').mockImplementation(mockDecodeToken as any)


class PaymentsMinimal {
  public facilitator: any
  public agents: any

  constructor(subscriber = true) {
    class Facilitator {
      private outer: PaymentsMinimal
      private subscriber: boolean

      constructor(outer: PaymentsMinimal, subscriber: boolean) {
        this.outer = outer
        this.subscriber = subscriber
      }

      async verifyPermissions(params: any) {
        if (!this.subscriber) {
          throw new Error('Subscriber not found')
        }
        return { isValid: true }
      }

      async settlePermissions(params: any) {
        return { success: true, transaction: '0x1234567890abcdef', network: 'eip155:84532', creditsRedeemed: String(params.maxAmount) }
      }
    }

    class Agents {
      async getAgentPlans(agentId: string) {
        return { plans: [] }
      }
    }

    this.facilitator = new Facilitator(this, subscriber)
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

    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'test', credits: 1n, planId: 'plan-123' })
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

    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'test', credits: 1n, planId: 'plan-123' })

    await expect(
      wrapped({ city: 'Madrid' }, { requestInfo: { headers: { Authorization: 'Bearer tok' } } }),
    ).rejects.toMatchObject({
      code: -32003,
    })
  })

  test('should provide PaywallContext with realistic agent request data', async () => {
    class PaymentsWithX402 {
      public facilitator: any
      public agents: any

      constructor(subscriber = true) {
        class Facilitator {
          private outer: PaymentsWithX402
          private subscriber: boolean

          constructor(outer: PaymentsWithX402, subscriber: boolean) {
            this.outer = outer
            this.subscriber = subscriber
          }
          async verifyPermissions(params: any) {
            if (!this.subscriber) {
              throw new Error('Subscriber not found')
            }
            return { isValid: true }
          }

          async settlePermissions(params: any) {
            const planId = params.paymentRequired?.accepts?.[0]?.planId || 'plan-123'
            const maxAmount = params.maxAmount || 0n
            const hash = `${planId}-${maxAmount}`
              .split('')
              .reduce((acc, char) => acc + char.charCodeAt(0), 0)
            return { success: true, transaction: `0x${(hash % 1000000000).toString(16)}`, network: 'eip155:84532', creditsRedeemed: String(maxAmount) }
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

        this.facilitator = new Facilitator(this, subscriber)
        this.agents = new Agents()
      }
    }

    const payments = new PaymentsWithX402(true) as any as Payments
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
          agentId: authResult.agentId,
          planId: context.planId,
          subscriberAddress: context.subscriberAddress,
          creditsUsed: Number(credits),
          weatherData: weatherData,
        },
      }
    }

    const wrapped = mcp.withPaywall(weatherHandler, {
      kind: 'tool',
      name: 'get-weather',
      credits: 5n,
      planId: 'plan-123',
    })

    const extra = { requestInfo: { headers: { authorization: 'Bearer weather-token-123' } } }
    const result = await wrapped({ city: 'Madrid' }, extra)

    // Verify the handler executed successfully
    expect(result.error).toBeUndefined()
    expect(result.content[0].text).toContain('Weather in Madrid: 22°C, sunny')

    // Verify context was captured
    expect(capturedContexts.length).toBe(1)
    const context = capturedContexts[0]

    // Verify x402 PaywallContext structure
    expect(context.authResult.token).toBe('weather-token-123')
    expect(context.authResult.agentId).toBe('did:nv:agent:abc123')
    expect(context.authResult.planId).toBe('plan-123')
    expect(context.authResult.subscriberAddress).toBe('0xSubscriber123')
    expect(context.authResult.logicalUrl).toContain('mcp://weather-service/tools/get-weather')


    // Verify credits
    expect(context.credits).toBe(5n)

    // Verify metadata in result
    expect(result.metadata.agentId).toBe('did:nv:agent:abc123')
    expect(result.metadata.planId).toBe('plan-123')
    expect(result.metadata.subscriberAddress).toBe('0xSubscriber123')
    expect(result.metadata.creditsUsed).toBe(5)
  })
})
