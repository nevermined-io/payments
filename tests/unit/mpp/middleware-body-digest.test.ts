/**
 * `bindBody` binds the challenge to the exact bytes the buyer sent. Express has
 * already parsed the body by the time the middleware runs, so the raw bytes
 * must be captured by the parser — hence the fail-fast when they are missing.
 *
 * The guard must fail CLOSED: any request that has a body but whose raw bytes
 * were never captured must be refused, in every shape (chunked transfer with
 * no Content-Length included) — not just the ones the parser happens to claim.
 * And the refusal itself must never escape as an uncaught throw: it has to go
 * through the same safe-response path (`onPaymentError` or a JSON body with no
 * stack trace) as every other payment-layer failure.
 */
import express from 'express'
import http from 'http'
import { createHash } from 'crypto'
import { paymentMiddleware, captureRawBody } from '../../../src/x402/express/index.js'
import { mppCredentialFixture } from './credential-fixture.js'

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
  CREDENTIAL = mppCredentialFixture(`digest-${credentialSeq}`)
})
const BODY = JSON.stringify({ q: 'hello' })
const EXPECTED_DIGEST = `sha-256=${createHash('sha256').update(Buffer.from(BODY)).digest('base64')}`

function buildMockPayments(overrides: Record<string, unknown> = {}) {
  return {
    mpp: {
      issueChallenge: jest.fn().mockResolvedValue({ challenge: 'Payment id="c1"', id: 'c1' }),
      verifyCredential: jest.fn().mockResolvedValue({ isValid: true }),
      settleCredential: jest.fn().mockResolvedValue({
        success: true,
        transaction: '0x',
        network: 'eip155:84532',
        paymentReceipt: 'receipt-b64',
      }),
      ...(overrides.mpp as object),
    },
    facilitator: { verifyPermissions: jest.fn(), settlePermissions: jest.fn() },
    getEnvironmentName: () => 'sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: true } } }) },
  } as any
}

async function startServer(
  payments: any,
  withCapture: boolean,
  options: Record<string, unknown> = {},
) {
  const app = express()
  app.use(withCapture ? express.json({ verify: captureRawBody }) : express.json())
  app.use(
    paymentMiddleware(
      payments,
      { 'POST /ask': { planId: '123', credits: 1, mpp: { bindBody: true } } },
      options as any,
    ),
  )
  app.post('/ask', (_req, res) => res.json({ answer: 'ok' }))
  const server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as any).port
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) }
}

async function post(port: number, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: BODY,
  })
}

/** Sends a request with NO Content-Length, so Node's http client picks chunked
 *  transfer-encoding automatically — the shape the round-3 content-length-only
 *  guard let straight through. */
async function postChunked(
  port: number,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string; contentType: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/ask', method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            contentType: res.headers['content-type'],
          }),
        )
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

describe('bindBody', () => {
  it('mints the challenge with the digest of the raw body', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, true)
    try {
      await post(port)
      expect(payments.mpp.issueChallenge).toHaveBeenCalledWith(
        expect.objectContaining({ digest: EXPECTED_DIGEST }),
      )
    } finally {
      await close()
    }
  })

  it('sends the same digest as bodyDigest at verify and settle', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, true)
    try {
      await post(port, { authorization: CREDENTIAL })
      expect(payments.mpp.verifyCredential).toHaveBeenCalledWith(
        expect.objectContaining({ bodyDigest: EXPECTED_DIGEST }),
      )
      expect(payments.mpp.settleCredential).toHaveBeenCalledWith(
        expect.objectContaining({ bodyDigest: EXPECTED_DIGEST }),
      )
    } finally {
      await close()
    }
  })

  it('a chunked request with a matching, correctly-mounted parser still binds normally', async () => {
    // Regression guard: the fix for the chunked fail-OPEN hole must not
    // break the case where captureRawBody genuinely does capture a chunked
    // body (body-parser handles chunked transfer transparently).
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, true)
    try {
      const result = await postChunked(port, { 'content-type': 'application/json' }, BODY)
      expect(result.status).toBe(402)
      expect(payments.mpp.issueChallenge).toHaveBeenCalledWith(
        expect.objectContaining({ digest: EXPECTED_DIGEST }),
      )
    } finally {
      await close()
    }
  })

  it('fails loudly, but safely, when the raw body was never captured for a Content-Length request', async () => {
    // Strengthens the round-1 assertion (which only pinned the 500 status,
    // not the shape) into the same "no stack trace, JSON body, onPaymentError
    // honoured" contract every other payment-layer failure gets.
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, false)
    try {
      const response = await post(port)
      expect(response.status).toBe(500)
      expect(response.headers.get('content-type')).toMatch(/application\/json/)
      const body = await response.text()
      expect(body).not.toMatch(/at handleMppRequest/)
      expect(body).not.toMatch(/<pre>/)
      expect(payments.mpp.issueChallenge).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('routes the missing-raw-body config error through onPaymentError when configured', async () => {
    const payments = buildMockPayments()
    const onPaymentError = jest.fn((_error: Error, _req: any, res: any) => {
      res.status(503).json({ error: 'custom handler' })
    })
    const { port, close } = await startServer(payments, false, { onPaymentError })
    try {
      const response = await post(port)
      expect(onPaymentError).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(503)
    } finally {
      await close()
    }
  })

  it('refuses (fails CLOSED) rather than silently minting an unbound challenge for a chunked request the parser never captures', async () => {
    // The blocker: content-length-only detection let a chunked request with
    // no Content-Length sail past the guard entirely -- no throw, no digest,
    // an unbound challenge minted silently. The buyer, not the seller,
    // decided whether bindBody's security property applied. A body-bearing
    // request whose raw bytes were never captured must always be refused,
    // never served unbound.
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, true) // captureRawBody IS mounted...
    try {
      // ...but for a content-type the JSON parser does not claim, so its
      // verify hook never runs and getRawBody(req) stays undefined.
      const result = await postChunked(port, { 'content-type': 'text/plain' }, BODY)
      expect(result.status).toBe(400)
      expect(result.contentType).toMatch(/application\/json/)
      expect(result.body).not.toMatch(/at handleMppRequest/)
      expect(result.body).not.toMatch(/<pre>/)
      expect(payments.mpp.issueChallenge).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('binds the EMPTY body when a request carries none, rather than minting an unbound challenge', async () => {
    // The hole this closes: an unbound challenge on a bindBody route is one
    // the buyer can redeem with ANY body, because the backend's
    // assertBodyDigestMatches returns early when the challenge carries no
    // digest. Minting empty-bodied would have let a buyer choose whether the
    // seller's bindBody applied — the same class as the chunked case above,
    // reached by simply omitting the body.
    //
    // The digest of zero bytes is well-defined, so "no body" is a bound
    // state: a bodyless redeem reproduces it, one that grew a body does not.
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, false)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      expect(response.status).toBe(402)
      expect(payments.mpp.issueChallenge).toHaveBeenCalledWith(
        // sha-256 of zero bytes, the RFC 9530 way MPP spells it.
        expect.objectContaining({ digest: 'sha-256=47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' }),
      )
    } finally {
      await close()
    }
  })

  it('redeems a bodyless request against the empty-body digest it was sealed with', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, false)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: CREDENTIAL },
      })
      expect(response.status).toBe(200)
      // Same digest at redeem as at mint — otherwise the backend would
      // reject the buyer's own unchanged request with BCK.MPP.0005.
      expect(payments.mpp.verifyCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          bodyDigest: 'sha-256=47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
        }),
      )
    } finally {
      await close()
    }
  })
})
