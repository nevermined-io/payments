/**
 * Regression coverage: a failure while minting an MPP challenge (e.g. the
 * environment has MPP turned off, `BCK.MPP.0002`) must never fall through to
 * Express's default error handler — that leaks a stack trace to the client
 * and skips a configured `onPaymentError` hook. Every `sendChallenge()` call
 * site (no credential, rejected credential, expired/errored verification)
 * shares this behaviour since they all route through the same helper.
 */
import express from 'express'
import http from 'http'
import { paymentMiddleware } from '../../../src/x402/express/index.js'
import { mppCredentialFixture } from './credential-fixture.js'
import { MppNotConfiguredError } from '../../../src/mpp/errors.js'

function buildMockPayments(overrides: Record<string, unknown> = {}) {
  return {
    mpp: {
      issueChallenge: jest.fn().mockRejectedValue(new MppNotConfiguredError()),
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
      verifyPermissions: jest.fn(),
      settlePermissions: jest.fn(),
    },
    getEnvironmentName: () => 'sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: true } } }) },
  } as any
}

async function startServer(payments: any, options: Record<string, unknown> = {}) {
  const app = express()
  app.use(express.json())
  app.use(
    paymentMiddleware(
      payments,
      { 'POST /ask': { planId: '123', credits: 2, mpp: true } },
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
    body: JSON.stringify({ q: 'hello' }),
  })
}

describe('MPP challenge issuance failure', () => {
  it('never leaks a stack trace when issueChallenge rejects and no onPaymentError is configured', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port)
      const body = await response.text()

      // Must not be Express's default HTML error page — that includes the
      // literal stack trace ("at handleMppRequest (...)").
      expect(body).not.toMatch(/at handleMppRequest/)
      expect(body).not.toMatch(/<pre>/)
      expect(response.headers.get('content-type')).toMatch(/application\/json/)

      // No challenge could be minted, so this can't be advertised as payable.
      expect(response.status).toBeGreaterThanOrEqual(500)
    } finally {
      await close()
    }
  })

  it('routes the failure through onPaymentError when configured, instead of the default response', async () => {
    const payments = buildMockPayments()
    const onPaymentError = jest.fn((_error: Error, _req: any, res: any) => {
      res.status(503).json({ error: 'custom handler' })
    })
    const { port, close } = await startServer(payments, { onPaymentError })
    try {
      const response = await post(port)
      expect(onPaymentError).toHaveBeenCalledTimes(1)
      expect(onPaymentError.mock.calls[0][0]).toBeInstanceOf(MppNotConfiguredError)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'custom handler' })
    } finally {
      await close()
    }
  })

  it('also protects the rejected-credential retry path', async () => {
    const payments = buildMockPayments({
      mpp: {
        verifyCredential: jest
          .fn()
          .mockResolvedValue({ isValid: false, invalidReason: 'no credits' }),
      },
    })
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { authorization: mppCredentialFixture('chal-err-1') })
      const body = await response.text()
      expect(body).not.toMatch(/at handleMppRequest/)
      expect(response.status).toBeGreaterThanOrEqual(500)
    } finally {
      await close()
    }
  })
})
