/**
 * Unit tests for the optional `provider` filter on
 * `payments.delegation.listPaymentMethods({ provider })`.
 *
 * The SDK forwards the provider as a `?provider=` query string when set, and
 * omits it entirely otherwise (preserving the default "all methods" behaviour).
 * Depends on the backend `?provider=` filter (nevermined-io/nvm-monorepo#1715).
 */
import { Payments } from '../../src/payments.js'
import type { PaymentMethodSummary } from '../../src/x402/delegation-api.js'

// The test mocks global.fetch (installFetch), so this key is never transmitted.
// It only has to satisfy `decodeJwt` in Payments.getInstance (reads `sub`/`o11y`,
// no signature/expiry check), so the fallback is a structurally-valid JWT with
// dummy claims — a zero-address subject and a fake signature — NOT a live token.
const TEST_API_KEY =
  process.env.TEST_PROXY_BEARER_TOKEN ||
  'sandbox-staging:eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiIweDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAiLCJzdWIiOiIweDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAiLCJqdGkiOiIweDAiLCJleHAiOjk5OTk5OTk5OTksIm8xMXkiOiJ0ZXN0LW8xMXkta2V5In0.test-signature'

interface CapturedCall {
  url: string
  init?: RequestInit
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('listPaymentMethods provider filter', () => {
  let originalFetch: typeof fetch
  let calls: CapturedCall[]
  let payments: Payments

  const stripeCard: PaymentMethodSummary = {
    id: 'pm_1abc',
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 27,
    alias: 'Personal',
    provider: 'stripe',
    status: 'Active',
    allowedApiKeyIds: null,
  }

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

  test('forwards provider as a ?provider= query string when set', async () => {
    installFetch(() => jsonResponse([stripeCard]))

    const methods = await payments.delegation.listPaymentMethods({ provider: 'stripe' })

    expect(calls).toHaveLength(1)
    const url = new URL(calls[0].url)
    expect(url.pathname).toContain('/api/v1/payment-methods')
    expect(url.searchParams.get('provider')).toBe('stripe')
    expect(methods).toEqual([stripeCard])
  })

  test('omits the provider query string when not set (default = all methods)', async () => {
    installFetch(() => jsonResponse([stripeCard]))

    await payments.delegation.listPaymentMethods()

    expect(calls).toHaveLength(1)
    expect(new URL(calls[0].url).searchParams.has('provider')).toBe(false)
  })

  test('combines provider with the accessible flag', async () => {
    installFetch(() => jsonResponse([stripeCard]))

    await payments.delegation.listPaymentMethods({ accessible: true, provider: 'braintree' })

    const url = new URL(calls[0].url)
    expect(url.searchParams.get('accessible')).toBe('true')
    expect(url.searchParams.get('provider')).toBe('braintree')
  })

  test('forwards the erc4337 provider value', async () => {
    installFetch(() => jsonResponse([]))

    await payments.delegation.listPaymentMethods({ provider: 'erc4337' })

    expect(new URL(calls[0].url).searchParams.get('provider')).toBe('erc4337')
  })
})
