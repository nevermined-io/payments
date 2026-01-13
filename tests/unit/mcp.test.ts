/**
 * Unit tests for MCP integration.
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
    planId: 'plan123',
    extra: { version: '1' },
  },
  payload: {
    signature: '0x123',
    authorization: {
      from: '0x123subscriber',
      sessionKeysProvider: 'zerodev',
      sessionKeys: [],
    },
  },
  extensions: {},
})
jest.spyOn(utils, 'decodeAccessToken').mockImplementation(mockDecodeToken as any)

class PaymentsMock {
  public calls: Array<[string, string, string, string | number, string?]> = []
  public requests: any
  public agents: any
  public facilitator: any

  constructor(settleResult?: any) {
    const settle_result = settleResult || { success: true }

    class Facilitator {
      private parent: PaymentsMock
      private settle_result: any

      constructor(parent: PaymentsMock, settle_result: any) {
        this.parent = parent
        this.settle_result = settle_result
      }

      async verifyPermissions(input: any) {
        const planId = typeof input === 'object' ? input.paymentRequired?.accepts?.[0]?.planId : input
        const maxAmount = typeof input === 'object' ? input.maxAmount : arguments[1]
        const x402AccessToken = typeof input === 'object' ? input.x402AccessToken : arguments[2]
        const subscriberAddress = typeof input === 'object' ? input.subscriberAddress : arguments[3]
        this.parent.calls.push([
          'verify',
          planId,
          x402AccessToken,
          Number(maxAmount),
          subscriberAddress,
        ])
        return { isValid: true }
      }

      async settlePermissions(input: any) {
        const planId = typeof input === 'object' ? input.paymentRequired?.accepts?.[0]?.planId : input
        const maxAmount = typeof input === 'object' ? input.maxAmount : arguments[1]
        const x402AccessToken = typeof input === 'object' ? input.x402AccessToken : arguments[2]
        const subscriberAddress = typeof input === 'object' ? input.subscriberAddress : arguments[3]
        this.parent.calls.push([
          'settle',
          planId,
          x402AccessToken,
          Number(maxAmount),
          subscriberAddress,
        ])
        return this.settle_result
      }
    }

    class Agents {
      async getAgentPlans(agentId: string) {
        return { plans: [] }
      }
    }

    this.facilitator = new Facilitator(this, settle_result)
    this.agents = new Agents()
  }
}

describe('MCP Integration', () => {
  describe('withPaywall', () => {
    test('should burn fixed credits after successful call', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      const base = async (_args: any, _extra?: any) => {
        return { content: [{ type: 'text', text: 'ok' }] }
      }

      const wrapped = mcp.withPaywall(base, {
        kind: 'tool',
        name: 'test',
        credits: 2n,
        planId: 'plan123',
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({}, extra)

      expect(out).toBeDefined()
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'verify' && c[1] === 'plan123' && c[2] === 'token',
        ),
      ).toBe(true)
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'settle' && c[1] === 'plan123' && c[2] === 'token' && c[3] === 2,
        ),
      ).toBe(true)
    })

    test('should add metadata to result after successful redemption', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      const base = async (_args: any, _extra?: any) => {
        return { content: [{ type: 'text', text: 'ok' }] }
      }

      const wrapped = mcp.withPaywall(base, {
        kind: 'tool',
        name: 'test',
        credits: 3n,
        planId: 'plan123',
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({}, extra)

      // Verify the result has metadata
      expect(out.metadata).toBeDefined()
      expect(out.metadata).not.toBeNull()
      expect(typeof out.metadata).toBe('object')

      // Verify metadata contains expected fields
      expect(out.metadata.success).toBe(true)
      expect(out.metadata.creditsRedeemed).toBe('3')
      // txHash should be undefined since our mock doesn't return it
      expect(out.metadata.txHash).toBeUndefined()
    })

    test('should add metadata with txHash when redeem returns it', async () => {
      const settleResult = { success: true, txHash: '0x1234567890abcdef' }
      const mockInstance = new PaymentsMock(settleResult)
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      const base = async (_args: any, _extra?: any) => {
        return { content: [{ type: 'text', text: 'ok' }] }
      }

      const wrapped = mcp.withPaywall(base, {
        kind: 'tool',
        name: 'test',
        credits: 5n,
        planId: 'plan123',
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({}, extra)

      // Verify the result has metadata
      expect(out.metadata).toBeDefined()
      expect(out.metadata).not.toBeNull()
      expect(typeof out.metadata).toBe('object')

      // Verify metadata contains expected fields including txHash
      expect(out.metadata.success).toBe(true)
      expect(out.metadata.creditsRedeemed).toBe('5')
      expect(out.metadata.txHash).toBe('0x1234567890abcdef')
    })

    test('should not add metadata when redemption fails', async () => {
      const redeemResult = { success: false, error: 'Insufficient credits' }
      const mockInstance = new PaymentsMock(redeemResult)
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      const base = async (_args: any, _extra?: any) => {
        return { content: [{ type: 'text', text: 'ok' }] }
      }

      const wrapped = mcp.withPaywall(base, {
        kind: 'tool',
        name: 'test',
        credits: 2n,
        planId: 'plan123',
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({}, extra)

      // Verify the result does not have metadata when redemption fails
      expect(out.metadata).toBeUndefined()
    })

    test('should reject when authorization header missing', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent' })

      const base = async (_args: any, _extra?: any) => {
        return {}
      }

      const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', credits: 1n })
      await expect(wrapped({}, { requestInfo: { headers: {} } })).rejects.toMatchObject({
        code: -32003,
      })
    })

    test('should burn dynamic credits from function', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'srv' })

      const base = async (_args: any, _extra?: any) => {
        return { content: [{ type: 'text', text: 'ok' }] }
      }

      const wrapped = mcp.withPaywall(base, {
        kind: 'tool',
        name: 'test',
        credits: (_ctx: any) => 7n,
        planId: 'plan123',
      })
      await wrapped({}, { requestInfo: { headers: { authorization: 'Bearer TT' } } })
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'settle' && c[1] === 'plan123' && c[2] === 'TT' && c[3] === 7,
        ),
      ).toBe(true)
    })

    test('should default to one credit when undefined', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:x', serverName: 'srv' })

      const base = async (_args: any, _extra?: any) => {
        return { res: true }
      }

      const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', planId: 'plan123' })
      await wrapped({}, { requestInfo: { headers: { Authorization: 'Bearer tok' } } })
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'settle' && c[1] === 'plan123' && c[2] === 'tok' && c[3] === 1,
        ),
      ).toBe(true)
    })

    test('should not redeem when zero credits', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:x', serverName: 'srv' })

      const base = async (_args: any, _extra?: any) => {
        return { res: true }
      }

      const wrapped = mcp.withPaywall(base, {
        kind: 'tool',
        name: 'test',
        credits: (_ctx: any) => 0n,
        planId: 'plan123',
      })
      await wrapped({}, { requestInfo: { headers: { Authorization: 'Bearer tok' } } })
      expect(mockInstance.calls.some((c: any) => c[0] === 'settle')).toBe(false)
    })
  })

  describe('attach', () => {
    test('should wrap and burn credits for registerResource', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'srv' })

      const captured: any = {}

      class Server {
        registerResource(name: string, template: any, config: any, handler: any) {
          captured.wrapped = handler
        }

        registerTool(name: string, config: any, handler: any) {
          captured.tool = handler
        }

        registerPrompt(name: string, config: any, handler: any) {
          captured.prompt = handler
        }
      }

      const api = mcp.attach(new Server())

      const handler = async (_uri: URL, _vars: any, _extra?: any) => {
        return {
          contents: [{ uri: 'mcp://srv/res', mimeType: 'application/json', text: '{}' }],
        }
      }

      api.registerResource('res.test', { tpl: true }, { cfg: true }, handler, {
        credits: 3n,
        planId: 'plan123',
      })
      const wrapped = captured.wrapped
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      await wrapped(new URL('mcp://srv/res'), { a: '1' }, extra)
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'settle' && c[1] === 'plan123' && c[2] === 'token' && c[3] === 3,
        ),
      ).toBe(true)
    })
  })

  describe('authorization headers', () => {
    test('should accept authorization from multiple header containers', async () => {
      const tokens = ['A', 'B', 'C', 'D', 'E']
      const variants = [
        { requestInfo: { headers: { authorization: `Bearer ${tokens[0]}` } } },
        { request: { headers: { Authorization: `Bearer ${tokens[1]}` } } },
        { headers: { authorization: `Bearer ${tokens[2]}` } },
        { connection: { headers: { authorization: `Bearer ${tokens[3]}` } } },
        {
          socket: {
            handshake: { headers: { Authorization: `Bearer ${tokens[4]}` } },
          },
        },
      ]

      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'mcp' })

      const base = async (_args: any, _extra?: any) => {
        return { ok: true }
      }

      const wrapped = mcp.withPaywall(base, {
        kind: 'tool',
        name: 'hdr',
        credits: 1n,
        planId: 'plan123',
      })
      for (let i = 0; i < variants.length; i++) {
        mockInstance.calls = []
        await wrapped({}, variants[i])
        expect(
          mockInstance.calls.some(
            (c: any) => c[0] === 'settle' && c[1] === 'plan123' && c[2] === tokens[i] && c[3] === 1,
          ),
        ).toBe(true)
      }
    })
  })

  describe('async iterables', () => {
    test('should redeem after async iterable completes', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'mcp' })

      async function* makeIterable(chunks: string[]) {
        for (const c of chunks) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          yield c
        }
      }

      const base = async (_args: any, _extra?: any) => {
        return makeIterable(['one', 'two', 'three'])
      }

      const wrapped = mcp.withPaywall(base, {
        kind: 'tool',
        name: 'stream',
        credits: 5n,
        planId: 'plan123',
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer tok' } } }
      const iterable = await wrapped({}, extra)
      // Not redeemed yet
      expect(mockInstance.calls.some((c: any) => c[0] === 'settle')).toBe(false)

      const collected: any[] = []
      for await (const chunk of iterable) {
        collected.push(chunk)
      }

      // The last chunk should be metadata
      expect(collected.length).toBeGreaterThanOrEqual(3)
      expect(collected.slice(0, 3)).toEqual(['one', 'two', 'three'])
      // Last chunk should be metadata
      const lastChunk = collected[collected.length - 1]
      expect(lastChunk.metadata).toBeDefined()
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'settle' && c[1] === 'plan123' && c[2] === 'tok' && c[3] === 5,
        ),
      ).toBe(true)
    })

    test('should redeem when consumer stops stream early', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'mcp' })

      async function* makeIterable(chunks: string[]) {
        for (const c of chunks) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          yield c
        }
      }

      const base = async (_args: any, _extra?: any) => {
        return makeIterable(['one', 'two', 'three'])
      }

      const wrapped = mcp.withPaywall(base, {
        kind: 'tool',
        name: 'stream',
        credits: 2n,
        planId: 'plan123',
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer tok' } } }
      const iterable = await wrapped({}, extra)

      let count = 0
      const iterator = iterable[Symbol.asyncIterator]()
      try {
        const result = await iterator.next()
        if (!result.done) {
          count++
        }
      } finally {
        if (iterator.return) {
          try {
            await iterator.return()
          } catch {
            // ignore
          }
        }
      }

      // Wait a bit for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(count).toBe(1)
      // Redemption should happen when stream is closed
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'settle' && c[1] === 'plan123' && c[2] === 'tok' && c[3] === 2,
        ),
      ).toBe(true)
    })
  })

  describe('PaywallContext', () => {
    class PaymentsMockWithAgentRequest {
      public calls: Array<[string, string, string, string | number, string?]> = []
      public requests: any
      public agents: any

      constructor(redeemResult?: any) {
        const redeem_result = redeemResult || { success: true }

        class Req {
          private parent: PaymentsMockWithAgentRequest
          private redeem_result: any

          constructor(parent: PaymentsMockWithAgentRequest, redeem_result: any) {
            this.parent = parent
            this.redeem_result = redeem_result
          }

          async startProcessingRequest(
            agentId: string,
            token: string,
            url: string,
            method: string,
            batch?: boolean,
          ) {
            this.parent.calls.push(['start', agentId, token, url, method])
            return {
              agentRequestId: 'req-123',
              agentName: 'Test Agent',
              agentId: agentId,
              balance: {
                balance: 1000,
                creditsContract: '0x123',
                isSubscriber: true,
                pricePerCredit: 0.01,
              },
              urlMatching: url,
              verbMatching: method,
              batch: batch || false,
            }
          }

          async redeemCreditsFromRequest(requestId: string, token: string, credits: bigint) {
            this.parent.calls.push(['redeem', requestId, token, Number(credits)])
            return this.redeem_result
          }
        }

        class Agents {
          async getAgentPlans(agentId: string) {
            return { plans: [] }
          }
        }

        this.requests = new Req(this, redeem_result)
        this.agents = new Agents()
      }
    }

    test('should work with handlers without context parameter', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      const oldHandler = async (args: any, extra?: any) => {
        return {
          content: [{ type: 'text', text: `Hello ${args.name || 'World'}` }],
        }
      }

      const wrapped = mcp.withPaywall(oldHandler, {
        kind: 'tool',
        name: 'test',
        credits: 2n,
        planId: 'plan123',
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({ name: 'Alice' }, extra)

      expect(out.content[0].text).toBe('Hello Alice')
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'verify' && c[1] === 'plan123' && c[2] === 'token',
        ),
      ).toBe(true)
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'settle' && c[1] === 'plan123' && c[2] === 'token' && c[3] === 2,
        ),
      ).toBe(true)
    })

    test('should provide PaywallContext to handlers with context parameter', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      let capturedContext: any = null

      const newHandler = async (args: any, extra?: any, context?: any) => {
        capturedContext = context
        return {
          content: [{ type: 'text', text: `Hello ${args.name || 'World'}` }],
        }
      }

      const wrapped = mcp.withPaywall(newHandler, {
        kind: 'tool',
        name: 'test',
        credits: 3n,
        planId: 'plan123',
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({ name: 'Bob' }, extra)

      expect(out.content[0].text).toBe('Hello Bob')
      expect(capturedContext).not.toBeNull()
      expect(typeof capturedContext).toBe('object')
    })

    test('should provide PaywallContext with all expected fields', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      let capturedContext: any = null

      const contextHandler = async (args: any, extra?: any, context?: any) => {
        capturedContext = context
        return { content: [{ type: 'text', text: 'ok' }] }
      }

      const wrapped = mcp.withPaywall(contextHandler, {
        kind: 'tool',
        name: 'test',
        credits: 5n,
        planId: 'plan123',
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      await wrapped({}, extra)

      // Verify PaywallContext structure
      expect(capturedContext).not.toBeNull()
      expect(capturedContext.authResult).toBeDefined()
      expect(capturedContext.credits).toBeDefined()
      expect(capturedContext.planId).toBeDefined()
      expect(capturedContext.subscriberAddress).toBeDefined()

      // Verify auth_result structure
      const authResult = capturedContext.authResult
      expect(authResult.token).toBe('token')
      expect(authResult.agentId).toBe('did:nv:agent')
      expect(authResult.logicalUrl).toMatch(/^mcp:\/\/test-mcp\/tools\/test/)
      expect(authResult.planId).toBe('plan123')
      expect(authResult.subscriberAddress).toBe('0x123subscriber')

      // Verify credits
      expect(capturedContext.credits).toBe(5n)
      expect(capturedContext.planId).toBe('plan123')
      expect(capturedContext.subscriberAddress).toBe('0x123subscriber')
    })

    test('should allow handlers to use agent request data from context', async () => {
      const mockInstance = new PaymentsMock()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      const businessLogicHandler = async (args: any, extra?: any, context?: any) => {
        if (!context) {
          return { error: 'No context provided' }
        }

        const authResult = context.authResult
        const credits = context.credits
        const planId = context.planId
        const subscriberAddress = context.subscriberAddress

        // Use agent request data for business logic
        if (!planId || !subscriberAddress) {
          return { error: 'Missing plan/subscriber' }
        }

        return {
          content: [{ type: 'text', text: 'Success' }],
          metadata: {
            agentId: authResult.agentId,
            planId,
            subscriberAddress,
            creditsUsed: Number(credits),
          },
        }
      }

      const wrapped = mcp.withPaywall(businessLogicHandler, {
        kind: 'tool',
        name: 'business',
        credits: 3n,
        planId: 'plan123',
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({ action: 'test' }, extra)

      // Verify handler used context data correctly
      expect(out.error).toBeUndefined()
      expect(out.content[0].text).toBe('Success')
      expect(out.metadata.agentId).toBe('did:nv:agent')
      expect(out.metadata.planId).toBe('plan123')
      expect(out.metadata.subscriberAddress).toBe('0x123subscriber')
      expect(out.metadata.creditsUsed).toBe(3)
    })
  })
})
