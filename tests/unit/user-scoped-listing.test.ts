/**
 * Unit tests for user-scoped listing: `payments.plans.getPlans` /
 * `payments.agents.getAgents`.
 *
 * Both wrap the authenticated, caller-scoped `GET /api/v1/protocol/{plans,agents}`
 * endpoints — "my plans" / "my agents" account management, not a marketplace
 * search (they never return other users' content). They forward
 * page/offset/sortBy/sortOrder, and `orgId` only when provided.
 */
import { Payments } from '../../src/payments.js'

// Structurally-valid but fake JWT (zero-address subject, dummy o11y, fake
// signature) — only has to satisfy `decodeJwt` in Payments.getInstance. Mocked
// fetch means it is never transmitted. NOT a live token.
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

describe('user-scoped listing (getPlans / getAgents)', () => {
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

  const authHeader = (call: CapturedCall): string | undefined =>
    (call.init?.headers as Record<string, string> | undefined)?.['Authorization']

  describe('plans.getPlans', () => {
    test("lists the caller's plans with default pagination and an auth header", async () => {
      const body = {
        total: 2,
        page: 1,
        offset: 100,
        plans: [{ planId: 'plan-1' }, { planId: 'plan-2' }],
      }
      installFetch(() => jsonResponse(body))

      const result = await payments.plans.getPlans()

      expect(calls).toHaveLength(1)
      const url = new URL(calls[0].url)
      expect(url.pathname).toBe('/api/v1/protocol/plans')
      expect(url.searchParams.get('page')).toBe('1')
      expect(url.searchParams.get('offset')).toBe('100')
      expect(url.searchParams.has('orgId')).toBe(false)
      // Authenticated — the bearer token is what scopes the result to "me".
      expect(authHeader(calls[0])).toMatch(/^Bearer /)
      expect(result).toEqual(body)
    })

    test('forwards pagination and orgId when provided', async () => {
      installFetch(() => jsonResponse({ total: 0, plans: [] }))

      await payments.plans.getPlans(2, 25, 'created', 'asc', 'org-acme')

      const url = new URL(calls[0].url)
      expect(url.searchParams.get('page')).toBe('2')
      expect(url.searchParams.get('offset')).toBe('25')
      expect(url.searchParams.get('sortBy')).toBe('created')
      expect(url.searchParams.get('sortOrder')).toBe('asc')
      expect(url.searchParams.get('orgId')).toBe('org-acme')
    })

    test('throws on a non-2xx response', async () => {
      installFetch(() => jsonResponse({ message: 'boom' }, 500))
      await expect(payments.plans.getPlans()).rejects.toThrow()
    })
  })

  describe('agents.getAgents', () => {
    test("lists the caller's agents at /api/v1/protocol/agents", async () => {
      const body = { total: 1, page: 1, offset: 100, agents: [{ agentId: 'agent-1' }] }
      installFetch(() => jsonResponse(body))

      const result = await payments.agents.getAgents()

      const url = new URL(calls[0].url)
      expect(url.pathname).toBe('/api/v1/protocol/agents')
      expect(url.searchParams.has('orgId')).toBe(false)
      expect(authHeader(calls[0])).toMatch(/^Bearer /)
      expect(result).toEqual(body)
    })

    test('forwards pagination and orgId when provided', async () => {
      installFetch(() => jsonResponse({ total: 0, agents: [] }))

      await payments.agents.getAgents(2, 25, 'created', 'asc', 'org-acme')

      // getAgents builds its query string independently of getPlans, so assert
      // every param here too — an arg-order/typo bug wouldn't surface otherwise.
      const url = new URL(calls[0].url)
      expect(url.searchParams.get('page')).toBe('2')
      expect(url.searchParams.get('offset')).toBe('25')
      expect(url.searchParams.get('sortBy')).toBe('created')
      expect(url.searchParams.get('sortOrder')).toBe('asc')
      expect(url.searchParams.get('orgId')).toBe('org-acme')
    })

    test('throws on a non-2xx response', async () => {
      installFetch(() => jsonResponse({ message: 'boom' }, 500))
      await expect(payments.agents.getAgents()).rejects.toThrow()
    })
  })
})
