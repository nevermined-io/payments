/**
 * Unit test for PaymentsClient resubscribe_task.
 */

import { PaymentsClient } from '../../../src/a2a/paymentsClient.js'
import type { Payments } from '../../../src/payments.js'
import { A2AClient } from '@a2a-js/sdk/client'

jest.mock('@a2a-js/sdk/client')

class DummyPayments {
  public agents: any
  public x402: any

  constructor() {
    this.agents = {
      getAgentAccessToken: jest.fn().mockResolvedValue({ accessToken: 'TOK' }),
    }
    this.x402 = {
      getX402AccessToken: jest.fn().mockResolvedValue({ accessToken: 'TOK' }),
    }
  }
}

describe('PaymentsClient resubscribeTask', () => {
  let mockA2AClient: any
  let paymentsClient: PaymentsClient
  let dummyPayments: DummyPayments

  beforeEach(async () => {
    jest.clearAllMocks()

    dummyPayments = new DummyPayments()

    // Mock A2AClient.fromCardUrl
    mockA2AClient = {
      getAgentCard: jest.fn().mockResolvedValue({
        capabilities: {
          extensions: [],
        },
      }),
    }
    ;(A2AClient.fromCardUrl as jest.Mock).mockResolvedValue(mockA2AClient)

    // Create PaymentsClient
    paymentsClient = await PaymentsClient.create(
      'https://agent',
      dummyPayments as any as Payments,
      'aid',
      'pid',
    )

    // Mock the internal _parseA2AStream method
    async function* fakeStream() {
      yield { kind: 'task' }
    }

    ;(paymentsClient as any)._parseA2AStream = jest.fn().mockImplementation(() => fakeStream())
    ;(paymentsClient as any)._getServiceEndpoint = jest
      .fn()
      .mockResolvedValue('https://agent/endpoint')

    // Mock fetch for the resubscribe call
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn().mockReturnValue('text/event-stream'),
      },
      body: null,
    }) as any
  })

  test('should resubscribe task and stream events', async () => {
    // Mock agent card with streaming capability
    ;(paymentsClient as any).agentCardPromise = Promise.resolve({
      capabilities: { streaming: true },
    })

    const collected: any[] = []
    for await (const ev of paymentsClient.resubscribeA2ATask({ taskId: 'tid' } as any)) {
      collected.push(ev)
    }

    expect(collected).toEqual([{ kind: 'task' }])
    expect(dummyPayments.x402.getX402AccessToken).toHaveBeenCalled()
  })
})
