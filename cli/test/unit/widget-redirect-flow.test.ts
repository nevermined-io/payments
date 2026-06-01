import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import {
  resolveEmbedNetwork,
  runWidgetRedirectFlow,
} from '../../src/utils/widget-redirect-flow.js'

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
 *
 * Cleanup: `runWidgetRedirectFlow` only closes its ephemeral server
 * after a state-matched good callback. Without an `afterEach` that
 * forces such a callback on every test, an early assertion failure
 * leaks the server and a real 5-minute timer until Jest's suite-wide
 * `testTimeout` fires. The `inFlight` registry below records every
 * spawned flow's `(returnUrl, state, promise)` and the `afterEach`
 * sends the success callback to whichever ones haven't resolved yet.
 */
type InFlightFlow = {
  promise: Promise<unknown>
  returnUrlPromise: Promise<{ returnUrl: string; state: string }>
  resolved: boolean
}

describe('runWidgetRedirectFlow', () => {
  const inFlight = new Set<InFlightFlow>()

  beforeEach(() => {
    inFlight.clear()
  })

  afterEach(async () => {
    // Force-resolve any flow whose assertions threw early. The helper
    // only releases its server after a valid `state`-matched callback,
    // so we send one with `__cleanup=1` as the extra payload field.
    for (const flow of inFlight) {
      if (flow.resolved) continue
      try {
        const { returnUrl, state } = await flow.returnUrlPromise
        const u = new URL(returnUrl)
        u.searchParams.set('__cleanup', '1')
        u.searchParams.set('state', state)
        await fetch(u.toString()).catch(() => undefined)
        await flow.promise.catch(() => undefined)
      } catch {
        // The flow never reached the listen step (e.g. mintSession
        // threw synchronously). Nothing to clean up.
      }
    }
    inFlight.clear()
  })

  /**
   * Start a `runWidgetRedirectFlow` and register it for cleanup. The
   * returned `promise` resolves when the helper resolves; the returned
   * `returnUrlPromise` resolves with the URL the helper logged plus
   * the issued `state`, so callers can fire callbacks against them.
   */
  function startFlow(opts: {
    embedPath?: string
    network?: 'sandbox' | 'live'
    extraSearchParams?: Record<string, string>
    mintSession?: (args: { returnUrl: string }) => Promise<{ sessionToken: string }>
  } = {}) {
    const logs: string[] = []
    const flow: InFlightFlow = {
      promise: undefined as unknown as Promise<unknown>,
      returnUrlPromise: undefined as unknown as Promise<{
        returnUrl: string
        state: string
      }>,
      resolved: false,
    }
    flow.promise = runWidgetRedirectFlow({
      embedUrl: 'http://embed.test',
      embedPath: opts.embedPath ?? '/cards/setup',
      network: opts.network ?? 'sandbox',
      extraSearchParams: opts.extraSearchParams,
      mintSession: opts.mintSession ?? (async () => ({ sessionToken: 'tok_abc' })),
      log: (msg: string) => logs.push(msg),
      noBrowser: true,
    })
    // Track resolution without swallowing the rejection — the per-test
    // `await` still observes the original promise's outcome. Attaching
    // a no-op `.catch` here only stops Node from reporting an
    // "unhandledRejection" before the test runner awaits the flow.
    flow.promise.then(
      () => {
        flow.resolved = true
      },
      () => {
        flow.resolved = true
      },
    )
    flow.returnUrlPromise = (async () => {
      const start = Date.now()
      while (Date.now() - start < 2000) {
        // Stop polling early if the flow has already settled — e.g. when
        // `mintSession` throws before the helper gets a chance to log
        // the URL.
        if (flow.resolved) {
          throw new Error('Flow resolved before logging a URL')
        }
        const url = logs.find((l) => l.startsWith('http://') || l.startsWith('https://'))
        if (url) {
          const parsed = new URL(url)
          return {
            returnUrl: parsed.searchParams.get('returnUrl') as string,
            state: parsed.searchParams.get('state') as string,
          }
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      throw new Error('Timed out waiting for the helper to log the embed URL')
    })()
    // Pre-attach a no-op handler so a flow that aborts before logging a
    // URL doesn't surface as an `unhandledRejection` in the per-test
    // event loop. The afterEach still awaits the promise via try/catch.
    flow.returnUrlPromise.catch(() => undefined)
    inFlight.add(flow)
    return { ...flow, logs }
  }

  test('mints with the actual returnUrl AFTER the server binds, then resolves with the callback IDs', async () => {
    const mintSession = jest
      .fn<(args: { returnUrl: string }) => Promise<{ sessionToken: string }>>()
      .mockResolvedValue({ sessionToken: 'tok_abc' })

    const flow = startFlow({ mintSession })
    const { returnUrl, state } = await flow.returnUrlPromise

    expect(mintSession).toHaveBeenCalledTimes(1)
    expect(mintSession.mock.calls[0][0].returnUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(mintSession.mock.calls[0][0].returnUrl).toBe(returnUrl)
    expect(state).toMatch(/^[0-9a-f]{32}$/i)

    const callback = new URL(returnUrl)
    callback.searchParams.set('paymentMethodId', 'pm_x')
    callback.searchParams.set('delegationId', 'del_y')
    callback.searchParams.set('state', state)
    const res = await fetch(callback.toString())
    expect(res.status).toBe(200)

    const result = (await flow.promise) as { state: string; query: Record<string, string> }
    expect(result.state).toBe(state)
    expect(result.query.paymentMethodId).toBe('pm_x')
    expect(result.query.delegationId).toBe('del_y')
    expect(result.query.state).toBeUndefined()
  })

  test('rejects callbacks whose state does not match the issued one (hex regex + timingSafeEqual)', async () => {
    const flow = startFlow()
    const { returnUrl } = await flow.returnUrlPromise

    // Three flavours of bad state: non-hex, wrong-length hex, and a
    // non-ASCII 32-char string. Pre-fix the last one would crash
    // `timingSafeEqual` because string `.length` is UTF-16 code units
    // while the buffers are UTF-8 bytes. All three must 400 without
    // throwing (Copilot review #7 + eruizgar91 follow-up).
    for (const badState of ['not-hex-at-all', 'abcd', 'ÿ'.repeat(32)]) {
      const bad = new URL(returnUrl)
      bad.searchParams.set('paymentMethodId', 'pm_x')
      bad.searchParams.set('state', badState)
      const badRes = await fetch(bad.toString())
      expect(badRes.status).toBe(400)
    }
    // afterEach cleans up the still-open server via the good callback.
  })

  test('returns 404 for any path other than /callback (server is single-purpose)', async () => {
    const flow = startFlow({ embedPath: '/cards/enroll' })
    const { returnUrl } = await flow.returnUrlPromise
    const notCallback = new URL(returnUrl)
    notCallback.pathname = '/other'
    const res = await fetch(notCallback.toString())
    expect(res.status).toBe(404)
    // afterEach cleans up via the good callback.
  })

  test('rejects when mintSession throws (e.g. backend rejects returnUrl) before opening a browser', async () => {
    const flow = startFlow({
      mintSession: async () => {
        throw new Error('Backend rejected returnUrl http://127.0.0.1:0/callback')
      },
    })
    await expect(flow.promise).rejects.toThrow(/Backend rejected returnUrl/)
  })

  test('forwards the network as ?network= on the embed URL (#362)', async () => {
    const flow = startFlow({ network: 'live' })
    await flow.returnUrlPromise
    const embedUrl = flow.logs.find((l) => l.startsWith('http://embed.test')) as string
    expect(embedUrl).toBeDefined()
    expect(new URL(embedUrl).searchParams.get('network')).toBe('live')
    // afterEach cleans up via the good callback.
  })

  test('network from opts wins over an attempted override in extraSearchParams', async () => {
    // The money-path guard: a future caller dropping `network` into
    // extraSearchParams must not silently downgrade a live flow to
    // sandbox. `buildEmbedUrl` writes `network` after the extra loop.
    const flow = startFlow({ network: 'live', extraSearchParams: { network: 'sandbox' } })
    await flow.returnUrlPromise
    const embedUrl = flow.logs.find((l) => l.startsWith('http://embed.test')) as string
    expect(new URL(embedUrl).searchParams.get('network')).toBe('live')
    // afterEach cleans up via the good callback.
  })
})

describe('resolveEmbedNetwork', () => {
  test('maps sandbox/staging_sandbox to sandbox and live/staging_live to live', () => {
    expect(resolveEmbedNetwork('sandbox')).toBe('sandbox')
    expect(resolveEmbedNetwork('staging_sandbox')).toBe('sandbox')
    expect(resolveEmbedNetwork('live')).toBe('live')
    expect(resolveEmbedNetwork('staging_live')).toBe('live')
  })

  test('custom sniffs NVM_BACKEND_URL (live host → live, otherwise sandbox)', () => {
    const original = process.env.NVM_BACKEND_URL
    try {
      process.env.NVM_BACKEND_URL = 'https://api.live.nevermined.app/'
      expect(resolveEmbedNetwork('custom')).toBe('live')
      process.env.NVM_BACKEND_URL = 'https://api.sandbox.nevermined.app/'
      expect(resolveEmbedNetwork('custom')).toBe('sandbox')
      process.env.NVM_BACKEND_URL = 'http://localhost:3001'
      expect(resolveEmbedNetwork('custom')).toBe('sandbox')
      // "live" only matches as a host segment, never inside another word.
      process.env.NVM_BACKEND_URL = 'https://api.alive.example.com/'
      expect(resolveEmbedNetwork('custom')).toBe('sandbox')
    } finally {
      if (original === undefined) delete process.env.NVM_BACKEND_URL
      else process.env.NVM_BACKEND_URL = original
    }
  })
})
