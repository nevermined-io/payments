/**
 * Unit tests for the OrganizationsAPI workspace surface added by the multi-org
 * SDK exposure (`getMyMemberships`, `getOrganizationActivity`, and the
 * per-call / instance-level `X-Current-Org-Id` header plumbing).
 *
 * `fetch` is replaced with a recording stub so we can assert on URLs and
 * headers without hitting the network. The mock NVM API key is the same
 * fixture used in `payments.test.ts`.
 */

import { Payments } from '../../src/payments.js'
import { CURRENT_ORG_ID_HEADER } from '../../src/api/base-payments.js'
import {
  OrganizationActivityEventType,
  OrganizationMemberRole,
  OrganizationType,
} from '../../src/api/organizations-api/types.js'

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

function makePayments(organizationId?: string) {
  return Payments.getInstance({
    nvmApiKey: TEST_API_KEY,
    environment: 'staging_sandbox',
    ...(organizationId ? { organizationId } : {}),
  })
}

describe('OrganizationsAPI — workspace surface', () => {
  afterEach(() => {
    restoreFetch()
  })

  describe('getMyMemberships', () => {
    test('returns the parsed list and hits /my-memberships', async () => {
      const payments = makePayments()
      const body = [
        {
          orgId: 'org-aaa',
          orgName: 'Acme',
          role: OrganizationMemberRole.Admin,
          orgType: OrganizationType.Premium,
          isAdmin: true,
          hasSubscriptionHistory: true,
        },
        {
          orgId: 'org-bbb',
          orgName: 'Beta',
          role: OrganizationMemberRole.Member,
          orgType: OrganizationType.Enterprise,
          isAdmin: false,
          hasSubscriptionHistory: true,
        },
      ]
      const calls = installFetchStub(() => ({ ok: true, body }))

      const memberships = await payments.organizations.getMyMemberships()

      expect(memberships).toEqual(body)
      expect(calls).toHaveLength(1)
      expect(calls[0].url.pathname).toBe('/api/v1/organizations/my-memberships')
      expect(calls[0].init.method).toBe('GET')
      expect(calls[0].init.headers.Authorization).toMatch(/^Bearer /)
    })

    test('tolerates an unexpected non-array body without throwing', async () => {
      const payments = makePayments()
      installFetchStub(() => ({ ok: true, body: null }))

      const memberships = await payments.organizations.getMyMemberships()
      expect(memberships).toEqual([])
    })

    test('throws PaymentsError on 5xx', async () => {
      const payments = makePayments()
      installFetchStub(() => ({ ok: false, status: 500, body: { message: 'boom' } }))

      await expect(payments.organizations.getMyMemberships()).rejects.toThrow(
        /Unable to fetch memberships/,
      )
    })
  })

  describe('getOrganizationActivity', () => {
    test('encodes filters in the query string and targets the org path', async () => {
      const payments = makePayments()
      const body = { items: [], total: 0 }
      const calls = installFetchStub(() => ({ ok: true, body }))

      await payments.organizations.getOrganizationActivity('org-xyz', {
        eventType: OrganizationActivityEventType.MemberInvited,
        actorUserId: 'us-1',
        from: '2026-01-01T00:00:00Z',
        to: '2026-12-31T23:59:59Z',
        page: 2,
        limit: 25,
      })

      expect(calls).toHaveLength(1)
      const { url, init } = calls[0]
      expect(url.pathname).toBe('/api/v1/organizations/org-xyz/activity')
      expect(url.searchParams.get('eventType')).toBe('member.invited')
      expect(url.searchParams.get('actorUserId')).toBe('us-1')
      expect(url.searchParams.get('from')).toBe('2026-01-01T00:00:00Z')
      expect(url.searchParams.get('to')).toBe('2026-12-31T23:59:59Z')
      expect(url.searchParams.get('page')).toBe('2')
      expect(url.searchParams.get('limit')).toBe('25')
      expect(init.method).toBe('GET')
    })

    test('joins an array eventType filter into a comma-separated list', async () => {
      const payments = makePayments()
      const calls = installFetchStub(() => ({ ok: true, body: { items: [], total: 0 } }))

      await payments.organizations.getOrganizationActivity('org-xyz', {
        eventType: [
          OrganizationActivityEventType.PlanCreated,
          OrganizationActivityEventType.AgentCreated,
        ],
      })

      expect(calls[0].url.searchParams.get('eventType')).toBe('plan.created,agent.created')
    })

    test('omits empty filters from the query string', async () => {
      const payments = makePayments()
      const calls = installFetchStub(() => ({
        ok: true,
        body: { items: [], total: 0 },
      }))

      await payments.organizations.getOrganizationActivity('org-xyz')

      expect(calls[0].url.search).toBe('')
    })

    test('rejects without an orgId', async () => {
      const payments = makePayments()
      installFetchStub(() => ({ ok: true, body: {} }))
      await expect(payments.organizations.getOrganizationActivity('')).rejects.toThrow(
        /orgId is required/,
      )
    })

    test('throws PaymentsError on 403 (non-member)', async () => {
      const payments = makePayments()
      installFetchStub(() => ({
        ok: false,
        status: 403,
        body: { errorCode: 'BCK.AUTH.0004', message: 'not a member' },
      }))

      await expect(payments.organizations.getOrganizationActivity('org-forbidden')).rejects.toThrow(
        /Unable to fetch organization activity/,
      )
    })
  })

  describe('X-Current-Org-Id header — instance-level pin', () => {
    test('constructor `organizationId` option attaches header to every authenticated call', async () => {
      const payments = makePayments('org-pin')
      const calls = installFetchStub(() => ({ ok: true, body: [] }))

      await payments.organizations.getMyMemberships()

      expect(calls[0].init.headers[CURRENT_ORG_ID_HEADER]).toBe('org-pin')
    })

    test('setOrganizationId mutates subsequent calls', async () => {
      const payments = makePayments()
      const calls = installFetchStub(() => ({ ok: true, body: [] }))

      await payments.organizations.getMyMemberships()
      payments.setOrganizationId('org-after-set')
      await payments.organizations.getMyMemberships()
      payments.setOrganizationId(null)
      await payments.organizations.getMyMemberships()

      expect(calls[0].init.headers[CURRENT_ORG_ID_HEADER]).toBeUndefined()
      expect(calls[1].init.headers[CURRENT_ORG_ID_HEADER]).toBe('org-after-set')
      expect(calls[2].init.headers[CURRENT_ORG_ID_HEADER]).toBeUndefined()
    })

    test('setOrganizationId propagates to sibling sub-APIs', async () => {
      const payments = makePayments()
      const calls = installFetchStub(() => ({
        ok: true,
        body: { items: [], total: 0, page: 1, offset: 10 },
      }))

      payments.setOrganizationId('org-fan-out')
      await payments.organizations.getOrganizationActivity('org-fan-out')

      // Both the organizations API and (via the same `Payments` instance)
      // every other sub-API now carries the pinned org id.
      expect(payments.agents.getOrganizationId()).toBe('org-fan-out')
      expect(payments.plans.getOrganizationId()).toBe('org-fan-out')
      expect(calls[0].init.headers[CURRENT_ORG_ID_HEADER]).toBe('org-fan-out')
    })
  })

  describe('X-Current-Org-Id header — per-call override on publish', () => {
    const baseMetadata = { name: 'Bot' }
    const baseApi = {
      authType: 'none' as const,
      endpoints: [{ POST: 'https://example.com/run' }],
    }
    const basePriceConfig = {
      amounts: [0n],
      receivers: [],
      isCrypto: true,
    }
    const baseCreditsConfig = {
      isRedemptionAmountFixed: true,
      redemptionType: 0,
      onchainMirror: false,
      durationSecs: 0n,
      amount: 100n,
      minAmount: 1n,
      maxAmount: 1n,
    }

    test('registerAgent forwards organizationId without mutating the instance pin', async () => {
      const payments = makePayments('org-pinned')
      const calls = installFetchStub(() => ({
        ok: true,
        body: { data: { agentId: 'ag-1' } },
      }))

      await payments.agents.registerAgent(baseMetadata, baseApi, ['plan-1'], {
        organizationId: 'org-override',
      })

      expect(calls[0].init.headers[CURRENT_ORG_ID_HEADER]).toBe('org-override')
      // The instance pin must not have been overwritten by the per-call hint.
      expect(payments.agents.getOrganizationId()).toBe('org-pinned')
      expect(payments.getOrganizationId()).toBe('org-pinned')
    })

    test('registerAgent falls back to the pinned org when no override is supplied', async () => {
      const payments = makePayments('org-pinned')
      const calls = installFetchStub(() => ({
        ok: true,
        body: { data: { agentId: 'ag-2' } },
      }))

      await payments.agents.registerAgent(baseMetadata, baseApi, ['plan-1'])

      expect(calls[0].init.headers[CURRENT_ORG_ID_HEADER]).toBe('org-pinned')
    })

    test('registerAgentAndPlan accepts the override in the trailing options argument', async () => {
      const payments = makePayments()
      const calls = installFetchStub(() => ({
        ok: true,
        body: { data: { agentId: 'ag-3', planId: 'pl-3' }, txHash: '0xabc' },
      }))

      await payments.agents.registerAgentAndPlan(
        baseMetadata,
        baseApi,
        { name: 'Plan' },
        basePriceConfig as any,
        baseCreditsConfig as any,
        undefined,
        { organizationId: 'org-c' },
      )

      expect(calls[0].init.headers[CURRENT_ORG_ID_HEADER]).toBe('org-c')
    })

    test('registerPlan forwards the override', async () => {
      const payments = makePayments()
      const calls = installFetchStub(() => ({ ok: true, body: { planId: 'pl-4' } }))

      await payments.plans.registerPlan(
        { name: 'P' },
        basePriceConfig as any,
        baseCreditsConfig as any,
        undefined,
        undefined,
        { organizationId: 'org-d' },
      )

      expect(calls[0].init.headers[CURRENT_ORG_ID_HEADER]).toBe('org-d')
    })
  })
})
