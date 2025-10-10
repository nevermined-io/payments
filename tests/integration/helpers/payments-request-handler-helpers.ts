/**
 * @file PaymentsRequestHandler Integration Test Helpers
 * @description Utilities and mocks for PaymentsRequestHandler integration tests
 */

import { PaymentsRequestHandler } from '../../../src/a2a/paymentsRequestHandler.js'
// @ts-ignore - Module resolution issue with @a2a-js/sdk/server in linter
import { InMemoryTaskStore } from '@a2a-js/sdk/server'
// @ts-ignore - Module resolution issue with @a2a-js/sdk/server in linter
import type { AgentExecutor } from '@a2a-js/sdk/server'
import { AgentCard } from '../../../src/a2a/types.js'
import { v4 as uuidv4 } from 'uuid'

// Test Data
export const PAYMENTS_REQUEST_HANDLER_TEST_DATA = {
  VALID_MESSAGE: {
    messageId: 'test-message-id',
    role: 'user' as const,
    kind: 'message' as const,
    parts: [{ kind: 'text' as const, text: 'test message' }],
  },

  VALID_HTTP_CONTEXT: {
    bearerToken: 'test-token',
    urlRequested: 'http://localhost:3000/a2a/',
    httpMethodRequested: 'POST',
    validation: { balance: { isSubscriber: true } },
  },

  AGENT_CARD: {
    name: 'Test Agent',
    description: 'Test agent for PaymentsRequestHandler tests',
    capabilities: {
      extensions: [
        {
          uri: 'urn:nevermined:payment',
          params: { agentId: 'test-agent-id' },
        },
      ],
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3000',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  } as AgentCard,
}

// Mock Services
export class MockPaymentsService {
  static create(): any {
    return {
      requests: {
        startProcessingRequest: jest.fn().mockResolvedValue({
          balance: { isSubscriber: true },
        }),
        redeemCreditsFromRequest: jest.fn().mockResolvedValue({
          txHash: '0x1234567890abcdef',
        }),
      },
      plans: {
        redeemCreditsFromRequest: jest.fn().mockResolvedValue(true),
        getPlanBalance: jest.fn().mockResolvedValue({
          balance: '100',
        }),
      },
    }
  }
}

export class MockAgentExecutor {
  static create(): AgentExecutor {
    return {
      execute: jest.fn().mockImplementation(async (requestContext, eventBus) => {
        // Simulate successful execution
        const taskId = requestContext.taskId
        const contextId = requestContext.userMessage.contextId || 'test-context'

        // Publish submitted status
        eventBus.publish({
          kind: 'task',
          id: taskId,
          contextId,
          status: { state: 'submitted', timestamp: new Date().toISOString() },
          history: [requestContext.userMessage],
          metadata: requestContext.userMessage.metadata,
        })

        // Publish completed status with creditsUsed metadata
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'completed',
            message: {
              kind: 'message',
              role: 'agent',
              messageId: 'test-message-id',
              parts: [{ kind: 'text', text: 'Request completed successfully!' }],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          metadata: {
            creditsUsed: 10,
          },
          final: true,
        })
      }),
      cancelTask: jest.fn().mockResolvedValue(undefined),
    }
  }
}

// Test Scenarios
export class PaymentsRequestHandlerTestScenarios {
  /**
   * Tests message validation scenarios
   */
  static getMessageValidationScenarios() {
    return [
      {
        name: 'missing message',
        params: {},
        expectedError: {
          code: -32602,
          message: 'message is required.',
        },
      },
      {
        name: 'missing messageId',
        params: {
          message: {
            role: 'user',
            kind: 'message' as const,
            parts: [{ kind: 'text', text: 'test' }],
          },
        },
        expectedError: {
          code: -32602,
          message: 'message.messageId is required.',
        },
      },
    ]
  }

  /**
   * Tests valid message scenarios
   */
  static getValidMessageScenarios() {
    return [
      {
        name: 'basic valid message',
        message: {
          messageId: uuidv4(),
          role: 'user' as const,
          kind: 'message' as const,
          parts: [{ kind: 'text' as const, text: 'Hello world' }],
        },
      },
      {
        name: 'message with contextId',
        message: {
          messageId: uuidv4(),
          role: 'user' as const,
          kind: 'message' as const,
          parts: [{ kind: 'text' as const, text: 'Hello with context' }],
          contextId: 'test-context-id',
        },
      },
      {
        name: 'message with metadata',
        message: {
          messageId: uuidv4(),
          role: 'user' as const,
          kind: 'message' as const,
          parts: [{ kind: 'text' as const, text: 'Hello with metadata' }],
          metadata: { testKey: 'testValue' },
        },
      },
    ]
  }
}

// Factory Functions
export class PaymentsRequestHandlerFactory {
  /**
   * Creates a PaymentsRequestHandler instance with mocked dependencies
   */
  static create(
    agentCard?: AgentCard,
    taskStore?: InMemoryTaskStore,
    agentExecutor?: AgentExecutor,
    paymentsService?: any,
  ): PaymentsRequestHandler {
    return new PaymentsRequestHandler(
      agentCard || PAYMENTS_REQUEST_HANDLER_TEST_DATA.AGENT_CARD,
      taskStore || new InMemoryTaskStore(),
      agentExecutor || MockAgentExecutor.create(),
      paymentsService || MockPaymentsService.create(),
    )
  }

  /**
   * Creates a handler with custom configuration
   */
  static createWithCustomConfig(config: {
    agentCard?: AgentCard
    taskStore?: InMemoryTaskStore
    agentExecutor?: AgentExecutor
    paymentsService?: any
  }): PaymentsRequestHandler {
    return this.create(
      config.agentCard,
      config.taskStore,
      config.agentExecutor,
      config.paymentsService,
    )
  }
}

// Test Utilities
export class PaymentsRequestHandlerTestUtils {
  /**
   * Creates a test message with optional overrides
   */
  static createTestMessage(
    overrides: Partial<{
      messageId?: string
      role?: 'user'
      parts?: Array<{ kind: 'text'; text: string }>
      contextId?: string
      metadata?: any
    }> = {},
  ) {
    return {
      ...PAYMENTS_REQUEST_HANDLER_TEST_DATA.VALID_MESSAGE,
      messageId: uuidv4(),
      kind: 'message' as const,
      ...overrides,
    }
  }

  /**
   * Creates HTTP context with optional overrides
   */
  static createHttpContext(
    overrides: Partial<{
      bearerToken?: string
      urlRequested?: string
      httpMethodRequested?: string
      validation?: any
    }> = {},
  ) {
    return {
      ...PAYMENTS_REQUEST_HANDLER_TEST_DATA.VALID_HTTP_CONTEXT,
      ...overrides,
    }
  }

  /**
   * Sets up HTTP context for a specific message
   */
  static setupHttpContext(handler: PaymentsRequestHandler, messageId: string, context?: any) {
    const httpContext = context || this.createHttpContext()
    handler.setHttpRequestContextForMessage(messageId, httpContext)
  }

  /**
   * Creates a complete test scenario with handler and context
   */
  static async createTestScenario(
    options: {
      message?: any
      httpContext?: any
      handler?: PaymentsRequestHandler
    } = {},
  ) {
    const handler = options.handler || PaymentsRequestHandlerFactory.create()
    const message = options.message || this.createTestMessage()
    const httpContext = options.httpContext || this.createHttpContext()

    // Set up HTTP context
    this.setupHttpContext(handler, message.messageId, httpContext)

    return {
      handler,
      message,
      httpContext,
      params: { message },
    }
  }
}

// Assertion Helpers
export class PaymentsRequestHandlerAssertions {
  /**
   * Asserts that a JSON-RPC error response is valid
   */
  static assertJsonRpcError(error: any, expectedCode: number, expectedMessage?: string) {
    expect(error.code).toBe(expectedCode)
    if (expectedMessage) {
      expect(error.message).toBe(expectedMessage)
    }
  }

  /**
   * Asserts that a task response is valid
   */
  static assertValidTaskResponse(result: any) {
    expect(result).toBeDefined()
    expect(result.kind).toBe('task')
    expect(result.id).toBeDefined()
    expect(result.contextId).toBeDefined()
    expect(result.status).toBeDefined()
    expect(result.history).toBeDefined()
    expect(result.history.length).toBeGreaterThan(0)
  }

  /**
   * Asserts that a task is completed
   */
  static assertTaskCompleted(result: any) {
    this.assertValidTaskResponse(result)
    expect(result.status.state).toBe('completed')
    expect(result.status.message).toBeDefined()
    expect(result.status.message.role).toBe('agent')
  }

  /**
   * Asserts that a task is submitted
   */
  static assertTaskSubmitted(result: any) {
    this.assertValidTaskResponse(result)
    expect(result.status.state).toBe('submitted')
  }

  /**
   * Asserts that a task is failed
   */
  static assertTaskFailed(result: any) {
    this.assertValidTaskResponse(result)
    expect(result.status.state).toBe('failed')
    expect(result.status.message).toBeDefined()
    expect(result.status.message.role).toBe('agent')
  }

  /**
   * Asserts that payments service methods were called correctly
   */
  static assertPaymentsServiceCalls(
    paymentsService: any,
    expectedCalls: {
      startProcessingRequest?: number
      redeemCreditsFromRequest?: number
    } = {},
  ) {
    if (expectedCalls.startProcessingRequest !== undefined) {
      expect(paymentsService.requests.startProcessingRequest).toHaveBeenCalledTimes(
        expectedCalls.startProcessingRequest,
      )
    }

    if (expectedCalls.redeemCreditsFromRequest !== undefined) {
      expect(paymentsService.plans.redeemCreditsFromRequest).toHaveBeenCalledTimes(
        expectedCalls.redeemCreditsFromRequest,
      )
    }
  }

  /**
   * Asserts that agent executor methods were called correctly
   */
  static assertAgentExecutorCalls(
    agentExecutor: any,
    expectedCalls: {
      execute?: number
      cancelTask?: number
    } = {},
  ) {
    if (expectedCalls.execute !== undefined) {
      expect(agentExecutor.execute).toHaveBeenCalledTimes(expectedCalls.execute)
    }

    if (expectedCalls.cancelTask !== undefined) {
      expect(agentExecutor.cancelTask).toHaveBeenCalledTimes(expectedCalls.cancelTask)
    }
  }
}

// Error Test Cases
export class PaymentsRequestHandlerErrorCases {
  /**
   * Tests for various error scenarios
   */
  static getErrorScenarios() {
    return [
      {
        name: 'payments service throws error',
        setup: (paymentsService: any) => {
          paymentsService.requests.startProcessingRequest.mockRejectedValue(
            new Error('Payment service error'),
          )
        },
        expectedError: 'Payment service error',
      },
    ]
  }
}
