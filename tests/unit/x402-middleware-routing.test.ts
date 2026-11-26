/**
 * Route protection for the Express middleware (#519).
 *
 * `paymentMiddleware` matched request paths more strictly than Express's own
 * router, so a request Express sent to a protected handler (`POST /ASK`,
 * `POST /ask/`, `HEAD` on a `GET` route) could miss every key and reach the
 * handler unpaid. `paywall` lets Express do the matching; the map form now
 * matches fail-closed and refuses key syntax it cannot match.
 */

import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { paymentMiddleware, paywall, X402_HEADERS } from '../../src/x402/express/index.js'
import type { PaymentContext, RouteConfigMap } from '../../src/x402/express/index.js'
import type {
  SettlePermissionsResult,
  VerifyPermissionsResult,
} from '../../src/x402/facilitator-api.js'

const TOKEN = 'mock-x402-token'

const VALID_VERIFICATION = {
  isValid: true,
  agentRequestId: 'req-1',
} satisfies VerifyPermissionsResult

const VALID_SETTLEMENT = {
  success: true,
  transaction: '0xsettletx',
  network: 'eip155:84532',
  creditsRedeemed: '1',
} satisfies SettlePermissionsResult

function buildMockPayments(opts: { verifySpy?: jest.Mock; settleSpy?: jest.Mock } = {}) {
  return {
    facilitator: {
      verifyPermissions: opts.verifySpy ?? jest.fn().mockResolvedValue(VALID_VERIFICATION),
      settlePermissions: opts.settleSpy ?? jest.fn().mockResolvedValue(VALID_SETTLEMENT),
    },
    getEnvironmentName: () => 'sandbox',
    plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: false } } }) },
  } as any
}

const ROUTE = { planId: '123', credits: 1, scheme: 'nvm:card-delegation' as const }

describe('paywall (per-route)', () => {
  test('returns 402 without a token and does not run the handler', async () => {
    const handler = jest.fn((_req: Request, res: Response) => res.json({ answer: 'paid' }))
    const app = express()
    app.post('/ask', paywall(buildMockPayments(), ROUTE), handler)

    const res = await request(app).post('/ask')

    expect(res.status).toBe(402)
    expect(res.headers[X402_HEADERS.PAYMENT_REQUIRED]).toBeDefined()
    expect(handler).not.toHaveBeenCalled()
  })

  test('verifies, runs the handler with req.paymentContext, and settles', async () => {
    const settleSpy = jest.fn().mockResolvedValue(VALID_SETTLEMENT)
    let seen: PaymentContext | undefined
    const app = express()
    app.post('/ask', paywall(buildMockPayments({ settleSpy }), ROUTE), (req, res) => {
      seen = (req as Request & { paymentContext?: PaymentContext }).paymentContext
      res.json({ answer: 'paid' })
    })

    const res = await request(app).post('/ask').set(X402_HEADERS.PAYMENT_SIGNATURE, TOKEN)

    expect(res.status).toBe(200)
    expect(seen?.verified).toBe(true)
    expect(settleSpy).toHaveBeenCalledTimes(1)
    expect(settleSpy).toHaveBeenCalledWith(expect.objectContaining({ maxAmount: 1n }))
    expect(res.headers[X402_HEADERS.PAYMENT_RESPONSE]).toBeDefined()
  })

  test('honors a credits function', async () => {
    const verifySpy = jest.fn().mockResolvedValue(VALID_VERIFICATION)
    const app = express()
    app.post(
      '/ask',
      paywall(buildMockPayments({ verifySpy }), { ...ROUTE, credits: () => 3 }),
      (_req, res) => res.json({ ok: true }),
    )

    await request(app).post('/ask').set(X402_HEADERS.PAYMENT_SIGNATURE, TOKEN)

    expect(verifySpy).toHaveBeenCalledWith(expect.objectContaining({ maxAmount: 3n }))
  })

  test('forwards an async error from a credits function to next', async () => {
    const handler = jest.fn((_req: Request, res: Response) => res.json({ answer: 'paid' }))
    const credits = (): number => {
      throw new Error('credits boom')
    }
    const app = express()
    app.post('/ask', paywall(buildMockPayments(), { ...ROUTE, credits }), handler)
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ err: err.message })
    })

    const res = await request(app).post('/ask').set(X402_HEADERS.PAYMENT_SIGNATURE, TOKEN)

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ err: 'credits boom' })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('paymentMiddleware route matching (#519)', () => {
  function protectedApp(
    routes: RouteConfigMap,
    register: (app: express.Express, h: jest.Mock) => void,
  ) {
    const verifySpy = jest.fn().mockResolvedValue(VALID_VERIFICATION)
    const handler = jest.fn((_req: Request, res: Response) => res.json({ answer: 'paid' }))
    const app = express()
    app.use(paymentMiddleware(buildMockPayments({ verifySpy }), routes))
    register(app, handler)
    return { app, handler, verifySpy }
  }

  function advertisedPlanId(res: request.Response): string {
    const header = res.headers[X402_HEADERS.PAYMENT_REQUIRED] as string
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString())
    return decoded.accepts[0].planId
  }

  it.each(['/ask', '/ASK', '/ask/', '/Ask/'])(
    'POST %s returns 402 and never runs the handler',
    async (path) => {
      const { app, handler } = protectedApp({ 'POST /ask': ROUTE }, (a, h) => a.post('/ask', h))

      const res = await request(app).post(path)

      expect(res.status).toBe(402)
      expect(handler).not.toHaveBeenCalled()
    },
  )

  test('HEAD on a GET key returns 402', async () => {
    const { app, handler } = protectedApp({ 'GET /doc': ROUTE }, (a, h) => a.get('/doc', h))

    const res = await request(app).head('/doc')

    expect(res.status).toBe(402)
    expect(handler).not.toHaveBeenCalled()
  })

  test('lower-case method in a key still protects', async () => {
    const { app, handler } = protectedApp({ 'post /ask': ROUTE }, (a, h) => a.post('/ask', h))

    const res = await request(app).post('/ask')

    expect(res.status).toBe(402)
    expect(handler).not.toHaveBeenCalled()
  })

  it.each(['/users/42', '/USERS/42/'])('param key matches GET %s', async (path) => {
    const { app, handler } = protectedApp({ 'GET /users/:id': ROUTE }, (a, h) =>
      a.get('/users/:id', h),
    )

    const res = await request(app).get(path)

    expect(res.status).toBe(402)
    expect(handler).not.toHaveBeenCalled()
  })

  test('literal key wins over a param key regardless of order', async () => {
    const { app } = protectedApp(
      {
        'GET /files/:id': { ...ROUTE, planId: 'p-param' },
        'GET /files/latest': { ...ROUTE, planId: 'p-literal' },
      },
      (a, h) => a.get('/files/:id', h),
    )

    const res = await request(app).get('/files/latest')

    expect(res.status).toBe(402)
    expect(advertisedPlanId(res)).toBe('p-literal')
  })

  test('unprotected routes pass through', async () => {
    const { app, verifySpy } = protectedApp({ 'POST /ask': ROUTE }, (a) =>
      a.get('/health', (_req, res) => res.json({ ok: true })),
    )

    const res = await request(app).get('/health')

    expect(res.status).toBe(200)
    expect(verifySpy).not.toHaveBeenCalled()
  })

  test('mounted under a prefix: POST /api/ASK returns 402', async () => {
    const handler = jest.fn((_req: Request, res: Response) => res.json({ answer: 'paid' }))
    const app = express()
    app.use('/api', paymentMiddleware(buildMockPayments(), { 'POST /ask': ROUTE }))
    app.post('/api/ask', handler)

    const res = await request(app).post('/api/ASK')

    expect(res.status).toBe(402)
    expect(handler).not.toHaveBeenCalled()
  })

  test('root key: GET / returns 402', async () => {
    const { app, handler } = protectedApp({ 'GET /': ROUTE }, (a, h) => a.get('/', h))

    const res = await request(app).get('/')

    expect(res.status).toBe(402)
    expect(handler).not.toHaveBeenCalled()
  })

  test('percent-encoded path never reaches the handler', async () => {
    const { app, handler } = protectedApp({ 'POST /ask': ROUTE }, (a, h) => a.post('/ask', h))

    const res = await request(app).post('/%61sk')

    expect(res.status).toBe(404)
    expect(handler).not.toHaveBeenCalled()
  })

  // A router mounted at a prefix swallows an extra slash after it: Express
  // serves `/v1//ask` from `router.post('/ask')`.
  it.each([
    ['POST /v1/ask', '/v1', 'post', '/ask', '/v1//ask'],
    ['POST /v1', '/v1', 'post', '/', '/v1//'],
    ['GET /users/:uid/profile', '/users/:uid', 'get', '/profile', '/users/42//profile'],
  ] as const)(
    'key %p, router at %p: a doubled slash after the prefix still pays',
    async (key, mount, method, routePath, requestPath) => {
      const handler = jest.fn((_req: Request, res: Response) => res.json({ answer: 'paid' }))
      const router = express.Router()
      router[method](routePath, handler)
      const app = express()
      app.use(paymentMiddleware(buildMockPayments(), { [key]: ROUTE }))
      app.use(mount, router)

      const res = await request(app)[method](requestPath)

      expect(res.status).toBe(402)
      expect(handler).not.toHaveBeenCalled()
    },
  )

  it.each([
    'GET /files/*',
    'ALL /ask',
    'PSOT /ask',
    'GET /price$',
    'GET /a|b',
    'GET /a\\b',
    'GET /a^b',
    'GET /f/:name.csv',
    'GET /a/(x)',
    'GET /a/:id?',
    'GET /a{/:id}',
    'GET /a/[x]',
    'POST',
    'POST ask',
    'POST  /ask',
  ])('refuses key %p at creation', (key) => {
    expect(() => paymentMiddleware(buildMockPayments(), { [key]: ROUTE })).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(new RegExp(`${escapeRegExp(key)}[\\s\\S]*paywall`)),
      }),
    )
  })

  it.each([
    [{ 'POST /ask': ROUTE, 'POST /ASK/': ROUTE }],
    [{ 'GET /u/:id': ROUTE, 'GET /u/:name': ROUTE }],
  ])('refuses keys that collide after normalization: %p', (routes) => {
    expect(() => paymentMiddleware(buildMockPayments(), routes)).toThrow()
  })
})

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
