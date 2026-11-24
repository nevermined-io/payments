/** Offline regressions for ambiguous MCP settlement outcomes. No sockets or live APIs. */
import { PaywallAuthenticator } from '../../../src/mcp/core/auth.js'
import { CreditsContextProvider } from '../../../src/mcp/core/credits-context.js'
import { PaywallDecorator } from '../../../src/mcp/core/paywall.js'
import { requestContextStorage } from '../../../src/mcp/http/mcp-handler.js'
import type { Payments } from '../../../src/payments.js'
import {
  FacilitatorAPI,
  type SettlePermissionsResult,
  type VerifyPermissionsResult,
  type X402PaymentRequired,
} from '../../../src/x402/facilitator-api.js'
import { API_URL_SETTLE_PERMISSIONS, API_URL_VERIFY_PERMISSIONS } from '../../../src/api/nvm-api.js'
import {
  NEVERMINED_CREDITS_META_KEY,
  X402_PAYMENT_META_KEY,
  X402_PAYMENT_RESPONSE_META_KEY,
} from '../../../src/mcp/utils/meta.js'
import { encodeAccessToken } from '../../../src/utils.js'

const LOGICAL_URL = 'mcp://offline/tools/paid'
const HTTP_URL = 'https://seller.invalid/mcp'
const PAYMENT = {
  x402Version: 2,
  accepted: { scheme: 'nvm:erc4337', network: 'eip155:84532', planId: 'offline-plan' },
  payload: {
    signature: 'offline-fixture',
    authorization: { from: '0x1111111111111111111111111111111111111111' },
  },
}
// A locally constructed, unsigned fixture: never read credentials from the environment.
const API_KEY = [
  Buffer.from('{"alg":"none"}').toString('base64url'),
  Buffer.from('{"sub":"offline-fixture"}').toString('base64url'),
  'offline',
].join('.')
const RECEIPT = {
  success: true,
  transaction: 'offline-transaction',
  network: 'eip155:84532',
  creditsRedeemed: '5',
} satisfies SettlePermissionsResult

interface CapturedRequest {
  paymentRequired: X402PaymentRequired
  x402AccessToken: string
  maxAmount?: string
}

type Outcome = 'success' | 'socket loss' | 'truncated JSON' | 'HTTP 503' | 'declined'
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('MCP settlement attempts (offline)', () => {
  let decorator: PaywallDecorator
  let authenticate: jest.SpyInstance
  let settlements: CapturedRequest[]
  let verifications: CapturedRequest[]
  let outcome: Outcome
  let useHttpVerification: boolean

  beforeEach(() => {
    settlements = []
    verifications = []
    outcome = 'success'
    useHttpVerification = false
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname
      const request = JSON.parse(String(init?.body)) as CapturedRequest
      if (path === API_URL_VERIFY_PERMISSIONS) {
        verifications.push(request)
        return jsonResponse({
          isValid: !useHttpVerification || request.paymentRequired.resource.url === HTTP_URL,
        } satisfies VerifyPermissionsResult)
      }
      if (path !== API_URL_SETTLE_PERMISSIONS) {
        throw new Error(`Unexpected offline fetch: ${url}`)
      }
      settlements.push(request)
      // A server may already have committed before any of these responses arrive.
      // A second submission succeeds to expose an accidental automatic replay.
      if (settlements.length === 1) {
        if (outcome === 'socket loss') throw new TypeError('offline socket lost')
        if (outcome === 'truncated JSON') return new Response('{"success":', { status: 200 })
        if (outcome === 'HTTP 503') return jsonResponse({ message: 'offline unavailable' }, 503)
        if (outcome === 'declined') {
          return jsonResponse({
            success: false,
            transaction: '',
            network: 'eip155:84532',
            errorReason: 'offline decline',
          } satisfies SettlePermissionsResult)
        }
      }
      return jsonResponse(RECEIPT)
    })

    const facilitator = new FacilitatorAPI({ nvmApiKey: API_KEY, environment: 'sandbox' })
    const payments = {
      facilitator,
      getEnvironmentName: () => 'sandbox',
    } as unknown as Payments
    const authenticator = new PaywallAuthenticator(payments)
    authenticate = jest.spyOn(authenticator, 'authenticate')
    decorator = new PaywallDecorator(payments, authenticator, new CreditsContextProvider())
    decorator.configure({ planId: 'offline-plan', serverName: 'offline' })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  function call(streaming: boolean, policy: 'ignore' | 'propagate', credits = 5n) {
    const handler = jest.fn(async () => {
      if (streaming) {
        return (async function* () {
          yield { content: [{ type: 'text', text: 'offline content' }] }
        })()
      }
      return { content: [{ type: 'text', text: 'offline content' }] }
    })
    const wrapped = decorator.protect(handler, {
      kind: 'tool',
      name: 'paid',
      credits,
      onRedeemError: policy,
    })
    const run = () =>
      requestContextStorage.run(
        {
          headers: { host: 'seller.invalid', 'x-forwarded-proto': 'https' },
          method: 'POST',
          url: '/mcp',
        },
        async () => {
          const result = await wrapped({}, { _meta: { [X402_PAYMENT_META_KEY]: PAYMENT } })
          if (!streaming) return result
          const chunks = []
          for await (const chunk of result) chunks.push(chunk)
          return chunks[chunks.length - 1]
        },
      )
    return { run, handler }
  }

  describe.each([false, true])('streaming=%s', (streaming) => {
    describe.each([false, true])('HTTP verification fallback=%s', (httpFallback) => {
      test.each(['ignore', 'propagate'] as const)(
        'settles once against the verified endpoint (%s)',
        async (policy) => {
          useHttpVerification = httpFallback
          const { run, handler } = call(streaming, policy)
          const result = await run()
          expect(handler).toHaveBeenCalledTimes(1)
          expect(settlements).toHaveLength(1)
          expect(settlements[0].paymentRequired.resource.url).toBe(
            httpFallback ? HTTP_URL : LOGICAL_URL,
          )
          expect(verifications.map((r) => r.paymentRequired.resource.url)).toEqual(
            httpFallback ? [LOGICAL_URL, HTTP_URL] : [LOGICAL_URL],
          )
          const auth = await authenticate.mock.results[0].value
          expect(auth.logicalUrl).toBe(LOGICAL_URL)
          expect(result._meta[X402_PAYMENT_RESPONSE_META_KEY]).toEqual(RECEIPT)
        },
      )

      describe.each(['ignore', 'propagate'] as const)('error policy=%s', (policy) => {
        test.each(['socket loss', 'truncated JSON', 'HTTP 503', 'declined'] as const)(
          'does not replay settlement after %s',
          async (failure) => {
            useHttpVerification = httpFallback
            outcome = failure
            const { run, handler } = call(streaming, policy)
            if (policy === 'propagate' && failure !== 'declined') {
              await expect(run()).rejects.toMatchObject({ code: -32002 })
            } else {
              const result = await run()
              if (streaming) {
                expect(result._meta[NEVERMINED_CREDITS_META_KEY].success).toBe(false)
                expect(result._meta[X402_PAYMENT_RESPONSE_META_KEY]).toBeUndefined()
              } else {
                expect(result.isError).toBe(true)
                expect(JSON.stringify(result)).not.toContain('offline content')
              }
            }
            expect(handler).toHaveBeenCalledTimes(1)
            expect(settlements).toHaveLength(1)
            expect(settlements[0]).toMatchObject({
              x402AccessToken: encodeAccessToken(PAYMENT),
              maxAmount: '5',
              paymentRequired: { resource: { url: httpFallback ? HTTP_URL : LOGICAL_URL } },
            })
          },
        )
      })
    })

    test('does not settle a no-credit call', async () => {
      const { run } = call(streaming, 'ignore', 0n)
      await run()
      expect(settlements).toHaveLength(0)
    })
  })
})
