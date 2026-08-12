/**
 * The buyer helper against the real seller middleware, with only the backend
 * stubbed. This is the test that would catch a header-name mismatch between
 * the two halves — the buyer sends the credential under `Authorization`, the
 * seller reads it from there and forwards it to `/api/v1/mpp/verify`
 * untouched — since the assertion below decodes the forwarded credential and
 * checks its sealed `challenge.request` still matches the base64 the
 * challenge carried. (The codec's own byte-for-byte round-trip guarantee is
 * covered by the Task 1 unit tests; this test covers the wiring between the
 * buyer and seller halves, not the codec itself.)
 */
import express from 'express'
import http from 'http'
import { Payments } from '../../../src/payments.js'
import { paymentMiddleware } from '../../../src/x402/express/index.js'

const CHALLENGE_REQUEST_ENCODED = 'eyJjcmVkaXRzIjoiMiIsInBsYW5JZCI6IjEyMyJ9'

describe('MPP buyer pays the SDK seller middleware', () => {
  let realFetch: typeof fetch
  let server: http.Server
  let port: number
  let payments: Payments
  let verifyBody: any

  beforeAll(async () => {
    realFetch = global.fetch
    payments = Payments.getInstance({
      nvmApiKey: 'eyJhbGciOiJIUzI1NiJ9.e30.sig',
      environment: 'sandbox',
    } as any)

    const challengeHeader =
      'Payment id="c1", realm="api.nevermined.app", method="nevermined", intent="charge", ' +
      `request="${CHALLENGE_REQUEST_ENCODED}", expires="2999-01-01T00:00:00.000Z"`

    global.fetch = (async (url: any, init: any) => {
      const href = String(url)
      if (href.includes('127.0.0.1')) return realFetch(url, init)
      if (href.includes('/api/v1/mpp/challenge'))
        return new Response(JSON.stringify({ challenge: challengeHeader, id: 'c1' }), { status: 201 })
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      if (href.includes('/api/v1/mpp/verify')) {
        // Captured so the test below can assert the seller middleware forwards
        // the buyer's credential — and the sealed challenge request inside it
        // — untouched, rather than just trusting a stubbed success response.
        verifyBody = JSON.parse(init.body)
        return new Response(JSON.stringify({ isValid: true }), { status: 201 })
      }
      if (href.includes('/api/v1/mpp/settle'))
        return new Response(
          JSON.stringify({
            success: true,
            transaction: '0x1',
            network: 'eip155:84532',
            creditsRedeemed: '2',
            paymentReceipt:
              'eyJtZXRob2QiOiJuZXZlcm1pbmVkIiwicmVmZXJlbmNlIjoiYzEiLCJzdGF0dXMiOiJzdWNjZXNzIiwidGltZXN0YW1wIjoiMjAyNi0wOC0xMlQxMDowMDozMC4wMDBaIn0',
          }),
          { status: 201 },
        )
      throw new Error(`unexpected fetch: ${href}`)
    }) as any

    const app = express()
    app.use(express.json())
    app.use(paymentMiddleware(payments, { 'POST /ask': { planId: '123', credits: 2, mpp: true } }))
    app.post('/ask', (_req, res) => res.json({ answer: '42' }))

    server = http.createServer(app)
    await new Promise<void>((r) => server.listen(0, r))
    port = (server.address() as any).port
  })

  afterAll(async () => {
    global.fetch = realFetch
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('pays and gets the answer plus a receipt', async () => {
    const { response, receipt, paid } = await payments.mpp.fetch(
      `http://127.0.0.1:${port}/ask`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { delegationConfig: { delegationId: 'del-1' } },
    )

    expect(paid).toBe(true)
    expect(await response.json()).toEqual({ answer: '42' })
    expect(receipt?.reference).toBe('c1')

    // The seller middleware must forward the buyer's credential to /verify
    // as-is — the base64url `request` sealed in the credential's `challenge`
    // is what the backend re-derives the challenge id's HMAC from, so it has
    // to survive the buyer-mint -> Authorization header -> seller-forward
    // trip untouched.
    expect(verifyBody.credential).toMatch(/^Payment /)
    const decodedCredential = JSON.parse(
      Buffer.from(verifyBody.credential.slice('Payment '.length), 'base64url').toString('utf8'),
    )
    expect(decodedCredential.challenge.request).toBe(CHALLENGE_REQUEST_ENCODED)
  })
})
