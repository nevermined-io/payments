/**
 * Unit tests for PaywallAuthenticator HTTP URL fallback mechanism
 */

import { PaywallAuthenticator } from '../../../src/mcp/core/auth.js'
import { requestContextStorage } from '../../../src/mcp/http/mcp-handler.js'
import type { Payments } from '../../../src/payments.js'
import type { RequestContext } from '../../../src/mcp/http/session-manager.js'

/**
 * Mock Payments with configurable rejection behavior
 */
class PaymentsMockWithUrlTracking {
  public calls: Array<[string, ...any[]]> = []
  public requests: any
  public agents: any
  private logicalUrlShouldFail: boolean
  private httpUrlShouldFail: boolean

  constructor(options?: { logicalUrlShouldFail?: boolean; httpUrlShouldFail?: boolean }) {
    this.logicalUrlShouldFail = options?.logicalUrlShouldFail ?? false
    this.httpUrlShouldFail = options?.httpUrlShouldFail ?? false

    const self = this

    class Req {
      async startProcessingRequest(agentId: string, token: string, url: string, method: string) {
        self.calls.push(['start', agentId, token, url, method])

        // Simulate logical URL failure
        if (url.startsWith('mcp://') && self.logicalUrlShouldFail) {
          throw new Error('Logical URL not authorized')
        }

        // Simulate HTTP URL failure
        if (url.startsWith('http') && self.httpUrlShouldFail) {
          throw new Error('HTTP URL not authorized')
        }

        return {
          agentRequestId: 'req-456',
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
        }
      }
    }

    class Agents {
      async getAgentPlans(agentId: string) {
        self.calls.push(['getAgentPlans', agentId])
        return {
          plans: [{ planId: 'plan-1', name: 'Basic Plan' }],
        }
      }
    }

    this.requests = new Req()
    this.agents = new Agents()
  }
}

describe('PaywallAuthenticator - HTTP URL Fallback', () => {
  test('should try logical URL first, then HTTP URL on failure', async () => {
    const mockInstance = new PaymentsMockWithUrlTracking({ logicalUrlShouldFail: true })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    // Mock request context with HTTP headers
    const requestContext: RequestContext = {
      headers: {
        host: 'localhost:3000',
        'x-forwarded-proto': 'https',
      },
      method: 'POST',
      url: '/mcp',
    }

    // Run within requestContextStorage to provide HTTP context
    const result = await requestContextStorage.run(requestContext, async () => {
      return await authenticator.authenticate(
        extra,
        'did:nv:agent',
        'test-server',
        'tool1',
        'tool',
        { city: 'London' },
      )
    })

    expect(result).toBeDefined()
    expect(result.token).toBe('token')
    expect(result.agentId).toBe('did:nv:agent')

    // Should have tried logical URL first
    expect(mockInstance.calls.some((c: any) => c[0] === 'start' && c[3].startsWith('mcp://'))).toBe(
      true,
    )

    // Then tried HTTP URL
    expect(
      mockInstance.calls.some((c: any) => c[0] === 'start' && c[3].startsWith('https://')),
    ).toBe(true)

    // Should have used the HTTP URL in the result
    expect(result.logicalUrl).toBe('https://localhost:3000/mcp')
  })

  test('should use logical URL if it succeeds (no fallback)', async () => {
    const mockInstance = new PaymentsMockWithUrlTracking()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    const requestContext: RequestContext = {
      headers: {
        host: 'localhost:3000',
      },
      method: 'POST',
      url: '/mcp',
    }

    const result = await requestContextStorage.run(requestContext, async () => {
      return await authenticator.authenticate(
        extra,
        'did:nv:agent',
        'test-server',
        'tool1',
        'tool',
        {},
      )
    })

    expect(result).toBeDefined()

    // Should have tried logical URL
    expect(mockInstance.calls.some((c: any) => c[0] === 'start' && c[3].startsWith('mcp://'))).toBe(
      true,
    )

    // Should NOT have tried HTTP URL (logical succeeded)
    expect(mockInstance.calls.filter((c: any) => c[0] === 'start').length).toBe(1)

    // Result should use logical URL
    expect(result.logicalUrl).toContain('mcp://test-server')
  })

  test('should fail with plans message when both URLs fail', async () => {
    const mockInstance = new PaymentsMockWithUrlTracking({
      logicalUrlShouldFail: true,
      httpUrlShouldFail: true,
    })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    const requestContext: RequestContext = {
      headers: {
        host: 'localhost:3000',
      },
      method: 'POST',
      url: '/mcp',
    }

    await requestContextStorage.run(requestContext, async () => {
      await expect(
        authenticator.authenticate(extra, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
      ).rejects.toMatchObject({
        code: -32003,
        message: expect.stringContaining('Available plans'),
        data: { reason: 'invalid' },
      })
    })

    // Should have tried both URLs
    expect(mockInstance.calls.filter((c: any) => c[0] === 'start').length).toBe(2)

    // Should have fetched plans for error message
    expect(mockInstance.calls.some((c: any) => c[0] === 'getAgentPlans')).toBe(true)
  })

  test('should build HTTP URL from x-forwarded-host header', async () => {
    const mockInstance = new PaymentsMockWithUrlTracking({ logicalUrlShouldFail: true })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    const requestContext: RequestContext = {
      headers: {
        'x-forwarded-host': 'example.com',
        'x-forwarded-proto': 'https',
      },
      method: 'POST',
      url: '/mcp',
    }

    const result = await requestContextStorage.run(requestContext, async () => {
      return await authenticator.authenticate(
        extra,
        'did:nv:agent',
        'test-server',
        'tool1',
        'tool',
        {},
      )
    })

    expect(result.logicalUrl).toBe('https://example.com/mcp')
  })

  test('should default to http protocol when x-forwarded-proto is missing', async () => {
    const mockInstance = new PaymentsMockWithUrlTracking({ logicalUrlShouldFail: true })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    const requestContext: RequestContext = {
      headers: {
        host: 'localhost:5000',
      },
      method: 'POST',
      url: '/mcp',
    }

    const result = await requestContextStorage.run(requestContext, async () => {
      return await authenticator.authenticate(
        extra,
        'did:nv:agent',
        'test-server',
        'tool1',
        'tool',
        {},
      )
    })

    expect(result.logicalUrl).toBe('http://localhost:5000/mcp')
  })

  test('should fail with logical URL when no HTTP context is available', async () => {
    const mockInstance = new PaymentsMockWithUrlTracking({ logicalUrlShouldFail: true })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    // No requestContextStorage, so no HTTP fallback available
    await expect(
      authenticator.authenticate(extra, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
    ).rejects.toMatchObject({
      code: -32003,
      data: { reason: 'invalid' },
    })

    // Should have tried logical URL but not HTTP (no context)
    expect(
      mockInstance.calls.filter((c: any) => c[0] === 'start' && c[3].startsWith('mcp://')).length,
    ).toBe(1)
    expect(
      mockInstance.calls.filter((c: any) => c[0] === 'start' && c[3].startsWith('http')).length,
    ).toBe(0)
  })
})

describe('PaywallAuthenticator - authenticateMeta with HTTP fallback', () => {
  test('should use HTTP fallback for meta operations when logical URL fails', async () => {
    const mockInstance = new PaymentsMockWithUrlTracking({ logicalUrlShouldFail: true })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    const requestContext: RequestContext = {
      headers: {
        host: 'api.example.com',
        'x-forwarded-proto': 'https',
      },
      method: 'POST',
      url: '/mcp',
    }

    const result = await requestContextStorage.run(requestContext, async () => {
      return await authenticator.authenticateMeta(
        extra,
        'did:nv:agent',
        'test-server',
        'initialize',
      )
    })

    expect(result).toBeDefined()
    expect(result.logicalUrl).toBe('https://api.example.com/mcp')

    // Should have tried both URLs
    expect(mockInstance.calls.filter((c: any) => c[0] === 'start').length).toBe(2)
  })
})
