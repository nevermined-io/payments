/**
 * Unit tests for the Visa provider surface of the payments SDK.
 *
 * Visa enrolment and Visa delegation creation both require a browser (VGS
 * Collect iframe + WebAuthn passkey ceremony), so the SDK is not expected
 * to perform either programmatically. These tests cover what the SDK is
 * actually responsible for:
 *
 *   1. listPaymentMethods() surfaces visa-provider cards unchanged.
 *   2. createDelegation() accepts provider:'visa' and posts the payload
 *      verbatim — the backend handles all visa-specific orchestration.
 *   3. getX402AccessToken() generates a token against a visa delegationId
 *      using the standard nvm:card-delegation scheme with network='visa'.
 */
import { Payments } from '../../src/payments.js'
import { PaymentsError } from '../../src/common/payments.error.js'
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

describe('Visa provider surface', () => {
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

  test('listPaymentMethods surfaces visa-provider cards unchanged', async () => {
    const visaCard: PaymentMethodSummary = {
      id: 'vat_1abc23def45',
      type: 'card',
      brand: 'visa',
      last4: '1387',
      expMonth: 12,
      expYear: 27,
      alias: 'Personal Visa',
      provider: 'visa',
      status: 'Active',
      allowedApiKeyIds: null,
    }
    installFetch(() => jsonResponse([visaCard]))

    const methods = await payments.delegation.listPaymentMethods()

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/payment-methods')
    expect(methods).toHaveLength(1)
    expect(methods[0]).toEqual(visaCard)
    expect(methods[0].provider).toBe('visa')
  })

  test('createDelegation posts provider:"visa" payload verbatim', async () => {
    installFetch(() => jsonResponse({ delegationId: 'del_visa_1234', delegationToken: 'tok_xyz' }))

    const payload = {
      provider: 'visa' as const,
      providerPaymentMethodId: 'vat_1abc23def45',
      spendingLimitCents: 10_000,
      durationSecs: 3_600,
      currency: 'usd',
      maxTransactions: 5,
    }
    const response = await payments.delegation.createDelegation(payload)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/delegation/create')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(calls[0].init!.body as string)).toEqual(payload)
    expect(response.delegationId).toBe('del_visa_1234')
  })

  test('getX402AccessToken targets nvm:card-delegation with network=visa and a visa delegationId', async () => {
    installFetch(() => jsonResponse({ accessToken: 'eyJ.visa.token' }))

    const result = await payments.x402.getX402AccessToken('plan-id-123', 'agent-id-abc', {
      scheme: 'nvm:card-delegation',
      network: 'visa',
      delegationConfig: { delegationId: 'del_visa_1234' },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/x402/permissions')
    const body = JSON.parse(calls[0].init!.body as string)
    expect(body.accepted.scheme).toBe('nvm:card-delegation')
    expect(body.accepted.network).toBe('visa')
    expect(body.accepted.planId).toBe('plan-id-123')
    expect(body.accepted.extra.agentId).toBe('agent-id-abc')
    expect(body.delegationConfig).toEqual({ delegationId: 'del_visa_1234' })
    expect(result.accessToken).toBe('eyJ.visa.token')
  })

  test('verifyPermissions accepts a visa-network paymentRequired without provider-specific branching', async () => {
    installFetch(() =>
      jsonResponse({ isValid: true, payer: 'cust_42', network: 'visa', urlMatching: '/tools/*' }),
    )

    const result = await payments.facilitator.verifyPermissions({
      paymentRequired: {
        x402Version: 2,
        resource: { url: '/tools/echo' },
        accepts: [{ scheme: 'nvm:card-delegation', network: 'visa', planId: 'plan-123' }],
        extensions: {},
      },
      x402AccessToken: 'eyJ.visa.token',
      maxAmount: 5n,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/x402/verify')
    expect(result.isValid).toBe(true)
    expect(result.network).toBe('visa')
  })

  test('settlePermissions accepts a visa-network paymentRequired without provider-specific branching', async () => {
    installFetch(() =>
      jsonResponse({
        success: true,
        transaction: 'visa-tx-7c3a',
        network: 'visa',
        creditsRedeemed: '5',
      }),
    )

    const result = await payments.facilitator.settlePermissions({
      paymentRequired: {
        x402Version: 2,
        resource: { url: '/tools/echo' },
        accepts: [{ scheme: 'nvm:card-delegation', network: 'visa', planId: 'plan-123' }],
        extensions: {},
      },
      x402AccessToken: 'eyJ.visa.token',
      maxAmount: 5n,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/x402/settle')
    expect(result.success).toBe(true)
    expect(result.network).toBe('visa')
    expect(result.creditsRedeemed).toBe('5')
  })

  test('createDelegation surfaces backend NVMException code + message on 4xx', async () => {
    // Mirrors the real envelope nvm-monorepo emits when consumerPrompt /
    // assuranceData are missing for a Visa delegation (BCK.VISA.0014).
    installFetch(
      () =>
        new Response(
          JSON.stringify({
            code: 'BCK.VISA.0014',
            httpStatus: 400,
            message: 'Visa delegation creation requires consumerPrompt and assuranceData',
            category: 'business',
            retryable: false,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    )

    let caught: PaymentsError | undefined
    try {
      await payments.delegation.createDelegation({
        provider: 'visa',
        providerPaymentMethodId: 'vat_1abc23def45',
        spendingLimitCents: 1_000,
        durationSecs: 3_600,
      })
    } catch (err) {
      caught = err as PaymentsError
    }

    expect(caught).toBeInstanceOf(PaymentsError)
    expect(caught!.message).toContain(
      'Visa delegation creation requires consumerPrompt and assuranceData',
    )
    expect(caught!.message).toContain('HTTP 400')
    expect(caught!.code).toBe('BCK.VISA.0014')
  })

  test('all backend calls carry the Bearer authorization header', async () => {
    installFetch(() => jsonResponse([]))

    await payments.delegation.listPaymentMethods()
    await payments.delegation
      .createDelegation({
        provider: 'visa',
        providerPaymentMethodId: 'vat_1abc23def45',
        spendingLimitCents: 1_000,
        durationSecs: 3_600,
      })
      .catch(() => undefined)

    for (const call of calls) {
      const auth = (call.init?.headers as Record<string, string> | undefined)?.Authorization
      expect(auth).toMatch(/^Bearer /)
    }
  })

  // The facilitator verify/settle endpoints carry money side effects
  // (Stripe/VGS/Braintree on settle), so the SDK now authenticates them with
  // the NVM API key instead of calling them unauthenticated. The backend's
  // optional guard tolerates the header today; this pre-positions for the
  // later strict-guard flip. See nevermined-io/nvm-monorepo#1570.
  test('verifyPermissions sends the NVM API-key authorization header', async () => {
    installFetch(() => jsonResponse({ isValid: true }))

    await payments.facilitator.verifyPermissions({
      paymentRequired: {
        x402Version: 2,
        resource: { url: '/tools/echo' },
        accepts: [{ scheme: 'nvm:card-delegation', network: 'visa', planId: 'plan-123' }],
        extensions: {},
      },
      x402AccessToken: 'eyJ.visa.token',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/x402/verify')
    const auth = (calls[0].init?.headers as Record<string, string> | undefined)?.Authorization
    expect(auth).toBe(`Bearer ${TEST_API_KEY}`)
  })

  test('settlePermissions sends the NVM API-key authorization header', async () => {
    installFetch(() => jsonResponse({ success: true }))

    await payments.facilitator.settlePermissions({
      paymentRequired: {
        x402Version: 2,
        resource: { url: '/tools/echo' },
        accepts: [{ scheme: 'nvm:card-delegation', network: 'visa', planId: 'plan-123' }],
        extensions: {},
      },
      x402AccessToken: 'eyJ.visa.token',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/x402/settle')
    const auth = (calls[0].init?.headers as Record<string, string> | undefined)?.Authorization
    expect(auth).toBe(`Bearer ${TEST_API_KEY}`)
  })

  // Switching to the authed HTTP options means an org-pinned caller now also
  // sends X-Current-Org-Id, so the money-adjacent settle becomes org-scoped.
  // See nevermined-io/nvm-monorepo#1570.
  test('settlePermissions sends X-Current-Org-Id for an org-pinned caller', async () => {
    installFetch(() => jsonResponse({ success: true }))

    payments.setOrganizationId('org-123')

    await payments.facilitator.settlePermissions({
      paymentRequired: {
        x402Version: 2,
        resource: { url: '/tools/echo' },
        accepts: [{ scheme: 'nvm:card-delegation', network: 'visa', planId: 'plan-123' }],
        extensions: {},
      },
      x402AccessToken: 'eyJ.visa.token',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/x402/settle')
    const headers = calls[0].init?.headers as Record<string, string> | undefined
    expect(headers?.['X-Current-Org-Id']).toBe('org-123')
    // Authorization is still the Bearer key alongside the org scope.
    expect(headers?.Authorization).toBe(`Bearer ${TEST_API_KEY}`)
  })

  test("getInstance rejects scheme:'visa' with a migration message", () => {
    expect(() =>
      Payments.getInstance({
        nvmApiKey: TEST_API_KEY,
        environment: 'staging_sandbox',
        // @ts-expect-error — scheme:'visa' is intentionally removed from
        // PaymentScheme. The test guards JS callers pinned to an older
        // .d.ts that might still pass it at runtime.
        scheme: 'visa',
      }),
    ).toThrow(/scheme 'visa' is no longer supported/)
  })
})
