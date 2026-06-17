/**
 * Unit tests for the x402 v2 in-band MCP transport (TS port of payments-py #228).
 *
 * Covers:
 * - the access-token <-> PaymentPayload round-trip used to carry the payment in
 *   `_meta["x402/payment"]` (including a foreign-encoded token),
 * - reading the in-band payload from the handler `extra._meta`,
 * - the in-band payload taking precedence over the Authorization header,
 * - the spec-shaped payment-required tool result (structuredContent + content[0].text),
 * - the happy-path settlement receipt under `_meta["x402/payment-response"]` plus the
 *   Nevermined observability under `_meta["nevermined/credits"]`,
 * - settlement-failure-after-execution suppressing tool content (tool) and surfacing the
 *   payment error, while resources/prompts still throw.
 */

import { PaywallDecorator } from '../../../src/mcp/core/paywall.js'
import { PaywallAuthenticator } from '../../../src/mcp/core/auth.js'
import { buildPaymentRequiredForPlans } from '../../../src/x402/facilitator-api.js'
import { PaymentRequiredError, SettlementFailedError } from '../../../src/mcp/utils/errors.js'
import {
  NEVERMINED_CREDITS_META_KEY,
  X402_PAYMENT_META_KEY,
  X402_PAYMENT_RESPONSE_META_KEY,
  paymentRequiredResult,
  readPaymentPayload,
} from '../../../src/mcp/utils/meta.js'
import { decodeAccessToken, encodeAccessToken } from '../../../src/utils.js'

const SAMPLE_PAYLOAD = {
  x402Version: 2,
  accepted: {
    scheme: 'nvm:erc4337',
    network: 'eip155:84532',
    planId: 'plan-123',
    extra: { agentId: 'agent-9' },
  },
  payload: {
    signature: '0xdeadbeef',
    authorization: { from: '0xabc', to: '0xdef', value: '1' },
  },
}

const SAMPLE_PR = {
  x402Version: 2,
  error: 'payment required',
  resource: { url: 'mcp://srv/tools/premium' },
  accepts: [{ scheme: 'nvm:erc4337', network: 'eip155:84532', planId: 'plan-123' }],
  extensions: {},
}

/** Build a PaywallDecorator wired with mocks for a single call. */
function makeDecorator(opts: {
  settle?: any
  authenticate?: jest.Mock
  credits?: bigint
  agentId?: string
}) {
  const payments: any = {
    getEnvironmentName: () => 'staging_sandbox',
    facilitator: {
      settlePermissions: jest.fn(
        async () => opts.settle ?? { success: true, transaction: '', network: '' },
      ),
    },
    agents: { getAgentPlans: jest.fn(async () => ({ plans: [] })) },
  }
  const authenticator: any = {
    authenticate:
      opts.authenticate ??
      jest.fn(async () => ({
        token: 'tok-abc',
        agentId: 'agent-9',
        logicalUrl: 'mcp://srv/tools/premium',
        httpUrl: undefined,
        planId: 'plan-123',
        subscriberAddress: '0x123',
      })),
  }
  const creditsContext: any = { resolve: jest.fn(() => opts.credits ?? 5n) }

  const decorator = new PaywallDecorator(payments, authenticator, creditsContext)
  decorator.configure({
    planId: 'plan-123',
    agentId: 'agentId' in opts ? opts.agentId : 'agent-9',
    serverName: 'srv',
  })
  return { decorator, payments, authenticator, creditsContext }
}

describe('x402 in-band: access token codec', () => {
  test('encode/decode round-trips an object', () => {
    const token = encodeAccessToken(SAMPLE_PAYLOAD)
    expect(decodeAccessToken(token)).toEqual(SAMPLE_PAYLOAD)
  })

  test('decode recovers a FOREIGN-encoded token (different serialization)', () => {
    // A backend may serialize differently (pretty-printed, sorted keys, padded
    // standard base64). The semantic payload must still round-trip.
    const foreign = btoa(JSON.stringify(SAMPLE_PAYLOAD, null, 2)) // padded, spaced
    expect(decodeAccessToken(foreign)).toEqual(SAMPLE_PAYLOAD)
    // And re-encoding the decoded payload still recovers it.
    expect(decodeAccessToken(encodeAccessToken(decodeAccessToken(foreign)!))).toEqual(
      SAMPLE_PAYLOAD,
    )
  })

  test('encode never throws on non-ASCII input; ASCII fields stay recoverable (lossy for non-ASCII)', () => {
    // encodeAccessToken runs on client-supplied _meta["x402/payment"]; it must not
    // throw on code points > U+00FF (btoa would). x402 payloads are ASCII in practice.
    const encoded = encodeAccessToken({ ...SAMPLE_PAYLOAD, note: 'café 😀' })
    const decoded = decodeAccessToken(encoded)
    // ASCII fields survive the round-trip.
    expect(decoded?.x402Version).toBe(2)
    expect(decoded?.accepted?.planId).toBe('plan-123')
    // note: decoded.note is NOT expected to equal 'café 😀' — decodeAccessToken's
    // atob is byte-wise, so the non-ASCII round-trip is intentionally lossy.
    // ASCII round-trip is fully lossless.
    expect(decodeAccessToken(encodeAccessToken(SAMPLE_PAYLOAD))).toEqual(SAMPLE_PAYLOAD)
  })
})

describe('x402 in-band: readPaymentPayload', () => {
  test('reads extra._meta["x402/payment"]', () => {
    const extra = { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } }
    expect(readPaymentPayload(extra)).toEqual(SAMPLE_PAYLOAD)
  })

  test('returns undefined when absent / no _meta / not a plain object (string, array, null)', () => {
    expect(readPaymentPayload({ _meta: { progressToken: 'x' } })).toBeUndefined()
    expect(readPaymentPayload({})).toBeUndefined()
    expect(readPaymentPayload(undefined)).toBeUndefined()
    expect(
      readPaymentPayload({ _meta: { [X402_PAYMENT_META_KEY]: 'not-an-object' } }),
    ).toBeUndefined()
    // Arrays are typeof 'object' but not valid payloads (mirror Python isinstance dict).
    expect(
      readPaymentPayload({ _meta: { [X402_PAYMENT_META_KEY]: [SAMPLE_PAYLOAD] } }),
    ).toBeUndefined()
    expect(readPaymentPayload({ _meta: { [X402_PAYMENT_META_KEY]: null } })).toBeUndefined()
  })

  test('rejects an oversized payload (defense-in-depth on untrusted input)', () => {
    // > 64KB serialized → treated as absent (falls back to the header path).
    const huge = { ...SAMPLE_PAYLOAD, blob: 'x'.repeat(64 * 1024 + 1) }
    expect(readPaymentPayload({ _meta: { [X402_PAYMENT_META_KEY]: huge } })).toBeUndefined()
  })
})

describe('x402 in-band: paymentRequiredResult', () => {
  test('is an error result carrying PaymentRequired in both representations', () => {
    const result = paymentRequiredResult(SAMPLE_PR)
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual(SAMPLE_PR)
    expect(result.structuredContent.x402Version).toBe(2)
    expect(result.content[0].type).toBe('text')
    expect(JSON.parse(result.content[0].text)).toEqual(SAMPLE_PR)
  })
})

describe('x402 in-band: paywall wrapper', () => {
  test('in-band payload takes precedence over the Authorization header', async () => {
    const { decorator, authenticator } = makeDecorator({})
    const handler = async () => ({ content: [{ type: 'text', text: 'ok' }] })
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'premium' })

    const extra = {
      _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD },
      requestInfo: { headers: { authorization: 'Bearer header-token-should-be-ignored' } },
    }
    await wrapped({}, extra)

    const passedExtra = authenticator.authenticate.mock.calls[0][0]
    expect(passedExtra.requestInfo.headers.authorization).toBe(
      `Bearer ${encodeAccessToken(SAMPLE_PAYLOAD)}`,
    )
  })

  test('attaches spec receipt + namespaced observability on success', async () => {
    const settle = {
      success: true,
      transaction: '0xabc',
      network: 'eip155:84532',
      payer: '0x123',
      creditsRedeemed: '5',
    }
    const { decorator } = makeDecorator({ settle })
    const handler = async () => ({ content: [{ type: 'text', text: 'ok' }] })
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'premium' })

    const out = await wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } })

    expect(out._meta[X402_PAYMENT_RESPONSE_META_KEY]).toEqual(settle)
    expect(out._meta[NEVERMINED_CREDITS_META_KEY].success).toBe(true)
    expect(out._meta[NEVERMINED_CREDITS_META_KEY].creditsRedeemed).toBe('5')
    expect(out._meta[NEVERMINED_CREDITS_META_KEY].planId).toBe('plan-123')
    // Tool content preserved on success
    expect(out.content[0].text).toBe('ok')
  })

  test('agentId optional: server works with planId and NO agentId', async () => {
    const settle = {
      success: true,
      transaction: '0xabc',
      network: 'eip155:84532',
      payer: '0x123',
      creditsRedeemed: '5',
    }
    // Configure with a planId but NO agentId — must not throw the
    // "missing agentId" misconfiguration; the plan-centric path settles fine.
    const { decorator } = makeDecorator({ settle, agentId: undefined })
    const handler = async () => ({ content: [{ type: 'text', text: 'ok' }] })
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'premium' })

    const out = await wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } })

    expect(out.isError).toBeFalsy()
    expect(out._meta[X402_PAYMENT_RESPONSE_META_KEY].success).toBe(true)
    expect(out._meta[NEVERMINED_CREDITS_META_KEY].planId).toBe('plan-123')
    expect(out.content[0].text).toBe('ok')
  })

  test('free / no-credit call: no spec receipt, content preserved', async () => {
    const { decorator } = makeDecorator({ credits: 0n })
    const handler = async () => ({ content: [{ type: 'text', text: 'ok' }] })
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'premium' })

    const out = await wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } })

    expect(out._meta[X402_PAYMENT_RESPONSE_META_KEY]).toBeUndefined()
    expect(out._meta[NEVERMINED_CREDITS_META_KEY].success).toBe(true)
    expect(out._meta[NEVERMINED_CREDITS_META_KEY].creditsRedeemed).toBe('0')
    expect(out.content[0].text).toBe('ok')
  })

  test('settlement failure (tool): suppresses content, returns payment error', async () => {
    const { decorator } = makeDecorator({
      settle: { success: false, transaction: '', network: '', errorReason: 'no funds' },
    })
    const handler = async () => ({ content: [{ type: 'text', text: 'secret-paid-result' }] })
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'premium' })

    const out = await wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } })

    expect(out.isError).toBe(true)
    expect(out.structuredContent.x402Version).toBe(2)
    expect(out.structuredContent.error).toBe('settlement failed')
    // The executed tool's content must NOT leak
    expect(JSON.stringify(out)).not.toContain('secret-paid-result')
  })

  test('payment-required (tool): auth error is converted to an in-band error result', async () => {
    const authenticate = jest.fn(async () => {
      throw new PaymentRequiredError(SAMPLE_PR, 'Payment required.')
    })
    const { decorator } = makeDecorator({ authenticate })
    const handler = async () => ({ content: [{ type: 'text', text: 'ok' }] })
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'premium' })

    const out = await wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } })
    expect(out.isError).toBe(true)
    expect(out.structuredContent.x402Version).toBe(2)
  })

  test('payment-required (resource): still THROWS (no tool-result error channel)', async () => {
    const authenticate = jest.fn(async () => {
      throw new PaymentRequiredError(SAMPLE_PR, 'Payment required.')
    })
    const { decorator } = makeDecorator({ authenticate })
    const handler = async () => ({ contents: [] })
    const wrapped = decorator.protect(handler as any, { kind: 'resource', name: 'res' })

    await expect(
      wrapped(new URL('mcp://srv/res'), {}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } }),
    ).rejects.toBeInstanceOf(PaymentRequiredError)
  })

  test('SettlementFailedError is a PaymentRequiredError', () => {
    const err = new SettlementFailedError(SAMPLE_PR)
    expect(err).toBeInstanceOf(PaymentRequiredError)
    expect(err.paymentRequired.x402Version).toBe(2)
  })

  test('over-catch guard: a generic tool error propagates, not converted to payment-required', async () => {
    const { decorator } = makeDecorator({})
    const handler = async () => {
      throw new Error('boom')
    }
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'premium' })
    await expect(
      wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } }),
    ).rejects.toThrow('boom')
  })

  test('tool body throwing PaymentRequiredError is converted to an in-band error result', async () => {
    const { decorator } = makeDecorator({})
    const handler = async () => {
      throw new PaymentRequiredError(SAMPLE_PR)
    }
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'premium' })
    const out = await wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } })
    expect(out.isError).toBe(true)
    expect(out.structuredContent.x402Version).toBe(2)
  })

  test('payment-required (prompt): still THROWS (no tool-result error channel)', async () => {
    const authenticate = jest.fn(async () => {
      throw new PaymentRequiredError(SAMPLE_PR, 'Payment required.')
    })
    const { decorator } = makeDecorator({ authenticate })
    const handler = async () => ({ messages: [] })
    const wrapped = decorator.protect(handler, { kind: 'prompt', name: 'p' })
    await expect(
      wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } }),
    ).rejects.toBeInstanceOf(PaymentRequiredError)
  })

  test('streaming settlement failure: final _meta omits the spec receipt, reports failure under nevermined/credits', async () => {
    const { decorator } = makeDecorator({
      settle: { success: false, transaction: '', network: '', errorReason: 'no funds' },
    })
    async function* gen() {
      yield { type: 'text', text: 'chunk1' }
    }
    const handler = async () => gen()
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'streamtool' })

    const stream = await wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } })
    const chunks: any[] = []
    for await (const c of stream) chunks.push(c)

    const metaChunk = chunks[chunks.length - 1]
    expect(metaChunk._meta[X402_PAYMENT_RESPONSE_META_KEY]).toBeUndefined()
    expect(metaChunk._meta[NEVERMINED_CREDITS_META_KEY].success).toBe(false)
    expect(metaChunk._meta[NEVERMINED_CREDITS_META_KEY].errorReason).toBe('no funds')
  })

  test('settle fallback uses httpUrl, not the verb (regression: fallbackEndpoint/httpVerb order)', async () => {
    const { decorator, payments, authenticator } = makeDecorator({})
    authenticator.authenticate = jest.fn(async () => ({
      token: 'tok-abc',
      agentId: 'agent-9',
      logicalUrl: 'mcp://srv/logical',
      httpUrl: 'https://srv.example/http',
      planId: 'plan-123',
      subscriberAddress: '0x123',
    }))
    let calls = 0
    payments.facilitator.settlePermissions = jest.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('primary settle failed')
      return { success: true, transaction: '0xok', network: 'eip155:84532', creditsRedeemed: '5' }
    })
    const handler = async () => ({ content: [{ type: 'text', text: 'ok' }] })
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'premium' })

    const out = await wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } })

    expect(payments.facilitator.settlePermissions).toHaveBeenCalledTimes(2)
    // The fallback must build paymentRequired from the httpUrl endpoint — under the
    // old transposed arg order (fallbackEndpoint='POST') it would be the literal "POST".
    const fallbackArg = payments.facilitator.settlePermissions.mock.calls[1][0]
    expect(fallbackArg.paymentRequired.resource.url).toBe('https://srv.example/http')
    expect(fallbackArg.paymentRequired.resource.url).not.toBe('POST')
    expect(out._meta[X402_PAYMENT_RESPONSE_META_KEY].success).toBe(true)
  })

  test('onRedeemError "propagate" surfaces a Misconfiguration (-32002) when settlement errors', async () => {
    const { decorator, payments } = makeDecorator({})
    payments.facilitator.settlePermissions = jest.fn(async () => {
      throw new Error('settle boom')
    })
    const handler = async () => ({ content: [{ type: 'text', text: 'ok' }] })
    const wrapped = decorator.protect(handler, {
      kind: 'tool',
      name: 'premium',
      onRedeemError: 'propagate',
    })
    await expect(
      wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD } }),
    ).rejects.toMatchObject({ code: -32002 })
  })
})

describe('buildPaymentRequiredForPlans', () => {
  test('emits one accepts[] entry per plan id, in order', () => {
    const pr = buildPaymentRequiredForPlans(['a', 'b', 'c'], { endpoint: 'mcp://x' })
    expect(pr.accepts.map((a: any) => a.planId)).toEqual(['a', 'b', 'c'])
  })

  test('empty plan list falls back to a single empty plan id', () => {
    const pr = buildPaymentRequiredForPlans([], { endpoint: 'mcp://x' })
    expect(pr.accepts).toHaveLength(1)
    expect(pr.accepts[0].planId).toBe('')
  })
})

describe('buildPaymentRequiredError: plans-lookup failure', () => {
  test('a backend outage surfaces "plans unavailable", not a clean 402', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const payments: any = {
      getEnvironmentName: () => 'staging_sandbox',
      agents: {
        getAgentPlans: jest.fn(async () => {
          throw new Error('backend down')
        }),
      },
    }
    const auth = new PaywallAuthenticator(payments)

    // No auth header → authenticate routes to buildPaymentRequiredError, whose
    // getAgentPlans lookup throws.
    const err: any = await auth.authenticate({}, {}, 'agent-9', 'srv', 'premium', 'tool', {}).then(
      () => {
        throw new Error('expected authenticate to reject')
      },
      (e) => e,
    )
    expect(err.paymentRequired.error).toBe('plans unavailable')
    // accepts is exactly one entry with an empty plan id — catches an
    // empty-accepts regression at the integration point.
    expect(err.paymentRequired.accepts).toHaveLength(1)
    expect(err.paymentRequired.accepts[0].planId).toBe('')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('x402 in-band: real MCP-SDK dispatch', () => {
  // Pins the load-bearing assumption that @modelcontextprotocol/sdk surfaces the
  // request params._meta on the tool handler's `extra` — so a future SDK bump that
  // changed it would fail here instead of silently routing every call to the
  // deprecated Authorization-header fallback. (Port of Python TestDispatcherInBand.)
  test('SDK delivers params._meta["x402/payment"] to the handler; in-band path re-encodes to Bearer', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')

    let capturedAuthExtra: any
    const payments: any = {
      getEnvironmentName: () => 'staging_sandbox',
      facilitator: {
        settlePermissions: jest.fn(async () => ({
          success: true,
          transaction: '0xok',
          network: 'eip155:84532',
          creditsRedeemed: '5',
        })),
      },
      agents: { getAgentPlans: jest.fn(async () => ({ plans: [] })) },
    }
    const authenticator: any = {
      authenticate: jest.fn(async (extra: any) => {
        capturedAuthExtra = extra
        return {
          token: 'tok-abc',
          agentId: 'agent-9',
          logicalUrl: 'mcp://srv/tools/premium',
          httpUrl: undefined,
          planId: 'plan-123',
          subscriberAddress: '0x123',
        }
      }),
    }
    const creditsContext: any = { resolve: jest.fn(() => 5n) }
    const decorator = new PaywallDecorator(payments, authenticator, creditsContext)
    decorator.configure({ planId: 'plan-123', agentId: 'agent-9', serverName: 'srv' })
    const protectedHandler = decorator.protect(
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      { kind: 'tool', name: 'premium' },
    )

    const server = new McpServer({ name: 'test', version: '0.0.0' })
    // An (empty) inputSchema makes the SDK invoke the callback as (args, extra),
    // matching the paywall wrapper's tool arity.
    server.registerTool(
      'premium',
      { description: 'premium', inputSchema: {} },
      protectedHandler as any,
    )

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'c', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    await client.callTool({
      name: 'premium',
      arguments: {},
      _meta: { [X402_PAYMENT_META_KEY]: SAMPLE_PAYLOAD },
    })

    // The SDK surfaced params._meta on the handler extra; the in-band path
    // re-encoded the payload into a Bearer token for authentication.
    expect(capturedAuthExtra?.requestInfo?.headers?.authorization).toBe(
      `Bearer ${encodeAccessToken(SAMPLE_PAYLOAD)}`,
    )

    await client.close()
    await server.close()
  })
})
