/**
 * Unit tests for PaywallAuthenticator header extraction and error handling
 */

import { PaywallAuthenticator } from '../../../src/mcp/core/auth.js'
import type { Payments } from '../../../src/payments.js'

jest.mock('../../../src/utils.js', () => ({
  decodeAccessToken: jest.fn(() => ({
    planId: 'plan-1',
    subscriberAddress: '0xabc',
  })),
}))

/**
 * Mock Payments instance for testing
 */
class PaymentsMock {
  public facilitator: {
    verifyPermissions: jest.Mock
  }
  public agents: {
    getAgentPlans: jest.Mock
  }
  public calls: Array<[string, ...any[]]> = []

  constructor(options?: { shouldReject?: boolean }) {
    const shouldReject = options?.shouldReject ?? false

    this.facilitator = {
      verifyPermissions: jest.fn(async (params: any) => {
        this.calls.push(['verifyPermissions', params])
        if (shouldReject) {
          return { success: false, message: 'Access denied' }
        }
        return { success: true }
      }),
    }

    this.agents = {
      getAgentPlans: jest.fn(async (agentId: string) => {
        this.calls.push(['getAgentPlans', agentId])
        return {
          plans: [
            { planId: 'plan-1', name: 'Basic Plan' },
            { planId: 'plan-2', name: 'Pro Plan' },
          ],
        }
      }),
    }
  }
}

describe('PaywallAuthenticator - Header Extraction', () => {
  test('should reject when authorization header is missing', async () => {
    const mockInstance = new PaymentsMock()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    // Extra without authorization header
    const extra = { requestInfo: { headers: {} } }

    await expect(
      authenticator.authenticate(extra, {}, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Authorization required'),
      data: { reason: 'missing' },
    })
  })

  test('should reject when extra is undefined', async () => {
    const mockInstance = new PaymentsMock()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    await expect(
      authenticator.authenticate(undefined, {}, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Authorization required'),
      data: { reason: 'missing' },
    })
  })

  test('should reject when extra is null', async () => {
    const mockInstance = new PaymentsMock()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    await expect(
      authenticator.authenticate(null, {}, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Authorization required'),
      data: { reason: 'missing' },
    })
  })

  test('should extract Bearer token from authorization header', async () => {
    const mockInstance = new PaymentsMock()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer test-token-123' } } }

    const result = await authenticator.authenticate(
      extra,
      { planId: 'plan-1' },
      'did:nv:agent',
      'test-server',
      'tool1',
      'tool',
      {},
    )

    expect(result).toBeDefined()
    expect(result.token).toBe('test-token-123')
    expect(result.agentId).toBe('did:nv:agent')
    expect(result.planId).toBe('plan-1')
    expect(result.subscriberAddress).toBe('0xabc')
  })

  test('should extract Bearer token with capital Authorization', async () => {
    const mockInstance = new PaymentsMock()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { Authorization: 'Bearer token-ABC' } } }

    const result = await authenticator.authenticate(
      extra,
      { planId: 'plan-1' },
      'did:nv:agent',
      'test-server',
      'tool1',
      'tool',
      {},
    )

    expect(result.token).toBe('token-ABC')
  })

  test('should reject when user is not a subscriber', async () => {
    const mockInstance = new PaymentsMock({ shouldReject: true })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    await expect(
      authenticator.authenticate(extra, { planId: 'plan-1' }, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Payment required'),
      data: { reason: 'invalid' },
    })
  })

  test('should reject when access is denied and include available plans', async () => {
    const mockInstance = new PaymentsMock({ shouldReject: true })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer bad-token' } } }

    await expect(
      authenticator.authenticate(extra, { planId: 'plan-1' }, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Available plans'),
      data: { reason: 'invalid' },
    })

    // Should have called getAgentPlans to fetch available plans
    expect(
      mockInstance.calls.some((c: any) => c[0] === 'getAgentPlans' && c[1] === 'did:nv:agent'),
    ).toBe(true)
  })

  test('should include plan information in error message', async () => {
    const mockInstance = new PaymentsMock({ shouldReject: true })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    try {
      await authenticator.authenticate(extra, { planId: 'plan-1' }, 'did:nv:agent', 'test-server', 'tool1', 'tool', {})
      fail('Should have thrown')
    } catch (error: any) {
      expect(error.message).toContain('plan-1')
      expect(error.message).toContain('Basic Plan')
    }
  })
})

describe('PaywallAuthenticator - authenticateMeta', () => {
  test('should authenticate meta operations (initialize, tools/list)', async () => {
    const mockInstance = new PaymentsMock()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer meta-token' } } }

    const result = await authenticator.authenticateMeta(
      extra,
      { planId: 'plan-1' },
      'did:nv:agent',
      'test-server',
      'initialize',
    )

    expect(result).toBeDefined()
    expect(result.token).toBe('meta-token')
    expect(result.agentId).toBe('did:nv:agent')
    expect(result.logicalUrl).toContain('test-server')
    expect(result.logicalUrl).toContain('initialize')
  })

  test('should reject meta operations without authorization', async () => {
    const mockInstance = new PaymentsMock()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: {} } }

    await expect(
      authenticator.authenticateMeta(extra, {}, 'did:nv:agent', 'test-server', 'tools/list'),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Authorization required'),
      data: { reason: 'missing' },
    })
  })

  test('should reject meta operations when user is not subscriber', async () => {
    const mockInstance = new PaymentsMock({ shouldReject: true })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    await expect(
      authenticator.authenticateMeta(extra, { planId: 'plan-1' }, 'did:nv:agent', 'test-server', 'initialize'),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Payment required'),
      data: { reason: 'invalid' },
    })
  })
})
