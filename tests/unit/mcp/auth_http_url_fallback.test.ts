/**
 * Unit tests for PaywallAuthenticator HTTP URL fallback mechanism
 */

import { PaywallAuthenticator } from '../../../src/mcp/core/auth.js'
import { requestContextStorage } from '../../../src/mcp/http/mcp-handler.js'
import type { RequestContext } from '../../../src/mcp/http/session-manager.js'
import type { Payments } from '../../../src/payments.js'

// Mock decodeAccessToken to provide x402-compliant token structure
jest.mock('../../../src/utils.js', () => ({
  decodeAccessToken: jest.fn(() => ({
    x402Version: 2,
    accepted: {
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      planId: 'plan-1',
      extra: { version: '1' },
    },
    payload: {
      signature: '0x123',
      authorization: {
        from: '0xabc',
        sessionKeysProvider: 'zerodev',
        sessionKeys: [],
      },
    },
    extensions: {},
  })),
}))

/**
 * Simple Payments mock that tracks calls to facilitator.verifyPermissions and agents.getAgentPlans.
 * verifyPermissions can be configured per-test to succeed or fail in sequence.
 */
class PaymentsMock {
  public facilitator: {
    verifyPermissions: jest.Mock
  }
  public agents: {
    getAgentPlans: jest.Mock
  }

  constructor(verifySequence: Array<{ isValid: boolean }> = [{ isValid: true }]) {
    this.facilitator = {
      verifyPermissions: jest.fn(),
    }
    verifySequence.forEach((result) => {
      this.facilitator.verifyPermissions.mockResolvedValueOnce(result)
    })

    this.agents = {
      getAgentPlans: jest.fn().mockResolvedValue({
        plans: [{ planId: 'plan-1', name: 'Basic Plan' }],
      }),
    }
  }
}

describe('PaywallAuthenticator - HTTP URL Fallback', () => {
  test('should try logical URL first, then HTTP URL on failure', async () => {
    const payments = new PaymentsMock([{ isValid: false }, { isValid: true }]) as any as Payments
    const authenticator = new PaywallAuthenticator(payments)

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
        { planId: 'plan-1' },
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

    // Should have attempted two validations (logical then HTTP fallback)
    expect((payments as any).facilitator.verifyPermissions).toHaveBeenCalledTimes(2)

    // Logical URL is always returned (fallback only changes verification origin)
    expect(result.logicalUrl).toBe('mcp://test-server/tools/tool1?city=London')
  })

  test('should use logical URL if it succeeds (no fallback)', async () => {
    const payments = new PaymentsMock([{ isValid: true }]) as any as Payments
    const authenticator = new PaywallAuthenticator(payments)

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
        { planId: 'plan-1' },
        'did:nv:agent',
        'test-server',
        'tool1',
        'tool',
        {},
      )
    })

    expect(result).toBeDefined()

    // Should have tried only once (logical succeeded)
    expect((payments as any).facilitator.verifyPermissions).toHaveBeenCalledTimes(1)

    // Result should use logical URL
    expect(result.logicalUrl).toContain('mcp://test-server')
  })

  test('should fail with plans message when both URLs fail', async () => {
    const payments = new PaymentsMock([{ isValid: false }, { isValid: false }]) as any as Payments
    const authenticator = new PaywallAuthenticator(payments)

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
        authenticator.authenticate(extra, { planId: 'plan-1' }, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
      ).rejects.toMatchObject({
        code: -32003,
        message: expect.stringContaining('Available plans'),
        data: { reason: 'invalid' },
      })
    })

    // Should have tried both validations and fetched plans
    expect((payments as any).facilitator.verifyPermissions).toHaveBeenCalledTimes(2)
    expect((payments as any).agents.getAgentPlans).toHaveBeenCalledTimes(1)
  })

  test('should build HTTP URL from x-forwarded-host header', async () => {
    const payments = new PaymentsMock([{ isValid: false }, { isValid: true }]) as any as Payments
    const authenticator = new PaywallAuthenticator(payments)

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
        { planId: 'plan-1' },
        'did:nv:agent',
        'test-server',
        'tool1',
        'tool',
        {},
      )
    })

    // Fallback still returns logical URL (verification retried with HTTP endpoint)
    expect(result.logicalUrl).toBe('mcp://test-server/tools/tool1')
  })

  test('should default to http protocol when x-forwarded-proto is missing', async () => {
    const payments = new PaymentsMock([{ isValid: false }, { isValid: true }]) as any as Payments
    const authenticator = new PaywallAuthenticator(payments)

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
        { planId: 'plan-1' },
        'did:nv:agent',
        'test-server',
        'tool1',
        'tool',
        {},
      )
    })

    expect(result.logicalUrl).toBe('mcp://test-server/tools/tool1')
  })

  test('should fail with logical URL when no HTTP context is available', async () => {
    const payments = new PaymentsMock([{ isValid: false }]) as any as Payments
    const authenticator = new PaywallAuthenticator(payments)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    // No requestContextStorage, so no HTTP fallback available
    await expect(
      authenticator.authenticate(extra, { planId: 'plan-1' }, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
    ).rejects.toMatchObject({
      code: -32003,
      data: { reason: 'invalid' },
    })

    // Should have tried logical URL once and fetched plans, no HTTP fallback without context
    expect((payments as any).facilitator.verifyPermissions).toHaveBeenCalledTimes(1)
    expect((payments as any).agents.getAgentPlans).toHaveBeenCalledTimes(1)
  })
})

describe('PaywallAuthenticator - authenticateMeta with HTTP fallback', () => {
  test('should use HTTP fallback for meta operations when logical URL fails', async () => {
    const payments = new PaymentsMock([{ isValid: false }, { isValid: true }]) as any as Payments
    const authenticator = new PaywallAuthenticator(payments)

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
        { planId: 'plan-1' },
        'did:nv:agent',
        'test-server',
        'initialize',
      )
    })

    expect(result).toBeDefined()
    expect(result.logicalUrl).toBe('https://api.example.com/mcp')

    // Should have tried both logical and HTTP fallback validations
    expect((payments as any).facilitator.verifyPermissions).toHaveBeenCalledTimes(2)
  })
})
