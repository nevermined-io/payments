import { buildMcpIntegration } from '../../src/mcp/index.js'

describe('MCP Paywall (integration)', () => {
  it('validates and burns with minimal mocks', async () => {
    const payments: any = {
      requests: {
        startProcessingRequest: jest
          .fn()
          .mockResolvedValue({ agentRequestId: 'req-xyz', balance: { isSubscriber: true } }),
        redeemCreditsFromRequest: jest.fn().mockResolvedValue({ success: true }),
      },
      agents: { getAgentPlans: jest.fn().mockResolvedValue({ plans: [] }) },
    }
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:agent', serverName: 'mcp-int' })

    const handler = async (_args: any) => ({ content: [{ type: 'text', text: 'hello' }] })
    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'test', credits: 1n })

    const extra = { requestInfo: { headers: { Authorization: 'Bearer abc' } } }
    const out = await wrapped({ city: 'Madrid' }, extra)
    expect(out).toBeDefined()
    expect(payments.requests.startProcessingRequest).toHaveBeenCalledWith(
      'did:nv:agent',
      'abc',
      expect.stringContaining('mcp://mcp-int/tools'),
      'POST',
    )
    expect(payments.requests.redeemCreditsFromRequest).toHaveBeenCalledWith('req-xyz', 'abc', 1n)
  })

  it('integration edge: not subscriber triggers -32003 and plan suggestions (best effort)', async () => {
    const payments: any = {
      requests: {
        startProcessingRequest: jest
          .fn()
          .mockResolvedValue({ agentRequestId: 'r', balance: { isSubscriber: false } }),
      },
      agents: {
        getAgentPlans: jest.fn().mockResolvedValue({ plans: [{ planId: 'p1', name: 'Basic' }] }),
      },
    }
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:agent', serverName: 'mcp-int' })

    const handler = async (_args: any) => ({ content: [{ type: 'text', text: 'hello' }] })
    const wrapped = mcp.withPaywall(handler, { kind: 'tool', name: 'test', credits: 1n })

    await expect(
      wrapped({ city: 'Madrid' }, { requestInfo: { headers: { Authorization: 'Bearer tok' } } }),
    ).rejects.toMatchObject({ code: -32003 })
  })
})
