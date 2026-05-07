/**
 * @file Unit tests for the consent-bootstrap exported from
 * `tests/e2e/global-setup.ts`. Inlined there (rather than in a sibling
 * helper) because Jest's `globalSetup` resolver doesn't apply the same
 * `.js → .ts` mapping the worker context does — see the file header for
 * the full rationale.
 *
 * The bootstrap is exercised end-to-end against staging by every e2e suite
 * via Jest globalSetup, so the unit tests focus on the no-op-safe contract
 * from issue #334:
 *  - manifest fetch failures must not throw
 *  - per-key POST failures must not throw and must not block other keys
 *  - empty / missing keys are skipped without any HTTP traffic
 *  - the request shape (URL, headers, JSON body) matches the backend spec
 */

import { bootstrapLegalConsent } from '../e2e/global-setup.js'

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>

interface CapturedCall {
  url: string
  init: FetchInit | undefined
}

describe('bootstrapLegalConsent', () => {
  const BACKEND = 'https://api.sandbox.nevermined.dev/'
  const KEY_A = 'key-a'
  const KEY_B = 'key-b'

  let originalFetch: typeof fetch
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    originalFetch = global.fetch
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    global.fetch = originalFetch
    warnSpy.mockRestore()
  })

  const installFetch = (
    handler: (call: CapturedCall) => Response | Promise<Response>,
  ): CapturedCall[] => {
    const calls: CapturedCall[] = []
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const call: CapturedCall = { url, init }
      calls.push(call)
      return handler(call)
    }) as unknown as typeof fetch
    return calls
  }

  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  test('skips entirely when no API keys are supplied', async () => {
    const calls = installFetch(() => jsonResponse({}))
    await bootstrapLegalConsent(BACKEND, [undefined, ''])
    expect(calls).toHaveLength(0)
  })

  test('fetches the manifest and posts current versions for each key', async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith('/api/v1/legal-documents/manifest')) {
        return jsonResponse({
          documents: {
            terms: { current: '1.1.0', requiresReConsent: true },
            privacy: { current: '1.1.0' },
          },
        })
      }
      return jsonResponse({ recorded: 2 }, 201)
    })

    await bootstrapLegalConsent(BACKEND, [KEY_A, KEY_B])

    expect(calls).toHaveLength(3)
    expect(calls[0].url).toBe('https://api.sandbox.nevermined.dev/api/v1/legal-documents/manifest')

    const posts = calls.slice(1)
    for (const post of posts) {
      expect(post.url).toBe('https://api.sandbox.nevermined.dev/api/v1/legal-documents/me/consents')
      expect(post.init?.method).toBe('POST')

      const headers = post.init?.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers.Authorization).toMatch(/^Bearer /)

      const body = JSON.parse(String(post.init?.body))
      expect(body.action).toBe('signup')
      expect(body.acceptances).toEqual([
        { slug: 'terms', version: '1.1.0' },
        { slug: 'privacy', version: '1.1.0' },
      ])
    }

    const authHeaders = posts.map(
      (call) => (call.init?.headers as Record<string, string>).Authorization,
    )
    expect(authHeaders).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`])
  })

  test('logs and returns when the manifest fetch fails — no POSTs attempted', async () => {
    const calls = installFetch(() => jsonResponse({ error: 'oops' }, 500))

    await expect(bootstrapLegalConsent(BACKEND, [KEY_A])).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('manifest fetch')
  })

  test('returns silently when the manifest declares no documents', async () => {
    const calls = installFetch(() => jsonResponse({ documents: {} }))

    await bootstrapLegalConsent(BACKEND, [KEY_A])

    expect(calls).toHaveLength(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('logs but does not throw when one key fails — other keys still posted', async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith('/manifest')) {
        return jsonResponse({ documents: { terms: { current: '1.0.0' } } })
      }
      const auth = (call.init?.headers as Record<string, string>).Authorization
      if (auth === `Bearer ${KEY_A}`) {
        return jsonResponse({ error: 'auth' }, 401)
      }
      return jsonResponse({ recorded: 1 }, 201)
    })

    await expect(bootstrapLegalConsent(BACKEND, [KEY_A, KEY_B])).resolves.toBeUndefined()

    expect(calls).toHaveLength(3)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('key #0')
  })

  test('does not double-up the slash when backend URL has no trailing slash', async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith('/manifest')) {
        return jsonResponse({ documents: { terms: { current: '1.0.0' } } })
      }
      return jsonResponse({ recorded: 1 }, 201)
    })

    await bootstrapLegalConsent('https://api.sandbox.nevermined.dev', [KEY_A])

    expect(calls[0].url).toBe('https://api.sandbox.nevermined.dev/api/v1/legal-documents/manifest')
    expect(calls[1].url).toBe(
      'https://api.sandbox.nevermined.dev/api/v1/legal-documents/me/consents',
    )
  })
})
