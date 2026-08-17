/**
 * The 402 on an MPP-enabled route advertises both a WWW-Authenticate MPP
 * challenge and the x402 payment-required header, so both protocols must be
 * payable — not just the one that minted the 402. A request that carries a
 * valid x402 token but no MPP credential must be served through the existing
 * x402 verify/settle path unchanged, never bounced into a fresh MPP
 * challenge.
 */
import express from 'express'
import http from 'http'
import { paymentMiddleware, X402_HEADERS } from '../../../src/x402/express/index.js'
import { mppCredentialFixture } from './credential-fixture.js'

const X402_TOKEN = 'mock-x402-token'

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
      verifyPermissions: jest.fn().mockResolvedValue({ isValid: true, agentRequestId: 'req-1' }),
      settlePermissions: jest.fn().mockResolvedValue({ success: true, creditsRedeemed: '2' }),
      ...(overrides.facilitator as object),
    },
    getEnvironmentName: () => 'sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: true } } }) },
  } as any
}

async function startServer(payments: any) {
  const app = express()
  app.use(express.json())
  app.use(paymentMiddleware(payments, { 'POST /ask': { planId: '123', credits: 2, mpp: true } }))
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
    body: JSON.stringify({ q: 'hello' }),
  })
}

describe('x402 token on an MPP-enabled route', () => {
  it('is served through the x402 path, not bounced into an MPP challenge', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { [X402_HEADERS.PAYMENT_SIGNATURE]: X402_TOKEN })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ answer: 'ok' })
      expect(payments.facilitator.verifyPermissions).toHaveBeenCalledWith(
        expect.objectContaining({ x402AccessToken: X402_TOKEN }),
      )
      expect(payments.facilitator.settlePermissions).toHaveBeenCalled()

      // The MPP surface must never be touched for this request.
      expect(payments.mpp.issueChallenge).not.toHaveBeenCalled()
      expect(payments.mpp.verifyCredential).not.toHaveBeenCalled()
      expect(payments.mpp.settleCredential).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('an MPP credential still takes the MPP path even when an x402 token is also present', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, {
        [X402_HEADERS.PAYMENT_SIGNATURE]: X402_TOKEN,
        authorization: mppCredentialFixture('fallback-1'),
      })

      expect(response.status).toBe(200)
      expect(payments.mpp.verifyCredential).toHaveBeenCalled()
      expect(payments.facilitator.verifyPermissions).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('an unrelated Authorization header that merely contains "payment" text does not divert an x402 buyer onto the MPP path', async () => {
    // codec.ts's extractPaymentScheme used to match "Payment" mid-token or
    // after bare whitespace, not just a genuine scheme boundary. An x402
    // buyer sending a perfectly valid payment-signature token, plus an
    // unrelated Authorization value that happens to contain "payment"
    // followed by whitespace (e.g. a custom auth scheme, or a proxy-added
    // header), was diverted onto the MPP path and challenged instead of
    // served -- reported by the reviewer with `Bearer prepayment xyz`.
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, {
        [X402_HEADERS.PAYMENT_SIGNATURE]: X402_TOKEN,
        authorization: 'Bearer prepayment xyz',
      })

      expect(response.status).toBe(200)
      expect(payments.facilitator.verifyPermissions).toHaveBeenCalledWith(
        expect.objectContaining({ x402AccessToken: X402_TOKEN }),
      )
      expect(payments.mpp.verifyCredential).not.toHaveBeenCalled()
      expect(payments.mpp.issueChallenge).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('with neither credential present, still issues the MPP challenge advertising both protocols', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port)
      expect(response.status).toBe(402)
      expect(response.headers.get('www-authenticate')).toBe('Payment id="c1"')
      expect(response.headers.get('payment-required')).toBeTruthy()
    } finally {
      await close()
    }
  })
})
