/**
 * Unit tests for backend API version pinning (nvm-monorepo#1938, epic #1535).
 *
 * Every HTTP call the SDK makes to the Nevermined backend must carry a
 * `Nevermined-Version` header so the backend serves the API contract this SDK
 * release was built and tested against. The value defaults to
 * `LOCKED_API_VERSION` and is overridable per instance via `options.version`
 * — never per request.
 *
 * `fetch` is replaced with a recording stub (same pattern as
 * `organizations-api.test.ts`) so headers can be asserted without hitting the
 * network. The mock NVM API key is the same fixture used in
 * `payments.test.ts`.
 */

import { Payments } from '../../src/payments.js'
import { BasePaymentsAPI } from '../../src/api/base-payments.js'
import { API_VERSION_HEADER, LOCKED_API_VERSION } from '../../src/common/api-version.js'
import { PaymentOptions } from '../../src/common/types.js'

const TEST_API_KEY =
  'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDIxRjc5ZjlkM2I2ZDUyZUY4Y2M4QjFhN0YyNjFCY2Y1ZjJFRjM1NGEiLCJqdGkiOiIweGUxMjIwMmRkMzZlZmQ4N2FkMjE1MmRlMjlkM2MwNmE5ZDU5N2M4NWJhOGMxOTQ1YjQ5MjlkYTYyYTRiZjQ1NGYiLCJleHAiOjE3OTEwNDc0OTcsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.JI14qfSWHCWRvHOK9TAg3HEXWX7oKEI6fU6gaaWlyDl5btBWLh8FQo1ZnuzixPmgsUR3gc4oRlenLPUuTy-mORw'

/**
 * Minimal concrete subclass exposing the protected HTTP option builders so
 * both can be asserted on directly.
 */
class TestPaymentsAPI extends BasePaymentsAPI {
  backendOptions(method: string, body?: any, extraHeaders?: Record<string, string>) {
    return this.getBackendHTTPOptions(method, body, extraHeaders)
  }

  publicOptions(method: string, body?: any) {
    return this.getPublicHTTPOptions(method, body)
  }
}

function makeApi(version?: string): TestPaymentsAPI {
  const options: PaymentOptions = {
    nvmApiKey: TEST_API_KEY,
    environment: 'staging_sandbox',
    ...(version ? { version } : {}),
  }
  return new TestPaymentsAPI(options)
}

type RecordedCall = { url: URL; init: any }

const originalFetch = globalThis.fetch

function installFetchStub(
  responder: (call: RecordedCall) => { ok: boolean; status?: number; body: any },
): RecordedCall[] {
  const calls: RecordedCall[] = []
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = input instanceof URL ? input : new URL(String(input))
    const call: RecordedCall = { url, init: init ?? input }
    calls.push(call)
    const { ok, status = ok ? 200 : 500, body } = responder(call)
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as any
  }) as any
  return calls
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

describe('API version pinning — Nevermined-Version header', () => {
  describe('constants', () => {
    test('LOCKED_API_VERSION is the backend MAJOR.MINOR contract this SDK targets', () => {
      expect(LOCKED_API_VERSION).toBe('1.1')
    })

    test('API_VERSION_HEADER is the Nevermined-Version header name', () => {
      expect(API_VERSION_HEADER).toBe('Nevermined-Version')
    })

    test('both constants are re-exported from the package barrel', async () => {
      const barrel = await import('../../src/index.js')
      expect(barrel.LOCKED_API_VERSION).toBe(LOCKED_API_VERSION)
      expect(barrel.API_VERSION_HEADER).toBe(API_VERSION_HEADER)
    })
  })

  describe('getBackendHTTPOptions', () => {
    test('pins LOCKED_API_VERSION by default', () => {
      const { headers } = makeApi().backendOptions('GET')
      expect(headers[API_VERSION_HEADER]).toBe('1.1')
    })

    test('honours the instance-level options.version override', () => {
      const { headers } = makeApi('1.0').backendOptions('POST', { some: 'body' })
      expect(headers[API_VERSION_HEADER]).toBe('1.0')
    })

    test('leaves the other transport headers untouched', () => {
      const { headers } = makeApi().backendOptions('GET')
      expect(headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`)
      expect(headers.Accept).toBe('application/json')
      expect(headers['Content-Type']).toBe('application/json')
    })

    test('per-request extraHeaders cannot override the pinned version', () => {
      const { headers } = makeApi().backendOptions('GET', undefined, {
        [API_VERSION_HEADER]: '9.9',
      })
      expect(headers[API_VERSION_HEADER]).toBe(LOCKED_API_VERSION)
    })
  })

  describe('getPublicHTTPOptions', () => {
    test('pins LOCKED_API_VERSION by default', () => {
      const { headers } = makeApi().publicOptions('GET')
      expect(headers[API_VERSION_HEADER]).toBe('1.1')
    })

    test('honours the instance-level options.version override', () => {
      const { headers } = makeApi('1.0').publicOptions('POST', { some: 'body' })
      expect(headers[API_VERSION_HEADER]).toBe('1.0')
    })

    test('never includes an Authorization header', () => {
      const { headers } = makeApi().publicOptions('GET')
      expect((headers as Record<string, string>).Authorization).toBeUndefined()
      expect(headers.Accept).toBe('application/json')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('Payments instance — header reaches the wire', () => {
    afterEach(() => {
      restoreFetch()
    })

    test('authenticated backend calls send the default version', async () => {
      const payments = Payments.getInstance({
        nvmApiKey: TEST_API_KEY,
        environment: 'staging_sandbox',
      })
      const calls = installFetchStub(() => ({ ok: true, body: [] }))

      await payments.organizations.getMyMemberships()

      expect(calls).toHaveLength(1)
      expect(calls[0].init.headers[API_VERSION_HEADER]).toBe(LOCKED_API_VERSION)
      expect(calls[0].init.headers.Authorization).toMatch(/^Bearer /)
    })

    test('options.version override propagates to sub-API calls', async () => {
      const payments = Payments.getInstance({
        nvmApiKey: TEST_API_KEY,
        environment: 'staging_sandbox',
        version: '1.0',
      })
      const calls = installFetchStub(() => ({ ok: true, body: [] }))

      await payments.organizations.getMyMemberships()

      expect(calls[0].init.headers[API_VERSION_HEADER]).toBe('1.0')
    })

    test('the lazily-built delegation API inherits the instance override', async () => {
      const payments = Payments.getInstance({
        nvmApiKey: TEST_API_KEY,
        environment: 'staging_sandbox',
        version: '1.0',
      })
      const calls = installFetchStub(() => ({ ok: true, body: [] }))

      await payments.delegation.listPaymentMethods()

      expect(calls[0].init.headers[API_VERSION_HEADER]).toBe('1.0')
    })

    test('public (unauthenticated) backend endpoints send the version header', async () => {
      const payments = Payments.getInstance({
        nvmApiKey: TEST_API_KEY,
        environment: 'staging_sandbox',
      })
      const calls = installFetchStub(() => ({ ok: true, body: {} }))

      await payments.plans.getPlan('plan-123')
      await payments.plans.getAgentsAssociatedToAPlan('plan-123')
      await payments.plans
        .getPlanBalance('plan-123', '0x6B16D0b334824581B4a24A49Fd7fcbD6509CE5da')
        .catch(() => undefined) // stub payload may not satisfy parsing; the wire assertion below is the point
      await payments.agents.getAgent('agent-123')
      await payments.agents.getAgentPlans('agent-123')

      expect(calls).toHaveLength(5)
      for (const call of calls) {
        expect(call.init.headers[API_VERSION_HEADER]).toBe(LOCKED_API_VERSION)
        expect(call.init.headers.Authorization).toBeUndefined()
      }
    })

    test('the deployment info bootstrap call sends the version header', async () => {
      const payments = Payments.getInstance({
        nvmApiKey: TEST_API_KEY,
        environment: 'staging_sandbox',
      })
      const calls = installFetchStub(() => ({
        ok: true,
        body: { deployment: { contracts: { PaymentsVault: '0x1' } } },
      }))

      await payments.contracts.getDeploymentInfo()

      expect(calls[0].init.headers[API_VERSION_HEADER]).toBe(LOCKED_API_VERSION)
    })
  })
})
