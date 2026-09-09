/**
 * Unit tests for PaymentsClient's handling of single-use (v3) access tokens.
 *
 * The client caches one token for its whole lifetime and replays it on every
 * paid call. That is correct for a v2 bearer token and WRONG for a v3 one: a v3
 * token is consumed by its first settlement, so the second call would settle
 * against a spent nonce (`BCK.X402.0059`). The cache must therefore be decided
 * by the version of the token that came back, not by what the client asked for.
 *
 * See nevermined-io/payments#427 and nvm-monorepo#2646.
 */

import { A2AClient } from '@a2a-js/sdk/client'
import { PaymentsClient } from '../../../src/a2a/paymentsClient.js'
import type { Payments } from '../../../src/payments.js'

jest.mock('@a2a-js/sdk/client')

const encodeToken = (payload: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(payload)).toString('base64')

const tokenEnvelope = (authorization: Record<string, unknown>): string =>
  encodeToken({
    x402Version: 2,
    accepted: {
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      planId: '1',
      extra: { version: '1' },
    },
    payload: {
      signature: '0xsig',
      authorization: {
        from: '0xsubscriber',
        sessionKeysProvider: 'zerodev',
        sessionKeys: [],
        ...authorization,
      },
    },
    extensions: {},
  })

const V2_TOKEN = tokenEnvelope({})
const v3TokenWithNonce = (nonce: string): string =>
  tokenEnvelope({
    agentId: 'agent1',
    resourceUrl: 'https://agent.example/a2a',
    httpVerb: 'POST',
    nonce,
  })

/**
 * Minimal Payments stub whose mint returns whatever the test queues up, with
 * the `tokenVersion` the real SDK derives from the token itself.
 */
function buildPayments(tokens: string[]) {
  let index = 0
  const mint = jest.fn().mockImplementation(async () => {
    const accessToken = tokens[Math.min(index, tokens.length - 1)]
    index += 1
    const nonce = JSON.parse(Buffer.from(accessToken, 'base64').toString())?.payload?.authorization
      ?.nonce
    return {
      accessToken,
      tokenVersion: typeof nonce === 'string' && nonce.trim() !== '' ? 3 : 2,
    }
  })
  return {
    mint,
    payments: {
      x402: { getX402AccessToken: mint },
      plans: { getPlan: jest.fn().mockResolvedValue({ registry: { price: { isCrypto: true } } }) },
    } as unknown as Payments,
  }
}

async function buildClient(payments: Payments, tokenVersion?: 2 | 3) {
  const mockA2AClient = {
    sendMessage: jest.fn().mockResolvedValue({ ok: true }),
    getAgentCard: jest.fn().mockResolvedValue({ capabilities: { extensions: [] } }),
  }
  ;(A2AClient.fromCardUrl as jest.Mock).mockResolvedValue(mockA2AClient)

  const client = await PaymentsClient.create(
    'https://agent.example',
    payments,
    'agent1',
    '1',
    undefined,
    { delegationId: 'test-delegation' },
    tokenVersion,
  )
  ;(client as any)._client = mockA2AClient
  ;(client as any)._getServiceEndpoint = jest.fn().mockResolvedValue('https://agent.example/a2a')
  const postRpc = jest.fn().mockResolvedValue({ ok: true })
  ;(client as any)._postRpcRequestWithHeaders = postRpc
  return { client, postRpc }
}

describe('PaymentsClient — single-use (v3) tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('a v3 token is minted per paid request and never cached', async () => {
    const { mint, payments } = buildPayments([v3TokenWithNonce('0xaaa'), v3TokenWithNonce('0xbbb')])
    const { client, postRpc } = await buildClient(payments, 3)

    await client.sendA2AMessage({ message: {} } as any)
    await client.sendA2AMessage({ message: {} } as any)

    expect(mint).toHaveBeenCalledTimes(2)
    // Each request carries its own token — a replayed one would settle against
    // a nonce the backend has already spent.
    const first = postRpc.mock.calls[0][2]['payment-signature']
    const second = postRpc.mock.calls[1][2]['payment-signature']
    expect(first).toBe(v3TokenWithNonce('0xaaa'))
    expect(second).toBe(v3TokenWithNonce('0xbbb'))
    expect(first).not.toBe(second)
  })

  test('a v2 token is still cached for the client lifetime', async () => {
    const { mint, payments } = buildPayments([V2_TOKEN])
    const { client, postRpc } = await buildClient(payments)

    await client.sendA2AMessage({ message: {} } as any)
    await client.sendA2AMessage({ message: {} } as any)

    expect(mint).toHaveBeenCalledTimes(1)
    expect(postRpc.mock.calls[0][2]['payment-signature']).toBe(V2_TOKEN)
    expect(postRpc.mock.calls[1][2]['payment-signature']).toBe(V2_TOKEN)
  })

  test('a v3 token is not reused across the other paid RPC methods either', async () => {
    const { mint, payments } = buildPayments([v3TokenWithNonce('0xaaa'), v3TokenWithNonce('0xbbb')])
    const { client } = await buildClient(payments, 3)

    await client.sendA2AMessage({ message: {} } as any)
    await client.getA2ATask({ id: 'task-1' } as any)

    expect(mint).toHaveBeenCalledTimes(2)
  })

  test('a v3 client binds the mint to the A2A service endpoint and POST', async () => {
    const { mint, payments } = buildPayments([v3TokenWithNonce('0xaaa')])
    const { client } = await buildClient(payments, 3)

    await client.sendA2AMessage({ message: {} } as any)

    expect(mint).toHaveBeenCalledWith(
      '1',
      'agent1',
      expect.objectContaining({
        resource: { url: 'https://agent.example/a2a' },
        httpVerb: 'POST',
        tokenVersion: 3,
      }),
    )
  })

  test('without an explicit v3 request the mint carries NO resource binding', async () => {
    // A `resource.url` is not inert on a v2 token: the backend compares it with
    // the seller's paymentRequired.resource.url, and sellers built on this SDK
    // advertise a relative path. Binding an absolute service endpoint would
    // break verify (BCK.X402.0013) for every one of them.
    const { mint, payments } = buildPayments([V2_TOKEN])
    const { client } = await buildClient(payments)

    await client.sendA2AMessage({ message: {} } as any)

    expect(mint.mock.calls[0][2]).not.toHaveProperty('resource')
    expect(mint.mock.calls[0][2]).not.toHaveProperty('httpVerb')
    expect(mint.mock.calls[0][2]).not.toHaveProperty('tokenVersion')
  })

  test('an unresolvable service endpoint fails the v3 mint instead of unbinding it', async () => {
    // A v3 caller asked for a token bound to one seller endpoint. Minting one
    // bound to nothing — still reporting tokenVersion 3 — would drop half the
    // guarantee with no signal at all, so the lookup failure surfaces.
    const { mint, payments } = buildPayments([v3TokenWithNonce('0xaaa')])
    const { client } = await buildClient(payments, 3)
    ;(client as any)._getServiceEndpoint = jest.fn().mockRejectedValue(new Error('no endpoint'))

    await expect(client.sendA2AMessage({ message: {} } as any)).rejects.toThrow(
      /tokenVersion 3 access token/,
    )
    expect(mint).not.toHaveBeenCalled()
  })

  test('an empty service endpoint fails the v3 mint too', async () => {
    const { mint, payments } = buildPayments([v3TokenWithNonce('0xaaa')])
    const { client } = await buildClient(payments, 3)
    ;(client as any)._getServiceEndpoint = jest.fn().mockResolvedValue('')

    await expect(client.sendA2AMessage({ message: {} } as any)).rejects.toThrow(/empty value/)
    expect(mint).not.toHaveBeenCalled()
  })

  test('v3 requested but the backend downgrades to v2: the token IS cached', async () => {
    // The caching decision follows the token, not the request. Branching on the
    // request instead would mint per call here for no reason — and, in the
    // mirror case below, replay a spent nonce.
    const { mint, payments } = buildPayments([V2_TOKEN])
    const { client } = await buildClient(payments, 3)

    await client.sendA2AMessage({ message: {} } as any)
    await client.sendA2AMessage({ message: {} } as any)

    expect(mint).toHaveBeenCalledTimes(1)
  })

  test('v3 never requested but the backend returns v3: the token is NOT cached', async () => {
    // The case that matters once the backend default flips: a client that
    // trusted its own request would replay a single-use token.
    const { mint, payments } = buildPayments([v3TokenWithNonce('0xaaa'), v3TokenWithNonce('0xbbb')])
    const { client } = await buildClient(payments)

    await client.sendA2AMessage({ message: {} } as any)
    await client.sendA2AMessage({ message: {} } as any)

    expect(mint).toHaveBeenCalledTimes(2)
  })
})
