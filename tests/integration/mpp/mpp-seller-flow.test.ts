/**
 * Full seller flow against a stubbed backend: 402 with a challenge, then a paid
 * request that settles and returns a receipt. Exercises the real MppAPI HTTP
 * layer with `fetch` stubbed, rather than a hand-mocked payments object.
 */
import express from 'express'
import http from 'http'
import { Payments } from '../../../src/payments.js'
import { paymentMiddleware } from '../../../src/x402/express/index.js'
import { mppCredentialFixture } from '../../unit/mpp/credential-fixture.js'

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
  CREDENTIAL = mppCredentialFixture(`seller-flow-${credentialSeq}`)
})

describe('MPP seller flow', () => {
  let realFetch: typeof fetch
  let server: http.Server
  let port: number

  beforeAll(async () => {
    realFetch = global.fetch
    const payments = Payments.getInstance({
      nvmApiKey: 'eyJhbGciOiJIUzI1NiJ9.e30.sig',
      environment: 'sandbox',
    } as any)

    global.fetch = (async (url: any, init: any) => {
      const href = String(url)
      // Let the test client's own request through to the local server.
      if (href.includes('127.0.0.1')) return realFetch(url, init)
      if (href.includes('/api/v1/mpp/challenge'))
        return new Response(JSON.stringify({ challenge: 'Payment id="c1"', id: 'c1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      if (href.includes('/api/v1/mpp/verify'))
        return new Response(JSON.stringify({ isValid: true, payer: '0xabc' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      if (href.includes('/api/v1/mpp/settle'))
        return new Response(
          JSON.stringify({
            success: true,
            transaction: '0x1',
            network: 'eip155:84532',
            creditsRedeemed: '2',
            paymentReceipt: 'receipt-b64',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
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

  it('challenges an unpaid request', async () => {
    const response = await realFetch(`http://127.0.0.1:${port}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(402)
    expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
  })

  it('serves and settles a paid request', async () => {
    const response = await realFetch(`http://127.0.0.1:${port}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: CREDENTIAL },
      body: '{}',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('payment-receipt')).toBe('receipt-b64')
    expect(await response.json()).toEqual({ answer: '42' })
  })
})
