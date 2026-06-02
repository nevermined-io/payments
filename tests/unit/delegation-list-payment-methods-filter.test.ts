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
