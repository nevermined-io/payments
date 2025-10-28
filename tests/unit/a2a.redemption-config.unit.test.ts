/**
 * @file Unit tests for A2A redemption configuration functionality
 */

import {
  PaymentsRequestHandler,
  PaymentsRequestHandlerOptions,
} from '../../src/a2a/paymentsRequestHandler.js'
import type { PaymentRedemptionConfig } from '../../src/a2a/types.js'
import type { AgentCard } from '../../src/a2a/types.js'

// Mock dependencies
const mockPaymentsService = {
  requests: {
    redeemCreditsFromRequest: jest.fn(),
    redeemWithMarginFromRequest: jest.fn(),
    redeemCreditsFromBatchRequest: jest.fn(),
    redeemWithMarginFromBatchRequest: jest.fn(),
    startProcessingRequest: jest.fn(),
  },
}

const mockTaskStore = {
  save: jest.fn(),
  get: jest.fn(),
}

const mockAgentExecutor = {
  execute: jest.fn(),
  cancelTask: jest.fn(),
}

const mockEventBusManager = {}

// Mock AgentCard
const createMockAgentCard = (redemptionConfig?: PaymentRedemptionConfig): AgentCard => ({
  name: 'Test Agent',
  description: 'Test agent for unit tests',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
    extensions: [
      {
        uri: 'urn:nevermined:payment',
        params: {
          paymentType: 'fixed',
          credits: 10,
          costDescription: 'Test agent',
          agentId: 'test-agent-id',
          ...(redemptionConfig && { redemptionConfig }),
        },
      },
    ],
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [],
  url: 'http://localhost:3000',
  version: '1.0.0',
  protocolVersion: '0.3.0',
})

describe('PaymentsRequestHandler - Redemption Configuration', () => {
  let handler: PaymentsRequestHandler
  let mockAgentCard: AgentCard

  beforeEach(() => {
    jest.clearAllMocks()
    mockAgentCard = createMockAgentCard()
  })

  describe('Constructor and Options', () => {
    it('should initialize with default options', () => {
      handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        mockAgentExecutor,
        mockPaymentsService,
        mockEventBusManager,
      )

      const options = handler.getHandlerOptions()
      expect(options.asyncExecution).toBe(false)
      expect(options.defaultBatch).toBe(false)
      expect(options.defaultMarginPercent).toBeUndefined()
    })

    it('should initialize with custom options', () => {
      const customOptions: PaymentsRequestHandlerOptions = {
        asyncExecution: true,
        defaultBatch: true,
        defaultMarginPercent: 15,
      }

      handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        mockAgentExecutor,
        mockPaymentsService,
        mockEventBusManager,
        customOptions,
      )

      const options = handler.getHandlerOptions()
      expect(options.asyncExecution).toBe(true)
      expect(options.defaultBatch).toBe(true)
      expect(options.defaultMarginPercent).toBe(15)
    })
  })

  describe('getRedemptionConfig', () => {
    beforeEach(() => {
      handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        mockAgentExecutor,
        mockPaymentsService,
        mockEventBusManager,
      )
    })

    it('should return default config when no agent card config is provided', async () => {
      const config = await handler['getRedemptionConfig']('test-task-id')

      expect(config).toEqual({
        useBatch: false,
        useMargin: false,
        marginPercent: undefined,
      })
    })

    it('should return agent card config when provided', async () => {
      const agentRedemptionConfig: PaymentRedemptionConfig = {
        useBatch: true,
        useMargin: true,
        marginPercent: 20,
      }

      const agentCardWithConfig = createMockAgentCard(agentRedemptionConfig)
      handler = new PaymentsRequestHandler(
        agentCardWithConfig,
        mockTaskStore,
        mockAgentExecutor,
        mockPaymentsService,
        mockEventBusManager,
      )

      const config = await handler['getRedemptionConfig']('test-task-id')

      expect(config).toEqual({
        useBatch: true,
        useMargin: true,
        marginPercent: 20,
      })
    })

    it('should merge agent card config with handler defaults', async () => {
      const agentRedemptionConfig: PaymentRedemptionConfig = {
        useBatch: true,
        // marginPercent not provided in agent card
      }

      const agentCardWithConfig = createMockAgentCard(agentRedemptionConfig)
      handler = new PaymentsRequestHandler(
        agentCardWithConfig,
        mockTaskStore,
        mockAgentExecutor,
        mockPaymentsService,
        mockEventBusManager,
        { defaultMarginPercent: 25 },
      )

      const config = await handler['getRedemptionConfig']('test-task-id')

      expect(config).toEqual({
        useBatch: true,
        useMargin: false,
        marginPercent: 25, // From handler defaults
      })
    })

    it('should prioritize agent card config over handler defaults', async () => {
      const agentRedemptionConfig: PaymentRedemptionConfig = {
        useBatch: false,
        useMargin: true,
        marginPercent: 30,
      }

      const agentCardWithConfig = createMockAgentCard(agentRedemptionConfig)
      handler = new PaymentsRequestHandler(
        agentCardWithConfig,
        mockTaskStore,
        mockAgentExecutor,
        mockPaymentsService,
        mockEventBusManager,
        {
          defaultBatch: true, // This should be overridden
          defaultMarginPercent: 10, // This should be overridden
        },
      )

      const config = await handler['getRedemptionConfig']('test-task-id')

      expect(config).toEqual({
        useBatch: false, // From agent card
        useMargin: true, // From agent card
        marginPercent: 30, // From agent card
      })
    })
  })

  describe('executeRedemption', () => {
    beforeEach(() => {
      handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        mockAgentExecutor,
        mockPaymentsService,
        mockEventBusManager,
      )
    })

    const mockValidation = {
      agentRequestId: 'test-request-id',
      agentName: 'test-agent',
      agentId: 'test-agent-id',
      balance: { isSubscriber: true, credits: 100 } as any,
      urlMatching: 'http://test.com',
      planId: 'test-plan-id',
      subscriber: 'test-subscriber',
      verbMatching: 'POST',
      batch: false,
    } as any
    const mockBearerToken = 'test-bearer-token'
    const mockCreditsUsed = 10n

    it('should call redeemCreditsFromRequest for single fixed credits', async () => {
      const config: PaymentRedemptionConfig = {
        useBatch: false,
        useMargin: false,
      }

      mockPaymentsService.requests.redeemCreditsFromRequest.mockResolvedValue({
        txHash: 'test-tx-hash',
        success: true,
      })

      await handler['executeRedemption'](mockValidation, mockBearerToken, mockCreditsUsed, config)

      expect(mockPaymentsService.requests.redeemCreditsFromRequest).toHaveBeenCalledWith(
        'test-request-id',
        'test-bearer-token',
        10n,
      )
      expect(mockPaymentsService.requests.redeemWithMarginFromRequest).not.toHaveBeenCalled()
      expect(mockPaymentsService.requests.redeemCreditsFromBatchRequest).not.toHaveBeenCalled()
      expect(mockPaymentsService.requests.redeemWithMarginFromBatchRequest).not.toHaveBeenCalled()
    })

    it('should call redeemWithMarginFromRequest for single margin redemption', async () => {
      const config: PaymentRedemptionConfig = {
        useBatch: false,
        useMargin: true,
        marginPercent: 15,
      }

      mockPaymentsService.requests.redeemWithMarginFromRequest.mockResolvedValue({
        txHash: 'test-tx-hash',
        success: true,
        amountOfCredits: 12,
      })

      await handler['executeRedemption'](mockValidation, mockBearerToken, mockCreditsUsed, config)

      expect(mockPaymentsService.requests.redeemWithMarginFromRequest).toHaveBeenCalledWith(
        'test-request-id',
        'test-bearer-token',
        15,
      )
      expect(mockPaymentsService.requests.redeemCreditsFromRequest).not.toHaveBeenCalled()
    })

    it('should call redeemCreditsFromBatchRequest for batch fixed credits', async () => {
      const config: PaymentRedemptionConfig = {
        useBatch: true,
        useMargin: false,
      }

      mockPaymentsService.requests.redeemCreditsFromBatchRequest.mockResolvedValue({
        txHash: 'test-tx-hash',
        success: true,
      })

      await handler['executeRedemption'](mockValidation, mockBearerToken, mockCreditsUsed, config)

      expect(mockPaymentsService.requests.redeemCreditsFromBatchRequest).toHaveBeenCalledWith(
        'test-request-id',
        'test-bearer-token',
        10n,
      )
      expect(mockPaymentsService.requests.redeemCreditsFromRequest).not.toHaveBeenCalled()
    })

    it('should call redeemWithMarginFromBatchRequest for batch margin redemption', async () => {
      const config: PaymentRedemptionConfig = {
        useBatch: true,
        useMargin: true,
        marginPercent: 20,
      }

      mockPaymentsService.requests.redeemWithMarginFromBatchRequest.mockResolvedValue({
        txHash: 'test-tx-hash',
        success: true,
        amountOfCredits: 12,
      })

      await handler['executeRedemption'](mockValidation, mockBearerToken, mockCreditsUsed, config)

      expect(mockPaymentsService.requests.redeemWithMarginFromBatchRequest).toHaveBeenCalledWith(
        'test-request-id',
        'test-bearer-token',
        20,
      )
      expect(mockPaymentsService.requests.redeemCreditsFromRequest).not.toHaveBeenCalled()
    })
  })

  describe('getRedemptionMethodName', () => {
    beforeEach(() => {
      handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        mockAgentExecutor,
        mockPaymentsService,
        mockEventBusManager,
      )
    })

    it('should return correct name for single fixed credits', () => {
      const config: PaymentRedemptionConfig = {
        useBatch: false,
        useMargin: false,
      }

      const methodName = handler['getRedemptionMethodName'](config)
      expect(methodName).toBe('single-fixed')
    })

    it('should return correct name for single margin redemption', () => {
      const config: PaymentRedemptionConfig = {
        useBatch: false,
        useMargin: true,
        marginPercent: 15,
      }

      const methodName = handler['getRedemptionMethodName'](config)
      expect(methodName).toBe('single-margin-15%')
    })

    it('should return correct name for batch fixed credits', () => {
      const config: PaymentRedemptionConfig = {
        useBatch: true,
        useMargin: false,
      }

      const methodName = handler['getRedemptionMethodName'](config)
      expect(methodName).toBe('batch-fixed')
    })

    it('should return correct name for batch margin redemption', () => {
      const config: PaymentRedemptionConfig = {
        useBatch: true,
        useMargin: true,
        marginPercent: 25,
      }

      const methodName = handler['getRedemptionMethodName'](config)
      expect(methodName).toBe('batch-margin-25%')
    })
  })

  describe('validateRequest with batch parameter', () => {
    beforeEach(() => {
      handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        mockAgentExecutor,
        mockPaymentsService,
        mockEventBusManager,
      )
    })

    it('should call startProcessingRequest with batch=false by default', async () => {
      mockPaymentsService.requests.startProcessingRequest.mockResolvedValue({
        success: true,
        balance: { isSubscriber: true },
      })

      await handler.validateRequest('agent-id', 'bearer-token', 'http://test.com', 'POST')

      expect(mockPaymentsService.requests.startProcessingRequest).toHaveBeenCalledWith(
        'agent-id',
        'bearer-token',
        'http://test.com',
        'POST',
        false,
      )
    })

    it('should call startProcessingRequest with batch=true when specified', async () => {
      mockPaymentsService.requests.startProcessingRequest.mockResolvedValue({
        success: true,
        balance: { isSubscriber: true },
      })

      await handler.validateRequest('agent-id', 'bearer-token', 'http://test.com', 'POST', true)

      expect(mockPaymentsService.requests.startProcessingRequest).toHaveBeenCalledWith(
        'agent-id',
        'bearer-token',
        'http://test.com',
        'POST',
        true,
      )
    })
  })
})
