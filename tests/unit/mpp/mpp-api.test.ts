/**
 * Unit tests for MppAPI: request shaping and error mapping.
 *
 * `fetch` is stubbed, so these lock the wire contract with the backend routes
 * without needing a backend.
 */
import { MppAPI, normalizeCredits } from '../../../src/mpp/mpp-api.js'
import {
  MppChallengeExpiredError,
  MppCredentialRejectedError,
  MppNotConfiguredError,
  MppError,
  MppSettlementOutcomeUnknownError,
} from '../../../src/mpp/errors.js'

const OPTIONS = { nvmApiKey: 'eyJhbGciOiJIUzI1NiJ9.e30.sig', environment: 'sandbox' } as any

function stubFetch(status: number, body: unknown) {
  const spy = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
  global.fetch = spy as any
  return spy
}

describe('MppAPI.issueChallenge', () => {
  it('posts to /api/v1/mpp/challenge with string credits', async () => {
    const spy = stubFetch(201, { challenge: 'Payment id="x"', id: 'x' })
    const api = MppAPI.getInstance(OPTIONS)

    const result = await api.issueChallenge({
      planId: '123',
      credits: 2,
      resource: '/ask',
      httpVerb: 'POST',
    })

    expect(result).toEqual({ challenge: 'Payment id="x"', id: 'x' })
    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toContain('/api/v1/mpp/challenge')
    expect(JSON.parse(init.body)).toEqual({
      planId: '123',
      credits: '2',
      resource: '/ask',
      httpVerb: 'POST',
    })
  })

  it('omits optional fields it was not given', async () => {
    const spy = stubFetch(201, { challenge: 'c', id: 'i' })
    await MppAPI.getInstance(OPTIONS).issueChallenge({
      planId: '123',
      credits: '1',
      resource: '/ask',
      httpVerb: 'POST',
      agentId: 'agent-1',
      digest: 'sha-256=abc',
      description: 'Premium',
    })
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({
      planId: '123',
      credits: '1',
      resource: '/ask',
      httpVerb: 'POST',
      agentId: 'agent-1',
      digest: 'sha-256=abc',
      description: 'Premium',
    })
  })
})

describe('MppAPI.settleCredential', () => {
  it('returns the settlement plus the receipt header value', async () => {
    stubFetch(201, {
      success: true,
      transaction: '0xabc',
      network: 'eip155:84532',
      creditsRedeemed: '2',
      paymentReceipt: 'eyJ0ZXN0Ijp0cnVlfQ',
    })
    const result = await MppAPI.getInstance(OPTIONS).settleCredential({
      credential: 'Payment abc',
      resource: '/ask',
      httpVerb: 'POST',
    })
    expect(result.success).toBe(true)
    expect(result.paymentReceipt).toBe('eyJ0ZXN0Ijp0cnVlfQ')
  })
})

describe('MppAPI error mapping', () => {
  it('maps BCK.MPP.0004 to MppChallengeExpiredError', async () => {
    stubFetch(402, { code: 'BCK.MPP.0004', message: 'Challenge expired' })
    await expect(
      MppAPI.getInstance(OPTIONS).verifyCredential({
        credential: 'Payment abc',
        resource: '/ask',
        httpVerb: 'POST',
      }),
    ).rejects.toBeInstanceOf(MppChallengeExpiredError)
  })

  it('maps BCK.MPP.0003 to MppCredentialRejectedError', async () => {
    stubFetch(402, { code: 'BCK.MPP.0003', message: 'Credential rejected' })
    await expect(
      MppAPI.getInstance(OPTIONS).verifyCredential({
        credential: 'Payment abc',
        resource: '/ask',
        httpVerb: 'POST',
      }),
    ).rejects.toBeInstanceOf(MppCredentialRejectedError)
  })

  it('maps BCK.MPP.0002 to MppNotConfiguredError', async () => {
    stubFetch(501, { code: 'BCK.MPP.0002', message: 'MPP is not configured' })
    await expect(
      MppAPI.getInstance(OPTIONS).issueChallenge({
        planId: '1',
        credits: '1',
        resource: '/ask',
        httpVerb: 'POST',
      }),
    ).rejects.toBeInstanceOf(MppNotConfiguredError)
  })
})

describe('normalizeCredits', () => {
  it('renders a large integer exponent exactly, without scientific notation', () => {
    // credits.toString() on a JS number used to emit "1e+21" verbatim into
    // the HMAC-sealed challenge; BigInt(...) renders the exact integer.
    expect(normalizeCredits(1e21)).toBe('1000000000000000000000')
  })

  it('passes an ordinary integer through', () => {
    expect(normalizeCredits(5)).toBe('5')
    expect(normalizeCredits(5n)).toBe('5')
    expect(normalizeCredits('5')).toBe('5')
  })

  it('rejects a non-integer number', () => {
    expect(() => normalizeCredits(0.1)).toThrow(MppError)
  })

  it('rejects NaN and Infinity', () => {
    expect(() => normalizeCredits(NaN)).toThrow(MppError)
    expect(() => normalizeCredits(Infinity)).toThrow(MppError)
  })

  it('rejects a negative amount', () => {
    expect(() => normalizeCredits(-5)).toThrow(MppError)
    expect(() => normalizeCredits('-5')).toThrow(MppError)
  })

  it('rejects a non-decimal credits string rather than silently accepting hex/empty/whitespace', () => {
    // BigInt('0x10'), BigInt(''), and BigInt(' 5 ') all parse "successfully"
    // to values a decimal-string contract must not accept.
    expect(() => normalizeCredits('0x10')).toThrow(MppError)
    expect(() => normalizeCredits('')).toThrow(MppError)
    expect(() => normalizeCredits(' 5 ')).toThrow(MppError)
    expect(() => normalizeCredits('5.5')).toThrow(MppError)
  })
})

describe('MppAPI.issueChallenge credits validation', () => {
  it('rejects NaN before it reaches the wire', async () => {
    const spy = stubFetch(201, { challenge: 'c', id: 'i' })
    await expect(
      MppAPI.getInstance(OPTIONS).issueChallenge({
        planId: '123',
        credits: NaN,
        resource: '/ask',
        httpVerb: 'POST',
      }),
    ).rejects.toThrow(MppError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('renders a large integer exponent exactly on the wire', async () => {
    const spy = stubFetch(201, { challenge: 'c', id: 'i' })
    await MppAPI.getInstance(OPTIONS).issueChallenge({
      planId: '123',
      credits: 1e21,
      resource: '/ask',
      httpVerb: 'POST',
    })
    expect(JSON.parse(spy.mock.calls[0][1].body).credits).toBe('1000000000000000000000')
  })
})

describe('MppAPI.post success-path parsing', () => {
  it('raises a typed MppError, not a raw SyntaxError, when a 2xx response is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => {
        throw new SyntaxError("Unexpected token '<', \"<html>...\" is not valid JSON")
      },
    }) as any
    await expect(
      MppAPI.getInstance(OPTIONS).issueChallenge({
        planId: '123',
        credits: '1',
        resource: '/ask',
        httpVerb: 'POST',
      }),
    ).rejects.toBeInstanceOf(MppError)
    await expect(
      MppAPI.getInstance(OPTIONS).issueChallenge({
        planId: '123',
        credits: '1',
        resource: '/ask',
        httpVerb: 'POST',
      }),
    ).rejects.not.toBeInstanceOf(SyntaxError)
  })
})

describe('MppAPI.post request timeout', () => {
  it('passes an AbortSignal to fetch, so a hung backend cannot hold the connection open indefinitely', async () => {
    const spy = stubFetch(201, { challenge: 'c', id: 'i' })
    await MppAPI.getInstance(OPTIONS).issueChallenge({
      planId: '123',
      credits: '1',
      resource: '/ask',
      httpVerb: 'POST',
    })
    const [, init] = spy.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('MppAPI settle-timeout outcome semantics', () => {
  function stubFetchTimeout() {
    global.fetch = jest.fn().mockRejectedValue(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    ) as any
  }

  it('surfaces a settle timeout as MppSettlementOutcomeUnknownError, not a generic network_error', async () => {
    stubFetchTimeout()
    await expect(
      MppAPI.getInstance(OPTIONS).settleCredential({
        credential: 'Payment abc',
        resource: '/ask',
        httpVerb: 'POST',
      }),
    ).rejects.toBeInstanceOf(MppSettlementOutcomeUnknownError)
  })

  it('does not treat a verifyCredential timeout as an unknown-outcome burn — verify burns nothing', async () => {
    stubFetchTimeout()
    await expect(
      MppAPI.getInstance(OPTIONS).verifyCredential({
        credential: 'Payment abc',
        resource: '/ask',
        httpVerb: 'POST',
      }),
    ).rejects.not.toBeInstanceOf(MppSettlementOutcomeUnknownError)
  })

  it('does not treat an issueChallenge timeout as an unknown-outcome burn — issuing a challenge burns nothing', async () => {
    stubFetchTimeout()
    await expect(
      MppAPI.getInstance(OPTIONS).issueChallenge({
        planId: '123',
        credits: '1',
        resource: '/ask',
        httpVerb: 'POST',
      }),
    ).rejects.not.toBeInstanceOf(MppSettlementOutcomeUnknownError)
  })

  it('still treats a non-timeout settle failure (e.g. connection refused) as an ordinary network_error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as any
    await expect(
      MppAPI.getInstance(OPTIONS).settleCredential({
        credential: 'Payment abc',
        resource: '/ask',
        httpVerb: 'POST',
      }),
    ).rejects.not.toBeInstanceOf(MppSettlementOutcomeUnknownError)
  })
})

describe('Payments facade', () => {
  it('exposes payments.mpp', async () => {
    const { Payments } = await import('../../../src/payments.js')
    const payments = Payments.getInstance({
      nvmApiKey: 'eyJhbGciOiJIUzI1NiJ9.e30.sig',
      environment: 'sandbox',
    } as any)
    expect(payments.mpp).toBeDefined()
    expect(typeof payments.mpp.issueChallenge).toBe('function')
  })
})
