/**
 * Unit tests for MppAPI: request shaping and error mapping.
 *
 * `fetch` is stubbed, so these lock the wire contract with the backend routes
 * without needing a backend.
 */
import { MppAPI } from '../../../src/mpp/mpp-api.js'
import {
  MppChallengeExpiredError,
  MppCredentialRejectedError,
  MppNotConfiguredError,
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
