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

  test('a v3 request does not resolve to a cached v2 client', async () => {
    // The cache key carries tokenVersion. Without it, the second caller — who
    // explicitly asked for a single-use, seller-bound token — would silently get
    // the v2 client cached by the first, which mints reusable tokens and caches
    // one for its whole lifetime.
    const registry = createRegistry()
    const base = { agentBaseUrl: 'https://agent.example', agentId: 'agent1', planId: '1' }

    const v2Client = await registry.getClient(base)
    const v3Client = await registry.getClient({ ...base, tokenVersion: 3 as const })

    expect(v3Client).not.toBe(v2Client)
    expect(PaymentsClient.create).toHaveBeenCalledTimes(2)
    expect((PaymentsClient.create as jest.Mock).mock.calls[1][6]).toBe(3)
  })

  test('a default request does not resolve to a cached v3 client', async () => {
    // The inverse: whoever asks first must not put everyone else on per-call
    // v3 mints.
    const registry = createRegistry()
    const base = { agentBaseUrl: 'https://agent.example', agentId: 'agent1', planId: '1' }

    const v3Client = await registry.getClient({ ...base, tokenVersion: 3 as const })
    const v2Client = await registry.getClient(base)

    expect(v2Client).not.toBe(v3Client)
    expect(PaymentsClient.create).toHaveBeenCalledTimes(2)
    expect((PaymentsClient.create as jest.Mock).mock.calls[1][6]).toBeUndefined()
  })

  test('two v3 requests still share one client', async () => {
    const registry = createRegistry()
    const opts = {
      agentBaseUrl: 'https://agent.example',
      agentId: 'agent1',
      planId: '1',
      tokenVersion: 3 as const,
    }

    expect(await registry.getClient(opts)).toBe(await registry.getClient(opts))
    expect(PaymentsClient.create).toHaveBeenCalledTimes(1)
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
