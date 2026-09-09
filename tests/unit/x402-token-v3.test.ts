/**
 * Unit tests for x402 token v3: single-use, seller/resource-bound access tokens.
 *
 * Mirrors the backend contract from nevermined-io/nvm-monorepo#2646. The v3
 * EIP-712 struct appends `agentId`, `resourceUrl`, `httpVerb` and a one-time
 * `nonce` to the signed payload, which makes the token bound to one seller
 * endpoint and consumed by its first settlement. v3 is opt-in: the backend
 * still mints v2 by default, and — crucially — a backend that predates #2646
 * DROPS `tokenVersion: 3` without an error (its ValidationPipe whitelists
 * without `forbidNonWhitelisted`), so the version must always be read off the
 * token that came back, never off the request.
 *
 * Kept symmetric with the Python SDK (payments-py#268).
 */
import { Payments } from '../../src/payments.js'
import {
  detectAccessTokenVersion,
  isSingleUseAccessToken,
  isAccessTokenAlreadyUsed,
  X402_TOKEN_ALREADY_USED_CODE,
} from '../../src/x402/token-version.js'
import { PaymentsError } from '../../src/common/payments.error.js'
import { buildX402TokenRequestBody } from '../../src/x402/token-request.js'
import { buildPaymentRequired } from '../../src/x402/facilitator-api.js'

const TEST_API_KEY =
  process.env.TEST_PROXY_BEARER_TOKEN ||
  'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDIxRjc5ZjlkM2I2ZDUyZUY4Y2M4QjFhN0YyNjFCY2Y1ZjJFRjM1NGEiLCJqdGkiOiIweGUxMjIwMmRkMzZlZmQ4N2FkMjE1MmRlMjlkM2MwNmE5ZDU5N2M4NWJhOGMxOTQ1YjQ5MjlkYTYyYTRiZjQ1NGYiLCJleHAiOjE3OTEwNDc0OTcsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.JI14qfSWHCWRvHOK9TAg3HEXWX7oKEI6fU6gaaWlyDl5btBWLh8FQo1ZnuzixPmgsUR3gc4oRlenLPUuTy-mORw'

interface CapturedCall {
  url: string
  init?: RequestInit
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Encodes a token envelope the way the backend does: base64 of compact JSON. */
const encodeToken = (payload: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(payload)).toString('base64')

/** A v2 (reusable) token envelope: no nonce in `payload.authorization`. */
const v2Token = (): string =>
  encodeToken({
    x402Version: 2,
    accepted: {
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      planId: 'plan-1',
      extra: { version: '1' },
    },
    payload: {
      signature: '0xsig',
      authorization: {
        from: '0xsubscriber',
        sessionKeysProvider: 'zerodev',
        sessionKeys: [],
      },
    },
    extensions: {},
  })

/** A v3 (single-use, bound) token envelope: nonce + the signed binding fields. */
const v3Token = (overrides: Record<string, unknown> = {}): string =>
  encodeToken({
    x402Version: 2,
    accepted: {
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      planId: 'plan-1',
      extra: { version: '1', agentId: 'agent-1', httpVerb: 'POST' },
    },
    payload: {
      signature: '0xsig',
      authorization: {
        from: '0xsubscriber',
        sessionKeysProvider: 'zerodev',
        sessionKeys: [],
        agentId: 'agent-1',
        resourceUrl: 'https://seller.example/api/v1/tasks',
        httpVerb: 'POST',
        nonce: '0xdeadbeef',
        ...overrides,
      },
    },
    extensions: {},
  })

describe('detectAccessTokenVersion', () => {
  test('a token carrying a non-empty nonce is v3 (single-use)', () => {
    const token = v3Token()
    expect(detectAccessTokenVersion(token)).toBe(3)
    expect(isSingleUseAccessToken(token)).toBe(true)
  })

  test('a token without a nonce is v2 (reusable)', () => {
    const token = v2Token()
    expect(detectAccessTokenVersion(token)).toBe(2)
    expect(isSingleUseAccessToken(token)).toBe(false)
  })

  test('an empty or whitespace nonce is NOT v3', () => {
    // A field absent at mint is signed as the empty string, so an empty nonce
    // is the shape of a v2 token, not a v3 one with a blank nonce.
    expect(detectAccessTokenVersion(v3Token({ nonce: '' }))).toBe(2)
    expect(detectAccessTokenVersion(v3Token({ nonce: '   ' }))).toBe(2)
  })

  test('a non-string nonce is NOT v3', () => {
    expect(detectAccessTokenVersion(v3Token({ nonce: 12345 }))).toBe(2)
    expect(detectAccessTokenVersion(v3Token({ nonce: null }))).toBe(2)
  })

  test('undecodable, empty and non-token input read as v2 rather than throwing', () => {
    expect(detectAccessTokenVersion('not-a-token')).toBe(2)
    expect(detectAccessTokenVersion('')).toBe(2)
    expect(detectAccessTokenVersion(undefined as unknown as string)).toBe(2)
    // Decodable base64 JSON, but not a token envelope.
    expect(detectAccessTokenVersion(encodeToken({ hello: 'world' }))).toBe(2)
  })

  test('url-safe base64 encoding is detected too', () => {
    const urlSafe = v3Token().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(detectAccessTokenVersion(urlSafe)).toBe(3)
  })
})

describe('isAccessTokenAlreadyUsed', () => {
  test('matches the BCK.X402.0059 code and nothing else', () => {
    expect(
      isAccessTokenAlreadyUsed(new PaymentsError('spent', X402_TOKEN_ALREADY_USED_CODE)),
    ).toBe(true)
    // A forgery is a different failure and must not be collapsed into "re-mint".
    expect(isAccessTokenAlreadyUsed(new PaymentsError('forged', 'BCK.X402.0005'))).toBe(false)
    expect(isAccessTokenAlreadyUsed(new PaymentsError('boom'))).toBe(false)
    expect(isAccessTokenAlreadyUsed(undefined)).toBe(false)
    expect(isAccessTokenAlreadyUsed(null)).toBe(false)
    expect(isAccessTokenAlreadyUsed('BCK.X402.0059')).toBe(false)
  })
})

describe('getX402AccessToken — v3 request body and version detection', () => {
  let originalFetch: typeof fetch
  let calls: CapturedCall[]
  let payments: Payments

  beforeEach(() => {
    originalFetch = global.fetch
    calls = []
    payments = Payments.getInstance({
      nvmApiKey: TEST_API_KEY,
      environment: 'staging_sandbox',
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  const installFetch = (handler: (call: CapturedCall) => Response | Promise<Response>): void => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const call: CapturedCall = { url, init }
      calls.push(call)
      return handler(call)
    }) as unknown as typeof fetch
  }

  const sentBody = (): any => JSON.parse(String(calls[0].init?.body))

  test('resource, httpVerb and tokenVersion are all sent', async () => {
    installFetch(() => jsonResponse({ accessToken: v3Token() }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      delegationConfig: { delegationId: 'del-1' },
      resource: { url: 'https://seller.example/api/v1/tasks' },
      httpVerb: 'POST',
      tokenVersion: 3,
    })

    const body = sentBody()
    expect(body.resource).toEqual({ url: 'https://seller.example/api/v1/tasks' })
    expect(body.accepted.extra).toEqual({ agentId: 'agent-1', httpVerb: 'POST' })
    expect(body.tokenVersion).toBe(3)
  })

  test('a v2 request body is unchanged — no resource, httpVerb or tokenVersion keys', async () => {
    // The absent-field contract is strict: a field absent at mint is signed as
    // the empty string and must stay absent from the envelope, so "not passed"
    // must not become `''`/`undefined` keys on the wire.
    installFetch(() => jsonResponse({ accessToken: v2Token() }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      delegationConfig: { delegationId: 'del-1' },
    })

    const body = sentBody()
    expect(body).not.toHaveProperty('resource')
    expect(body).not.toHaveProperty('tokenVersion')
    expect(body.accepted.extra).toEqual({ agentId: 'agent-1' })
  })

  test('the returned version is read off the token, not echoed from the request', async () => {
    // The silent-strip case: v3 was asked for, a backend without v3 support
    // dropped the field and minted v2. Reporting 3 here would make a caller
    // treat a reusable token as single-use — and, once defaults flip, the
    // reverse mistake replays a spent nonce on every call.
    installFetch(() => jsonResponse({ accessToken: v2Token() }))

    const result = await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      delegationConfig: { delegationId: 'del-1' },
      tokenVersion: 3,
    })

    expect(result.tokenVersion).toBe(2)
  })

  test('a v3 token is reported as v3 even when v3 was never requested', async () => {
    // The other direction: once the backend default flips, tokens come back v3
    // without being asked for. A client that trusts its own request would reuse
    // a single-use token.
    installFetch(() => jsonResponse({ accessToken: v3Token() }))

    const result = await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      delegationConfig: { delegationId: 'del-1' },
    })

    expect(result.tokenVersion).toBe(3)
    expect(result.accessToken).toBe(v3Token())
  })
})

describe('getX402AccessToken — malformed mint responses', () => {
  let originalFetch: typeof fetch
  let payments: Payments

  beforeEach(() => {
    originalFetch = global.fetch
    payments = Payments.getInstance({
      nvmApiKey: TEST_API_KEY,
      environment: 'staging_sandbox',
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test.each([
    ['no accessToken at all', {}],
    ['an empty accessToken', { accessToken: '' }],
    ['a non-string accessToken', { accessToken: 42 }],
  ])('a 2xx with %s throws instead of returning an unusable token', async (_label, body) => {
    // Without the guard the caller gets `accessToken: undefined` typed as
    // `string`, presents it as the payment-signature, and the failure surfaces
    // at the seller as an unparseable token — three layers from the cause.
    global.fetch = jest.fn(async () => jsonResponse(body)) as unknown as typeof fetch

    await expect(
      payments.x402.getX402AccessToken('plan-1', 'agent-1', {
        delegationConfig: { delegationId: 'del-1' },
      }),
    ).rejects.toThrow(/no accessToken/)
  })
})

describe('settlePermissions — BCK.X402.0059 is its own, actionable error', () => {
  let originalFetch: typeof fetch
  let payments: Payments

  beforeEach(() => {
    originalFetch = global.fetch
    payments = Payments.getInstance({
      nvmApiKey: TEST_API_KEY,
      environment: 'staging_sandbox',
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  const settle = () =>
    payments.facilitator.settlePermissions({
      paymentRequired: buildPaymentRequired('plan-1', {
        endpoint: 'https://seller.example/api/v1/tasks',
        agentId: 'agent-1',
        httpVerb: 'POST',
      }),
      x402AccessToken: v3Token(),
    })

  test('a second settle of a v3 token surfaces the spent-token guidance', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(
        { message: 'Access token already used', code: X402_TOKEN_ALREADY_USED_CODE },
        400,
      ),
    ) as unknown as typeof fetch

    await expect(settle()).rejects.toMatchObject({ code: X402_TOKEN_ALREADY_USED_CODE })

    const error = await settle().catch((e) => e)
    expect(isAccessTokenAlreadyUsed(error)).toBe(true)
    expect(error.message).toContain('already used')
    // The actionable half: re-mint, do not retry with the same token.
    expect(error.message).toContain('mint a new token')
  })

  test('a forgery keeps its own code and message — not the re-mint guidance', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ message: 'Invalid access token', code: 'BCK.X402.0005' }, 400),
    ) as unknown as typeof fetch

    const error = await settle().catch((e) => e)
    expect(error.code).toBe('BCK.X402.0005')
    expect(isAccessTokenAlreadyUsed(error)).toBe(false)
    expect(error.message).not.toContain('mint a new token')
  })
})

describe('MPP mints carry no token version', () => {
  // MPP and x402 stopped sharing a version ladder (nvm-monorepo#3266): MPP's
  // single-use unit is the CHALLENGE, and one access token is presented across
  // many challenges, so `MppService.createPermission` refuses ANY `tokenVersion`
  // with `BCK.MPP.0007` — `2` included, since that ordinal is x402's.
  const build = (tokenVersion?: 2 | 3, protocol: 'x402' | 'mpp' = 'mpp') =>
    buildX402TokenRequestBody({
      planId: 'plan-1',
      agentId: 'agent-1',
      environmentName: 'staging_sandbox',
      protocol,
      tokenOptions: {
        delegationConfig: { delegationId: 'del-1' },
        ...(tokenVersion !== undefined && { tokenVersion }),
      },
    })

  test('an MPP mint with no tokenVersion builds a body without the field', () => {
    expect(build()).not.toHaveProperty('tokenVersion')
  })

  test.each([2, 3] as const)('an MPP mint refuses tokenVersion %i before the request', (v) => {
    expect(() => build(v)).toThrow(PaymentsError)
    expect(() => build(v)).toThrow(/BCK\.MPP\.0007/)
  })

  test('the same option is still accepted on the x402 route', () => {
    expect(build(3, 'x402')).toMatchObject({ tokenVersion: 3 })
  })
})

describe('the binding fields on a non-v3 mint', () => {
  // The backend compares a token's resource against the seller's advertised
  // paymentRequired for ANY token that carries one, so this combination is
  // legal but rarely intended — and its failure surfaces at the seller, not
  // here. The builder forwards it (the caller may know the seller's URL) but
  // never silently.
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  const build = (tokenOptions: Record<string, unknown>) =>
    buildX402TokenRequestBody({
      planId: 'plan-1',
      agentId: 'agent-1',
      environmentName: 'staging_sandbox',
      tokenOptions: { delegationConfig: { delegationId: 'del-1' }, ...tokenOptions } as never,
    })

  const bindingWarning = (): string | undefined =>
    warnSpy.mock.calls.map((args) => String(args[0])).find((msg) => msg.includes('BCK.X402.0013'))

  test('a resource without tokenVersion 3 is forwarded, but warns', () => {
    const body = build({ resource: { url: 'https://seller.example/ask' } })

    expect(body.resource).toEqual({ url: 'https://seller.example/ask' })
    expect(bindingWarning()).toBeDefined()
  })

  test('the same binding with tokenVersion 3 is silent', () => {
    build({ resource: { url: 'https://seller.example/ask' }, httpVerb: 'POST', tokenVersion: 3 })

    expect(bindingWarning()).toBeUndefined()
  })

  test('a mint with no binding at all is silent', () => {
    build({})

    expect(bindingWarning()).toBeUndefined()
  })

  test('an empty resource url is treated as absent, not sent as an empty string', () => {
    // A field absent at mint is signed as the empty string and must stay absent
    // from the envelope, so `{ url: '' }` and "not passed" must not diverge.
    const body = build({ resource: { url: '' }, tokenVersion: 3 })

    expect(body).not.toHaveProperty('resource')
  })

  test('httpVerb is upper-cased before it is sent', () => {
    // Sellers advertise `req.method`. A lower-case verb mints a token that can
    // never match, and the SDK core — not each consumer — is where that is fixed.
    const body = build({ httpVerb: 'post', tokenVersion: 3 })

    expect(body.accepted.extra.httpVerb).toBe('POST')
  })
})

describe('settlePermissions — a 200 that did not burn is not silent', () => {
  let originalFetch: typeof fetch
  let payments: Payments
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    originalFetch = global.fetch
    payments = Payments.getInstance({
      nvmApiKey: TEST_API_KEY,
      environment: 'staging_sandbox',
    })
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    global.fetch = originalFetch
    warnSpy.mockRestore()
  })

  const settle = () =>
    payments.facilitator.settlePermissions({
      paymentRequired: buildPaymentRequired('plan-1', { endpoint: '/ask', agentId: 'agent-1' }),
      x402AccessToken: v2Token(),
    })

  const settleWarning = (): string | undefined =>
    warnSpy.mock.calls.map((args) => String(args[0])).find((m) => m.includes('success: false'))

  test('a 200 with success:false is returned verbatim AND reported', async () => {
    // The caller still gets the body — `errorReason` and `billingModel` are what
    // they need to react — but a failed burn must not look exactly like a paid
    // one at the layer that made the call.
    global.fetch = jest.fn(async () =>
      jsonResponse({ success: false, errorReason: 'Cannot order plan', creditsRedeemed: '0' }),
    ) as unknown as typeof fetch

    const result = await settle()

    expect(result.success).toBe(false)
    expect(result.errorReason).toBe('Cannot order plan')
    expect(settleWarning()).toContain('Cannot order plan')
  })

  test('a successful settle says nothing', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ success: true, transaction: '0xtx', creditsRedeemed: '1' }),
    ) as unknown as typeof fetch

    await settle()

    expect(settleWarning()).toBeUndefined()
  })
})
