/**
 * Seller-edge redemption: verify before the handler, settle after a 2xx, and a
 * fresh challenge on rejection.
 */
import express from 'express'
import http from 'http'
import { paymentMiddleware } from '../../../src/x402/express/index.js'
import { MppChallengeExpiredError, MppCredentialRejectedError } from '../../../src/mpp/errors.js'

const CREDENTIAL = 'Payment eyJjaGFsbGVuZ2UiOnt9fQ'

function buildMockPayments(mpp: Record<string, unknown> = {}) {
  return {
    mpp: {
      issueChallenge: jest
        .fn()
        .mockResolvedValueOnce({ challenge: 'Payment id="c1"', id: 'c1' })
        .mockResolvedValue({ challenge: 'Payment id="c2"', id: 'c2' }),
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
    facilitator: {
      verifyPermissions: jest.fn(),
      settlePermissions: jest.fn(),
    },
    getEnvironmentName: () => 'sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: true } } }) },
  } as any
}

async function startServer(
  payments: any,
  handler?: (req: any, res: any) => void,
  options: Record<string, unknown> = {},
  routeCredits: number = 2,
) {
  const app = express()
  app.use(express.json())
  app.use(
    paymentMiddleware(
      payments,
      { 'POST /ask': { planId: '123', credits: routeCredits, mpp: true } },
      options as any,
    ),
  )
  app.post('/ask', handler ?? ((_req, res) => res.json({ answer: 'ok' })))
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

describe('MPP redemption', () => {
  it('verifies, serves the handler and settles with the receipt header', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ answer: 'ok' })
      expect(response.headers.get('payment-receipt')).toBe('receipt-b64')
      expect(payments.mpp.verifyCredential).toHaveBeenCalledWith({
        credential: CREDENTIAL,
        resource: '/ask',
        httpVerb: 'POST',
      })
      expect(payments.mpp.settleCredential).toHaveBeenCalledWith({
        credential: CREDENTIAL,
        resource: '/ask',
        httpVerb: 'POST',
      })
    } finally {
      await close()
    }
  })

  it('does not settle when the handler fails', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, (_req, res) =>
      res.status(500).json({ error: 'boom' }),
    )
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(500)
      expect(payments.mpp.settleCredential).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('answers a FRESH challenge when the credential is rejected, falling back to BCK.MPP.0003', async () => {
    // A request that presented a credential and got { isValid: false } back
    // IS a credential rejection, even though this path never throws a typed
    // MppError with its own code. The wire contract has to be positional,
    // not incidental: any 402 answering a credential-bearing request carries
    // a code, or a buyer reading "code present = refused, paying again is
    // pointless" would read this fresh-but-code-less challenge as retryable
    // and mint a second credential for a rejection the first already proved
    // terminal. BCK.MPP.0003 is the backend's own generic rejection code, so
    // this invents nothing and publishes no new distinction.
    const payments = buildMockPayments({
      verifyCredential: jest.fn().mockResolvedValue({ isValid: false, invalidReason: 'no credits' }),
    })
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
      const body = await response.json()
      expect(body.message).toBe('no credits')
      expect(body.code).toBe('BCK.MPP.0003')
    } finally {
      await close()
    }
  })

  it('answers a fresh challenge when the challenge has expired, carrying the backend code', async () => {
    const payments = buildMockPayments({
      verifyCredential: jest.fn().mockRejectedValue(new MppChallengeExpiredError()),
    })
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
      const body = await response.json()
      expect(body.code).toBe('BCK.MPP.0004')
    } finally {
      await close()
    }
  })

  it('answers a fresh challenge carrying BCK.MPP.0003 when the credential is rejected as a typed error', async () => {
    // The backend distinguishes a genuine refusal (BCK.MPP.0003, thrown as
    // MppCredentialRejectedError by MppAPI.post when the /verify call itself
    // 4xxs) from a resolved { isValid: false }. The buyer's terminal-
    // rejection gate needs this code to tell "refused" from "re-challenged" —
    // without it every rejection looks retryable and a refused credential
    // gets a second one minted and handed over for nothing.
    const payments = buildMockPayments({
      verifyCredential: jest.fn().mockRejectedValue(new MppCredentialRejectedError('forged signature')),
    })
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
      const body = await response.json()
      expect(body.code).toBe('BCK.MPP.0003')
      // The buyer-visible message is fixed and generic, never the caught
      // error's own message -- see the dedicated hint-leak test below for
      // why: MppAPI.post folds a backend `hint` field into that message, and
      // forwarding it verbatim would re-widen the anti-oracle discipline
      // src/mpp/errors.ts documents.
      expect(body.message).toBe('Credential rejected')
    } finally {
      await close()
    }
  })

  it('never forwards a caught verification error message verbatim to the buyer, even when it carries a backend hint', async () => {
    // MppAPI.post folds a backend-supplied `hint` onto the thrown error's
    // message (mpp-api.ts): "MPP credential rejected — the signature does
    // not match the account bound to this plan". The backend deliberately
    // collapses every rejection into one coarse code so the endpoint cannot
    // be used as a forgery oracle (src/mpp/errors.ts); a hint folded into
    // the message and then echoed to the buyer would hand the discriminator
    // straight back to the exact caller -- a buyer probing forged
    // credentials -- the coarse code was meant to withhold from.
    const payments = buildMockPayments({
      verifyCredential: jest
        .fn()
        .mockRejectedValue(
          new MppCredentialRejectedError(
            'MPP credential rejected — the signature does not match the account bound to this plan',
          ),
        ),
    })
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(402)
      const body = await response.json()
      expect(body.code).toBe('BCK.MPP.0003')
      expect(body.message).not.toMatch(/signature/)
      expect(body.message).not.toMatch(/account bound/)
      expect(body.message).toBe('Credential rejected')
    } finally {
      await close()
    }
  })

  it('omits the code entirely on the no-credential challenge (no rejection happened yet)', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port)
      expect(response.status).toBe(402)
      const body = await response.json()
      expect(body.code).toBeUndefined()
    } finally {
      await close()
    }
  })

  it('ignores an Authorization header that carries no Payment scheme', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { authorization: 'Bearer some-jwt' })
      expect(response.status).toBe(402)
      expect(payments.mpp.verifyCredential).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('still settles when the handler streams and headers are already flushed', async () => {
    // Mirrors tests/unit/x402-middleware-settlement.test.ts's
    // "settles when handler streams via res.write + res.end": once the
    // handler writes before calling end(), headers are already sent by the
    // time the res.end wrapper runs, so the Payment-Receipt header cannot be
    // attached — but settlement MUST still run so the buyer is billed.
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, (_req: any, res: any) => {
      res.setHeader('content-type', 'text/plain')
      res.write('chunk-1')
      res.write('-chunk-2')
      res.end()
    })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('chunk-1-chunk-2')
      // Headers were flushed before settlement, so the receipt cannot be
      // attached to this response.
      expect(response.headers.get('payment-receipt')).toBeNull()
      expect(payments.mpp.settleCredential).toHaveBeenCalledWith({
        credential: CREDENTIAL,
        resource: '/ask',
        httpVerb: 'POST',
      })
    } finally {
      await close()
    }
  })

  describe('the amount reported to onAfterSettle and paymentContext', () => {
    it('reports the amount the backend actually redeemed, not the locally recomputed credits', async () => {
      // Credits are sealed into the challenge on an EARLIER request; this
      // request's own creditsToCharge (routeCredits: 5, e.g. a credits
      // function that changed between mint and redeem) must not be reported
      // as what was burned when the settle response says otherwise.
      const payments = buildMockPayments({
        settleCredential: jest.fn().mockResolvedValue({
          success: true,
          transaction: '0x',
          network: 'eip155:84532',
          creditsRedeemed: '2', // sealed into the challenge, not routeCredits below
          paymentReceipt: 'receipt-b64',
        }),
      })
      const onAfterSettle = jest.fn()
      const { port, close } = await startServer(
        payments,
        (req: any, res: any) => res.json({ creditsToSettle: req.paymentContext.creditsToSettle }),
        { onAfterSettle },
        5, // routeCredits: diverges from the settlement's creditsRedeemed
      )
      try {
        const response = await post(port, { authorization: CREDENTIAL })
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.creditsToSettle).toBe(5) // read before settlement ran; unaffected

        // Give the deferred settlement microtask a turn.
        await new Promise((r) => setImmediate(r))
        expect(onAfterSettle).toHaveBeenCalledWith(
          expect.anything(),
          2, // the settled amount, not the recomputed 5
          expect.objectContaining({ creditsRedeemed: '2' }),
        )
      } finally {
        await close()
      }
    })

    it('falls back to the recomputed credits when the settlement omits creditsRedeemed', async () => {
      const payments = buildMockPayments({
        settleCredential: jest.fn().mockResolvedValue({
          success: true,
          transaction: '0x',
          network: 'eip155:84532',
          paymentReceipt: 'receipt-b64',
        }),
      })
      const onAfterSettle = jest.fn()
      const { port, close } = await startServer(payments, undefined, { onAfterSettle })
      try {
        await post(port, { authorization: CREDENTIAL })
        await new Promise((r) => setImmediate(r))
        expect(onAfterSettle).toHaveBeenCalledWith(expect.anything(), 2, expect.anything())
      } finally {
        await close()
      }
    })
  })

  describe('settlement failure handling', () => {
    it('still returns the served 2xx, with no Payment-Receipt header, when settleCredential rejects', async () => {
      const payments = buildMockPayments({
        settleCredential: jest.fn().mockRejectedValue(new Error('settlement service unreachable')),
      })
      const { port, close } = await startServer(payments)
      try {
        const response = await post(port, { authorization: CREDENTIAL })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ answer: 'ok' })
        expect(response.headers.get('payment-receipt')).toBeNull()
      } finally {
        await close()
      }
    })

    it('does not settle twice when the handler ends the response twice', async () => {
      const payments = buildMockPayments()
      const { port, close } = await startServer(payments, (_req: any, res: any) => {
        // res.write flushes headers immediately, so both end() calls take
        // the synchronous (headersSent) branch -- settlementStarted is the
        // only thing standing between this and a double settle.
        res.write('ok')
        res.end()
        try {
          res.end()
        } catch {
          // A second end() on an already-finished native response can throw;
          // irrelevant here -- only the settlement call count matters.
        }
      })
      try {
        const response = await post(port, { authorization: CREDENTIAL })
        expect(response.status).toBe(200)
        await new Promise((r) => setImmediate(r))
        expect(payments.mpp.settleCredential).toHaveBeenCalledTimes(1)
      } finally {
        await close()
      }
    })

    it('does not throw and still calls onAfterSettle when the settle resolves with success: false and no paymentReceipt', async () => {
      const payments = buildMockPayments({
        settleCredential: jest.fn().mockResolvedValue({
          success: false,
          errorReason: 'insufficient balance at settle time',
          transaction: '',
          network: 'eip155:84532',
        }),
      })
      const onAfterSettle = jest.fn()
      const { port, close } = await startServer(payments, undefined, { onAfterSettle })
      try {
        const response = await post(port, { authorization: CREDENTIAL })
        // The buyer already has the delivered resource; a failed settle
        // must not throw ERR_HTTP_INVALID_HEADER_VALUE and must not be
        // silently indistinguishable from every other kind of failure.
        expect(response.status).toBe(200)
        expect(response.headers.get('payment-receipt')).toBeNull()
        await new Promise((r) => setImmediate(r))
        expect(onAfterSettle).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ success: false }),
        )
      } finally {
        await close()
      }
    })
  })
})
