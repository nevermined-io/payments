/**
 * verify-then-deliver with an idempotent settle: verifyCredential burns
 * nothing (`mpp-api.ts`'s own docstring says so), and settleCredential
 * settling the same credential twice burns once. Taken together, N
 * concurrent requests presenting the SAME credential would each pass verify,
 * each get served, and the N settles would collapse to a single burn -- the
 * buyer pays once and receives N responses.
 *
 * This is fixable at the seller edge WITHIN one Node process: track which
 * credentials are between "verified" and "settled" and refuse a second
 * concurrent request for the SAME one. It is NOT fixable here across
 * multiple processes or horizontally-scaled instances -- that needs a
 * shared store (e.g. Redis) this middleware does not provide, and is
 * documented as a limitation rather than silently assumed away.
 */
import express from 'express'
import http from 'http'
import net from 'net'
import { paymentMiddleware } from '../../../src/x402/express/index.js'
import { mppCredentialFixture } from './credential-fixture.js'

// Per-case credential: single-use is enforced process-wide, so a constant
// shared across cases would leak "already spent" from one test into the next.
// Reuse WITHIN a case is deliberate here — that is what this file tests.
let credentialSeq = 0
let CREDENTIAL = ''
beforeEach(() => {
  credentialSeq += 1
  CREDENTIAL = mppCredentialFixture(`conc-${credentialSeq}`)
})

function buildMockPayments(mpp: Record<string, unknown> = {}) {
  return {
    mpp: {
      issueChallenge: jest.fn().mockResolvedValue({ challenge: 'Payment id="c1"', id: 'c1' }),
      verifyCredential: jest.fn().mockResolvedValue({ isValid: true }),
      settleCredential: jest.fn().mockResolvedValue({
        success: true,
        transaction: '0x',
        network: 'eip155:84532',
        creditsRedeemed: '2',
        paymentReceipt: 'receipt-b64',
      }),
      ...mpp,
    },
    facilitator: { verifyPermissions: jest.fn(), settlePermissions: jest.fn() },
    getEnvironmentName: () => 'sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: true } } }) },
  } as any
}

async function startServer(payments: any, handler: (req: any, res: any) => void | Promise<void>) {
  const app = express()
  app.use(express.json())
  app.use(paymentMiddleware(payments, { 'POST /ask': { planId: '123', credits: 2, mpp: true } }))
  app.post('/ask', handler)
  const server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as any).port
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) }
}

async function post(port: number, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ q: 'hello' }),
  })
}

/**
 * Sends the request over a raw socket and hangs up, deterministically.
 *
 * `fetch` + `AbortController` does NOT do this reliably: undici can abandon
 * the response without tearing the TCP connection down, so the server's `res`
 * is still `destroyed: false` when the handler writes — the disconnect never
 * reaches the process under test, and a test built on it asserts nothing
 * about disconnect handling. Destroying the socket ourselves is what actually
 * makes `res.destroyed` / `res.closed` true, which is the signal the
 * middleware gates delivery on.
 *
 * @returns a promise that resolves once the socket is gone.
 */
async function postThenHangUp(
  port: number,
  headers: Record<string, string>,
  msBeforeHangUp: number,
): Promise<void> {
  const body = JSON.stringify({ q: 'hello' })
  const socket = net.connect(port, '127.0.0.1')
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
  const headerLines = Object.entries({ 'content-type': 'application/json', ...headers })
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join('')
  socket.write(
    `POST /ask HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${headerLines}Content-Length: ${Buffer.byteLength(
      body,
    )}\r\nConnection: close\r\n\r\n${body}`,
  )
  socket.on('error', () => undefined)
  await new Promise((r) => setTimeout(r, msBeforeHangUp))
  socket.destroy()
  // Give the server's event loop a turn to actually observe the close.
  // `res.destroyed` flips when Node processes the socket's close event, not
  // when the peer hangs up, so a caller that resumes the handler in the same
  // tick would be testing the one window in which the disconnect is genuinely
  // unknowable to the server — which proves nothing about the gate.
  await new Promise((r) => setTimeout(r, 50))
}

describe('concurrent requests presenting the same MPP credential', () => {
  it('refuses a second request for the SAME credential while the first is still between verify and settle', async () => {
    const payments = buildMockPayments()
    let handlerReached: () => void = () => undefined
    const handlerReachedPromise = new Promise<void>((resolve) => {
      handlerReached = resolve
    })
    let releaseHandler: () => void = () => undefined
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })
    const { port, close } = await startServer(payments, async (_req, res) => {
      // Reaching the handler at all proves the credential was already
      // verified AND claimed -- both happen strictly before next() is
      // called. Hold the response open after that so the first request is
      // provably still "in flight" (claimed, not yet settled) when the
      // second request is fired.
      handlerReached()
      await handlerGate
      res.json({ answer: 'ok' })
    })
    try {
      const first = post(port, { authorization: CREDENTIAL })
      await handlerReachedPromise

      // Fired, not awaited yet: post-fix this resolves immediately with 409
      // (refused before the guarded route ever reaches the handler /
      // handlerGate); pre-fix it would ALSO block on handlerGate, so
      // awaiting it here before releasing would deadlock the test itself.
      // A real wall-clock delay (not just a microtask/setImmediate tick) is
      // needed: this is a genuinely new TCP connection and HTTP round trip,
      // which takes real event-loop time to reach the claim check --
      // releasing too early lets request 1 finish and release its claim
      // before request 2's processing ever gets there, hiding the bug this
      // test exists to catch.
      const second = post(port, { authorization: CREDENTIAL })
      await new Promise((r) => setTimeout(r, 50))

      releaseHandler()
      const [firstResponse, secondResponse] = await Promise.all([first, second])
      expect(firstResponse.status).toBe(200)
      expect(secondResponse.status).toBe(409)
      await new Promise((r) => setImmediate(r))
      expect(payments.mpp.settleCredential).toHaveBeenCalledTimes(1)
    } finally {
      await close()
    }
  })

  it('refuses a credential that already bought a response, and answers a fresh challenge', async () => {
    // The premise this file used to encode was that a sequential replay is
    // harmless because "the backend's own idempotency key would reject a
    // spent credential". It does the opposite: feeding the challenge id as
    // the burn key makes a replayed settle SUCCEED as a replay of the first
    // burn (idempotentReplay), and verifyCredential burns nothing, so a
    // replay verifies clean. Nothing in the MPP redeem path tracks spent
    // state. Left alone, one payment buys unlimited responses for the whole
    // 300s challenge TTL.
    //
    // Single-use is therefore the seller edge's job, and this is the test
    // that holds it.
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, (_req, res) => {
      res.json({ answer: 'ok' })
    })
    try {
      const firstResponse = await post(port, { authorization: CREDENTIAL })
      expect(firstResponse.status).toBe(200)
      await new Promise((r) => setImmediate(r))

      const secondResponse = await post(port, { authorization: CREDENTIAL })
      expect(secondResponse.status).toBe(402)
      // A fresh challenge, not a bare error: the buyer can pay again and
      // make progress. Marked terminal for THIS credential (0003) so a
      // buyer retry loop does not spin on it.
      expect(secondResponse.headers.get('www-authenticate')).toBe('Payment id="c1"')
      expect(await secondResponse.json()).toMatchObject({
        code: 'BCK.MPP.0003',
        retryable: false,
      })

      await new Promise((r) => setImmediate(r))
      // The decisive assertion: one payment, one settle. Serving the replay
      // would have produced a second settle that collapsed onto the same
      // burn — a free response.
      expect(payments.mpp.settleCredential).toHaveBeenCalledTimes(1)
      // Refused before the backend is consulted at all.
      expect(payments.mpp.verifyCredential).toHaveBeenCalledTimes(1)
    } finally {
      await close()
    }
  })

  it('does not mark a credential spent when the handler failed, so the buyer keeps their claim', async () => {
    // Only a 2xx settles. A credential whose request never got served must
    // stay usable — otherwise a seller-side 500 would burn the buyer's
    // payment and lock them out of retrying with it.
    const payments = buildMockPayments()
    let failFirst = true
    const { port, close } = await startServer(payments, (_req, res) => {
      if (failFirst) {
        failFirst = false
        res.status(500).json({ error: 'handler blew up' })
        return
      }
      res.json({ answer: 'ok' })
    })
    try {
      const firstResponse = await post(port, { authorization: CREDENTIAL })
      expect(firstResponse.status).toBe(500)
      await new Promise((r) => setImmediate(r))
      expect(payments.mpp.settleCredential).not.toHaveBeenCalled()

      const secondResponse = await post(port, { authorization: CREDENTIAL })
      expect(secondResponse.status).toBe(200)
      await new Promise((r) => setImmediate(r))
      expect(payments.mpp.settleCredential).toHaveBeenCalledTimes(1)
    } finally {
      await close()
    }
  })

  it('does not strand the credential when the buyer disconnects while verify is in flight', async () => {
    // The 'close' listener that releases the claim is registered AFTER
    // onBeforeVerify / verifyCredential / onAfterVerify have been awaited. A
    // buyer who disconnects during those awaits has already made res emit
    // 'close' — Node emits it once — so the listener would never fire and
    // the credential would stay claimed for the life of the process.
    //
    // That is worse than a leak: nothing was settled, so the buyer still
    // owns an unspent claim, and every legitimate retry with it would 409 —
    // a 409 that carries no fresh challenge either, leaving the documented
    // retry loop with nothing to fall back on.
    let releaseVerify: () => void = () => undefined
    const verifyGate = new Promise<void>((resolve) => {
      releaseVerify = resolve
    })
    const payments = buildMockPayments({
      verifyCredential: jest.fn(async () => {
        await verifyGate
        return { isValid: true }
      }),
    })
    const { port, close } = await startServer(payments, (_req, res) => {
      res.json({ answer: 'ok' })
    })
    try {
      // Let the request reach verifyCredential, then hang up on it.
      await postThenHangUp(port, { authorization: CREDENTIAL }, 50)
      releaseVerify()
      await new Promise((r) => setTimeout(r, 50))

      // Unconditional, and this is the assertion that matters. The socket
      // closed before verifyCredential even returned, so NOTHING was
      // delivered — and a status code is not a delivery: the aborted request
      // still carries 200 through res.end(), which used to settle it. The
      // test used to accept 200 OR 402 depending on whether a settle had
      // landed, which meant CI documented charge-without-delivery as correct
      // and could not fail on it. (Its 402 branch was also factually
      // inverted: it claimed "the settle landed before the socket closed".)
      expect(payments.mpp.settleCredential).not.toHaveBeenCalled()

      const retry = await post(port, { authorization: CREDENTIAL })
      // The defect this test was originally written for was a PERMANENT 409:
      // the claim was never released, so this retry (and every later one) was
      // refused as "already being processed by a concurrent request" for the
      // life of the process, with no fresh challenge to fall back on.
      expect(retry.status).not.toBe(409)
      // Nothing was charged, so the credential is still the buyer's to spend
      // and the retry is served.
      expect(retry.status).toBe(200)
    } finally {
      await close()
    }
  })

  it('does not settle, and leaves the credential spendable, when the buyer disconnects before delivery', async () => {
    // The disconnect above happens during verify. This one happens after the
    // handler has produced its 2xx — the case res.statusCode cannot see, and
    // the one that actually moved money: an aborted request still reports
    // 200, res.end() still runs the settlement wrapper, and MppAPI has no
    // void, refund or reversal, so that burn was permanent.
    const payments = buildMockPayments()
    let releaseHandler: () => void = () => undefined
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { port, close } = await startServer(payments, async (_req, res) => {
      await handlerGate
      res.json({ answer: 'ok' })
    })
    try {
      // Let it reach the handler, hang up, and only then let the handler
      // write its 200 into a socket nobody is listening on.
      await postThenHangUp(port, { authorization: CREDENTIAL }, 50)
      releaseHandler()
      await new Promise((r) => setTimeout(r, 50))

      expect(payments.mpp.settleCredential).not.toHaveBeenCalled()

      // And because it was never settled, it was never marked spent: the
      // buyer keeps the claim they paid for.
      const retry = await post(port, { authorization: CREDENTIAL })
      expect(retry.status).toBe(200)
      await new Promise((r) => setImmediate(r))
      expect(payments.mpp.settleCredential).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
      await close()
    }
  })

  it('refuses a credential whose bytes were mutated but whose challenge id is the same', async () => {
    // The guards used to key on the raw header slice, which is not the
    // credential's identity: the scheme match is case-insensitive and returns
    // its slice verbatim, so `payment …` and `Payment  …` are three distinct
    // Set keys for one credential — while the backend collapses all three
    // onto ONE burn, because its idempotency key is the decoded challenge id.
    // One payment, three responses, from flipping one byte of case.
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, (_req, res) => {
      res.json({ answer: 'ok' })
    })
    try {
      expect((await post(port, { authorization: CREDENTIAL })).status).toBe(200)
      await new Promise((r) => setImmediate(r))

      const lowercased = CREDENTIAL.replace(/^Payment/, 'payment')
      const respaced = CREDENTIAL.replace(/^Payment /, 'Payment  ')
      expect(lowercased).not.toBe(CREDENTIAL)
      expect(respaced).not.toBe(CREDENTIAL)

      expect((await post(port, { authorization: lowercased })).status).toBe(402)
      expect((await post(port, { authorization: respaced })).status).toBe(402)

      await new Promise((r) => setImmediate(r))
      expect(payments.mpp.settleCredential).toHaveBeenCalledTimes(1)
    } finally {
      await close()
    }
  })

  it('refuses a credential that carries no decodable challenge id, without a backend round-trip', async () => {
    // Single-use needs a stable identity. A credential that has none cannot
    // be guarded at all, so falling back to the raw bytes as a key would be
    // the same guard-shaped hole. The backend rejects it anyway.
    const payments = buildMockPayments()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { port, close } = await startServer(payments, (_req, res) => {
      res.json({ answer: 'ok' })
    })
    try {
      const response = await post(port, { authorization: 'Payment eyJvdGhlciI6dHJ1ZX0' })
      expect(response.status).toBe(402)
      expect(await response.json()).toMatchObject({ code: 'BCK.MPP.0003' })
      expect(payments.mpp.verifyCredential).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
      await close()
    }
  })

  it('refuses a second request that passed the early spent check before the first finished', async () => {
    // The early spent check runs three awaits before the claim is taken
    // (onBeforeVerify, verifyCredential, onAfterVerify) and used not to be
    // re-checked. Request B passes it while A is still unspent; by the time B
    // reaches the claim, A has completed, marked itself spent AND released
    // its in-flight claim on 'close' — so B found both sets empty and was
    // served. Two responses, one burn, from ordinary latency skew.
    let releaseSecondVerify: () => void = () => undefined
    const secondVerifyGate = new Promise<void>((resolve) => {
      releaseSecondVerify = resolve
    })
    let verifyCalls = 0
    const payments = buildMockPayments({
      verifyCredential: jest.fn(async () => {
        verifyCalls += 1
        // Only the second caller is held, and it is held past the point where
        // the first has finished and released everything.
        if (verifyCalls === 2) await secondVerifyGate
        return { isValid: true }
      }),
    })
    const { port, close } = await startServer(payments, (_req, res) => {
      res.json({ answer: 'ok' })
    })
    try {
      const first = post(port, { authorization: CREDENTIAL })
      const second = post(port, { authorization: CREDENTIAL })

      const firstResponse = await first
      expect(firstResponse.status).toBe(200)
      await new Promise((r) => setImmediate(r))

      releaseSecondVerify()
      const secondResponse = await second
      expect(secondResponse.status).toBe(402)
      expect(await secondResponse.json()).toMatchObject({ code: 'BCK.MPP.0003' })

      await new Promise((r) => setImmediate(r))
      expect(payments.mpp.settleCredential).toHaveBeenCalledTimes(1)
    } finally {
      await close()
    }
  })

  it('does not lock out a DIFFERENT credential while one is in flight', async () => {
    const payments = buildMockPayments()
    let releaseHandler: () => void = () => undefined
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })
    const { port, close } = await startServer(payments, async (_req, res) => {
      await handlerGate
      res.json({ answer: 'ok' })
    })
    try {
      const first = post(port, { authorization: CREDENTIAL })
      await new Promise((r) => setImmediate(r))

      const other = post(port, { authorization: mppCredentialFixture('conc-other') })
      await new Promise((r) => setImmediate(r))

      releaseHandler()
      const [, otherResponse] = await Promise.all([first, other])
      expect(otherResponse.status).not.toBe(409)
    } finally {
      await close()
    }
  })
})
