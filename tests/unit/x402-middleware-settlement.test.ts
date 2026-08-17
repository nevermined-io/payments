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
import net from 'net'
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

  test('does NOT settle when the buyer disconnects before any of the response is delivered', async () => {
    // A route declared with `mpp: true` advertises BOTH protocols on the same
    // 402, so the two branches of this middleware have to answer the same
    // disconnect the same way. The MPP branch gained a delivery gate; without
    // the same gate here an x402 buyer who hangs up is still charged, because
    // an aborted request keeps `res.statusCode === 200` all the way through
    // the `res.end` wrapper.
    const settleSpy = jest.fn().mockResolvedValue(baseSettlement)
    let releaseHandler: () => void = () => undefined
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { port, close } = await startServer(async (_req, res) => {
      await handlerGate
      res.json({ answer: 'ok' })
    }, settleSpy)

    try {
      // A raw socket, not fetch + AbortController: undici does not reliably
      // tear down the server-side connection, so `res.destroyed` can still be
      // false in the handler and the disconnect never reaches the code.
      const body = JSON.stringify({ ask: 'hello' })
      const socket = net.connect(port, '127.0.0.1')
      socket.on('error', () => undefined)
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
      socket.write(
        `POST /protected HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\ncontent-type: application/json\r\n` +
          `${X402_HEADERS.PAYMENT_SIGNATURE}: ${MOCK_TOKEN}\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      )
      await new Promise((r) => setTimeout(r, 60))
      socket.destroy()
      // Let the server's event loop observe the close before the handler
      // writes — `res.destroyed` flips when Node processes it, not when the
      // peer hangs up.
      await new Promise((r) => setTimeout(r, 60))

      releaseHandler()
      await new Promise((r) => setTimeout(r, 80))

      expect(settleSpy).not.toHaveBeenCalled()
    } finally {
      releaseHandler()
      warn.mockRestore()
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
