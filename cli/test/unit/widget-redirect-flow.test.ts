import { describe, expect, jest, test } from '@jest/globals'
import { runWidgetRedirectFlow } from '../../src/utils/widget-redirect-flow.js'

/**
 * Unit-test the redirect-flow helper end to end against an actual
 * localhost server it spins up. We don't open a browser (the helper
 * accepts `noBrowser: true`); instead the test grabs the URL printed
 * via `log` and fires the callback by hand. This exercises the same
 * code path a real CLI invocation does, without the browser dependency.
 *
 * The helper takes a `mintSession` callback that runs AFTER the local
 * server has bound, so `returnUrl` is known at session-creation time.
 * Each test stubs that callback with a synchronous resolver that hands
 * back a fake `sessionToken`.
 */
describe('runWidgetRedirectFlow', () => {
  test('mints with the actual returnUrl AFTER the server binds, then resolves with the callback IDs', async () => {
    const logs: string[] = []
    const mintSession = jest
      .fn<(args: { returnUrl: string }) => Promise<{ sessionToken: string }>>()
      .mockResolvedValue({ sessionToken: 'tok_abc' })

    const promise = runWidgetRedirectFlow({
      frontendUrl: 'http://frontend.test',
      embedPath: '/embed/cards/setup',
      mintSession,
      log: (msg: string) => logs.push(msg),
      noBrowser: true,
    })

    const url = await waitForLoggedUrl(logs)
    const parsed = new URL(url)
    expect(parsed.host).toBe('frontend.test')
    expect(parsed.pathname).toBe('/embed/cards/setup')
    expect(parsed.searchParams.get('sessionToken')).toBe('tok_abc')
    expect(parsed.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/i)

    // `mintSession` MUST have been called with the bound returnUrl —
    // this is the post-review contract: the backend can now validate
    // the URL at session-creation time.
    expect(mintSession).toHaveBeenCalledTimes(1)
    const callArg = mintSession.mock.calls[0][0]
    expect(callArg.returnUrl).toMatch(/^http:\/\/localhost:\d+\/callback$/)
    expect(callArg.returnUrl).toBe(parsed.searchParams.get('returnUrl'))

    const returnUrl = new URL(callArg.returnUrl)
    const state = parsed.searchParams.get('state') as string

    const callback = new URL(returnUrl)
    callback.searchParams.set('paymentMethodId', 'pm_x')
    callback.searchParams.set('delegationId', 'del_y')
    callback.searchParams.set('state', state)
    const res = await fetch(callback.toString())
    expect(res.status).toBe(200)

    const result = await promise
    expect(result.state).toBe(state)
    expect(result.query.paymentMethodId).toBe('pm_x')
    expect(result.query.delegationId).toBe('del_y')
    expect(result.query.state).toBeUndefined()
  })

  test('rejects a callback whose state does not match the issued one (hex regex + timingSafeEqual)', async () => {
    const logs: string[] = []
    const promise = runWidgetRedirectFlow({
      frontendUrl: 'http://frontend.test',
      embedPath: '/embed/cards/setup',
      mintSession: async () => ({ sessionToken: 'tok_abc' }),
      log: (msg: string) => logs.push(msg),
      noBrowser: true,
    })
    const url = await waitForLoggedUrl(logs)
    const parsed = new URL(url)
    const returnUrl = new URL(parsed.searchParams.get('returnUrl') as string)

    // Two flavours of bad state: a non-hex string (caught by regex) and
    // a hex string of the wrong length. Both must 400 without throwing
    // (Copilot review #7: pre-fix, `safeEqualString` could crash on
    // non-ASCII input).
    for (const badState of ['not-hex-at-all', 'abcd', 'ÿ'.repeat(32)]) {
      const bad = new URL(returnUrl)
      bad.searchParams.set('paymentMethodId', 'pm_x')
      bad.searchParams.set('state', badState)
      const badRes = await fetch(bad.toString())
      expect(badRes.status).toBe(400)
    }

    const good = new URL(returnUrl)
    good.searchParams.set('paymentMethodId', 'pm_x')
    good.searchParams.set('state', parsed.searchParams.get('state') as string)
    const goodRes = await fetch(good.toString())
    expect(goodRes.status).toBe(200)

    const result = await promise
    expect(result.query.paymentMethodId).toBe('pm_x')
  })

  test('returns 404 for any path other than /callback (server is single-purpose)', async () => {
    const logs: string[] = []
    const promise = runWidgetRedirectFlow({
      frontendUrl: 'http://frontend.test',
      embedPath: '/embed/cards/enroll',
      mintSession: async () => ({ sessionToken: 'tok_abc' }),
      log: (msg: string) => logs.push(msg),
      noBrowser: true,
    })
    const url = await waitForLoggedUrl(logs)
    const returnUrl = new URL(new URL(url).searchParams.get('returnUrl') as string)
    const notCallback = new URL(returnUrl)
    notCallback.pathname = '/other'
    const res = await fetch(notCallback.toString())
    expect(res.status).toBe(404)

    // Close out the helper so the test process can exit cleanly.
    const ok = new URL(returnUrl)
    ok.searchParams.set('paymentMethodId', 'pm_x')
    ok.searchParams.set('state', new URL(url).searchParams.get('state') as string)
    await fetch(ok.toString())
    await promise
  })

  test('rejects when mintSession throws (e.g. backend rejects returnUrl) before opening a browser', async () => {
    const logs: string[] = []
    const promise = runWidgetRedirectFlow({
      frontendUrl: 'http://frontend.test',
      embedPath: '/embed/cards/setup',
      mintSession: async () => {
        throw new Error('Backend rejected returnUrl http://localhost:0/callback')
      },
      log: (msg: string) => logs.push(msg),
      noBrowser: true,
    })

    await expect(promise).rejects.toThrow(/Backend rejected returnUrl/)
    // Nothing should have been logged either — the helper aborts before
    // it prints the URL or attempts to open a browser.
    expect(logs.every((l) => !l.startsWith('http'))).toBe(true)
  })
})

async function waitForLoggedUrl(logs: string[]): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < 2000) {
    const url = logs.find((line) => line.startsWith('http://') || line.startsWith('https://'))
    if (url) return url
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('Timed out waiting for the helper to log the embed URL')
}
