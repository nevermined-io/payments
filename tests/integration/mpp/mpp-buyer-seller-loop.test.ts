/**
 * The buyer helper against the real seller middleware, with only the backend
 * stubbed. This is the test that would catch a header-name mismatch between
 * the two halves — the buyer sends the credential under `Authorization`, the
 * seller reads it from there and forwards it to `/api/v1/mpp/verify`
 * untouched — since the assertion below decodes the forwarded credential and
 * checks its sealed `challenge.request` still matches the base64 the
 * challenge carried. (The codec's own byte-for-byte round-trip guarantee is
 * covered by the Task 1 unit tests; this test covers the wiring between the
 * buyer and seller halves, not the codec itself.)
 *
 * The rejection and expiry tests below assert against the wire contract the
 * seller middleware now implements (landed via the sibling PR #417/#2643,
 * confirmed present in this tree — `grep -n "code" src/x402/express/middleware.ts`
 * has hits): a 402 answering a request that presented a credential always
 * carries a `code` — `BCK.MPP.0003` on a resolved `{ isValid: false }`, or
 * the backend's own `BCK.MPP.*` code (e.g. `BCK.MPP.0004`, preserved and not
 * flattened into 0003) when `verifyCredential` itself throws — while the very
 * first (no-credential) challenge carries none. Because every credential-
 * bearing rejection now carries a defined code, the buyer's identical-
 * challenge-id fallback (used only when a re-challenge carries NO code at
 * all) is never exercised through this real, contract-compliant seller; it
 * remains covered — correctly, not as a stand-in for this seller's specific
 * behaviour — by the raw-stub tests in tests/unit/mpp/mpp-fetch.test.ts,
 * which model a third-party or non-compliant seller instead.
 */
import express from 'express'
import http from 'http'
import { Payments } from '../../../src/payments.js'
import { paymentMiddleware } from '../../../src/x402/express/index.js'
import { MppCredentialRejectedError } from '../../../src/mpp/errors.js'

const CHALLENGE_REQUEST_ENCODED = 'eyJjcmVkaXRzIjoiMiIsInBsYW5JZCI6IjEyMyJ9'

/** Builds a challenge header with a given id — the real backend mints a fresh, distinct id every time. */
function challengeHeaderFor(id: string): string {
  return (
    `Payment id="${id}", realm="api.nevermined.app", method="nevermined", intent="charge", ` +
    `request="${CHALLENGE_REQUEST_ENCODED}", expires="2999-01-01T00:00:00.000Z"`
  )
}

type VerifyMode = 'valid' | 'invalid' | 'expire-once'

describe('MPP buyer pays the SDK seller middleware', () => {
  let realFetch: typeof fetch
  let server: http.Server
  let port: number
  let payments: Payments
  let verifyBody: any
  let verifyMode: VerifyMode = 'valid'
  let verifyCallCount = 0
  let permissionMints = 0
  // Not reset between tests, mirroring the real backend: challenge ids are
  // never reused across issueChallenge calls, even across what a single
  // buyer call perceives as "the same" 402 exchange.
  let challengeCallCount = 0

  beforeAll(async () => {
    realFetch = global.fetch
    payments = Payments.getInstance({
      nvmApiKey: 'eyJhbGciOiJIUzI1NiJ9.e30.sig',
      environment: 'sandbox',
    } as any)

    global.fetch = (async (url: any, init: any) => {
      const href = String(url)
      if (href.includes('127.0.0.1')) return realFetch(url, init)
      if (href.includes('/api/v1/mpp/challenge')) {
        challengeCallCount += 1
        const id = `c${challengeCallCount}`
        return new Response(JSON.stringify({ challenge: challengeHeaderFor(id), id }), { status: 201 })
      }
      if (href.includes('/api/v1/mpp/permissions')) {
        permissionMints += 1
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      }
      if (href.includes('/api/v1/mpp/verify')) {
        verifyCallCount += 1
        // Captured so the happy-path test can assert the seller middleware
        // forwards the buyer's credential — and the sealed challenge request
        // inside it — untouched, rather than just trusting a stubbed success.
        verifyBody = JSON.parse(init.body)
        if (verifyMode === 'valid') return new Response(JSON.stringify({ isValid: true }), { status: 201 })
        if (verifyMode === 'invalid')
          return new Response(
            JSON.stringify({ isValid: false, invalidReason: 'Credential rejected' }),
            { status: 201 },
          )
        // 'expire-once': the FIRST verify call answers with the backend's own
        // BCK.MPP.0004 (expired) rejection — verifyCredential throws
        // MppChallengeExpiredError, and middleware.ts's catch block forwards
        // that exact code on the 402 it sends. The retry's verify call (after
        // the buyer mints against the fresh challenge) succeeds normally.
        if (verifyCallCount === 1)
          return new Response(JSON.stringify({ code: 'BCK.MPP.0004', message: 'Challenge expired' }), {
            status: 402,
          })
        return new Response(JSON.stringify({ isValid: true }), { status: 201 })
      }
      if (href.includes('/api/v1/mpp/settle'))
        return new Response(
          JSON.stringify({
            success: true,
            transaction: '0x1',
            network: 'eip155:84532',
            creditsRedeemed: '2',
            paymentReceipt:
              'eyJtZXRob2QiOiJuZXZlcm1pbmVkIiwicmVmZXJlbmNlIjoiYzEiLCJzdGF0dXMiOiJzdWNjZXNzIiwidGltZXN0YW1wIjoiMjAyNi0wOC0xMlQxMDowMDozMC4wMDBaIn0',
          }),
          { status: 201 },
        )
      throw new Error(`unexpected fetch: ${href}`)
    }) as any

    const app = express()
    app.use(express.json())
    app.use(paymentMiddleware(payments, { 'POST /ask': { planId: '123', credits: 2, mpp: true } }))
    app.post('/ask', (_req, res) => res.json({ answer: '42' }))

    server = http.createServer(app)
    await new Promise<void>((r) => server.listen(0, r))
    port = (server.address() as any).port
  })

  afterAll(async () => {
    global.fetch = realFetch
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('pays and gets the answer plus a receipt', async () => {
    permissionMints = 0
    const { response, receipt, paid, settled, credentialsPresented } = await payments.mpp.fetch(
      `http://127.0.0.1:${port}/ask`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { delegationConfig: { delegationId: 'del-1' } },
    )

    expect(paid).toBe(true)
    expect(settled).toBe(true)
    expect(credentialsPresented).toBe(1)
    expect(await response.json()).toEqual({ answer: '42' })
    expect(receipt?.reference).toBe('c1')

    // The seller middleware must forward the buyer's credential to /verify
    // as-is — the base64url `request` sealed in the credential's `challenge`
    // is what the backend re-derives the challenge id's HMAC from, so it has
    // to survive the buyer-mint -> Authorization header -> seller-forward
    // trip untouched.
    expect(verifyBody.credential).toMatch(/^Payment /)
    const decodedCredential = JSON.parse(
      Buffer.from(verifyBody.credential.slice('Payment '.length), 'base64url').toString('utf8'),
    )
    expect(decodedCredential.challenge.request).toBe(CHALLENGE_REQUEST_ENCODED)
  })

  it('surfaces MppCredentialRejectedError, not a second mint, when the seller rejects a credential', async () => {
    verifyMode = 'invalid'
    permissionMints = 0
    try {
      // The seller's BCK.MPP.0003 code is now always attached to this
      // rejection (verification.isValid === false always carries it — see
      // middleware.ts), so the buyer resolves it to the specific typed error,
      // not just the MppError base class. The regression this guards against
      // — minting a SECOND credential for a rejection the first one already
      // proved terminal — is what `permissionMints` pins.
      await expect(
        payments.mpp.fetch(
          `http://127.0.0.1:${port}/ask`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
          { delegationConfig: { delegationId: 'del-1' } },
        ),
      ).rejects.toBeInstanceOf(MppCredentialRejectedError)
      expect(permissionMints).toBe(1)
    } finally {
      verifyMode = 'valid'
    }
  })

  it('retries exactly once on a BCK.MPP.0004 rejection with a genuinely fresh challenge, and settles', async () => {
    verifyMode = 'expire-once'
    verifyCallCount = 0
    permissionMints = 0
    try {
      const result = await payments.mpp.fetch(
        `http://127.0.0.1:${port}/ask`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        { delegationConfig: { delegationId: 'del-1' } },
      )

      expect(result.paid).toBe(true)
      expect(result.settled).toBe(true)
      // Exactly one re-challenge cycle: the buyer minted against the
      // original challenge, was told BCK.MPP.0004 with a fresh challenge,
      // minted again against THAT one, and it settled. Not more, not fewer.
      expect(result.credentialsPresented).toBe(2)
      expect(permissionMints).toBe(2)
      expect(verifyCallCount).toBe(2)
    } finally {
      verifyMode = 'valid'
    }
  })
})
