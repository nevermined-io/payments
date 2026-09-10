/**
 * Unit tests for pagination input on the public marketplace listing methods
 * `payments.agents.getAgentPlans` and `payments.plans.getAgentsAssociatedToAPlan`
 * (nevermined-io/payments#431).
 *
 * The signature reads as a plain options object, so callers pass `{ page, offset }`
 * and previously hit `TypeError: pagination.asQueryParams is not a function` at
 * runtime. Both methods must accept a plain object, a `PaginationOptions` instance,
 * or nothing, and forward `page` / `pageSize` / `sortOrder` identically.
 */
import { Payments } from '../../src/payments.js'
import { PaginationOptions } from '../../src/common/types.js'

// sandbox-staging prefix so the environment is derived from the key (no
// `environment` option → no deprecation warning). Fake JWT; mocked fetch means
// it is never transmitted.
const TEST_API_KEY =
  'sandbox-staging:eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiIweDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAiLCJzdWIiOiIweDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAiLCJqdGkiOiIweDAiLCJleHAiOjk5OTk5OTk5OTksIm8xMXkiOiJ0ZXN0LW8xMXkta2V5In0.test-signature'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('marketplace listing pagination input (#431)', () => {
  let originalFetch: typeof fetch
  let lastUrl: string
  let payments: Payments

  beforeEach(() => {
    originalFetch = global.fetch
    lastUrl = ''
    payments = Payments.getInstance({ nvmApiKey: TEST_API_KEY })
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input.toString()
      return jsonResponse({ total: 0, page: 1, offset: 10, plans: [], agents: [] })
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('agents.getAgentPlans', () => {
    test('accepts a plain object instead of a PaginationOptions instance', async () => {
      await expect(payments.agents.getAgentPlans('agent-1', { page: 2, offset: 25 })).resolves.toBeDefined()
      const url = new URL(lastUrl)
      expect(url.pathname).toBe('/api/v1/protocol/agents/agent-1/plans')
      expect(url.searchParams.get('page')).toBe('2')
      expect(url.searchParams.get('pageSize')).toBe('25')
    })

    test('still accepts a PaginationOptions instance', async () => {
      await payments.agents.getAgentPlans('agent-1', new PaginationOptions({ page: 3, offset: 5 }))
      const url = new URL(lastUrl)
      expect(url.searchParams.get('page')).toBe('3')
      expect(url.searchParams.get('pageSize')).toBe('5')
    })

    test('defaults to page 1 / pageSize 10 when no pagination is passed', async () => {
      await payments.agents.getAgentPlans('agent-1')
      const url = new URL(lastUrl)
      expect(url.searchParams.get('page')).toBe('1')
      expect(url.searchParams.get('pageSize')).toBe('10')
      expect(url.searchParams.get('sortOrder')).toBe('desc')
    })
  })

  describe('plans.getAgentsAssociatedToAPlan', () => {
    test('accepts a plain object instead of a PaginationOptions instance', async () => {
      await expect(
        payments.plans.getAgentsAssociatedToAPlan('plan-1', { page: 4, offset: 50 }),
      ).resolves.toBeDefined()
      const url = new URL(lastUrl)
      expect(url.pathname).toBe('/api/v1/protocol/plans/plan-1/agents')
      expect(url.searchParams.get('page')).toBe('4')
      expect(url.searchParams.get('pageSize')).toBe('50')
    })
  })
})
