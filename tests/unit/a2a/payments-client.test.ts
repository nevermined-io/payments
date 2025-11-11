/**
 * Unit tests for PaymentsClient.
 */

import { PaymentsClient } from '../../../src/a2a/paymentsClient.js'
import type { Payments } from '../../../src/payments.js'
import { A2AClient } from '@a2a-js/sdk/client'

jest.mock('@a2a-js/sdk/client')

class DummyPayments {
  public _getTokenMock: jest.Mock
  public agents: any
  public requests: any

  constructor() {
    this._getTokenMock = jest.fn().mockResolvedValue({ accessToken: 'XYZ' })
    this.agents = {
      getAgentAccessToken: this._getTokenMock,
    }
    this.requests = {}
  }
}

describe('PaymentsClient', () => {
  let mockA2AClient: any
  let paymentsClient: PaymentsClient
  let dummyPayments: DummyPayments

  beforeEach(async () => {
    jest.clearAllMocks()

    dummyPayments = new DummyPayments()

    // Mock A2AClient.fromCardUrl
    mockA2AClient = {
      sendMessage: jest.fn().mockResolvedValue({ ok: true }),
      getAgentCard: jest.fn().mockResolvedValue({
        capabilities: {
          extensions: [],
        },
      }),
    }
    ;(A2AClient.fromCardUrl as jest.Mock).mockResolvedValue(mockA2AClient)

    // Create PaymentsClient
    paymentsClient = await PaymentsClient.create(
      'https://agent.example',
      dummyPayments as any as Payments,
      'agent1',
      '1',
    )

    // Mock internal _getClient to avoid ClientFactory path
    ;(paymentsClient as any)._client = mockA2AClient
  })

  test('should cache access token after first call', async () => {
    // Mock the internal _postRpcRequestWithHeaders method
    const mockPostRpc = jest.fn().mockResolvedValue({ ok: true })
    ;(paymentsClient as any)._postRpcRequestWithHeaders = mockPostRpc

    // First call should fetch token and cache it
    await paymentsClient.sendA2AMessage({ message: {} } as any)
    // Token fetching occurs once; call again and ensure get_agent_access_token
    // not called again
    await paymentsClient.sendA2AMessage({ message: {} } as any)

    // The mocked get_agent_access_token should have been awaited exactly once
    expect(dummyPayments._getTokenMock).toHaveBeenCalledTimes(1)
  })

  test('should inject authorization header', async () => {
    // Mock the internal _postRpcRequestWithHeaders method
    const mockPostRpc = jest.fn().mockResolvedValue({ ok: true })
    ;(paymentsClient as any)._postRpcRequestWithHeaders = mockPostRpc

    await paymentsClient.sendA2AMessage({ message: {} } as any)
    expect(mockPostRpc).toHaveBeenCalled()
    const callArgs = mockPostRpc.mock.calls[0]
    const headers = callArgs[2]?.headers || callArgs[2] || {}
    expect(headers.Authorization).toMatch(/^Bearer /)
    expect(headers.Authorization).toContain('XYZ')
  })
})
