/**
 * Unit tests for `payments.orders` (OrdersAPI) — the SDK client for the
 * browser-fiat Orders endpoints (nvm-monorepo epic #3238, task #3250):
 *
 * - `POST /api/v1/orders` — merchant, server-to-server, authenticated with an
 *   org-scoped NVM API key.
 * - `GET /api/v1/orders/:id` — anonymous; the unguessable id is the access
 *   control, so the SDK sends NO Authorization header.
 *
 * `fetch` is replaced with a recording stub so we can assert on URLs, headers
 * and bodies without hitting the network. The mock NVM API key is the same
 * fixture used in `payments.test.ts`.
 */

import { Payments } from '../../src/payments.js'
import { API_VERSION_HEADER, LOCKED_API_VERSION } from '../../src/common/api-version.js'
import { CURRENT_ORG_ID_HEADER } from '../../src/api/base-payments.js'
import type { CreateOrderResult, Order } from '../../src/api/orders-api.js'

const TEST_API_KEY =
  'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDIxRjc5ZjlkM2I2ZDUyZUY4Y2M4QjFhN0YyNjFCY2Y1ZjJFRjM1NGEiLCJqdGkiOiIweGUxMjIwMmRkMzZlZmQ4N2FkMjE1MmRlMjlkM2MwNmE5ZDU5N2M4NWJhOGMxOTQ1YjQ5MjlkYTYyYTRiZjQ1NGYiLCJleHAiOjE3OTEwNDc0OTcsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.JI14qfSWHCWRvHOK9TAg3HEXWX7oKEI6fU6gaaWlyDl5btBWLh8FQo1ZnuzixPmgsUR3gc4oRlenLPUuTy-mORw'

type RecordedCall = { url: URL; init: any }

const originalFetch = globalThis.fetch

function installFetchStub(
  responder: (call: RecordedCall) => { ok: boolean; status?: number; body: any },
): RecordedCall[] {
  const calls: RecordedCall[] = []
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = input instanceof URL ? input : new URL(String(input))
    const call: RecordedCall = { url, init: init ?? {} }
    calls.push(call)
    const { ok, status = ok ? 200 : 500, body } = responder(call)
    return {
      ok,
      status,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as any
  }) as any
  return calls
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

function makePayments() {
  return Payments.getInstance({ nvmApiKey: TEST_API_KEY, environment: 'staging_sandbox' })
}

describe('OrdersAPI — payments.orders', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('is wired into Payments and forwards the instance org pin to the wire', async () => {
    const calls = installFetchStub(() => ({
      ok: true,
      status: 201,
      body: { orderId: 'ord_1', status: 'requires_payment' },
    }))
    const payments = makePayments()
    expect(payments.orders).toBeDefined()

    payments.setOrganizationId('org-abc')
    await payments.orders.createOrder({ amountMinor: 100 })

    expect(calls[0].init.headers[CURRENT_ORG_ID_HEADER]).toBe('org-abc')
  })

  describe('createOrder', () => {
    const created: CreateOrderResult = {
      orderId: 'ord_9f2c1a7e-3b4d-4c8a-9e21-0a5b6c7d8e9f',
      status: 'requires_payment',
      clientSecret: 'pi_3PGh9k_secret_9x8y7z',
    }

    test('POSTs to /api/v1/orders with the merchant key and returns the result', async () => {
      const calls = installFetchStub(() => ({ ok: true, status: 201, body: created }))
      const payments = makePayments()

      const result = await payments.orders.createOrder({
        amountMinor: 3437,
        description: 'Cart checkout — 3 items',
        idempotencyKey: 'idem-8f2c1a',
        // Opaque merchant data must reach the wire verbatim (no key rewriting).
        metadata: { channel: 'web', unit_price: 3437 },
        lineItems: [{ sku: 'PRO-PLAN', unit_price: 3437, quantity: 1 }],
      })

      expect(result).toEqual(created)
      expect(calls).toHaveLength(1)
      const [{ url, init }] = calls
      expect(url.pathname).toBe('/api/v1/orders')
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`)
      expect(init.headers[API_VERSION_HEADER]).toBe(LOCKED_API_VERSION)
      expect(JSON.parse(init.body)).toEqual({
        amountMinor: 3437,
        currency: 'usd',
        description: 'Cart checkout — 3 items',
        idempotencyKey: 'idem-8f2c1a',
        metadata: { channel: 'web', unit_price: 3437 },
        lineItems: [{ sku: 'PRO-PLAN', unit_price: 3437, quantity: 1 }],
      })
    })

    test('sends only the fields the caller set (no undefined placeholders)', async () => {
      const calls = installFetchStub(() => ({ ok: true, status: 201, body: created }))
      await makePayments().orders.createOrder({ amountMinor: 100, currency: 'usd' })
      expect(JSON.parse(calls[0].init.body)).toEqual({ amountMinor: 100, currency: 'usd' })
    })

    test('surfaces the backend catalogue code on refusal (BCK.ORDER.0003)', async () => {
      installFetchStub(() => ({
        ok: false,
        status: 403,
        body: { code: 'BCK.ORDER.0003', message: 'Order not initiated by an active organization' },
      }))
      await expect(makePayments().orders.createOrder({ amountMinor: 3437 })).rejects.toMatchObject({
        name: 'PaymentsError',
        code: 'BCK.ORDER.0003',
        message: expect.stringContaining('active organization'),
      })
    })
  })

  describe('getOrder', () => {
    const order: Order = {
      id: 'ord_9f2c1a7e-3b4d-4c8a-9e21-0a5b6c7d8e9f',
      amountMinor: 3437,
      currency: 'usd',
      status: 'requires_payment',
      amountRefundedMinor: 0,
      description: 'Cart checkout — 3 items',
      buyerRef: null,
      paymentIntentId: 'pi_3PGh9k',
      expiresAt: null,
      clientSecret: 'pi_3PGh9k_secret_9x8y7z',
    }

    test('GETs /api/v1/orders/:id anonymously and returns the buyer-safe view', async () => {
      const calls = installFetchStub(() => ({ ok: true, body: order }))
      const result = await makePayments().orders.getOrder(order.id)

      expect(result).toEqual(order)
      const [{ url, init }] = calls
      expect(url.pathname).toBe(`/api/v1/orders/${order.id}`)
      expect(init.method).toBe('GET')
      // The id IS the access control — never leak the merchant key on the read.
      expect(init.headers.Authorization).toBeUndefined()
      expect(init.headers[API_VERSION_HEADER]).toBe(LOCKED_API_VERSION)
    })

    test('URL-encodes the order id so a stray character cannot retarget the request', async () => {
      const calls = installFetchStub(() => ({ ok: true, body: order }))
      await makePayments().orders.getOrder('ord_x?foo=1')
      expect(calls[0].url.pathname).toBe('/api/v1/orders/ord_x%3Ffoo%3D1')
      expect(calls[0].url.search).toBe('')
    })

    test('surfaces the read throttle (no catalogue code) as http_429', async () => {
      // Nest ThrottlerException body: no `code`, unlike NVMException envelopes.
      installFetchStub(() => ({
        ok: false,
        status: 429,
        body: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
      }))
      await expect(makePayments().orders.getOrder('ord_1')).rejects.toMatchObject({
        name: 'PaymentsError',
        code: 'http_429',
        message: expect.stringContaining('Too Many Requests'),
      })
    })

    test('surfaces BCK.ORDER.0002 on a miss', async () => {
      installFetchStub(() => ({
        ok: false,
        status: 404,
        body: { code: 'BCK.ORDER.0002', message: 'No order exists with this id' },
      }))
      await expect(makePayments().orders.getOrder('ord_missing')).rejects.toMatchObject({
        name: 'PaymentsError',
        code: 'BCK.ORDER.0002',
      })
    })
  })
})
