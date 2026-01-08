/**
 * Unit tests for MCP integration.
 */

import { buildMcpIntegration } from '../../src/mcp/index.js'
import type { Payments } from '../../src/payments.js'

class PaymentsMock {
  public calls: Array<[string, string, string, string | number, string?]> = []
  public requests: any
  public agents: any

  constructor(redeemResult?: any) {
    const redeem_result = redeemResult || { success: true }

    class Req {
      private parent: PaymentsMock
      private redeem_result: any

      constructor(parent: PaymentsMock, redeem_result: any) {
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
          agentRequestId: 'req-1',
          agentName: 'Test Agent',
          agentId: agentId,
          balance: {
            isSubscriber: true,
            balance: 1000,
            creditsContract: '0x123',
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

      const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', credits: 2n })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({}, extra)

      expect(out).toBeDefined()
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'start' && c[1] === 'did:nv:agent' && c[2] === 'token',
        ),
      ).toBe(true)
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'redeem' && c[1] === 'req-1' && c[2] === 'token' && c[3] === 2,
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

      const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', credits: 3n })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({}, extra)

      // Verify the result has metadata
      expect(out.metadata).toBeDefined()
      expect(out.metadata).not.toBeNull()
      expect(typeof out.metadata).toBe('object')

      // Verify metadata contains expected fields
      expect(out.metadata.success).toBe(true)
      expect(out.metadata.requestId).toBe('req-1')
      expect(out.metadata.creditsRedeemed).toBe('3')
      // txHash should be undefined since our mock doesn't return it
      expect(out.metadata.txHash).toBeUndefined()
    })

    test('should add metadata with txHash when redeem returns it', async () => {
      const redeemResult = { success: true, txHash: '0x1234567890abcdef' }
      const mockInstance = new PaymentsMock(redeemResult)
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      const base = async (_args: any, _extra?: any) => {
        return { content: [{ type: 'text', text: 'ok' }] }
      }

      const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', credits: 5n })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({}, extra)

      // Verify the result has metadata
      expect(out.metadata).toBeDefined()
      expect(out.metadata).not.toBeNull()
      expect(typeof out.metadata).toBe('object')

      // Verify metadata contains expected fields including txHash
      expect(out.metadata.success).toBe(true)
      expect(out.metadata.requestId).toBe('req-1')
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

      const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', credits: 2n })
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
      })
      await wrapped({}, { requestInfo: { headers: { authorization: 'Bearer TT' } } })
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'redeem' && c[1] === 'req-1' && c[2] === 'TT' && c[3] === 7,
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

      const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test' })
      await wrapped({}, { requestInfo: { headers: { Authorization: 'Bearer tok' } } })
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'redeem' && c[1] === 'req-1' && c[2] === 'tok' && c[3] === 1,
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
      })
      await wrapped({}, { requestInfo: { headers: { Authorization: 'Bearer tok' } } })
      expect(mockInstance.calls.some((c: any) => c[0] === 'redeem')).toBe(false)
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

      api.registerResource('res.test', { tpl: true }, { cfg: true }, handler, { credits: 3n })
      const wrapped = captured.wrapped
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      await wrapped(new URL('mcp://srv/res'), { a: '1' }, extra)
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'redeem' && c[1] === 'req-1' && c[2] === 'token' && c[3] === 3,
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

      const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'hdr', credits: 1n })
      for (let i = 0; i < variants.length; i++) {
        mockInstance.calls = []
        await wrapped({}, variants[i])
        expect(
          mockInstance.calls.some(
            (c: any) => c[0] === 'redeem' && c[1] === 'req-1' && c[2] === tokens[i] && c[3] === 1,
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

      const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'stream', credits: 5n })
      const extra = { requestInfo: { headers: { authorization: 'Bearer tok' } } }
      const iterable = await wrapped({}, extra)
      // Not redeemed yet
      expect(mockInstance.calls.some((c: any) => c[0] === 'redeem')).toBe(false)

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
          (c: any) => c[0] === 'redeem' && c[1] === 'req-1' && c[2] === 'tok' && c[3] === 5,
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

      const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'stream', credits: 2n })
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
          (c: any) => c[0] === 'redeem' && c[1] === 'req-1' && c[2] === 'tok' && c[3] === 2,
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
      const mockInstance = new PaymentsMockWithAgentRequest()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      const oldHandler = async (args: any, extra?: any) => {
        return {
          content: [{ type: 'text', text: `Hello ${args.name || 'World'}` }],
        }
      }

      const wrapped = mcp.withPaywall(oldHandler, { kind: 'tool', name: 'test', credits: 2n })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({ name: 'Alice' }, extra)

      expect(out.content[0].text).toBe('Hello Alice')
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'start' && c[1] === 'did:nv:agent' && c[2] === 'token',
        ),
      ).toBe(true)
      expect(
        mockInstance.calls.some(
          (c: any) => c[0] === 'redeem' && c[1] === 'req-123' && c[2] === 'token' && c[3] === 2,
        ),
      ).toBe(true)
    })

    test('should provide PaywallContext to handlers with context parameter', async () => {
      const mockInstance = new PaymentsMockWithAgentRequest()
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

      const wrapped = mcp.withPaywall(newHandler, { kind: 'tool', name: 'test', credits: 3n })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({ name: 'Bob' }, extra)

      expect(out.content[0].text).toBe('Hello Bob')
      expect(capturedContext).not.toBeNull()
      expect(typeof capturedContext).toBe('object')
    })

    test('should provide PaywallContext with all expected fields', async () => {
      const mockInstance = new PaymentsMockWithAgentRequest()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      let capturedContext: any = null

      const contextHandler = async (args: any, extra?: any, context?: any) => {
        capturedContext = context
        return { content: [{ type: 'text', text: 'ok' }] }
      }

      const wrapped = mcp.withPaywall(contextHandler, { kind: 'tool', name: 'test', credits: 5n })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      await wrapped({}, extra)

      // Verify PaywallContext structure
      expect(capturedContext).not.toBeNull()
      expect(capturedContext.authResult).toBeDefined()
      expect(capturedContext.credits).toBeDefined()
      expect(capturedContext.agentRequest).toBeDefined()

      // Verify auth_result structure
      const authResult = capturedContext.authResult
      expect(authResult.requestId).toBe('req-123')
      expect(authResult.token).toBe('token')
      expect(authResult.agentId).toBe('did:nv:agent')
      expect(authResult.logicalUrl).toMatch(/^mcp:\/\/test-mcp\/tools\/test/)
      expect(authResult.agentRequest).toBeDefined()

      // Verify agent_request structure
      const agentRequest = capturedContext.agentRequest
      expect(agentRequest.agentRequestId).toBe('req-123')
      expect(agentRequest.agentName).toBe('Test Agent')
      expect(agentRequest.agentId).toBe('did:nv:agent')
      expect(agentRequest.balance.isSubscriber).toBe(true)
      expect(agentRequest.balance.balance).toBe(1000)
      expect(agentRequest.urlMatching).toMatch(/^mcp:\/\/test-mcp\/tools\/test/)
      expect(agentRequest.verbMatching).toBe('POST')
      expect(agentRequest.batch).toBe(false)

      // Verify credits
      expect(capturedContext.credits).toBe(5n)
    })

    test('should allow handlers to use agent request data from context', async () => {
      const mockInstance = new PaymentsMockWithAgentRequest()
      const pm = mockInstance as any as Payments
      const mcp = buildMcpIntegration(pm)
      mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

      const businessLogicHandler = async (args: any, extra?: any, context?: any) => {
        if (!context) {
          return { error: 'No context provided' }
        }

        const agentRequest = context.agentRequest
        const authResult = context.authResult
        const credits = context.credits

        // Use agent request data for business logic
        if (!agentRequest.balance.isSubscriber) {
          return { error: 'Not a subscriber' }
        }

        if (agentRequest.balance.balance < Number(credits)) {
          return { error: 'Insufficient balance' }
        }

        return {
          content: [{ type: 'text', text: 'Success' }],
          metadata: {
            agentName: agentRequest.agentName,
            requestId: authResult.requestId,
            creditsUsed: Number(credits),
            balanceRemaining: agentRequest.balance.balance - Number(credits),
          },
        }
      }

      const wrapped = mcp.withPaywall(businessLogicHandler, {
        kind: 'tool',
        name: 'business',
        credits: 3n,
      })
      const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
      const out = await wrapped({ action: 'test' }, extra)

      // Verify handler used context data correctly
      expect(out.error).toBeUndefined()
      expect(out.content[0].text).toBe('Success')
      expect(out.metadata.agentName).toBe('Test Agent')
      expect(out.metadata.requestId).toBe('req-123')
      expect(out.metadata.creditsUsed).toBe(3)
      expect(out.metadata.balanceRemaining).toBe(997) // 1000 - 3
    })
  })
})
