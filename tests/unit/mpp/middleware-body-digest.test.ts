/**
 * `bindBody` binds the challenge to the exact bytes the buyer sent. Express has
 * already parsed the body by the time the middleware runs, so the raw bytes
 * must be captured by the parser — hence the fail-fast when they are missing.
 */
import express from 'express'
import http from 'http'
import { createHash } from 'crypto'
import { paymentMiddleware, captureRawBody } from '../../../src/x402/express/index.js'

const CREDENTIAL = 'Payment eyJjaGFsbGVuZ2UiOnt9fQ'
const BODY = JSON.stringify({ q: 'hello' })
const EXPECTED_DIGEST = `sha-256=${createHash('sha256').update(Buffer.from(BODY)).digest('base64')}`

function buildMockPayments() {
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
    },
    facilitator: { verifyPermissions: jest.fn(), settlePermissions: jest.fn() },
    getEnvironmentName: () => 'sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: true } } }) },
  } as any
}

async function startServer(payments: any, withCapture: boolean) {
  const app = express()
  app.use(withCapture ? express.json({ verify: captureRawBody }) : express.json())
  app.use(
    paymentMiddleware(payments, {
      'POST /ask': { planId: '123', credits: 1, mpp: { bindBody: true } },
    }),
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

  it('fails loudly when the raw body was never captured', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments, false)
    try {
      const response = await post(port)
      expect(response.status).toBe(500)
      expect(payments.mpp.issueChallenge).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })
})
