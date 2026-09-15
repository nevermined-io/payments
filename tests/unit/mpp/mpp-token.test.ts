/**
 * The MPP mint posts the same body as the x402 mint to a different route — the
 * only difference is the EIP-712 domain the backend signs under.
 */
import { MppAPI } from '../../../src/mpp/mpp-api.js'

const OPTIONS = { nvmApiKey: 'eyJhbGciOiJIUzI1NiJ9.e30.sig', environment: 'sandbox' } as any

function stubFetch(body: unknown) {
  const spy = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => body })
  global.fetch = spy as any
  return spy
}

describe('MppAPI.getMppAccessToken', () => {
  it('posts to /api/v1/mpp/permissions with the x402 body shape', async () => {
    const spy = stubFetch({ accessToken: 'mpp-token' })
    const result = await MppAPI.getInstance(OPTIONS).getMppAccessToken('123', 'agent-1', {
      delegationConfig: { delegationId: 'del-1' },
    })

    expect(result.accessToken).toBe('mpp-token')
    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toContain('/api/v1/mpp/permissions')
    const body = JSON.parse(init.body)
    expect(body.accepted).toEqual({
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      planId: '123',
      extra: { agentId: 'agent-1' },
    })
    expect(body.delegationConfig).toEqual({ delegationId: 'del-1' })
  })

  it('requires a delegationConfig, like the x402 mint', async () => {
    stubFetch({ accessToken: 'x' })
    await expect(MppAPI.getInstance(OPTIONS).getMppAccessToken('123')).rejects.toThrow(
      /delegationConfig is required/,
    )
  })
})
