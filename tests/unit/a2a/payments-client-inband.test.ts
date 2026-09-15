/**
 * Unit tests for the PaymentsClient in-band x402 transport (client side).
 *
 * Asserts the client carries the payment in band via `x402.payment.payload`
 * message metadata (primary path), keeps the deprecated `payment-signature`
 * header (fallback), and resubmits correlated to a taskId when the server
 * replies with an `input-required` payment-required task.
 */

import { A2AClient } from '@a2a-js/sdk/client'
import { PaymentsClient } from '../../../src/a2a/paymentsClient.js'
import { X402A2AMetadata, PaymentStatus } from '../../../src/a2a/x402-a2a.js'
import type { Payments } from '../../../src/payments.js'

jest.mock('@a2a-js/sdk/client')

// A real base64-JSON token so decodeAccessToken recovers the PaymentPayload.
const PAYLOAD = {
  x402Version: 2,
  accepted: { scheme: 'nvm:erc4337', network: 'eip155:84532', planId: '1', extra: {} },
  payload: {
    signature: '0xs',
    authorization: { from: '0xFrom', sessionKeysProvider: 'zerodev', sessionKeys: [] },
  },
  extensions: {},
}
const TOKEN = Buffer.from(JSON.stringify(PAYLOAD)).toString('base64')

class DummyPayments {
  public x402: any
  public requests: any
  constructor() {
    this.requests = {}
    this.x402 = { getX402AccessToken: jest.fn().mockResolvedValue({ accessToken: TOKEN }) }
  }
}

describe('PaymentsClient in-band x402 transport', () => {
  let paymentsClient: PaymentsClient
  let dummyPayments: DummyPayments

  beforeEach(async () => {
    jest.clearAllMocks()
    dummyPayments = new DummyPayments()
    const mockA2AClient = {
      getAgentCard: jest.fn().mockResolvedValue({ capabilities: { extensions: [] } }),
    }
    ;(A2AClient.fromCardUrl as jest.Mock).mockResolvedValue(mockA2AClient)
    paymentsClient = await PaymentsClient.create(
      'https://agent.example',
      dummyPayments as any as Payments,
      'agent1',
      '1',
      undefined,
      { delegationId: 'd' },
    )
  })

  test('injects x402.payment.payload metadata in band AND keeps the header fallback', async () => {
    const mockPostRpc = jest
      .fn()
      .mockResolvedValue({ result: { kind: 'task', status: { state: 'completed' } } })
    ;(paymentsClient as any)._postRpcRequestWithHeaders = mockPostRpc

    await paymentsClient.sendA2AMessage({
      message: { messageId: 'm', role: 'user', parts: [] },
    } as any)

    const [, params, headers] = mockPostRpc.mock.calls[0]
    // Deprecated header still present (fallback for one release).
    expect(headers['payment-signature']).toBe(TOKEN)
    // In-band payload carried in message metadata, decoded back to the object.
    const meta = params.message.metadata
    expect(meta[X402A2AMetadata.STATUS_KEY]).toBe(PaymentStatus.PAYMENT_SUBMITTED)
    expect(meta[X402A2AMetadata.PAYLOAD_KEY]).toEqual(PAYLOAD)
  })

  test('resubmits correlated to taskId when the server returns input-required payment-required', async () => {
    const mockPostRpc = jest
      .fn()
      // First response: payment-required task.
      .mockResolvedValueOnce({
        result: {
          kind: 'task',
          id: 'task-xyz',
          status: {
            state: 'input-required',
            message: {
              kind: 'message',
              messageId: 's',
              role: 'agent',
              parts: [],
              metadata: { [X402A2AMetadata.STATUS_KEY]: PaymentStatus.PAYMENT_REQUIRED },
            },
          },
        },
      })
      // Second (follow-up) response: completed.
      .mockResolvedValueOnce({
        result: { kind: 'task', id: 'task-xyz', status: { state: 'completed' } },
      })
    ;(paymentsClient as any)._postRpcRequestWithHeaders = mockPostRpc

    const res = await paymentsClient.sendA2AMessage({
      message: { messageId: 'm', role: 'user', parts: [] },
    } as any)

    expect(mockPostRpc).toHaveBeenCalledTimes(2)
    // The follow-up correlates to the task id and re-sends the in-band payload.
    const followUpParams = mockPostRpc.mock.calls[1][1]
    expect(followUpParams.message.taskId).toBe('task-xyz')
    expect(followUpParams.message.metadata[X402A2AMetadata.PAYLOAD_KEY]).toEqual(PAYLOAD)
    expect((res as any).result.status.state).toBe('completed')
  })

  test('does NOT resubmit when the first response already completes', async () => {
    const mockPostRpc = jest
      .fn()
      .mockResolvedValue({ result: { kind: 'task', id: 't', status: { state: 'completed' } } })
    ;(paymentsClient as any)._postRpcRequestWithHeaders = mockPostRpc

    await paymentsClient.sendA2AMessage({
      message: { messageId: 'm', role: 'user', parts: [] },
    } as any)
    expect(mockPostRpc).toHaveBeenCalledTimes(1)
  })

  test('does NOT resubmit on a NON-payment input-required response (no double-pay)', async () => {
    // input-required, but WITHOUT x402.payment.status: payment-required — a genuine
    // input request, not a paywall. The client must send exactly once.
    const mockPostRpc = jest.fn().mockResolvedValue({
      result: {
        kind: 'task',
        id: 't',
        status: {
          state: 'input-required',
          message: { kind: 'message', messageId: 's', role: 'agent', parts: [], metadata: {} },
        },
      },
    })
    ;(paymentsClient as any)._postRpcRequestWithHeaders = mockPostRpc

    await paymentsClient.sendA2AMessage({
      message: { messageId: 'm', role: 'user', parts: [] },
    } as any)
    expect(mockPostRpc).toHaveBeenCalledTimes(1)
  })
})

describe('PaymentsClient agent-card discovery fallback', () => {
  const card = { capabilities: { extensions: [] } }
  const clientFor = (c: any) => ({ getAgentCard: jest.fn().mockResolvedValue(c) })

  beforeEach(() => jest.clearAllMocks())

  test('falls back to the legacy path when the canonical path fails (and warns)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    ;(A2AClient.fromCardUrl as jest.Mock).mockImplementation((url: string) =>
      url.includes('agent-card.json')
        ? Promise.reject(new Error('canonical 404'))
        : Promise.resolve(clientFor(card)),
    )

    const client = await PaymentsClient.create(
      'https://agent.example/',
      new DummyPayments() as any as Payments,
      'a',
      '1',
    )
    expect(client).toBeInstanceOf(PaymentsClient)
    expect(warn).toHaveBeenCalled() // silent fallback would be a discovery risk
    warn.mockRestore()
  })

  test('throws preserving the canonical-path root cause when both paths fail', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const canonicalErr = new Error('canonical TLS error')
    ;(A2AClient.fromCardUrl as jest.Mock).mockImplementation((url: string) =>
      url.includes('agent-card.json')
        ? Promise.reject(canonicalErr)
        : Promise.reject(new Error('legacy 404')),
    )

    await expect(
      PaymentsClient.create(
        'https://agent.example/',
        new DummyPayments() as any as Payments,
        'a',
        '1',
      ),
    ).rejects.toMatchObject({ cause: canonicalErr })
    ;(console.warn as jest.Mock).mockRestore()
  })
})
