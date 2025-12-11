/**
 * Integration tests for MCP handler authentication header propagation.
 * Tests that HTTP headers are correctly propagated from requests to the paywall.
 */

import { requestContextStorage } from '../../../src/mcp/http/mcp-handler.js'
import { PaywallAuthenticator } from '../../../src/mcp/core/auth.js'
import type { Payments } from '../../../src/payments.js'
import type { RequestContext } from '../../../src/mcp/http/session-manager.js'

/**
 * Mock Payments with call tracking for integration tests
 */
class PaymentsMockWithTracking {
  public calls: Array<[string, ...any[]]> = []
  public requests: any
  public agents: any

  constructor() {
    const self = this

    class Req {
      async startProcessingRequest(agentId: string, token: string, url: string, method: string) {
        self.calls.push(['start', agentId, token, url, method])
        return {
          agentRequestId: `req-${Date.now()}`,
          agentName: 'Integration Test Agent',
          agentId: agentId,
          balance: {
            isSubscriber: true,
            balance: 1000,
            creditsContract: '0xintegration',
            pricePerCredit: 0.01,
          },
          urlMatching: url,
          verbMatching: method,
        }
      }

      async redeemCreditsFromRequest(requestId: string, token: string, credits: bigint) {
        self.calls.push(['redeem', requestId, token, Number(credits)])
        return { success: true, txHash: '0xintegration123' }
      }
    }

    class Agents {
      async getAgentPlans(agentId: string) {
        self.calls.push(['getAgentPlans', agentId])
        return {
          plans: [
            { planId: 'int-plan-1', name: 'Integration Plan' },
            { planId: 'int-plan-2', name: 'Test Plan' },
          ],
        }
      }
    }

    this.requests = new Req()
    this.agents = new Agents()
  }
}

describe('MCP Handler - Auth Header Propagation', () => {
  test('should propagate Authorization header from HTTP request to paywall', async () => {
    const mockInstance = new PaymentsMockWithTracking()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    // Simulate HTTP request with headers
    const requestContext: RequestContext = {
      headers: {
        authorization: 'Bearer integration-token-456',
        host: 'localhost:3000',
        'user-agent': 'MCP-Client/1.0',
      },
      method: 'POST',
      url: '/mcp',
    }

    // Run authentication within request context storage
    const result = await requestContextStorage.run(requestContext, async () => {
      // Extra without explicit headers (should use context)
      const extra = {}
      return await authenticator.authenticate(
        extra,
        'did:nv:integration',
        'test-server',
        'weather',
        'tool',
        { city: 'Barcelona' },
      )
    })

    expect(result).toBeDefined()
    expect(result.token).toBe('integration-token-456')
    expect(result.agentId).toBe('did:nv:integration')

    // Verify the token was used in startProcessingRequest
    expect(
      mockInstance.calls.some(
        (c: any) =>
          c[0] === 'start' && c[2] === 'integration-token-456' && c[1] === 'did:nv:integration',
      ),
    ).toBe(true)
  })

  test('should prefer explicit Authorization in extra over request context', async () => {
    const mockInstance = new PaymentsMockWithTracking()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const requestContext: RequestContext = {
      headers: {
        authorization: 'Bearer context-token',
        host: 'localhost:3000',
      },
      method: 'POST',
      url: '/mcp',
    }

    const result = await requestContextStorage.run(requestContext, async () => {
      // Extra WITH explicit headers (should take precedence)
      const extra = {
        requestInfo: {
          headers: {
            authorization: 'Bearer explicit-token',
          },
        },
      }
      return await authenticator.authenticate(
        extra,
        'did:nv:integration',
        'test-server',
        'weather',
        'tool',
        {},
      )
    })

    // Should use the explicit token, not the context token
    expect(result.token).toBe('explicit-token')
    expect(mockInstance.calls.some((c: any) => c[0] === 'start' && c[2] === 'explicit-token')).toBe(
      true,
    )
    expect(mockInstance.calls.some((c: any) => c[0] === 'start' && c[2] === 'context-token')).toBe(
      false,
    )
  })

  test('should work with case-insensitive Authorization header', async () => {
    const mockInstance = new PaymentsMockWithTracking()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const requestContext: RequestContext = {
      headers: {
        Authorization: 'Bearer UPPERCASE-TOKEN',
        host: 'localhost:3000',
      },
      method: 'POST',
      url: '/mcp',
    }

    const result = await requestContextStorage.run(requestContext, async () => {
      return await authenticator.authenticate(
        {},
        'did:nv:integration',
        'test-server',
        'tool1',
        'tool',
        {},
      )
    })

    expect(result.token).toBe('UPPERCASE-TOKEN')
  })

  test('should handle missing Authorization header with proper error', async () => {
    const mockInstance = new PaymentsMockWithTracking()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const requestContext: RequestContext = {
      headers: {
        host: 'localhost:3000',
        'user-agent': 'MCP-Client/1.0',
        // No authorization header
      },
      method: 'POST',
      url: '/mcp',
    }

    await requestContextStorage.run(requestContext, async () => {
      await expect(
        authenticator.authenticate({}, 'did:nv:integration', 'test-server', 'tool1', 'tool', {}),
      ).rejects.toMatchObject({
        code: -32003,
        message: expect.stringContaining('Authorization required'),
        data: { reason: 'missing' },
      })
    })

    // Should not have called startProcessingRequest
    expect(mockInstance.calls.some((c: any) => c[0] === 'start')).toBe(false)
  })

  test('should propagate headers through multiple authentication calls', async () => {
    const mockInstance = new PaymentsMockWithTracking()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const requestContext: RequestContext = {
      headers: {
        authorization: 'Bearer session-token-789',
        host: 'api.example.com',
        'mcp-session-id': 'session-abc-123',
      },
      method: 'POST',
      url: '/mcp',
    }

    await requestContextStorage.run(requestContext, async () => {
      // First call - initialize
      const result1 = await authenticator.authenticateMeta(
        {},
        'did:nv:integration',
        'multi-server',
        'initialize',
      )
      expect(result1.token).toBe('session-token-789')

      // Second call - tools/list
      const result2 = await authenticator.authenticateMeta(
        {},
        'did:nv:integration',
        'multi-server',
        'tools/list',
      )
      expect(result2.token).toBe('session-token-789')

      // Third call - actual tool execution
      const result3 = await authenticator.authenticate(
        {},
        'did:nv:integration',
        'multi-server',
        'get_weather',
        'tool',
        { city: 'Valencia' },
      )
      expect(result3.token).toBe('session-token-789')
    })

    // All three calls should have used the same token
    const startCalls = mockInstance.calls.filter((c: any) => c[0] === 'start')
    expect(startCalls.length).toBe(3)
    expect(startCalls.every((c: any) => c[2] === 'session-token-789')).toBe(true)
  })

  test('should work without request context when extra has headers', async () => {
    const mockInstance = new PaymentsMockWithTracking()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    // No request context storage - running outside HTTP context
    const extra = {
      requestInfo: {
        headers: {
          authorization: 'Bearer standalone-token',
        },
      },
    }

    const result = await authenticator.authenticate(
      extra,
      'did:nv:integration',
      'standalone-server',
      'tool1',
      'tool',
      {},
    )

    expect(result).toBeDefined()
    expect(result.token).toBe('standalone-token')
  })
})
