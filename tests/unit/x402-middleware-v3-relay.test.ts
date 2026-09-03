/**
 * Regression coverage: the seller relays a v3 access token byte-for-byte.
 *
 * A v3 token is signed over `agentId`, `resourceUrl`, `httpVerb` and a one-time
 * `nonce`, and the backend rejects any envelope that disagrees with the signed
 * values as forgery (`BCK.X402.0005`). The seller side therefore has no
 * protocol change to make — but it also must not "helpfully" normalise, re-encode
 * or trim the token on its way to verify/settle. This pins that: whatever the
 * buyer put in `payment-signature` is exactly what reaches the facilitator, and
 * the same string reaches both calls.
 *
 * See nevermined-io/payments#427 and nvm-monorepo#2646.
 */

import express from 'express'
import type { Request, Response } from 'express'
import http from 'http'
import { paymentMiddleware, X402_HEADERS } from '../../src/x402/express/index.js'

/**
 * A real v3 envelope, base64 of compact JSON — long, padded, and containing
 * `+`/`/` characters after encoding, so any re-encoding or url-safe rewrite on
 * the relay path shows up as a mismatch.
 */
const V3_TOKEN = Buffer.from(
  JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      planId: '12345',
      extra: { version: '1', agentId: 'agent-1', httpVerb: 'POST' },
    },
    payload: {
      signature: `0x${'ab'.repeat(32)}`,
      authorization: {
        from: '0x21F79f9d3b6d52eF8cc8B1a7F261Bcf5f2EF354a',
        sessionKeysProvider: 'zerodev',
        sessionKeys: [],
        agentId: 'agent-1',
        resourceUrl: 'https://seller.example/protected',
        httpVerb: 'POST',
        nonce: '0xfeedface00ff',
      },
    },
    extensions: {},
  }),
).toString('base64')

function buildMockPayments(verifySpy: jest.Mock, settleSpy: jest.Mock) {
  return {
    facilitator: { verifyPermissions: verifySpy, settlePermissions: settleSpy },
    getEnvironmentName: () => 'staging_sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: true } } }) },
  } as any
}

async function startServer(verifySpy: jest.Mock, settleSpy: jest.Mock) {
  const app = express()
  app.use(express.json())
  app.use(
    paymentMiddleware(buildMockPayments(verifySpy, settleSpy), {
      'POST /protected': { planId: '12345', credits: 1 },
    }),
  )
  app.post('/protected', (_req: Request, res: Response) => res.json({ answer: 'ok' }))

  const server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}

async function postWithToken(port: number, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/protected',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [X402_HEADERS.PAYMENT_SIGNATURE]: token,
        },
      },
      (res) => {
        res.on('data', () => undefined)
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify({ query: 'hello' }))
  })
}

describe('paymentMiddleware — v3 token relay', () => {
  test('the token reaches verify and settle byte-for-byte', async () => {
    const verifySpy = jest
      .fn()
      .mockResolvedValue({ isValid: true, agentRequestId: 'req-1', agentRequest: undefined })
    const settleSpy = jest.fn().mockResolvedValue({
      success: true,
      transaction: '0xtx',
      network: 'eip155:84532',
      creditsRedeemed: '1',
    })
    const { port, close } = await startServer(verifySpy, settleSpy)

    try {
      const status = await postWithToken(port, V3_TOKEN)
      expect(status).toBe(200)

      // Settlement runs on res.end, which can land just after the response is
      // flushed to the client.
      await new Promise((r) => setTimeout(r, 200))

      expect(verifySpy).toHaveBeenCalledTimes(1)
      expect(settleSpy).toHaveBeenCalledTimes(1)
      const relayedToVerify = verifySpy.mock.calls[0][0].x402AccessToken
      const relayedToSettle = settleSpy.mock.calls[0][0].x402AccessToken
      expect(relayedToVerify).toBe(V3_TOKEN)
      expect(relayedToSettle).toBe(V3_TOKEN)
      // Same string on both legs: the nonce a v3 token is spent by must be the
      // one that was verified.
      expect(relayedToSettle).toBe(relayedToVerify)
    } finally {
      await close()
    }
  })
})
