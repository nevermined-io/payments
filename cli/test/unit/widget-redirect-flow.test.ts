import { describe, expect, test } from '@jest/globals'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { runWidgetRedirectFlow } from '../../src/utils/widget-redirect-flow.js'

/**
 * Unit-test the redirect-flow helper end to end against an actual
 * localhost server it spins up. We don't open a browser (the helper
 * accepts `noBrowser: true`); instead the test grabs the URL printed
 * via `log` and fires the callback by hand. This exercises the same
 * code path a real CLI invocation does, without the browser dependency.
 */
describe('runWidgetRedirectFlow', () => {
  test('resolves with paymentMethodId + delegationId when the callback fires with the matching state', async () => {
    const logs: string[] = []
    const promise = runWidgetRedirectFlow({
      backendUrl: 'http://backend.test',
      frontendUrl: 'http://frontend.test',
      sessionToken: 'tok_abc',
      embedPath: '/embed/cards/setup',
      log: (msg: string) => logs.push(msg),
      noBrowser: true,
    })

    // The helper logs the URL after the server is listening, so wait
    // for the URL to appear. Polling avoids racing the server-bind
    // callback in the helper.
    const url = await waitForLoggedUrl(logs)
    const parsed = new URL(url)
    expect(parsed.host).toBe('frontend.test')
    expect(parsed.pathname).toBe('/embed/cards/setup')
    expect(parsed.searchParams.get('sessionToken')).toBe('tok_abc')
    expect(parsed.searchParams.get('state')).toBeTruthy()

    const returnUrl = new URL(parsed.searchParams.get('returnUrl') as string)
    const state = parsed.searchParams.get('state') as string

    // Fire the callback as the embed page would.
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
    // state should be stripped from `query` (the helper has already
    // verified it).
    expect(result.query.state).toBeUndefined()
  })

  test('rejects a callback whose state does not match the issued one', async () => {
    const logs: string[] = []
    const promise = runWidgetRedirectFlow({
      backendUrl: 'http://backend.test',
      frontendUrl: 'http://frontend.test',
      sessionToken: 'tok_abc',
      embedPath: '/embed/cards/setup',
      log: (msg: string) => logs.push(msg),
      noBrowser: true,
    })
    const url = await waitForLoggedUrl(logs)
    const parsed = new URL(url)
    const returnUrl = new URL(parsed.searchParams.get('returnUrl') as string)

    // Fire callback with a forged state. The 400 returned by the helper
    // tells us it did NOT resolve the promise — to confirm the helper
    // stays pending we then send a correctly-stated callback, which is
    // the only thing that should make `promise` resolve.
    const bad = new URL(returnUrl)
    bad.searchParams.set('paymentMethodId', 'pm_x')
    bad.searchParams.set('state', 'wrong-state')
    const badRes = await fetch(bad.toString())
    expect(badRes.status).toBe(400)

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
      backendUrl: 'http://backend.test',
      frontendUrl: 'http://frontend.test',
      sessionToken: 'tok_abc',
      embedPath: '/embed/cards/enroll',
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
})

// Suppress "createServer / IncomingMessage / ServerResponse imported but
// only used in type position" lint by referencing them in a no-op type
// alias — they document the contract the helper relies on even though
// the test itself goes through fetch.
type _DocOnly = [typeof createServer, IncomingMessage, ServerResponse]

async function waitForLoggedUrl(logs: string[]): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < 2000) {
    const url = logs.find((line) => line.startsWith('http://') || line.startsWith('https://'))
    if (url) return url
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('Timed out waiting for the helper to log the embed URL')
}
