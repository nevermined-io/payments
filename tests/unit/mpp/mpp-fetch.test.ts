/**
 * Buyer flow: a 402 challenge is paid with an MPP credential minted from the
 * caller's existing Nevermined delegation, and the request is retried once.
 *
 * PR #418 review, round 3: these tests pin the money-path guards the
 * mutation-testing evidence in the review showed were previously unpinned —
 * the re-challenge gate, the honest `paid`/`settled`/`credentialsPresented`
 * bookkeeping, the credits cap, the malformed-challenge/receipt handling, the
 * Authorization-append behaviour and the PaymentsError/MppError split.
 */
import { MppAPI } from '../../../src/mpp/mpp-api.js'
import {
  MppCredentialRejectedError,
  MppError,
  MppSpendOutcomeUnknownError,
  isRetryableMppCode,
  mppSpendOf,
} from '../../../src/mpp/errors.js'
import { PaymentsError } from '../../../src/common/payments.error.js'

const OPTIONS = { nvmApiKey: 'eyJhbGciOiJIUzI1NiJ9.e30.sig', environment: 'sandbox' } as any

const REQUEST_ENCODED =
  'eyJjcmVkaXRzIjoiMiIsInBsYW5JZCI6IjQ0NzQyNzYzMDc2MDQ3NDk3NjQwMDgwMjMwMjM2NzgxNDc0MTI5OTcwOTkyNzI3ODk2NTkzODYxOTk3MzQ3MTM1NjEzMTM1NTcxMDcifQ'
const OPAQUE_ENCODED =
  'eyJfbXBweF9zY29wZSI6IlBPU1QgL2FzayIsIm5vbmNlIjoiMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1In0'

/** Builds a `WWW-Authenticate: Payment …` value with a given id, credits and planId. */
function challengeHeader(
  id: string,
  requestEncoded: string = REQUEST_ENCODED,
  expires = '2026-08-12T10:05:00.000Z',
) {
  return (
    `Payment id="${id}", realm="api.nevermined.app", ` +
    'method="nevermined", intent="charge", ' +
    `request="${requestEncoded}", ` +
    `expires="${expires}", ` +
    `opaque="${OPAQUE_ENCODED}"`
  )
}

/** Encodes an arbitrary `request` payload the way the codec expects it, for shape-validation tests. */
function encodeRequest(request: unknown): string {
  return Buffer.from(JSON.stringify(request), 'utf8').toString('base64url')
}

const CHALLENGE_HEADER = challengeHeader('CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og')
const CHALLENGE_HEADER_2 = challengeHeader('fresh-challenge-2')
const CHALLENGE_HEADER_3 = challengeHeader('fresh-challenge-3')

const RECEIPT_HEADER =
  'eyJtZXRob2QiOiJuZXZlcm1pbmVkIiwicmVmZXJlbmNlIjoiQ1Fzek9uZ2Z2VDFSSUdTYWppcFpKdmctbEJDRUR1Z1dMREY3U0RfdzFvZyIsInN0YXR1cyI6InN1Y2Nlc3MiLCJ0aW1lc3RhbXAiOiIyMDI2LTA4LTEyVDEwOjAwOjMwLjAwMFoifQ'

const PLAN_ID = '4474276307604749764008023023678147412997099272789659386199734713561313557107'
const FETCH_OPTIONS = { delegationConfig: { delegationId: 'del-1' } } as any

function challenge402(
  header: string = CHALLENGE_HEADER,
  body: unknown = { error: 'Payment Required' },
) {
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: { 'www-authenticate': header, 'content-type': 'application/json' },
  })
}

function paid200() {
  return new Response(JSON.stringify({ answer: '42' }), {
    status: 200,
    headers: { 'payment-receipt': RECEIPT_HEADER },
  })
}

function mintStub(mintsCounter: { count: number }) {
  return async () => {
    mintsCounter.count += 1
    return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
  }
}

describe('MppAPI.fetch — happy path', () => {
  it('pays a 402 and retries once with the credential, reporting settlement honestly', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    global.fetch = (async (url: any, init: any) => {
      const href = String(url)
      const headers = Object.fromEntries(new Headers(init?.headers ?? {}).entries())
      calls.push({ url: href, headers })
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      return calls.filter((c) => c.url.includes('/ask')).length === 1 ? challenge402() : paid200()
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      { method: 'POST', body: '{}' },
      FETCH_OPTIONS,
    )

    expect(result.paid).toBe(true)
    expect(result.settled).toBe(true)
    expect(result.credentialsPresented).toBe(1)
    expect(result.response.status).toBe(200)
    expect(result.receipt?.reference).toBe('CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og')

    const retry = calls.filter((c) => c.url.includes('/ask'))[1]
    expect(retry.headers['authorization']).toMatch(/^Payment /)
  })

  it('reads the plan out of the sealed challenge', async () => {
    let mintBody: any
    global.fetch = (async (url: any, init: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) {
        mintBody = JSON.parse(init.body)
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      }
      return mintBody ? paid200() : challenge402()
    }) as any

    await MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS)
    expect(mintBody.accepted.planId).toBe(PLAN_ID)
  })

  it('returns a non-402 response untouched without minting anything', async () => {
    const spy = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    global.fetch = spy as any
    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )
    expect(result.paid).toBe(false)
    expect(result.settled).toBe(false)
    expect(result.credentialsPresented).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('returns a 402 that carries no www-authenticate header at all, untouched', async () => {
    global.fetch = (async () => new Response('nope', { status: 402 })) as any
    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )
    expect(result.paid).toBe(false)
    expect(result.credentialsPresented).toBe(0)
    expect(result.response.status).toBe(402)
  })

  it('returns a 402 whose www-authenticate carries a non-Payment scheme, untouched', async () => {
    global.fetch = (async () =>
      new Response('nope', {
        status: 402,
        headers: { 'www-authenticate': 'Bearer realm="x"' },
      })) as any
    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )
    expect(result.paid).toBe(false)
    expect(result.credentialsPresented).toBe(0)
    expect(result.response.status).toBe(402)
  })
})

describe('MppAPI.fetch — the re-challenge gate defaults to STOP (blocker: fail-open gate)', () => {
  it('does not silently re-mint when a seller rejects without a code field (identical challenge id replayed)', async () => {
    // `{ error, message }`, no `code` — the shape a third-party seller sends,
    // and one THIS repo's seller sends too: middleware.ts forwards a code only
    // when it starts with `BCK.MPP.`, so a verify-side infrastructure failure
    // (whose synthesized code is `network_error`/`http_${status}`) reaches the
    // buyer as a codeless 402. That is precisely why the codeless case is not
    // terminal by itself — see the fresh-id test below.
    //
    // What IS terminal, and what this test pins, is a codeless 402 replaying the
    // IDENTICAL challenge id: the seller is refusing the credential it just
    // issued a challenge for, so minting against that same challenge again
    // cannot help and would only spend twice. Same header on both turns.
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      return challenge402(CHALLENGE_HEADER, {
        error: 'Payment Required',
        message: 'Credential rejected',
      })
    }) as any

    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS),
    ).rejects.toThrow(/rejected/i)
    expect(mints.count).toBe(1)
  })

  it('mints once per genuinely fresh re-challenge (different id, no code), then stops at the loop bound', async () => {
    // Exercises the id-freshness fallback specifically (no `code` on either
    // 402) — the same-shaped, real-seller-with-a-code equivalent of this
    // scenario (a BCK.MPP.0004 rejection retried exactly once, mints === 2)
    // is covered against the actual middleware in
    // tests/integration/mpp/mpp-buyer-seller-loop.test.ts.
    let asked = 0
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      if (asked === 1) return challenge402(CHALLENGE_HEADER)
      if (asked === 2) return challenge402(CHALLENGE_HEADER_2)
      return challenge402(CHALLENGE_HEADER_3)
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )

    // Pin the money, not just the request count: two credentials were minted
    // and presented, and the result must say so honestly.
    expect(mints.count).toBe(2)
    expect(result.credentialsPresented).toBe(2)
    expect(result.settled).toBe(false)
    expect(result.paid).toBe(false)
    expect(result.response.status).toBe(402)
    expect(asked).toBe(3)
  })

  it('surfaces a coded rejection as MppCredentialRejectedError, terminal with exactly 1 mint', async () => {
    let served = 0
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      served += 1
      if (served === 1) return challenge402()
      return new Response(
        JSON.stringify({ code: 'BCK.MPP.0003', message: 'Credential rejected' }),
        {
          status: 402,
          headers: { 'content-type': 'application/json' },
        },
      )
    }) as any

    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS),
    ).rejects.toBeInstanceOf(MppCredentialRejectedError)
    expect(mints.count).toBe(1)
  })

  it('retries on an explicit BCK.MPP.0004 (expired challenge) code', async () => {
    let asked = 0
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      if (asked === 1) return challenge402()
      if (asked === 2)
        return new Response(
          JSON.stringify({ code: 'BCK.MPP.0004', message: 'Challenge expired' }),
          {
            status: 402,
            headers: { 'www-authenticate': CHALLENGE_HEADER_2, 'content-type': 'application/json' },
          },
        )
      return paid200()
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )
    expect(result.paid).toBe(true)
    expect(mints.count).toBe(2)
    expect(result.credentialsPresented).toBe(2)
  })

  it('retries on an explicit BCK.MPP.0005 (body-digest mismatch) code, exactly once', async () => {
    // A body-digest mismatch is the one rejection that IS retryable: the 402
    // answering it carries a freshly minted challenge sealed to the digest of
    // the request that just arrived, so a new credential for it (same body)
    // would match. Nothing about the failure is permanent — see
    // src/mpp/errors.ts's MppBodyDigestMismatchError (BCK.MPP.0005).
    let asked = 0
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      if (asked === 1) return challenge402()
      if (asked === 2)
        return new Response(
          JSON.stringify({ code: 'BCK.MPP.0005', message: 'Body digest mismatch' }),
          {
            status: 402,
            headers: { 'www-authenticate': CHALLENGE_HEADER_2, 'content-type': 'application/json' },
          },
        )
      return paid200()
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )
    expect(result.paid).toBe(true)
    expect(mints.count).toBe(2)
    expect(result.credentialsPresented).toBe(2)
  })

  it('treats a non-BCK.MPP coded 402 (e.g. a synthetic network_error/http_500 from MppAPI.post) as terminal', async () => {
    // MppAPI.post maps its own network/HTTP failures to codes like
    // 'network_error' or 'http_500' — not 'BCK.MPP.*'. This repo's own
    // seller forwards whatever code an MppError carries on the rejection
    // path, so a transient backend blip on the SELLER's side can reach the
    // buyer as a 402 with exactly this shape. It must not be retried: an
    // explicit, non-empty code that isn't in the retryable set is terminal,
    // the same as a genuine rejection code.
    let asked = 0
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      if (asked === 1) return challenge402()
      return new Response(
        JSON.stringify({ code: 'network_error', message: 'Network error during MPP request' }),
        {
          status: 402,
          headers: { 'www-authenticate': CHALLENGE_HEADER_2, 'content-type': 'application/json' },
        },
      )
    }) as any

    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS),
    ).rejects.toBeInstanceOf(MppError)
    expect(mints.count).toBe(1)
  })

  it('treats an unreadable (non-JSON) 402 body as terminal, not evidence of a fresh challenge', async () => {
    let asked = 0
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      if (asked === 1) return challenge402()
      // The retry hits a WAF/CDN 402 page instead of the seller: the
      // www-authenticate header is untouched (not rotated), but the body is
      // garbage, not JSON.
      return new Response('<html>403 Forbidden by WAF</html>', {
        status: 402,
        headers: { 'www-authenticate': CHALLENGE_HEADER, 'content-type': 'text/html' },
      })
    }) as any

    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS),
    ).rejects.toBeInstanceOf(MppError)
    expect(mints.count).toBe(1)
    expect(asked).toBe(2)
  })

  it('attributes and truncates the remote rejection message rather than forwarding it verbatim', async () => {
    const longMessage = 'x'.repeat(500)
    let asked = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      asked += 1
      if (asked === 1) return challenge402()
      return challenge402(CHALLENGE_HEADER, { error: 'Payment Required', message: longMessage })
    }) as any

    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(MppError)
    const message = (error as Error).message
    expect(message).toContain('https://agent.example')
    expect(message).toContain('rejected the credential')
    expect(message.length).toBeLessThan(longMessage.length)
  })

  it('coerces a non-string error/message field to the fallback string, instead of a raw TypeError', async () => {
    // A non-compliant seller can send `{ error: { reason: '...' } }` — no
    // `message`, and `error` itself is an object, not a string. The fallback
    // chain (`body?.message ?? body?.error ?? 'MPP request failed'`) must not
    // hand that object straight to the terminal throw's `.slice(0, 200)`,
    // which would raise `TypeError: message.slice is not a function` instead
    // of the promised typed MppError.
    let asked = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      asked += 1
      if (asked === 1) return challenge402()
      return new Response(JSON.stringify({ error: { reason: 'not a string' } }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      })
    }) as any

    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(MppError)
    expect((error as Error).message).not.toMatch(/\[object Object\]/)
  })
})

describe('MppAPI.fetch — malformed challenge and receipt handling', () => {
  it('throws a typed MppError when the 402 challenge cannot be decoded, without minting anything', async () => {
    const malformed = challengeHeader('mal-1', 'zzz')
    const spy = jest
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 402, headers: { 'www-authenticate': malformed } }),
      )
    global.fetch = spy as any

    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS),
    ).rejects.toBeInstanceOf(MppError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('refuses a challenge that names no planId at the codec, before anything is minted', async () => {
    // The refusal comes from isValidChallengeRequestShape in codec.ts, which
    // rejects a missing/non-string planId outright — so the decode throws and
    // the buyer never sees a challenge at all. fetch.ts deliberately does NOT
    // re-check planId: that second guard was unreachable and read as coverage.
    const header = challengeHeader('mal-2', encodeRequest({ credits: '2' }))
    const spy = jest.fn(
      async () => new Response('{}', { status: 402, headers: { 'www-authenticate': header } }),
    )
    global.fetch = spy as any

    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS),
    ).rejects.toBeInstanceOf(MppError)
    // One call: the resource. No /permissions mint.
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('coerces a NUMERIC credits rather than refusing it, and pays normally', async () => {
    // Pins the codec's documented coercion, so the credits guard below cannot
    // be tested with a JSON number and pass for the wrong reason: 2 becomes
    // '2', which is a valid decimal string.
    const header = challengeHeader('num-1', encodeRequest({ planId: PLAN_ID, credits: 2 }))
    let asked = 0
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      return asked === 1 ? challenge402(header) : paid200()
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )
    expect(result.paid).toBe(true)
    expect(result.creditsPresented).toBe('2')
    expect(mints.count).toBe(1)
  })

  it('refuses a non-decimal credits string BEFORE minting anything', async () => {
    const header = challengeHeader('mal-3', encodeRequest({ planId: PLAN_ID, credits: '2.5' }))
    const urls: string[] = []
    global.fetch = (async (url: any) => {
      urls.push(String(url))
      return new Response('{}', { status: 402, headers: { 'www-authenticate': header } })
    }) as any

    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS),
    ).rejects.toThrow(/non-decimal-string credits/)
    // The property that matters is not the error type — it is that no mint was
    // attempted. A stub answering every URL with a 402 makes a mint look like a
    // failure too, which is how this test previously passed with the guard dead.
    expect(urls.filter((u) => u.includes('/api/v1/mpp/permissions'))).toHaveLength(0)
    expect(urls).toHaveLength(1)
  })

  it('decodes a malformed Payment-Receipt as absent, with a warning, rather than throwing after payment succeeded', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    let asked = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      asked += 1
      if (asked === 1) return challenge402()
      return new Response(JSON.stringify({ answer: '42' }), {
        status: 200,
        headers: { 'payment-receipt': 'zzz' },
      })
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )

    expect(result.response.status).toBe(200)
    expect(await result.response.json()).toEqual({ answer: '42' })
    expect(result.receipt).toBeUndefined()
    // A malformed receipt is exactly the "2xx with no usable settlement
    // evidence" case: paid/settled must both read false, not just "receipt
    // absent" — this is one of the two states that catches the
    // `paid: response.ok` mutation (dropping `&& receipt !== undefined`
    // makes this `paid: true`, which is wrong: there is no proof anything
    // settled).
    expect(result.paid).toBe(false)
    expect(result.settled).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('MppAPI.fetch — paid/settled reflect settlement evidence, not HTTP status alone', () => {
  it('reports settled: true with a valid receipt even when the final response is non-2xx (settle-then-error)', async () => {
    // A seller can settle (burn credits) before writing its own response —
    // settle-then-500, settle-then-3xx, a proxy rewriting the status. The
    // receipt is the only settlement evidence on the wire; `settled` must
    // reflect it regardless of what the HTTP status ends up being, while
    // `paid` additionally requires a 2xx. The two must not contradict each
    // other the way a single `paid` boolean derived from status alone did.
    let asked = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      asked += 1
      if (asked === 1) return challenge402()
      return new Response(JSON.stringify({ error: 'downstream failure' }), {
        status: 500,
        headers: { 'payment-receipt': RECEIPT_HEADER },
      })
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )

    expect(result.response.status).toBe(500)
    expect(result.settled).toBe(true)
    expect(result.paid).toBe(false)
    expect(result.receipt?.status).toBe('success')
  })

  it('reports paid: false, settled: false for a 2xx response with no receipt (a silently swallowed settlement failure)', async () => {
    // This repo's own middleware can swallow a settlement failure and still
    // let a 2xx out with no Payment-Receipt header (it logs and continues).
    // `credentialsPresented` must still say a credential WAS handed over —
    // this is the "do not blindly retry, the fate is unknown" case, not
    // "nothing happened". This is the other state that catches the
    // `paid: response.ok` mutation: dropping `&& receipt !== undefined`
    // makes this `paid: true` on a 2xx with nothing actually settled.
    let asked = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      asked += 1
      if (asked === 1) return challenge402()
      return new Response(JSON.stringify({ answer: '42' }), { status: 200 }) // no payment-receipt header
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )

    expect(result.response.status).toBe(200)
    expect(result.paid).toBe(false)
    expect(result.settled).toBe(false)
    expect(result.credentialsPresented).toBe(1)
    expect(result.receipt).toBeUndefined()
  })
})

describe('MppAPI.fetch — argument/guard errors are PaymentsError, not MppError', () => {
  it('throws PaymentsError.validation when the caller pinned a different planId', async () => {
    global.fetch = (async () => challenge402()) as any
    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch(
        'https://agent.example/ask',
        {},
        {
          ...FETCH_OPTIONS,
          planId: '999',
        },
      )
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PaymentsError)
    expect(error).not.toBeInstanceOf(MppError)
    expect((error as Error).message).toMatch(/plan/i)
  })

  it('rejects a challenge that asks for more credits than the caller capped', async () => {
    global.fetch = (async () => challenge402()) as any // CHALLENGE_HEADER asks for 2 credits
    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch(
        'https://agent.example/ask',
        {},
        { ...FETCH_OPTIONS, maxCredits: 1 },
      )
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PaymentsError)
    expect(error).not.toBeInstanceOf(MppError)
  })

  it('allows a challenge within the caller-set credits cap', async () => {
    const calls: string[] = []
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      calls.push(href)
      return calls.length === 1 ? challenge402() : paid200()
    }) as any
    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      { method: 'POST', body: '{}' },
      { ...FETCH_OPTIONS, maxCredits: 2 },
    )
    expect(result.credentialsPresented).toBe(1)
    expect(result.settled).toBe(true)
    expect(result.creditsPresented).toBe('2')
  })

  it('re-checks the credits cap on the re-challenge turn, not just the first challenge', async () => {
    const highCreditsHeader = challengeHeader(
      'fresh-high',
      encodeRequest({ planId: PLAN_ID, credits: '10000' }),
    )
    let asked = 0
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      return asked === 1 ? challenge402() : challenge402(highCreditsHeader)
    }) as any

    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch(
        'https://agent.example/ask',
        {},
        { ...FETCH_OPTIONS, maxCredits: 5 },
      )
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PaymentsError)
    // Only the first (capped-OK, 2-credit) challenge was minted against; the
    // re-challenge asking for 10,000 credits must be refused before a second mint.
    expect(mints.count).toBe(1)
  })

  it('throws PaymentsError.validation for a ReadableStream body once a 402 challenge requires a retry', async () => {
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      return challenge402()
    }) as any

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'))
        controller.close()
      },
    })

    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch(
        'https://agent.example/ask',
        { method: 'POST', body: stream as any, duplex: 'half' } as any,
        FETCH_OPTIONS,
      )
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(PaymentsError)
    expect(error).not.toBeInstanceOf(MppError)
    expect((error as Error).message).toMatch(/ReadableStream/)
  })

  it('passes a stream body through untouched when the endpoint never challenges', async () => {
    const spy = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    global.fetch = spy as any
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'))
        controller.close()
      },
    })

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      { method: 'POST', body: stream as any, duplex: 'half' } as any,
      FETCH_OPTIONS,
    )

    expect(result.paid).toBe(false)
    expect(result.response.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('throws PaymentsError.validation when delegationConfig has no delegationId (would take the inline-create path)', async () => {
    const spy = jest.fn()
    global.fetch = spy as any
    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, {
        delegationConfig: { spendingLimitCents: 10000, durationSecs: 604800 },
      } as any)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PaymentsError)
    expect(error).not.toBeInstanceOf(MppError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('throws PaymentsError.validation when delegationConfig is entirely missing', async () => {
    const spy = jest.fn()
    global.fetch = spy as any
    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, {} as any),
    ).rejects.toBeInstanceOf(PaymentsError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('never creates a second delegation as a side effect of a re-challenge retry loop', async () => {
    // Regression guard: without the delegationId requirement, an inline
    // create-on-the-fly delegationConfig could be minted against twice per
    // fetch() call (once per retry turn), creating two delegations.
    let permissionsCalls = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) {
        permissionsCalls += 1
        return new Response(JSON.stringify({ accessToken: 't' }), { status: 201 })
      }
      return challenge402()
    }) as any

    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, {
        delegationConfig: { spendingLimitCents: 10000, durationSecs: 604800 },
      } as any),
    ).rejects.toBeInstanceOf(PaymentsError)
    expect(permissionsCalls).toBe(0)
  })
})

describe('MppAPI.fetch — Authorization header handling', () => {
  it('appends the credential to an existing caller-supplied Authorization header rather than replacing it', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    global.fetch = (async (url: any, init: any) => {
      const href = String(url)
      const headers = Object.fromEntries(new Headers(init?.headers ?? {}).entries())
      calls.push({ url: href, headers })
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      return calls.filter((c) => c.url.includes('/ask')).length === 1 ? challenge402() : paid200()
    }) as any

    await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      { method: 'POST', body: '{}', headers: { authorization: 'Bearer caller-own-api-key' } },
      FETCH_OPTIONS,
    )

    const retry = calls.filter((c) => c.url.includes('/ask'))[1]
    expect(retry.headers['authorization']).toMatch(/^Payment .+, Bearer caller-own-api-key$/)
  })
})

describe('MppAPI.fetch — every exit reports what may already have been spent', () => {
  /** A 402 asking for `credits` under a distinct challenge id. */
  function priced402(id: string, credits: string) {
    return challenge402(challengeHeader(id, encodeRequest({ planId: PLAN_ID, credits })))
  }

  it('carries the spend accounting on the terminal-rejection throw, not only on the return', async () => {
    let asked = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      asked += 1
      return asked === 1
        ? challenge402()
        : new Response(JSON.stringify({ code: 'BCK.MPP.0003', message: 'Credential rejected' }), {
            status: 402,
            headers: { 'content-type': 'application/json' },
          })
    }) as any

    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(MppCredentialRejectedError)
    // The credential and its access token are function-local and gone by now:
    // without these numbers the caller cannot tell that money left.
    expect(mppSpendOf(error)).toEqual({
      credentialsPresented: 1,
      creditsPresented: '2',
      challengeId: 'CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og',
    })
  })

  it('wraps a transport failure on the credential-bearing retry so the documented handler catches it', async () => {
    const transportFailure = new TypeError('fetch failed')
    let asked = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      asked += 1
      if (asked === 1) return challenge402()
      throw transportFailure
    }) as any

    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS)
    } catch (caught) {
      error = caught
    }

    // A raw TypeError here would escape `catch (e) { if (e instanceof MppError) }`
    // — the pattern this module and markdown/mpp-integration.md both prescribe —
    // while the credential was already on the wire.
    expect(error).toBeInstanceOf(MppSpendOutcomeUnknownError)
    expect(error).toBeInstanceOf(MppError)
    expect((error as MppSpendOutcomeUnknownError).cause).toBe(transportFailure)
    expect((error as MppError).code).toBe('spend_outcome_unknown')
    expect(mppSpendOf(error)?.credentialsPresented).toBe(1)
    expect(mppSpendOf(error)?.creditsPresented).toBe('2')
  })

  it('leaves a transport failure that happens BEFORE any credential exactly as fetch threw it', async () => {
    const transportFailure = new TypeError('fetch failed')
    global.fetch = (async () => {
      throw transportFailure
    }) as any

    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS)
    } catch (caught) {
      error = caught
    }

    // Nothing was spent, so wrapping it would only obscure a plain network fault.
    expect(error).toBe(transportFailure)
    expect(error).not.toBeInstanceOf(MppError)
    expect(mppSpendOf(error)).toBeUndefined()
  })

  it('carries the accounting on a PaymentsError raised on the re-challenge turn', async () => {
    let asked = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      asked += 1
      return asked === 1 ? priced402('turn-1', '100') : priced402('turn-2', '100')
    }) as any

    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch(
        'https://agent.example/ask',
        {},
        { ...FETCH_OPTIONS, maxCredits: 150 },
      )
    } catch (caught) {
      error = caught
    }

    // "Nothing was ever minted when a PaymentsError throws" is only true on the
    // FIRST turn; a guard firing on the re-challenge turn fires after a
    // credential has been presented, and must say so.
    expect(error).toBeInstanceOf(PaymentsError)
    expect(mppSpendOf(error)).toEqual({
      credentialsPresented: 1,
      creditsPresented: '100',
      challengeId: 'turn-1',
    })
  })

  it('returns the 402 — rather than throwing — when a retryable code carries no challenge to retry against', async () => {
    let asked = 0
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      if (asked === 1) return challenge402()
      // Retryable code, but no WWW-Authenticate: the next turn finds nothing to
      // mint against. Documented dead end #2 on mppFetch.
      return new Response(JSON.stringify({ code: 'BCK.MPP.0004', message: 'expired' }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      })
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )
    expect(result.response.status).toBe(402)
    expect(result.paid).toBe(false)
    // A resolved promise does NOT mean nothing was spent — one credential is out.
    expect(result.credentialsPresented).toBe(1)
    expect(result.creditsPresented).toBe('2')
    expect(mints.count).toBe(1)
  })
})

describe('MppAPI.fetch — maxCredits is a budget for the CALL', () => {
  function priced402(id: string, credits: string) {
    return challenge402(challengeHeader(id, encodeRequest({ planId: PLAN_ID, credits })))
  }

  function twoTurnSeller(mints: { count: number }, prices: [string, string]) {
    let asked = 0
    return (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      if (asked === 1) return priced402('turn-1', prices[0])
      if (asked === 2) return priced402('turn-2', prices[1])
      return paid200()
    }) as any
  }

  it('refuses the second turn when the two challenges TOGETHER exceed the cap', async () => {
    const mints = { count: 0 }
    global.fetch = twoTurnSeller(mints, ['100', '100'])

    await expect(
      MppAPI.getInstance(OPTIONS).fetch(
        'https://agent.example/ask',
        {},
        { ...FETCH_OPTIONS, maxCredits: 150 },
      ),
    ).rejects.toBeInstanceOf(PaymentsError)
    // A per-turn cap would have allowed both — 100 ≤ 150 twice — and let the
    // seller collect 200 against a cap that reads as 150.
    expect(mints.count).toBe(1)
  })

  it('allows both turns when their total fits, and reports the SUM as creditsPresented', async () => {
    const mints = { count: 0 }
    global.fetch = twoTurnSeller(mints, ['100', '40'])

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      { ...FETCH_OPTIONS, maxCredits: 150 },
    )
    expect(result.paid).toBe(true)
    expect(result.credentialsPresented).toBe(2)
    // Not '40': a re-challenge may name a different price, and the caller is
    // accounting for the call, not for the last turn.
    expect(result.creditsPresented).toBe('140')
    expect(mints.count).toBe(2)
  })

  it.each([
    ['a non-numeric string', 'abc'],
    ['a decimal string', '2.5'],
    ['a negative number', -1],
    ['a fractional number', 1.5],
  ])('refuses %s maxCredits at entry, before any request is made', async (_label, value) => {
    const spy = jest.fn()
    global.fetch = spy as any

    let error: unknown
    try {
      await MppAPI.getInstance(OPTIONS).fetch(
        'https://agent.example/ask',
        {},
        { ...FETCH_OPTIONS, maxCredits: value as any },
      )
    } catch (caught) {
      error = caught
    }

    // A bad argument must not surface mid-flight as a raw SyntaxError/RangeError
    // out of BigInt() on whatever 402 happens to arrive first.
    expect(error).toBeInstanceOf(PaymentsError)
    expect(error).not.toBeInstanceOf(MppError)
    expect((error as Error).message).toMatch(/maxCredits/)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('MppAPI.fetch — the retryable-code decision comes from errors.ts', () => {
  // Pins the buyer to isRetryableMppCode instead of a copied literal set: add a
  // code to the canonical set and this test demands the buyer follow, which a
  // local `new Set([...])` in fetch.ts would fail.
  it.each(['BCK.MPP.0002', 'BCK.MPP.0003', 'BCK.MPP.0004', 'BCK.MPP.0005', 'BCK.MPP.0099'])(
    'treats %s exactly as isRetryableMppCode says',
    async (code) => {
      let asked = 0
      const mints = { count: 0 }
      global.fetch = (async (url: any) => {
        const href = String(url)
        if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
        asked += 1
        if (asked === 1) return challenge402()
        // Same challenge id on every turn, so the id-freshness fallback cannot
        // account for a retry: only the code can.
        return new Response(JSON.stringify({ code, message: 'rejected' }), {
          status: 402,
          headers: { 'www-authenticate': CHALLENGE_HEADER, 'content-type': 'application/json' },
        })
      }) as any

      const retryable = isRetryableMppCode(code)
      let error: unknown
      let result: Awaited<ReturnType<MppAPI['fetch']>> | undefined
      try {
        result = await MppAPI.getInstance(OPTIONS).fetch(
          'https://agent.example/ask',
          {},
          FETCH_OPTIONS,
        )
      } catch (caught) {
        error = caught
      }

      if (retryable) {
        expect(error).toBeUndefined()
        expect(mints.count).toBe(2)
        expect(result?.credentialsPresented).toBe(2)
        expect(result?.response.status).toBe(402)
      } else {
        expect(error).toBeInstanceOf(MppError)
        expect(mints.count).toBe(1)
      }
    },
  )
})

describe('MppAPI.fetch — hostile 402 error bodies', () => {
  it('treats a `code: null` body as codeless, so a genuinely fresh challenge is still retried', async () => {
    let asked = 0
    const mints = { count: 0 }
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      if (asked === 1) return challenge402()
      if (asked === 2)
        // `{"code": null}` is a routine way to serialize "no code". Read
        // literally it both defeats the `code === undefined` fallback gate and
        // puts a null in a field typed `code?: string`.
        return new Response(JSON.stringify({ code: null, message: 'try again' }), {
          status: 402,
          headers: { 'www-authenticate': CHALLENGE_HEADER_2, 'content-type': 'application/json' },
        })
      return paid200()
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )
    expect(result.paid).toBe(true)
    expect(mints.count).toBe(2)
  })

  it('stops reading a 402 body at the cap, which lands on the terminal (unreadable) path', async () => {
    let asked = 0
    const mints = { count: 0 }
    const huge = `{"code":"BCK.MPP.0004","pad":"${'x'.repeat(200 * 1024)}"}`
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions')) return mintStub(mints)()
      asked += 1
      if (asked === 1) return challenge402()
      return new Response(huge, {
        status: 402,
        headers: { 'www-authenticate': CHALLENGE_HEADER_2, 'content-type': 'application/json' },
      })
    }) as any

    // Truncated JSON cannot parse, so the body is "unreadable" — terminal, one
    // mint. Fail-closed: a seller cannot buy a second mint with a huge body,
    // and cannot make the buyer buffer it either.
    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS),
    ).rejects.toBeInstanceOf(MppError)
    expect(mints.count).toBe(1)
  })
})
