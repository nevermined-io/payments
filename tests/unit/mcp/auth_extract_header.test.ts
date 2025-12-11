/**
 * Unit tests for PaywallAuthenticator header extraction and error handling
 */

import { PaywallAuthenticator } from '../../../src/mcp/core/auth.js'
import type { Payments } from '../../../src/payments.js'

/**
 * Mock Payments instance for testing
 */
class PaymentsMock {
  public calls: Array<[string, ...any[]]> = []
  public requests: any
  public agents: any
  private shouldReject: boolean
  private isSubscriber: boolean

  constructor(options?: { shouldReject?: boolean; isSubscriber?: boolean }) {
    this.shouldReject = options?.shouldReject ?? false
    this.isSubscriber = options?.isSubscriber ?? true

    const self = this

    class Req {
      async startProcessingRequest(agentId: string, token: string, url: string, method: string) {
        self.calls.push(['start', agentId, token, url, method])

        if (self.shouldReject) {
          throw new Error('Access denied')
        }

        return {
          agentRequestId: 'req-123',
          agentName: 'Test Agent',
          agentId: agentId,
          balance: {
            isSubscriber: self.isSubscriber,
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
          plans: [
            { planId: 'plan-1', name: 'Basic Plan' },
            { planId: 'plan-2', name: 'Pro Plan' },
          ],
        }
      }
    }

    this.requests = new Req()
    this.agents = new Agents()
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
      authenticator.authenticate(extra, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
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
      authenticator.authenticate(undefined, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
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
      authenticator.authenticate(null, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
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
      'did:nv:agent',
      'test-server',
      'tool1',
      'tool',
      {},
    )

    expect(result).toBeDefined()
    expect(result.token).toBe('test-token-123')
    expect(result.agentId).toBe('did:nv:agent')
    expect(result.requestId).toBe('req-123')
  })

  test('should extract Bearer token with capital Authorization', async () => {
    const mockInstance = new PaymentsMock()
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { Authorization: 'Bearer token-ABC' } } }

    const result = await authenticator.authenticate(
      extra,
      'did:nv:agent',
      'test-server',
      'tool1',
      'tool',
      {},
    )

    expect(result.token).toBe('token-ABC')
  })

  test('should reject when user is not a subscriber', async () => {
    const mockInstance = new PaymentsMock({ isSubscriber: false })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    await expect(
      authenticator.authenticate(extra, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Payment'),
      data: { reason: 'invalid' },
    })
  })

  test('should reject when access is denied and include available plans', async () => {
    const mockInstance = new PaymentsMock({ shouldReject: true })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer bad-token' } } }

    await expect(
      authenticator.authenticate(extra, 'did:nv:agent', 'test-server', 'tool1', 'tool', {}),
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
      await authenticator.authenticate(extra, 'did:nv:agent', 'test-server', 'tool1', 'tool', {})
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
      authenticator.authenticateMeta(extra, 'did:nv:agent', 'test-server', 'tools/list'),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Authorization required'),
      data: { reason: 'missing' },
    })
  })

  test('should reject meta operations when user is not subscriber', async () => {
    const mockInstance = new PaymentsMock({ isSubscriber: false })
    const pm = mockInstance as any as Payments
    const authenticator = new PaywallAuthenticator(pm)

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    await expect(
      authenticator.authenticateMeta(extra, 'did:nv:agent', 'test-server', 'initialize'),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Payment'),
      data: { reason: 'invalid' },
    })
  })
})
