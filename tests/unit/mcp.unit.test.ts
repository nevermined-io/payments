import { buildMcpIntegration } from '../../src/mcp/index.js'

describe('MCP Paywall (unit + edge cases)', () => {
  function createPaymentsMock(overrides: any = {}) {
    return {
      requests: {
        startProcessingRequest: jest.fn().mockResolvedValue({
          agentRequestId: 'req-1',
          balance: { isSubscriber: true },
        }),
        redeemCreditsFromRequest: jest.fn().mockResolvedValue({ success: true }),
      },
      agents: { getAgentPlans: jest.fn().mockResolvedValue({ plans: [] }) },
      ...overrides,
    }
  }

  it('burns fixed credits after successful call', async () => {
    const mockPayments = createPaymentsMock()
    const mcp = buildMcpIntegration(mockPayments)
    mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

    const base = async () => ({ content: [{ type: 'text', text: 'ok' }] })
    const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', credits: 2n })

    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
    const res = await wrapped({}, extra)
    expect(res).toBeDefined()
    expect(mockPayments.requests.startProcessingRequest).toHaveBeenCalled()
    expect(mockPayments.requests.redeemCreditsFromRequest).toHaveBeenCalledWith(
      'req-1',
      'token',
      2n,
    )
  })

  it('rejects when Authorization header is missing', async () => {
    const mockPayments = createPaymentsMock()
    const mcp = buildMcpIntegration(mockPayments)
    mcp.configure({ agentId: 'did:nv:agent' })

    const base = async () => ({})
    const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', credits: 1n })
    await expect(wrapped({}, { requestInfo: { headers: {} } })).rejects.toMatchObject({
      code: -32003,
    })
  })

  it('burns dynamic credits from function', async () => {
    const payments = createPaymentsMock()
    const mcp = buildMcpIntegration(payments as any)
    mcp.configure({ agentId: 'did:nv:agent', serverName: 'test' })
    const base = async () => ({ content: [{ type: 'text', text: 'ok' }] })
    const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', credits: () => 7n })
    await wrapped({}, { requestInfo: { headers: { authorization: 'Bearer TT' } } })
    expect(payments.requests.redeemCreditsFromRequest).toHaveBeenCalledWith('req-1', 'TT', 7n)
  })

  it('defaults to 1 credit when credits option is undefined', async () => {
    const payments = createPaymentsMock()
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:x', serverName: 'srv' })

    const base = async () => ({ res: true })
    const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test' })
    await wrapped({}, { requestInfo: { headers: { Authorization: 'Bearer tok' } } })
    expect(payments.requests.redeemCreditsFromRequest).toHaveBeenCalledWith('req-1', 'tok', 1n)
  })

  it('does not redeem when credits returns 0n', async () => {
    const payments = createPaymentsMock()
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:x', serverName: 'srv' })

    const base = async () => ({ res: true })
    const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', credits: () => 0n })
    await wrapped({}, { requestInfo: { headers: { Authorization: 'Bearer tok' } } })
    expect(payments.requests.redeemCreditsFromRequest).not.toHaveBeenCalled()
  })

  it('propagates error when redeem fails and onRedeemError=propagate', async () => {
    const payments = createPaymentsMock({
      requests: {
        startProcessingRequest: jest
          .fn()
          .mockResolvedValue({ agentRequestId: 'r', balance: { isSubscriber: true } }),
        redeemCreditsFromRequest: jest.fn().mockRejectedValue(new Error('redeem failed')),
      },
    })
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:x', serverName: 'srv' })

    const base = async () => ({ ok: true })
    const wrapped = mcp.withPaywall(base, {
      kind: 'tool',
      name: 'test',
      credits: 1n,
      onRedeemError: 'propagate',
    })
    await expect(
      wrapped({}, { requestInfo: { headers: { Authorization: 'Bearer tok' } } }),
    ).rejects.toMatchObject({
      code: -32002,
    })
  })

  it('returns Payment required (-32003) when not subscriber; includes plans', async () => {
    const payments = createPaymentsMock({
      requests: {
        startProcessingRequest: jest
          .fn()
          .mockResolvedValue({ agentRequestId: 'r', balance: { isSubscriber: false } }),
      },
      agents: {
        getAgentPlans: jest.fn().mockResolvedValue({ plans: [{ planId: 'p1', name: 'Basic' }] }),
      },
    })
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:x', serverName: 'srv' })

    const base = async () => ({ ok: true })
    const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'test', credits: 1n })
    await expect(
      wrapped({}, { requestInfo: { headers: { Authorization: 'Bearer tok' } } }),
    ).rejects.toMatchObject({ code: -32003 })
  })

  it('registerResource via attach wraps handler and burns credits', async () => {
    const mockPayments = createPaymentsMock()
    const mcp = buildMcpIntegration(mockPayments)
    mcp.configure({ agentId: 'did:nv:agent', serverName: 'test-mcp' })

    // Fake MCP server with jest spies
    const server = {
      registerResource: jest.fn(),
      registerTool: jest.fn(),
      registerPrompt: jest.fn(),
    }

    const { registerResource } = mcp.attach(server)

    const handler = async (_uri: URL, _vars: Record<string, string | string[]>) => ({
      contents: [{ uri: 'mcp://srv/res', mimeType: 'application/json', text: '{}' }],
    })

    registerResource('res.test', { tpl: true }, { cfg: true }, handler, { credits: 3n })

    // Call the wrapped handler captured by server.registerResource
    const wrapped = server.registerResource.mock.calls[0][3]
    const extra = { requestInfo: { headers: { authorization: 'Bearer token' } } }
    await wrapped(new URL('mcp://srv/res'), { a: '1' }, extra)

    expect(mockPayments.requests.startProcessingRequest).toHaveBeenCalled()
    expect(mockPayments.requests.redeemCreditsFromRequest).toHaveBeenCalledWith(
      'req-1',
      'token',
      3n,
    )
  })

  it('accepts Authorization header from multiple header containers across transports', async () => {
    const tokens = ['A', 'B', 'C', 'D', 'E']
    const variants = [
      { requestInfo: { headers: { authorization: `Bearer ${tokens[0]}` } } },
      { request: { headers: { Authorization: `Bearer ${tokens[1]}` } } },
      { headers: { authorization: `Bearer ${tokens[2]}` } },
      { connection: { headers: { authorization: `Bearer ${tokens[3]}` } } },
      { socket: { handshake: { headers: { Authorization: `Bearer ${tokens[4]}` } } } },
    ]

    const payments = createPaymentsMock()
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:agent', serverName: 'mcp' })

    const base = async () => ({ ok: true })
    const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'hdr', credits: 1n })

    for (let i = 0; i < variants.length; i++) {
      payments.requests.startProcessingRequest.mockClear()
      payments.requests.redeemCreditsFromRequest.mockClear()
      await wrapped({}, variants[i] as any)
      expect(payments.requests.startProcessingRequest).toHaveBeenCalled()
      expect(payments.requests.redeemCreditsFromRequest).toHaveBeenCalledWith(
        'req-1',
        tokens[i],
        1n,
      )
    }
  })

  it('redeems credits only after an AsyncIterable stream completes', async () => {
    const payments = createPaymentsMock()
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:agent', serverName: 'mcp' })

    const makeIterable = (chunks: string[]): AsyncIterable<string> => ({
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) {
          await Promise.resolve()
          yield c
        }
      },
    })

    const base = async () => makeIterable(['one', 'two', 'three'])
    const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'stream', credits: 5n })
    const extra = { requestInfo: { headers: { authorization: 'Bearer tok' } } }

    const iterable = await wrapped({}, extra)
    expect(payments.requests.redeemCreditsFromRequest).not.toHaveBeenCalled()

    const received: any[] = []
    for await (const chunk of iterable as AsyncIterable<any>) {
      received.push(chunk)
    }

    // Should have 3 data chunks + 1 metadata chunk
    expect(received).toHaveLength(4)
    expect(received.slice(0, 3)).toEqual(['one', 'two', 'three'])
    expect(received[3]).toMatchObject({
      metadata: {
        txHash: undefined, // Mock returns undefined for txHash
        requestId: 'req-1',
        creditsRedeemed: '5',
        success: true,
      },
    })
    expect(payments.requests.redeemCreditsFromRequest).toHaveBeenCalledWith('req-1', 'tok', 5n)
  })

  it('redeems credits when consumer stops the stream early (break)', async () => {
    const payments = createPaymentsMock()
    const mcp = buildMcpIntegration(payments)
    mcp.configure({ agentId: 'did:nv:agent', serverName: 'mcp' })

    const makeIterable = (chunks: string[]): AsyncIterable<string> => ({
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) {
          await Promise.resolve()
          yield c
        }
      },
    })

    const base = async () => makeIterable(['one', 'two', 'three'])
    const wrapped = mcp.withPaywall(base, { kind: 'tool', name: 'stream', credits: 2n })
    const extra = { requestInfo: { headers: { authorization: 'Bearer tok' } } }

    const iterable = await wrapped({}, extra)
    let count = 0
    for await (const _ of iterable as AsyncIterable<any>) {
      count++
      break
    }
    expect(count).toBe(1)
    expect(payments.requests.redeemCreditsFromRequest).toHaveBeenCalledWith('req-1', 'tok', 2n)
  })
})
