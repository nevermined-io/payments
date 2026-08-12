/**
 * The buyer helper against the real seller middleware, with only the backend
 * stubbed. This is the test that would catch a header-name or credential-shape
 * mismatch between the two halves.
 */
import express from 'express'
import http from 'http'
import { Payments } from '../../../src/payments.js'
import { paymentMiddleware } from '../../../src/x402/express/index.js'

describe('MPP buyer pays the SDK seller middleware', () => {
  let realFetch: typeof fetch
  let server: http.Server
  let port: number
  let payments: Payments

  beforeAll(async () => {
    realFetch = global.fetch
    payments = Payments.getInstance({
      nvmApiKey: 'eyJhbGciOiJIUzI1NiJ9.e30.sig',
      environment: 'sandbox',
    } as any)

    const challengeHeader =
      'Payment id="c1", realm="api.nevermined.app", method="nevermined", intent="charge", ' +
      'request="eyJjcmVkaXRzIjoiMiIsInBsYW5JZCI6IjEyMyJ9", expires="2999-01-01T00:00:00.000Z"'

    global.fetch = (async (url: any, init: any) => {
      const href = String(url)
      if (href.includes('127.0.0.1')) return realFetch(url, init)
      if (href.includes('/api/v1/mpp/challenge'))
        return new Response(JSON.stringify({ challenge: challengeHeader, id: 'c1' }), { status: 201 })
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      if (href.includes('/api/v1/mpp/verify'))
        return new Response(JSON.stringify({ isValid: true }), { status: 201 })
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
  })
})
