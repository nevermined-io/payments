/**
 * Hook and observability parity between the x402 path and the MPP path.
 * Turning `mpp: true` on for a route must not silently disable a documented
 * `PaymentMiddlewareOptions` hook or blank `req.paymentContext` fields the
 * x402 path already populates -- a seller reading the docs has no reason to
 * expect either.
 */
import express from 'express'
import http from 'http'
import { paymentMiddleware } from '../../../src/x402/express/index.js'
import { mppCredentialFixture } from './credential-fixture.js'
import { MppCredentialRejectedError } from '../../../src/mpp/errors.js'

// A credential is single-use: the middleware refuses one that has already
// bought a response (see `spentMppCredentials` in middleware.ts). Tests share
// this module-level state, so each case mints its own credential — a shared
// constant would make every case after the first see a 402 for a reason that
// has nothing to do with what it is testing. Real buyers never replay one
// either; that is the property being protected.
let credentialSeq = 0
let CREDENTIAL = ''
beforeEach(() => {
  credentialSeq += 1
  CREDENTIAL = mppCredentialFixture(`hooks-${credentialSeq}`)
})

function buildMockPayments(mpp: Record<string, unknown> = {}) {
  return {
    mpp: {
      issueChallenge: jest.fn().mockResolvedValue({ challenge: 'Payment id="c1"', id: 'c1' }),
      verifyCredential: jest.fn().mockResolvedValue({
        isValid: true,
        agentRequestId: 'req-1',
        agentRequest: { agentRequestId: 'req-1', agentId: 'agent-1' },
      }),
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

async function startServer(
  payments: any,
  options: Record<string, unknown> = {},
  handler?: (req: any, res: any) => void,
) {
  const app = express()
  app.use(express.json())
  app.use(
    paymentMiddleware(
      payments,
      { 'POST /ask': { planId: '123', credits: 2, mpp: true } },
      options as any,
    ),
  )
  app.post(
    '/ask',
    handler ?? ((req: any, res: any) => res.json({ paymentContext: req.paymentContext ?? null })),
  )
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

describe('onPaymentError on a rejected MPP credential', () => {
  it('lets a hook that answers the request own the response', async () => {
    const payments = buildMockPayments({
      verifyCredential: jest
        .fn()
        .mockResolvedValue({ isValid: false, invalidReason: 'no credits' }),
    })
    const onPaymentError = jest.fn((_error: Error, _req: any, res: any) => {
      res.status(503).json({ error: 'custom handler' })
    })
    const { port, close } = await startServer(payments, { onPaymentError })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(onPaymentError).toHaveBeenCalledTimes(1)
      expect(onPaymentError.mock.calls[0][0]).toBeInstanceOf(MppCredentialRejectedError)
      expect(response.status).toBe(503)
    } finally {
      await close()
    }
  })

  it('notifies the hook AND still sends the fresh challenge when the hook does not respond', async () => {
    // On MPP routes onPaymentError notifies; the middleware keeps the
    // response. A hook wired purely for observability must not strip the
    // fresh challenge off the 402 — without it the buyer has nothing to pay
    // and the documented retry loop dead-ends. (The x402 branch hands the
    // response to the hook instead, because an x402 402 carries no
    // equivalent single-use challenge to lose.)
    const payments = buildMockPayments({
      verifyCredential: jest
        .fn()
        .mockResolvedValue({ isValid: false, invalidReason: 'no credits' }),
    })
    const onPaymentError = jest.fn()
    const { port, close } = await startServer(payments, { onPaymentError })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(onPaymentError).toHaveBeenCalledTimes(1)
      expect(onPaymentError.mock.calls[0][0]).toBeInstanceOf(MppCredentialRejectedError)
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
      expect(await response.json()).toMatchObject({ code: 'BCK.MPP.0003', retryable: false })
    } finally {
      await close()
    }
  })

  it('does not let a throwing hook turn into a 500 instead of a challenge', async () => {
    const payments = buildMockPayments({
      verifyCredential: jest
        .fn()
        .mockResolvedValue({ isValid: false, invalidReason: 'no credits' }),
    })
    const onPaymentError = jest.fn(() => {
      throw new Error('seller hook is broken')
    })
    const { port, close } = await startServer(payments, { onPaymentError })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
    } finally {
      await close()
    }
  })

  it('still sends a fresh challenge when onPaymentError is not configured', async () => {
    const payments = buildMockPayments({
      verifyCredential: jest
        .fn()
        .mockResolvedValue({ isValid: false, invalidReason: 'no credits' }),
    })
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
    } finally {
      await close()
    }
  })

  it('does NOT fire on the ordinary credential-less opening request', async () => {
    // Deliberate divergence from x402, and pinned here because nothing else
    // pins it: the only existing coverage was incidental (a path where
    // issueChallenge itself rejects). The mint/redeem handshake makes the
    // first request of every payment cycle credential-less BY CONSTRUCTION —
    // a buyer cannot obtain a credential without first being handed a
    // challenge — so notifying here would fire onPaymentError once per
    // SUCCESSFUL payment and drown the rejections the hook exists to
    // surface. A future "restore x402 parity" patch would undo this
    // silently; it was in fact implemented once and reverted for exactly
    // this reason.
    const payments = buildMockPayments()
    const onPaymentError = jest.fn()
    const { port, close } = await startServer(payments, { onPaymentError })
    try {
      const response = await post(port)
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
      expect(onPaymentError).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('DOES fire when an Authorization header arrived but carried no Payment scheme', async () => {
    // The other half of the same null. extractCredential returns null for
    // "no header at all" (healthy) and for "a header that is not ours"
    // (broken), and only the second is a failure: an intermediary rewriting
    // Authorization — a gateway injecting its own Bearer, a proxy with its
    // own auth — puts the buyer in a silent infinite loop of mint, pay,
    // present, rewritten, re-challenge, at the cost of a real issueChallenge
    // round-trip per iteration, while the seller's metrics show healthy
    // traffic.
    const payments = buildMockPayments()
    const onPaymentError = jest.fn()
    const { port, close } = await startServer(payments, { onPaymentError })
    try {
      const response = await post(port, { authorization: 'Bearer a-gateway-jwt' })
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
      expect(onPaymentError).toHaveBeenCalledTimes(1)
      expect(onPaymentError.mock.calls[0][0].message).toMatch(/no MPP Payment scheme/)
    } finally {
      await close()
    }
  })

  it('logs an async hook rejection instead of leaving it unhandled', async () => {
    // The declared type is `(error, req, res) => void`, which happily accepts
    // an async function — so a rejecting hook is easy for a seller to write,
    // and try/catch alone never covered it. An unhandled rejection is
    // process-fatal under Node's default.
    const payments = buildMockPayments({
      verifyCredential: jest
        .fn()
        .mockResolvedValue({ isValid: false, invalidReason: 'no credits' }),
    })
    const onPaymentError = jest.fn(async () => {
      throw new Error('async seller hook is broken')
    })
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { port, close } = await startServer(payments, { onPaymentError })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(402)
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
      expect(unhandled).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'MPP onPaymentError hook failed:',
        expect.any(Error),
      )
    } finally {
      process.off('unhandledRejection', unhandled)
      consoleErrorSpy.mockRestore()
      await close()
    }
  })

  it('routes a throwing credits function through onPaymentError instead of Express', async () => {
    // `credits` is caller-supplied and evaluated per request (a DB lookup, a
    // rate-table fetch), so a throw is an ordinary seller bug. It used to run
    // before notifyPaymentError even existed, and handleMppRequest is awaited
    // outside any try/catch — so the rejection reached Express's default
    // error handler and the buyer got a 500 with a stack trace, no challenge,
    // and no way forward, while a configured onPaymentError never fired.
    const payments = buildMockPayments()
    const onPaymentError = jest.fn()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const app = express()
    app.use(express.json())
    app.use(
      paymentMiddleware(
        payments,
        {
          'POST /ask': {
            planId: '123',
            credits: () => {
              throw new Error('rate table lookup failed')
            },
            mpp: true,
          },
        },
        { onPaymentError } as any,
      ),
    )
    app.post('/ask', (_req, res) => res.json({ answer: 'ok' }))
    const server = http.createServer(app)
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as any).port
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(onPaymentError).toHaveBeenCalledTimes(1)
      expect(onPaymentError.mock.calls[0][0].message).toMatch(/rate table lookup failed/)
      expect(response.status).toBe(500)
      const body = await response.text()
      expect(body).not.toMatch(/at handleMppRequest/)
      expect(body).not.toMatch(/rate table lookup failed/)
    } finally {
      consoleErrorSpy.mockRestore()
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})

describe('onBeforeVerify on an MPP route', () => {
  it('is called before verifyCredential, like the x402 path', async () => {
    const payments = buildMockPayments()
    const calls: string[] = []
    const onBeforeVerify = jest.fn(async () => {
      calls.push('before')
    })
    payments.mpp.verifyCredential.mockImplementation(async () => {
      calls.push('verify')
      return { isValid: true }
    })
    const { port, close } = await startServer(payments, { onBeforeVerify })
    try {
      await post(port, { authorization: CREDENTIAL })
      expect(onBeforeVerify).toHaveBeenCalledTimes(1)
      expect(calls).toEqual(['before', 'verify'])
    } finally {
      await close()
    }
  })

  it('is not called at all when no credential is presented (nothing to verify yet)', async () => {
    const payments = buildMockPayments()
    const onBeforeVerify = jest.fn()
    const { port, close } = await startServer(payments, { onBeforeVerify })
    try {
      await post(port)
      expect(onBeforeVerify).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })
})

describe('onAfterVerify failures on an MPP route', () => {
  it('do not get reported as a credential rejection or re-challenge the buyer', async () => {
    const payments = buildMockPayments()
    const onAfterVerify = jest.fn().mockRejectedValue(new Error('seller hook bug: db write failed'))
    const { port, close } = await startServer(payments, { onAfterVerify })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      // Must NOT be a fresh 402 challenge -- the credential was already
      // valid; this is a seller-side defect, not a payment problem.
      expect(response.status).not.toBe(402)
      expect(response.headers.get('www-authenticate')).toBeNull()
      const body = await response.text()
      // The hook's internal exception text must not cross the trust
      // boundary into a buyer-visible response.
      expect(body).not.toMatch(/db write failed/)
      expect(payments.mpp.issueChallenge).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('route through onPaymentError when configured, instead of the default response', async () => {
    const payments = buildMockPayments()
    const onAfterVerify = jest.fn().mockRejectedValue(new Error('seller hook bug'))
    const onPaymentError = jest.fn((_error: Error, _req: any, res: any) => {
      res.status(503).json({ error: 'custom handler' })
    })
    const { port, close } = await startServer(payments, { onAfterVerify, onPaymentError })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(onPaymentError).toHaveBeenCalledTimes(1)
      expect(onPaymentError.mock.calls[0][0].message).toMatch(/seller hook bug/)
      expect(response.status).toBe(503)
    } finally {
      await close()
    }
  })

  it('still lets a well-behaved onAfterVerify serve the handler normally', async () => {
    const payments = buildMockPayments()
    const onAfterVerify = jest.fn().mockResolvedValue(undefined)
    const { port, close } = await startServer(payments, { onAfterVerify })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(200)
      expect(onAfterVerify).toHaveBeenCalledTimes(1)
    } finally {
      await close()
    }
  })
})

describe('MPP PaymentContext observability fields', () => {
  it('carries agentRequest and agentRequestId, like the x402 path', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(200)
      const { paymentContext } = await response.json()
      expect(paymentContext.agentRequestId).toBe('req-1')
      expect(paymentContext.agentRequest).toEqual({ agentRequestId: 'req-1', agentId: 'agent-1' })
    } finally {
      await close()
    }
  })
})
