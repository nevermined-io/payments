/**
 * Buyer flow: a 402 challenge is paid with an MPP credential minted from the
 * caller's existing Nevermined delegation, and the request is retried once.
 */
import { MppAPI } from '../../../src/mpp/mpp-api.js'
import { MppCredentialRejectedError, MppError } from '../../../src/mpp/errors.js'

const OPTIONS = { nvmApiKey: 'eyJhbGciOiJIUzI1NiJ9.e30.sig', environment: 'sandbox' } as any

const CHALLENGE_HEADER =
  'Payment id="CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og", realm="api.nevermined.app", ' +
  'method="nevermined", intent="charge", ' +
  'request="eyJjcmVkaXRzIjoiMiIsInBsYW5JZCI6IjQ0NzQyNzYzMDc2MDQ3NDk3NjQwMDgwMjMwMjM2NzgxNDc0MTI5OTcwOTkyNzI3ODk2NTkzODYxOTk3MzQ3MTM1NjEzMTM1NTcxMDcifQ", ' +
  'expires="2026-08-12T10:05:00.000Z", ' +
  'opaque="eyJfbXBweF9zY29wZSI6IlBPU1QgL2FzayIsIm5vbmNlIjoiMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1In0"'

const RECEIPT_HEADER =
  'eyJtZXRob2QiOiJuZXZlcm1pbmVkIiwicmVmZXJlbmNlIjoiQ1Fzek9uZ2Z2VDFSSUdTYWppcFpKdmctbEJDRUR1Z1dMREY3U0RfdzFvZyIsInN0YXR1cyI6InN1Y2Nlc3MiLCJ0aW1lc3RhbXAiOiIyMDI2LTA4LTEyVDEwOjAwOjMwLjAwMFoifQ'

const PLAN_ID = '4474276307604749764008023023678147412997099272789659386199734713561313557107'
const FETCH_OPTIONS = { delegationConfig: { delegationId: 'del-1' } } as any

function challenge402() {
  return new Response(JSON.stringify({ error: 'Payment Required' }), {
    status: 402,
    headers: { 'www-authenticate': CHALLENGE_HEADER },
  })
}

function paid200() {
  return new Response(JSON.stringify({ answer: '42' }), {
    status: 200,
    headers: { 'payment-receipt': RECEIPT_HEADER },
  })
}

describe('MppAPI.fetch', () => {
  it('pays a 402 and retries once with the credential', async () => {
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

  it('throws when the caller pinned a different planId', async () => {
    global.fetch = (async () => challenge402()) as any
    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, {
        ...FETCH_OPTIONS,
        planId: '999',
      }),
    ).rejects.toThrow(/plan/i)
  })

  it('returns a non-402 response untouched without minting anything', async () => {
    const spy = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    global.fetch = spy as any
    const result = await MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS)
    expect(result.paid).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('returns a 402 that carries no Payment challenge untouched', async () => {
    global.fetch = (async () => new Response('nope', { status: 402 })) as any
    const result = await MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS)
    expect(result.paid).toBe(false)
    expect(result.response.status).toBe(402)
  })

  it('surfaces a rejected credential as MppCredentialRejectedError', async () => {
    let served = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      served += 1
      if (served === 1) return challenge402()
      return new Response(JSON.stringify({ code: 'BCK.MPP.0003', message: 'Credential rejected' }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      })
    }) as any

    await expect(
      MppAPI.getInstance(OPTIONS).fetch('https://agent.example/ask', {}, FETCH_OPTIONS),
    ).rejects.toBeInstanceOf(MppCredentialRejectedError)
  })

  it('re-fetches a challenge at most once when the retry is challenged again', async () => {
    let asked = 0
    global.fetch = (async (url: any) => {
      const href = String(url)
      if (href.includes('/api/v1/mpp/permissions'))
        return new Response(JSON.stringify({ accessToken: 'mpp-token' }), { status: 201 })
      asked += 1
      return asked >= 4 ? paid200() : challenge402()
    }) as any

    const result = await MppAPI.getInstance(OPTIONS).fetch(
      'https://agent.example/ask',
      {},
      FETCH_OPTIONS,
    )
    // Original + paid retry + one re-challenge cycle, then the caller gets the 402.
    expect(result.paid).toBe(false)
    expect(result.response.status).toBe(402)
    expect(asked).toBe(3)
  })

  it('rejects a ReadableStream body up front, before any request is sent', async () => {
    // A stream is single-read: once the first fetch() consumes it, a retry
    // with the same body throws an opaque runtime TypeError instead of a
    // typed MPP error. The check runs before the first request — whether a
    // retry ever happens depends on that request's outcome, which is not
    // known ahead of time.
    const spy = jest.fn()
    global.fetch = spy as any
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

    expect(error).toBeInstanceOf(MppError)
    expect((error as Error).message).toMatch(/ReadableStream/)
    expect(spy).not.toHaveBeenCalled()
  })
})
