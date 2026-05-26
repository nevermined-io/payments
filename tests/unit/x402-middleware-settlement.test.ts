/**
 * Unit tests for the x402 paymentMiddleware settlement hook.
 *
 * Regression coverage for #1728: settlement used to be wired through a
 * `res.json` monkey-patch only, so handlers responding with `res.send`,
 * `res.sendFile`, `res.end`, or a stream pipe delivered the resource
 * without burning credits. The current implementation wraps `res.end`
 * (the common terminator for all response methods) so settlement runs
 * regardless of how the handler responds.
 */

import express from 'express'
import type { Request, Response } from 'express'
import http from 'http'
import { paymentMiddleware, X402_HEADERS } from '../../src/x402/express/index.js'

// Use the same mock token shape the rest of the test suite uses so the
// middleware's verify call gets past the shape checks.
const MOCK_TOKEN = 'mock-x402-token'

// Minimal stub of the Payments API surface the middleware reaches into.
function buildMockPayments(opts: { settleSpy: jest.Mock; verifySpy?: jest.Mock }) {
  const verify =
    opts.verifySpy ??
    jest.fn().mockResolvedValue({ isValid: true, agentRequest: undefined, agentRequestId: 'req-1' })
  return {
    facilitator: {
      verifyPermissions: verify,
      settlePermissions: opts.settleSpy,
    },
    getEnvironmentName: () => 'staging_sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: false } } }) },
  } as any
}

async function startServer(handler: (req: Request, res: Response) => void, settleSpy: jest.Mock) {
  const app = express()
  app.use(express.json())
  app.use(
    paymentMiddleware(buildMockPayments({ settleSpy }), {
      'POST /protected': { planId: '12345', credits: 1, scheme: 'nvm:card-delegation' },
    }),
  )
  app.post('/protected', handler)

  const server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}

async function postWithToken(port: number): Promise<{
  status: number
  body: string
  paymentResponseHeader: string | undefined
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/protected',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [X402_HEADERS.PAYMENT_SIGNATURE]: MOCK_TOKEN,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            paymentResponseHeader:
              (res.headers[X402_HEADERS.PAYMENT_RESPONSE] as string) ?? undefined,
          })
        })
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify({ ask: 'hello' }))
  })
}

describe('paymentMiddleware settlement coverage (#1728)', () => {
  const baseSettlement = {
    success: true,
    creditsRedeemed: '1',
    orderTx: '0xabc',
  }

  test('settles when handler uses res.json', async () => {
    const settleSpy = jest.fn().mockResolvedValue(baseSettlement)
    const { port, close } = await startServer((req, res) => {
      res.json({ ok: true })
    }, settleSpy)

    try {
      const result = await postWithToken(port)
      expect(result.status).toBe(200)
      expect(settleSpy).toHaveBeenCalledTimes(1)
      expect(result.paymentResponseHeader).toBeDefined()
    } finally {
      await close()
    }
  })

  test('settles when handler uses res.send', async () => {
    const settleSpy = jest.fn().mockResolvedValue(baseSettlement)
    const { port, close } = await startServer((req, res) => {
      res.send('plain text body')
    }, settleSpy)

    try {
      const result = await postWithToken(port)
      expect(result.status).toBe(200)
      expect(result.body).toBe('plain text body')
      expect(settleSpy).toHaveBeenCalledTimes(1)
      expect(result.paymentResponseHeader).toBeDefined()
    } finally {
      await close()
    }
  })

  test('settles when handler uses res.end directly', async () => {
    const settleSpy = jest.fn().mockResolvedValue(baseSettlement)
    const { port, close } = await startServer((req, res) => {
      res.status(200).end('raw end body')
    }, settleSpy)

    try {
      const result = await postWithToken(port)
      expect(result.status).toBe(200)
      expect(result.body).toBe('raw end body')
      expect(settleSpy).toHaveBeenCalledTimes(1)
    } finally {
      await close()
    }
  })

  test('settles when handler streams via res.write + res.end', async () => {
    const settleSpy = jest.fn().mockResolvedValue(baseSettlement)
    const { port, close } = await startServer((req, res) => {
      res.setHeader('content-type', 'text/plain')
      res.write('chunk-1')
      res.write('-chunk-2')
      res.end()
    }, settleSpy)

    try {
      const result = await postWithToken(port)
      expect(result.status).toBe(200)
      expect(result.body).toBe('chunk-1-chunk-2')
      // Headers were flushed before settlement so the receipt cannot be
      // attached, but settlement MUST still run so the buyer is billed.
      expect(settleSpy).toHaveBeenCalledTimes(1)
    } finally {
      await close()
    }
  })

  test('does NOT settle when handler returns 4xx', async () => {
    const settleSpy = jest.fn().mockResolvedValue(baseSettlement)
    const { port, close } = await startServer((req, res) => {
      res.status(422).send({ error: 'bad shape' })
    }, settleSpy)

    try {
      const result = await postWithToken(port)
      expect(result.status).toBe(422)
      expect(settleSpy).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  test('does NOT settle when handler redirects (3xx)', async () => {
    // Regression for #359 review: the old res.json-only interception never
    // fired on res.redirect(...); the res.end wrapper must keep that
    // behaviour and skip 3xx so a redirect doesn't burn credits.
    const settleSpy = jest.fn().mockResolvedValue(baseSettlement)
    const { port, close } = await startServer((req, res) => {
      res.redirect(302, '/elsewhere')
    }, settleSpy)

    try {
      const result = await postWithToken(port)
      expect(result.status).toBe(302)
      expect(settleSpy).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })
})
