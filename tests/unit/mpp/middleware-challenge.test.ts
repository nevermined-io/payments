/**
 * Seller-edge tests: an MPP-enabled route answers 402 with a challenge, and an
 * MPP-disabled route is untouched.
 */
import express from 'express'
import http from 'http'
import { paymentMiddleware } from '../../../src/x402/express/index.js'

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
    facilitator: {
      verifyPermissions: jest.fn().mockResolvedValue({ isValid: true }),
      settlePermissions: jest.fn().mockResolvedValue({ success: true }),
    },
    getEnvironmentName: () => 'sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: true } } }) },
  } as any
}

async function startServer(payments: any, routes: any) {
  const app = express()
  app.use(express.json())
  app.use(paymentMiddleware(payments, routes))
  app.post('/ask', (_req, res) => res.json({ answer: 'ok' }))

  const server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as any).port
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) }
}

async function post(port: number, headers: Record<string, string> = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ q: 'hello' }),
  })
  return response
}

describe('paymentMiddleware with MPP enabled', () => {
  it('answers 402 with a WWW-Authenticate challenge when no credential is sent', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, {
      'POST /ask': { planId: '123', credits: 2, mpp: true },
    })
    try {
      const response = await post(port)
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
      expect(payments.mpp.issueChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: '123',
          credits: '2',
          resource: '/ask',
          httpVerb: 'POST',
        }),
      )
    } finally {
      await close()
    }
  })

  it('still advertises the x402 payment-required header on the same 402', async () => {
    const { port, close } = await startServer(buildMockPayments(), {
      'POST /ask': { planId: '123', credits: 1, mpp: true },
    })
    try {
      const response = await post(port)
      expect(response.headers.get('payment-required')).toBeTruthy()
    } finally {
      await close()
    }
  })

  it('evaluates a credits function once, at challenge time', async () => {
    const credits = jest.fn().mockReturnValue(5)
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, {
      'POST /ask': { planId: '123', credits, mpp: true },
    })
    try {
      await post(port)
      expect(credits).toHaveBeenCalledTimes(1)
      expect(payments.mpp.issueChallenge).toHaveBeenCalledWith(
        expect.objectContaining({ credits: '5' }),
      )
    } finally {
      await close()
    }
  })

  it('safely refuses (no stack trace) rather than sealing a NaN credits amount into the challenge', async () => {
    // A credits function returning NaN/Infinity/a non-integer must never
    // reach the HMAC-sealed challenge amount -- normalizeCredits throws
    // before issueChallenge is even called, and that throw is caught by the
    // same safe-response path as every other challenge-issuance failure.
    const credits = jest.fn().mockReturnValue(NaN)
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, {
      'POST /ask': { planId: '123', credits, mpp: true },
    })
    try {
      const response = await post(port)
      expect(response.status).toBeGreaterThanOrEqual(500)
      const body = await response.text()
      expect(body).not.toMatch(/at handleMppRequest/)
      expect(payments.mpp.issueChallenge).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })
})

describe('paymentMiddleware with MPP disabled', () => {
  it('never touches the MPP API and keeps the x402 402 shape', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, {
      'POST /ask': { planId: '123', credits: 1 },
    })
    try {
      const response = await post(port)
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBeNull()
      expect(response.headers.get('payment-required')).toBeTruthy()
      expect(payments.mpp.issueChallenge).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })
})
