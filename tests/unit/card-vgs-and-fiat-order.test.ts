/**
 * Pins the SDK side of two card flows against what the backend accepts/returns:
 *
 *   1. createDelegation() accepts provider:'vgs' (a card enrolled through the
 *      credit/debit card form) with its CRD… card id.
 *   2. orderFiatPlan() posts { planId } to /api/v1/fiat/stripe/payment and returns
 *      the PaymentIntent the backend answers with, unwrapped.
 */
import { Payments } from '../../src/payments.js'
import { PaymentsError } from '../../src/common/payments.error.js'
import type { CreateDelegationPayload, StripePaymentIntent } from '../../src/common/types.js'

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

describe('vgs card delegation and fiat plan order', () => {
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

  const installFetch = (handler: () => Response): void => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init })
      return handler()
    }) as unknown as typeof fetch
  }

  test('createDelegation posts a provider:"vgs" payload with the CRD… card id', async () => {
    installFetch(() => jsonResponse({ delegationId: 'del_vgs_1234', delegationToken: 'tok_xyz' }))

    const payload = {
      provider: 'vgs',
      providerPaymentMethodId: 'CRDrX94aaaJz7oTFy2i13964k',
      spendingLimitCents: 10_000,
      durationSecs: 3_600,
      currency: 'usd',
    } satisfies CreateDelegationPayload
    const response = await payments.delegation.createDelegation(payload)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/delegation/create')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(calls[0].init!.body as string)).toEqual(payload)
    expect(response.delegationId).toBe('del_vgs_1234')
  })

  test('orderFiatPlan posts { planId } and returns the PaymentIntent unwrapped', async () => {
    const paymentIntent: StripePaymentIntent = {
      id: 'pi_3O4KfNBYvSRKcV42',
      client_secret: 'pi_3O4KfNBYvSRKcV42_secret_ABC',
      status: 'requires_payment_method',
      amount: 1000,
      currency: 'usd',
    }
    installFetch(() => jsonResponse(paymentIntent, 201))

    const result = await payments.plans.orderFiatPlan('plan-123')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/fiat/stripe/payment')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ planId: 'plan-123' })
    expect(result.id).toBe('pi_3O4KfNBYvSRKcV42')
    expect(result.client_secret).toBe('pi_3O4KfNBYvSRKcV42_secret_ABC')
    expect(result).toEqual(paymentIntent)
  })

  test('orderFiatPlan turns a 4xx into a PaymentsError', async () => {
    installFetch(() =>
      jsonResponse(
        {
          code: 'BCK.STRIPE.0003',
          httpStatus: 400,
          message: 'Unable to create Stripe payment intent',
        },
        400,
      ),
    )

    await expect(payments.plans.orderFiatPlan('plan-123')).rejects.toBeInstanceOf(PaymentsError)
  })
})
