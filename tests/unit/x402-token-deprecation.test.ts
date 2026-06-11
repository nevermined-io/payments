/**
 * Unit tests for the create-first / inline-create deprecation surface of
 * getX402AccessToken, plus the additive planId and required currency on
 * createDelegation.
 *
 * Mirrors the backend contract from nevermined-io/nvm-monorepo#1549
 * (#1534 plan-agnostic + additive planId, #1677 currency-required, #1674
 * deprecate inline create-on-the-fly): the supported flow is create-first
 * (createDelegation -> { delegationId }); a delegationConfig that carries an
 * inline-create signal (cardId / providerPaymentMethodId / spendingLimitCents
 * / durationSecs) but no delegationId is inline create-on-the-fly and must
 * emit a runtime deprecation warning. The { delegationId } path — and a bare
 * config with neither a delegationId nor a creation field — stay silent.
 * Predicate aligned with the Python SDK (payments-py#224).
 */
import { Payments } from '../../src/payments.js'

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

describe('getX402AccessToken — create-first deprecation', () => {
  let originalFetch: typeof fetch
  let calls: CapturedCall[]
  let payments: Payments
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    originalFetch = global.fetch
    calls = []
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

  const installFetch = (handler: (call: CapturedCall) => Response | Promise<Response>): void => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const call: CapturedCall = { url, init }
      calls.push(call)
      return handler(call)
    }) as unknown as typeof fetch
  }

  const deprecationWarn = (): string | undefined =>
    warnSpy.mock.calls.map((args) => String(args[0])).find((msg) => msg.includes('[DEPRECATED]'))

  test('reuse-by-delegationId does NOT emit a deprecation warning', async () => {
    installFetch(() => jsonResponse({ accessToken: 'tok.reuse' }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:card-delegation',
      delegationConfig: { delegationId: 'del-uuid-1' },
    })

    expect(deprecationWarn()).toBeUndefined()
  })

  test('delegationId + apiKeyId is still silent (apiKeyId stays active)', async () => {
    installFetch(() => jsonResponse({ accessToken: 'tok.reuse' }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:card-delegation',
      delegationConfig: { delegationId: 'del-uuid-1', apiKeyId: 'key-1' },
    })

    expect(deprecationWarn()).toBeUndefined()
  })

  test('delegationId present + leftover inline fields is silent (migration footgun)', async () => {
    // A caller migrating to create-first may leave the old inline fields in
    // place alongside the new delegationId. delegationId wins — reuse path,
    // no warning — so the migration is not punished mid-flight.
    installFetch(() => jsonResponse({ accessToken: 'tok.reuse' }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:card-delegation',
      delegationConfig: {
        delegationId: 'del-1',
        spendingLimitCents: 1000,
        durationSecs: 3600,
        currency: 'usd',
      },
    })

    expect(deprecationWarn()).toBeUndefined()
  })

  test('inline create with spending limits (no delegationId) warns but is NON-FATAL', async () => {
    installFetch(() => jsonResponse({ accessToken: 'tok.inline' }))

    const res = await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:erc4337',
      delegationConfig: { spendingLimitCents: 1000, durationSecs: 3600 },
    })

    const warn = deprecationWarn()
    expect(warn).toBeDefined()
    expect(warn).toContain('createDelegation')
    expect(warn).toContain('delegationId')
    // The warning must NOT short-circuit the request: the token request still
    // fires and returns. Guards against a regression turning warn -> throw.
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/x402/permissions')
    expect(res.accessToken).toBe('tok.inline')
  })

  test('inline create with providerPaymentMethodId (no delegationId) warns', async () => {
    installFetch(() => jsonResponse({ accessToken: 'tok.inline' }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:card-delegation',
      delegationConfig: { providerPaymentMethodId: 'pm_123', spendingLimitCents: 5000, durationSecs: 3600 },
    })

    expect(deprecationWarn()).toBeDefined()
  })

  test('cardId without delegationId warns (cardId is a deprecated inline-create field)', async () => {
    installFetch(() => jsonResponse({ accessToken: 'tok.inline' }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:card-delegation',
      delegationConfig: { cardId: 'card-uuid', spendingLimitCents: 5000, durationSecs: 3600 },
    })

    expect(deprecationWarn()).toBeDefined()
  })

  test('identifier-less auto-select shape (spending limits, no delegationId) warns', async () => {
    installFetch(() => jsonResponse({ accessToken: 'tok.inline' }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:card-delegation',
      delegationConfig: { spendingLimitCents: 10000, durationSecs: 2592000 },
    })

    expect(deprecationWarn()).toBeDefined()
  })

  test('durationSecs alone (no delegationId) warns — each creation field triggers', async () => {
    // Standalone single-field trigger: guards against a predicate that drops one
    // of the inline-create fields from the OR chain.
    installFetch(() => jsonResponse({ accessToken: 'tok.inline' }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:erc4337',
      delegationConfig: { durationSecs: 3600 },
    })

    expect(deprecationWarn()).toBeDefined()
  })

  test('emits the deprecation warning exactly once per call', async () => {
    // Guards against a double-warn regression (e.g. warning in two places).
    installFetch(() => jsonResponse({ accessToken: 'tok.inline' }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:erc4337',
      delegationConfig: { spendingLimitCents: 1000, durationSecs: 3600 },
    })

    const deprecationCalls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('[DEPRECATED]'),
    )
    expect(deprecationCalls).toHaveLength(1)
  })

  test('bare delegationConfig (no delegationId, no creation fields) does NOT warn', async () => {
    // Mirrors the Python SDK predicate: warn only when an inline-create signal
    // is present. A bare/invalid config is left to fail downstream, not warned.
    installFetch(() => jsonResponse({ accessToken: 'tok.bare' }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:card-delegation',
      delegationConfig: {},
    })

    expect(deprecationWarn()).toBeUndefined()
  })

  test('apiKeyId-only delegationConfig (no delegationId, no creation fields) does NOT warn', async () => {
    installFetch(() => jsonResponse({ accessToken: 'tok.bare' }))

    await payments.x402.getX402AccessToken('plan-1', 'agent-1', {
      scheme: 'nvm:card-delegation',
      delegationConfig: { apiKeyId: 'key-1' },
    })

    expect(deprecationWarn()).toBeUndefined()
  })

  test('missing delegationConfig throws (does not warn)', async () => {
    installFetch(() => jsonResponse({ accessToken: 'unused' }))

    await expect(
      payments.x402.getX402AccessToken('plan-1', 'agent-1', { scheme: 'nvm:erc4337' }),
    ).rejects.toThrow(/delegationConfig is required/)

    expect(deprecationWarn()).toBeUndefined()
  })

  test('empty-string delegationId throws early (not treated as inline-create)', async () => {
    installFetch(() => jsonResponse({ accessToken: 'unused' }))

    await expect(
      payments.x402.getX402AccessToken('plan-1', 'agent-1', {
        scheme: 'nvm:card-delegation',
        delegationConfig: { delegationId: '   ' },
      }),
    ).rejects.toThrow(/delegationId must not be an empty string/)

    // It fails the request entirely — no warning, no fetch.
    expect(deprecationWarn()).toBeUndefined()
    expect(calls).toHaveLength(0)
  })
})

describe('createDelegation — required currency + additive planId on the wire', () => {
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
      calls.push({ url, init })
      return handler({ url, init })
    }) as unknown as typeof fetch
  }

  test('posts currency and the optional planId verbatim', async () => {
    installFetch(() => jsonResponse({ delegationId: 'del-1' }))

    await payments.delegation.createDelegation({
      provider: 'stripe',
      providerPaymentMethodId: 'pm_123',
      spendingLimitCents: 10000,
      durationSecs: 604800,
      currency: 'usd',
      planId: 'plan-bound-1',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/delegation/create')
    const body = JSON.parse(calls[0].init!.body as string)
    expect(body.currency).toBe('usd')
    expect(body.planId).toBe('plan-bound-1')
  })

  test('plan-agnostic by default — planId is omitted when not supplied', async () => {
    installFetch(() => jsonResponse({ delegationId: 'del-1' }))

    await payments.delegation.createDelegation({
      provider: 'erc4337',
      spendingLimitCents: 100000,
      durationSecs: 604800,
      currency: 'usdc',
    })

    const body = JSON.parse(calls[0].init!.body as string)
    expect(body.currency).toBe('usdc')
    expect(body.planId).toBeUndefined()
  })
})
