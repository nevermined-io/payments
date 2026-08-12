/**
 * Seller-edge redemption: verify before the handler, settle after a 2xx, and a
 * fresh challenge on rejection.
 */
import express from 'express'
import http from 'http'
import { paymentMiddleware } from '../../../src/x402/express/index.js'
import { MppChallengeExpiredError } from '../../../src/mpp/errors.js'

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

async function startServer(payments: any, handler?: (req: any, res: any) => void) {
  const app = express()
  app.use(express.json())
  app.use(paymentMiddleware(payments, { 'POST /ask': { planId: '123', credits: 2, mpp: true } }))
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

  it('answers a FRESH challenge when the credential is rejected', async () => {
    const payments = buildMockPayments({
      verifyCredential: jest.fn().mockResolvedValue({ isValid: false, invalidReason: 'no credits' }),
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

  it('answers a fresh challenge when the challenge has expired', async () => {
    const payments = buildMockPayments({
      verifyCredential: jest.fn().mockRejectedValue(new MppChallengeExpiredError()),
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
})
