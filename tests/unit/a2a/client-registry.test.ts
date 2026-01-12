/**
 * Unit tests for ClientRegistry.
 */

import { ClientRegistry } from '../../../src/a2a/clientRegistry.js'
import { PaymentsClient } from '../../../src/a2a/paymentsClient.js'
import type { Payments } from '../../../src/payments.js'

jest.mock('../../../src/a2a/paymentsClient.js')

class DummyPayments {
  public agents: any
  public x402: any

  constructor() {
    this.x402 = {
      getX402AccessToken: jest.fn().mockResolvedValue({ accessToken: 'TOKEN' }),
    }
  }
}

function createRegistry(): ClientRegistry {
  return new ClientRegistry(new DummyPayments() as any as Payments)
}

describe('ClientRegistry', () => {
  let mockClient: any

  beforeEach(() => {
    jest.clearAllMocks()
    ;(PaymentsClient.create as jest.Mock).mockImplementation(() => {
      return Promise.resolve({
        sendMessage: jest.fn(),
        getTask: jest.fn(),
        resubscribeTask: jest.fn(),
      })
    })
  })

  test('should return same instance for same key', async () => {
    const registry = createRegistry()
    const opts = {
      agentBaseUrl: 'https://agent.example',
      agentId: 'agent1',
      planId: '1',
    }
    const client1 = await registry.getClient(opts)
    const client2 = await registry.getClient(opts)
    expect(client1).toBe(client2)
    expect(PaymentsClient.create).toHaveBeenCalledTimes(1)
  })

  test('should return different instance for different keys', async () => {
    const registry = createRegistry()
    const opts1 = {
      agentBaseUrl: 'https://agent.example',
      agentId: 'agent1',
      planId: '1',
    }
    const opts2 = {
      agentBaseUrl: 'https://agent.example',
      agentId: 'agent1',
      planId: '2',
    }
    const client1 = await registry.getClient(opts1)
    const client2 = await registry.getClient(opts2)
    expect(client1).not.toBe(client2)
    expect(PaymentsClient.create).toHaveBeenCalledTimes(2)
  })

  test('should raise error when missing parameter', async () => {
    const registry = createRegistry()
    await expect(
      registry.getClient({
        agentBaseUrl: 'https://agent.example',
        agentId: 'agent1',
        planId: '',
      }),
    ).rejects.toThrow()
  })
})
