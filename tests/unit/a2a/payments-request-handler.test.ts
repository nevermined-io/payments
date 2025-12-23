/**
 * Unit tests for PaymentsRequestHandler.
 */

import type { AgentCard, TaskStatusUpdateEvent } from '@a2a-js/sdk'
import { PaymentsRequestHandler } from '../../../src/a2a/paymentsRequestHandler.js'
import type { HttpRequestContext } from '../../../src/a2a/types.js'
import type { Payments } from '../../../src/payments.js'

jest.mock('@a2a-js/sdk/server')

jest.mock('../../../src/utils.js', () => ({
  decodeAccessToken: jest.fn(() => ({
    subscriber: '0xsub',
    subscriberAddress: '0xsub',
    planId: 'plan-1',
  })),
}))

class DummyExecutor {
  async execute(...args: any[]): Promise<any> {
    // Dummy implementation
  }

  async cancelTask(...args: any[]): Promise<void> {
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
      facilitator: {
        settlePermissions: jest.fn().mockResolvedValue({ txHash: '0xabc', amountOfCredits: 5n }),
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
              planId: 'plan-1',
            },
          },
        ],
      },
    } as any as AgentCard
  })

  describe('handleTaskFinalization', () => {
    test('should burn credits when event has creditsUsed', async () => {
      const settleMock = jest.fn().mockResolvedValue({ txHash: '0xabc', amountOfCredits: 5n })
      mockPayments.facilitator.settlePermissions = settleMock

      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

        ; (handler as any).getAgentCard = jest.fn().mockResolvedValue(mockAgentCard)

        // Mock getRedemptionConfig to return non-batch config
        ; (handler as any).getRedemptionConfig = jest.fn().mockResolvedValue({
          useBatch: false,
          useMargin: false,
        })

      // Mock resultManager
      const taskRef = { id: 'tid', metadata: {} as any }
      const mockResultManager = {
        getCurrentTask: jest.fn().mockReturnValue(taskRef),
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

      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      await handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN')

      expect(settleMock).toHaveBeenCalledTimes(1)
      expect(settleMock).toHaveBeenCalledWith({
        planId: 'plan-1',
        maxAmount: 5n,
        x402AccessToken: 'BEARER_TOKEN',
        subscriberAddress: '0xsub',
      })
      expect(event.metadata?.txHash).toBe('0xabc')
      expect(event.metadata?.creditsCharged).toBe(5)
      expect(taskRef.metadata?.txHash).toBe('0xabc')
      expect(taskRef.metadata?.creditsCharged).toBe(5)
      expect(mockResultManager.processEvent).toHaveBeenCalledWith(taskRef)
    })

    test('should not burn credits when event has no creditsUsed', async () => {
      const settleMock = jest.fn().mockResolvedValue({ txHash: '0xabc' })
      mockPayments.facilitator.settlePermissions = settleMock

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

      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      await handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN')

      expect(settleMock).not.toHaveBeenCalled()
    })

    test('should not burn credits when event has no metadata', async () => {
      const settleMock = jest.fn().mockResolvedValue({ txHash: '0xabc' })
      mockPayments.facilitator.settlePermissions = settleMock

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

      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      await handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN')

      expect(settleMock).not.toHaveBeenCalled()
    })

    test('should swallow errors when redemption fails', async () => {
      const settleMock = jest.fn().mockRejectedValue(new Error('Redeem failed'))
      mockPayments.facilitator.settlePermissions = settleMock

      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

        ; (handler as any).getAgentCard = jest.fn().mockResolvedValue(mockAgentCard)

        // Mock getRedemptionConfig to return non-batch config
        ; (handler as any).getRedemptionConfig = jest.fn().mockResolvedValue({
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

      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      // Should not throw
      await expect(
        handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN'),
      ).resolves.not.toThrow()

      expect(settleMock).toHaveBeenCalledTimes(1)
      expect(settleMock).toHaveBeenCalledWith({
        planId: 'plan-1',
        maxAmount: 5n,
        x402AccessToken: 'BEARER_TOKEN',
        subscriberAddress: '0xsub',
      })
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
        ; (handler as any).getAgentCard = jest.fn().mockResolvedValue(agentCardWithoutPayment)

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
