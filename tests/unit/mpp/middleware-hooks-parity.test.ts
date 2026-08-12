/**
 * Hook and observability parity between the x402 path and the MPP path.
 * Turning `mpp: true` on for a route must not silently disable a documented
 * `PaymentMiddlewareOptions` hook or blank `req.paymentContext` fields the
 * x402 path already populates -- a seller reading the docs has no reason to
 * expect either.
 */
import express from 'express'
import http from 'http'
import { paymentMiddleware } from '../../../src/x402/express/index.js'
import { MppCredentialRejectedError } from '../../../src/mpp/errors.js'

const CREDENTIAL = 'Payment eyJjaGFsbGVuZ2UiOnt9fQ'

function buildMockPayments(mpp: Record<string, unknown> = {}) {
  return {
    mpp: {
      issueChallenge: jest.fn().mockResolvedValue({ challenge: 'Payment id="c1"', id: 'c1' }),
      verifyCredential: jest.fn().mockResolvedValue({
        isValid: true,
        agentRequestId: 'req-1',
        agentRequest: { agentRequestId: 'req-1', agentId: 'agent-1' },
      }),
      settleCredential: jest.fn().mockResolvedValue({
        success: true,
        transaction: '0x',
        network: 'eip155:84532',
        creditsRedeemed: '2',
        paymentReceipt: 'receipt-b64',
      }),
      ...mpp,
    },
    facilitator: { verifyPermissions: jest.fn(), settlePermissions: jest.fn() },
    getEnvironmentName: () => 'sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: true } } }) },
  } as any
}

async function startServer(
  payments: any,
  options: Record<string, unknown> = {},
  handler?: (req: any, res: any) => void,
) {
  const app = express()
  app.use(express.json())
  app.use(
    paymentMiddleware(
      payments,
      { 'POST /ask': { planId: '123', credits: 2, mpp: true } },
      options as any,
    ),
  )
  app.post(
    '/ask',
    handler ??
      ((req: any, res: any) => res.json({ paymentContext: req.paymentContext ?? null })),
  )
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

describe('onPaymentError on a rejected MPP credential', () => {
  it('is called instead of sendChallenge, matching the x402 path', async () => {
    const payments = buildMockPayments({
      verifyCredential: jest
        .fn()
        .mockResolvedValue({ isValid: false, invalidReason: 'no credits' }),
    })
    const onPaymentError = jest.fn((_error: Error, _req: any, res: any) => {
      res.status(503).json({ error: 'custom handler' })
    })
    const { port, close } = await startServer(payments, { onPaymentError })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(onPaymentError).toHaveBeenCalledTimes(1)
      expect(onPaymentError.mock.calls[0][0]).toBeInstanceOf(MppCredentialRejectedError)
      expect(response.status).toBe(503)
      expect(payments.mpp.issueChallenge).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('still sends a fresh challenge when onPaymentError is not configured', async () => {
    const payments = buildMockPayments({
      verifyCredential: jest
        .fn()
        .mockResolvedValue({ isValid: false, invalidReason: 'no credits' }),
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
})

describe('onBeforeVerify on an MPP route', () => {
  it('is called before verifyCredential, like the x402 path', async () => {
    const payments = buildMockPayments()
    const calls: string[] = []
    const onBeforeVerify = jest.fn(async () => {
      calls.push('before')
    })
    payments.mpp.verifyCredential.mockImplementation(async () => {
      calls.push('verify')
      return { isValid: true }
    })
    const { port, close } = await startServer(payments, { onBeforeVerify })
    try {
      await post(port, { authorization: CREDENTIAL })
      expect(onBeforeVerify).toHaveBeenCalledTimes(1)
      expect(calls).toEqual(['before', 'verify'])
    } finally {
      await close()
    }
  })

  it('is not called at all when no credential is presented (nothing to verify yet)', async () => {
    const payments = buildMockPayments()
    const onBeforeVerify = jest.fn()
    const { port, close } = await startServer(payments, { onBeforeVerify })
    try {
      await post(port)
      expect(onBeforeVerify).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })
})

describe('onAfterVerify failures on an MPP route', () => {
  it('do not get reported as a credential rejection or re-challenge the buyer', async () => {
    const payments = buildMockPayments()
    const onAfterVerify = jest.fn().mockRejectedValue(new Error('seller hook bug: db write failed'))
    const { port, close } = await startServer(payments, { onAfterVerify })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      // Must NOT be a fresh 402 challenge -- the credential was already
      // valid; this is a seller-side defect, not a payment problem.
      expect(response.status).not.toBe(402)
      expect(response.headers.get('www-authenticate')).toBeNull()
      const body = await response.text()
      // The hook's internal exception text must not cross the trust
      // boundary into a buyer-visible response.
      expect(body).not.toMatch(/db write failed/)
      expect(payments.mpp.issueChallenge).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('route through onPaymentError when configured, instead of the default response', async () => {
    const payments = buildMockPayments()
    const onAfterVerify = jest.fn().mockRejectedValue(new Error('seller hook bug'))
    const onPaymentError = jest.fn((_error: Error, _req: any, res: any) => {
      res.status(503).json({ error: 'custom handler' })
    })
    const { port, close } = await startServer(payments, { onAfterVerify, onPaymentError })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(onPaymentError).toHaveBeenCalledTimes(1)
      expect(onPaymentError.mock.calls[0][0].message).toMatch(/seller hook bug/)
      expect(response.status).toBe(503)
    } finally {
      await close()
    }
  })

  it('still lets a well-behaved onAfterVerify serve the handler normally', async () => {
    const payments = buildMockPayments()
    const onAfterVerify = jest.fn().mockResolvedValue(undefined)
    const { port, close } = await startServer(payments, { onAfterVerify })
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(200)
      expect(onAfterVerify).toHaveBeenCalledTimes(1)
    } finally {
      await close()
    }
  })
})

describe('MPP PaymentContext observability fields', () => {
  it('carries agentRequest and agentRequestId, like the x402 path', async () => {
    const payments = buildMockPayments()
    const { port, close } = await startServer(payments)
    try {
      const response = await post(port, { authorization: CREDENTIAL })
      expect(response.status).toBe(200)
      const { paymentContext } = await response.json()
      expect(paymentContext.agentRequestId).toBe('req-1')
      expect(paymentContext.agentRequest).toEqual({ agentRequestId: 'req-1', agentId: 'agent-1' })
    } finally {
      await close()
    }
  })
})
