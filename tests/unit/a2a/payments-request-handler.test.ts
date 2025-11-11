/**
 * Unit tests for PaymentsRequestHandler.
 */

import { PaymentsRequestHandler } from '../../../src/a2a/paymentsRequestHandler.js'
import type { Payments } from '../../../src/payments.js'
import type { HttpRequestContext } from '../../../src/a2a/types.js'
import type { AgentCard, TaskStatusUpdateEvent } from '@a2a-js/sdk'

jest.mock('@a2a-js/sdk/server')

class DummyExecutor {
  async execute(...args: any[]): Promise<any> {
    // Dummy implementation
  }
}

describe('PaymentsRequestHandler', () => {
  let mockPayments: any
  let mockTaskStore: any
  let mockAgentCard: AgentCard

  beforeEach(() => {
    jest.clearAllMocks()

    mockPayments = {
      requests: {
        redeemCreditsFromRequest: jest.fn().mockResolvedValue({ txHash: '0xabc' }),
      },
    }

    mockTaskStore = {
      save: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(undefined),
    }

    mockAgentCard = {
      capabilities: {
        extensions: [
          {
            uri: 'urn:nevermined:payment',
            params: {
              agentId: 'test-agent',
            },
          },
        ],
      },
    } as any as AgentCard
  })

  describe('handleTaskFinalization', () => {
    test('should burn credits when event has creditsUsed', async () => {
      const redeemMock = jest.fn().mockResolvedValue({ txHash: '0xabc' })
      mockPayments.requests.redeemCreditsFromRequest = redeemMock

      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      // Mock getRedemptionConfig to return non-batch config
      ;(handler as any).getRedemptionConfig = jest.fn().mockResolvedValue({
        useBatch: false,
        useMargin: false,
      })

      // Mock resultManager
      const mockResultManager = {
        getCurrentTask: jest.fn().mockReturnValue({ id: 'tid', metadata: {} }),
        processEvent: jest.fn().mockResolvedValue(undefined),
      }

      const event: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 'tid',
        contextId: 'ctx-123',
        status: { state: 'completed' },
        final: true,
        metadata: { creditsUsed: 5 },
      } as TaskStatusUpdateEvent

      const validation = { agentRequestId: 'test-agent-req' } as any

      // Mock the internal method
      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      await handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN', validation)

      expect(redeemMock).toHaveBeenCalledTimes(1)
      expect(redeemMock).toHaveBeenCalledWith('test-agent-req', 'BEARER_TOKEN', 5n)
    })

    test('should not burn credits when event has no creditsUsed', async () => {
      const redeemMock = jest.fn().mockResolvedValue({ txHash: '0xabc' })
      mockPayments.requests.redeemCreditsFromRequest = redeemMock

      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      const mockResultManager = {
        getCurrentTask: jest.fn().mockReturnValue({ id: 'tid', metadata: {} }),
        processEvent: jest.fn().mockResolvedValue(undefined),
      }

      const event: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 'tid',
        contextId: 'ctx-123',
        status: { state: 'completed' },
        final: true,
        metadata: {}, // No creditsUsed
      } as TaskStatusUpdateEvent

      const validation = { agentRequestId: 'test-agent-req' } as any

      // Mock the internal method
      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      await handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN', validation)

      expect(redeemMock).not.toHaveBeenCalled()
    })

    test('should not burn credits when event has no metadata', async () => {
      const redeemMock = jest.fn().mockResolvedValue({ txHash: '0xabc' })
      mockPayments.requests.redeemCreditsFromRequest = redeemMock

      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      const mockResultManager = {
        getCurrentTask: jest.fn().mockReturnValue({ id: 'tid', metadata: {} }),
        processEvent: jest.fn().mockResolvedValue(undefined),
      }

      const event: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 'tid',
        contextId: 'ctx-123',
        status: { state: 'completed' },
        final: true,
        metadata: {}, // No metadata
      } as TaskStatusUpdateEvent

      const validation = { agentRequestId: 'test-agent-req' } as any

      // Mock the internal method
      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      await handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN', validation)

      expect(redeemMock).not.toHaveBeenCalled()
    })

    test('should swallow errors when redemption fails', async () => {
      const redeemMock = jest.fn().mockRejectedValue(new Error('Redeem failed'))
      mockPayments.requests.redeemCreditsFromRequest = redeemMock

      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      // Mock getRedemptionConfig to return non-batch config
      ;(handler as any).getRedemptionConfig = jest.fn().mockResolvedValue({
        useBatch: false,
        useMargin: false,
      })

      const mockResultManager = {
        getCurrentTask: jest.fn().mockReturnValue({ id: 'tid', metadata: {} }),
        processEvent: jest.fn().mockResolvedValue(undefined),
      }

      const event: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 'tid',
        contextId: 'ctx-123',
        status: { state: 'completed' },
        final: true,
        metadata: { creditsUsed: 5 },
      } as TaskStatusUpdateEvent

      const validation = { agentRequestId: 'test-agent-req' } as any

      // Mock the internal method
      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      // Should not throw
      await expect(
        handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN', validation),
      ).resolves.not.toThrow()

      expect(redeemMock).toHaveBeenCalledTimes(1)
      expect(redeemMock).toHaveBeenCalledWith('test-agent-req', 'BEARER_TOKEN', 5n)
    })
  })

  describe('HTTP context management', () => {
    test('should set and get HTTP context for task', () => {
      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      const ctx: HttpRequestContext = {
        bearerToken: 'BEARER',
        urlRequested: 'https://x',
        httpMethodRequested: 'POST',
        validation: { agentRequestId: 'agentReq' } as any,
      }

      handler.setHttpRequestContextForTask('tid', ctx)
      const retrieved = (handler as any).getHttpRequestContextForTask('tid')
      expect(retrieved).toBe(ctx)
    })

    test('should set and get HTTP context for message', () => {
      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      const ctx: HttpRequestContext = {
        bearerToken: 'BEARER',
        urlRequested: 'https://x',
        httpMethodRequested: 'POST',
        validation: { agentRequestId: 'agentReq' } as any,
      }

      handler.setHttpRequestContextForMessage('mid', ctx)
      const retrieved = (handler as any).getHttpRequestContextForMessage('mid')
      expect(retrieved).toBe(ctx)
    })

    test('should delete HTTP context for task', () => {
      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      const ctx: HttpRequestContext = {
        bearerToken: 'BEARER',
        urlRequested: 'https://x',
        httpMethodRequested: 'POST',
        validation: { agentRequestId: 'agentReq' } as any,
      }

      handler.setHttpRequestContextForTask('tid', ctx)
      handler.deleteHttpRequestContextForTask('tid')
      const retrieved = (handler as any).getHttpRequestContextForTask('tid')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('agent card validation', () => {
    test('should return default config when payment extension is missing', async () => {
      const agentCardWithoutPayment: AgentCard = {
        capabilities: {
          extensions: [],
        },
      } as any as AgentCard

      const handler = new PaymentsRequestHandler(
        agentCardWithoutPayment,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      // Mock getAgentCard to return card without payment extension
      ;(handler as any).getAgentCard = jest.fn().mockResolvedValue(agentCardWithoutPayment)

      // Try to get redemption config - should return default config
      const config = await (handler as any).getRedemptionConfig()
      expect(config).toEqual({
        useBatch: false,
        useMargin: false,
        marginPercent: undefined,
      })
    })
  })
})
