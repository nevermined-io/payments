/**
 * Integration tests for MCP paywall with invalid token flows.
 * Tests complete authentication flow when tokens are invalid or insufficient.
 */

import { buildMcpIntegration } from '../../../src/mcp/index.js'
import type { Payments } from '../../../src/payments.js'

jest.mock('../../../src/utils.js', () => ({
  decodeAccessToken: jest.fn(() => ({
    x402Version: 2,
    accepted: {
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      planId: 'plan-basic',
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
 * Mock Payments that simulates various authentication failure scenarios
 */
class PaymentsMockWithFailures {
  public calls: Array<[string, ...any[]]> = []
  public facilitator: {
    verifyPermissions: jest.Mock
    settlePermissions: jest.Mock
  }
  public agents: {
    getAgentPlans: jest.Mock
  }
  private failureMode: 'none' | 'invalid-token' | 'not-subscriber' | 'insufficient-balance'

  constructor(
    failureMode: 'none' | 'invalid-token' | 'not-subscriber' | 'insufficient-balance' = 'none',
  ) {
    this.failureMode = failureMode
    this.facilitator = {
      verifyPermissions: jest.fn(async (params: any) => {
        this.calls.push(['verifyPermissions', params])
        if (this.failureMode === 'invalid-token' || this.failureMode === 'not-subscriber') {
          return { isValid: false, invalidReason: 'Payment required' }
        }
        return { isValid: true }
      }),
      settlePermissions: jest.fn(async (params: any) => {
        this.calls.push(['settle', params])
        if (this.failureMode === 'insufficient-balance') {
          throw new Error('Insufficient balance for redemption')
        }
        return {
          success: true,
          transaction: '0xtest123',
          network: 'eip155:84532',
          creditsRedeemed: String(params.maxAmount),
        }
      }),
    }

    this.agents = {
      getAgentPlans: jest.fn(async (agentId: string) => {
        this.calls.push(['getAgentPlans', agentId])
        return {
          plans: [
            { planId: 'plan-basic', name: 'Basic Plan', price: 10 },
            { planId: 'plan-pro', name: 'Pro Plan', price: 50 },
            { planId: 'plan-enterprise', name: 'Enterprise Plan', price: 200 },
          ],
        }
      }),
    }
  }
}

describe('MCP Paywall - Invalid Token Flow', () => {
  test('should reject with payment required when token is invalid', async () => {
    const mockInstance = new PaymentsMockWithFailures('invalid-token')
    const pm = mockInstance as any as Payments
    const mcp = buildMcpIntegration(pm)
    mcp.configure({ agentId: 'did:nv:test', serverName: 'test-server' })

    const handler = async (args: any) => {
      return { content: [{ type: 'text', text: `Weather in ${args.city}` }] }
    }

    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'weather', credits: 5n, planId: 'plan-basic' })

    // Attempt to call with invalid token
    await expect(
      wrapped(
        { city: 'Madrid' },
        { requestInfo: { headers: { authorization: 'Bearer invalid-token-xyz' } } },
      ),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Payment'),
    })

    // Should have attempted to verify permissions
    expect(mockInstance.calls.some((c: any) => c[0] === 'verifyPermissions')).toBe(true)

    // Should have fetched available plans for error message
    expect(mockInstance.calls.some((c: any) => c[0] === 'getAgentPlans')).toBe(true)

    // Should NOT have attempted to settle credits
    expect(mockInstance.calls.some((c: any) => c[0] === 'settle')).toBe(false)
  })

  test('should include plan information in error when token is invalid', async () => {
    const mockInstance = new PaymentsMockWithFailures('invalid-token')
    const pm = mockInstance as any as Payments
    const mcp = buildMcpIntegration(pm)
    mcp.configure({ agentId: 'did:nv:test', serverName: 'test-server' })

    const handler = async (args: any) => {
      return { content: [{ type: 'text', text: 'result' }] }
    }

    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'test', credits: 1n, planId: 'plan-basic' })

    try {
      await wrapped(
        { input: 'test' },
        { requestInfo: { headers: { authorization: 'Bearer bad-token' } } },
      )
      fail('Should have thrown')
    } catch (error: any) {
      // Error message should include available plans
      expect(error.message).toContain('Available plans')
      expect(error.message).toMatch(/plan-basic|plan-pro|plan-enterprise/)
    }
  })

  test('should reject when user is not a subscriber', async () => {
    const mockInstance = new PaymentsMockWithFailures('not-subscriber')
    const pm = mockInstance as any as Payments
    const mcp = buildMcpIntegration(pm)
    mcp.configure({ agentId: 'did:nv:test', serverName: 'test-server' })

    const handler = async (args: any) => {
      return { content: [{ type: 'text', text: 'result' }] }
    }

    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'test', credits: 1n, planId: 'plan-basic' })

    await expect(
      wrapped(
        { input: 'test' },
        { requestInfo: { headers: { authorization: 'Bearer valid-token' } } },
      ),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringContaining('Payment'),
      data: { reason: 'invalid' },
    })

    // Should have called verifyPermissions (which returned success: false)
    expect(mockInstance.calls.some((c: any) => c[0] === 'verifyPermissions')).toBe(true)

    // Should NOT have attempted to settle
    expect(mockInstance.calls.some((c: any) => c[0] === 'settle')).toBe(false)
  })

  test('should successfully process with valid token and sufficient balance', async () => {
    const mockInstance = new PaymentsMockWithFailures('none')
    const pm = mockInstance as any as Payments
    const mcp = buildMcpIntegration(pm)
    mcp.configure({ agentId: 'did:nv:test', serverName: 'test-server' })

    const handler = async (args: any) => {
      return {
        content: [{ type: 'text', text: `Processing ${args.action}` }],
      }
    }

    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'process', credits: 10n, planId: 'plan-basic' })

    const result = await wrapped(
      { action: 'analyze' },
      { requestInfo: { headers: { authorization: 'Bearer valid-token-123' } } },
    )

    expect(result).toBeDefined()
    expect(result.content[0].text).toBe('Processing analyze')

    // Should have completed full flow
    expect(mockInstance.calls.some((c: any) => c[0] === 'verifyPermissions')).toBe(true)
    expect(mockInstance.calls.some((c: any) => c[0] === 'settle')).toBe(true)

    // Should NOT have fetched plans (no error)
    expect(mockInstance.calls.some((c: any) => c[0] === 'getAgentPlans')).toBe(false)
  })

  test('should handle different tools with different credit requirements', async () => {
    const mockInstance = new PaymentsMockWithFailures('none')
    const pm = mockInstance as any as Payments
    const mcp = buildMcpIntegration(pm)
    mcp.configure({ agentId: 'did:nv:test', serverName: 'multi-tool-server' })

    const simpleHandler = async () => ({ content: [{ type: 'text', text: 'simple' }] })
    const complexHandler = async () => ({ content: [{ type: 'text', text: 'complex' }] })
    const premiumHandler = async () => ({ content: [{ type: 'text', text: 'premium' }] })

    const simpleTool = mcp.withPaywall(simpleHandler, {
      kind: 'tool',
      name: 'simple',
      credits: 1n,
      planId: 'plan-basic',
    })
    const complexTool = mcp.withPaywall(complexHandler, {
      kind: 'tool',
      name: 'complex',
      credits: 5n,
      planId: 'plan-basic',
    })
    const premiumTool = mcp.withPaywall(premiumHandler, {
      kind: 'tool',
      name: 'premium',
      credits: 20n,
      planId: 'plan-basic',
    })

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }

    // Execute all tools
    await simpleTool({}, extra)
    await complexTool({}, extra)
    await premiumTool({}, extra)

    // Verify different credit amounts were settled
    const settleCalls = mockInstance.calls.filter((c: any) => c[0] === 'settle')
    expect(settleCalls.length).toBe(3)
    expect(Number(settleCalls[0][1].maxAmount)).toBe(1) // simple tool
    expect(Number(settleCalls[1][1].maxAmount)).toBe(5) // complex tool
    expect(Number(settleCalls[2][1].maxAmount)).toBe(20) // premium tool
  })

  test('should propagate redemption errors when configured', async () => {
    const mockInstance = new PaymentsMockWithFailures('insufficient-balance')
    const pm = mockInstance as any as Payments
    const mcp = buildMcpIntegration(pm)
    mcp.configure({ agentId: 'did:nv:test', serverName: 'test-server' })

    const handler = async (args: any) => {
      return { content: [{ type: 'text', text: 'result' }] }
    }

    const wrapped = mcp.withPaywall(handler, {
      kind: 'tool',
      name: 'test',
      credits: 100n,
      planId: 'plan-basic',
      onRedeemError: 'propagate',
    })

    // Note: verifyPermissions succeeds but settlePermissions fails
    await expect(
      wrapped({ input: 'test' }, { requestInfo: { headers: { authorization: 'Bearer token' } } }),
    ).rejects.toMatchObject({
      code: -32002, // Misconfiguration error (ERROR_CODES.Misconfiguration)
      message: expect.stringContaining('Failed to redeem credits'),
    })
  })

  test('should ignore redemption errors by default', async () => {
    const mockInstance = new PaymentsMockWithFailures('insufficient-balance')
    const pm = mockInstance as any as Payments
    const mcp = buildMcpIntegration(pm)
    mcp.configure({ agentId: 'did:nv:test', serverName: 'test-server' })

    const handler = async (args: any) => {
      return { content: [{ type: 'text', text: 'result' }] }
    }

    // Default behavior: ignore redemption errors
    const wrapped = mcp.withPaywall(handler, {
      kind: 'tool',
      name: 'test',
      credits: 100n,
      planId: 'plan-basic',
      // onRedeemError defaults to 'ignore'
    })

    // Should not throw, even though redemption fails
    const result = await wrapped(
      { input: 'test' },
      { requestInfo: { headers: { authorization: 'Bearer token' } } },
    )

    expect(result).toBeDefined()
    expect(result.content[0].text).toBe('result')

    // When redemption fails silently, metadata is still added with success: true
    // but txHash will be undefined (only included when transaction has a value)
    expect(result.metadata).toBeDefined()
    expect(result.metadata.success).toBe(true)
    expect(result.metadata.txHash).toBeUndefined()
    expect(result.metadata.creditsRedeemed).toBe('100')
  })

  test('should handle multiple authentication failures in sequence', async () => {
    const mockInstance = new PaymentsMockWithFailures('invalid-token')
    const pm = mockInstance as any as Payments
    const mcp = buildMcpIntegration(pm)
    mcp.configure({ agentId: 'did:nv:test', serverName: 'test-server' })

    const handler = async () => ({ content: [{ type: 'text', text: 'ok' }] })
    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'test', credits: 1n, planId: 'plan-basic' })

    // Multiple failed attempts
    const attempts = 5
    for (let i = 0; i < attempts; i++) {
      await expect(
        wrapped({}, { requestInfo: { headers: { authorization: `Bearer bad-token-${i}` } } }),
      ).rejects.toMatchObject({
        code: -32003,
      })
    }

    // Should have attempted to verify permissions for each attempt
    const verifyCalls = mockInstance.calls.filter((c: any) => c[0] === 'verifyPermissions')
    expect(verifyCalls.length).toBe(attempts)

    // Should have fetched plans for each failure
    const planCalls = mockInstance.calls.filter((c: any) => c[0] === 'getAgentPlans')
    expect(planCalls.length).toBe(attempts)
  })
})
