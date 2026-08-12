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
import { paymentMiddleware } from '../../../src/x402/express/index.js'

const CREDENTIAL = 'Payment eyJjaGFsbGVuZ2UiOnt9fQ'

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

  it('releases the credential once settlement completes, so a later request can use it again', async () => {
    // Not a realistic reuse (a spent credential would be rejected by the
    // backend's own idempotency key), but it proves the guard is a
    // transient in-flight lock, not a permanent one -- a hung or leaked
    // lock would make a credential unusable forever within this process.
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, (_req, res) => {
      res.json({ answer: 'ok' })
    })
    try {
      const firstResponse = await post(port, { authorization: CREDENTIAL })
      expect(firstResponse.status).toBe(200)
      await new Promise((r) => setImmediate(r))

      const secondResponse = await post(port, { authorization: CREDENTIAL })
      expect(secondResponse.status).toBe(200)
      await new Promise((r) => setImmediate(r))
      expect(payments.mpp.settleCredential).toHaveBeenCalledTimes(2)
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

      const other = post(port, { authorization: 'Payment eyJvdGhlciI6dHJ1ZX0' })
      await new Promise((r) => setImmediate(r))

      releaseHandler()
      const [, otherResponse] = await Promise.all([first, other])
      expect(otherResponse.status).not.toBe(409)
    } finally {
      await close()
    }
  })
})
