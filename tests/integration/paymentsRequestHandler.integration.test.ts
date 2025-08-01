/**
 * @file PaymentsRequestHandler Integration Tests
 * @description Integration tests for PaymentsRequestHandler functionality including message validation,
 * HTTP context handling, and error scenarios
 */

import {
  PaymentsRequestHandlerFactory,
  PaymentsRequestHandlerTestUtils,
  PaymentsRequestHandlerAssertions,
  PaymentsRequestHandlerTestScenarios,
  PaymentsRequestHandlerErrorCases,
  MockPaymentsService,
  MockAgentExecutor,
} from './helpers/payments-request-handler-helpers.js'

describe('PaymentsRequestHandler Integration', () => {
  let handler: any
  let mockPaymentsService: any
  let mockAgentExecutor: any

  beforeEach(() => {
    // Create fresh mocks for each test
    mockPaymentsService = MockPaymentsService.create()
    mockAgentExecutor = MockAgentExecutor.create()
    
    handler = PaymentsRequestHandlerFactory.create(
      undefined, // Use default agent card
      undefined, // Use default task store
      mockAgentExecutor,
      mockPaymentsService
    )
  })

  describe('Message Validation', () => {
    describe('Invalid Message Scenarios', () => {
      const validationScenarios = PaymentsRequestHandlerTestScenarios.getMessageValidationScenarios()

      validationScenarios.forEach(({ name, params, expectedError }) => {
        it(`should return JSON-RPC error when ${name}`, async () => {
          try {
            await handler.sendMessage(params)
            expect(true).toBe(false) // Should not reach here
          } catch (error: any) {
            PaymentsRequestHandlerAssertions.assertJsonRpcError(
              error, 
              expectedError.code, 
              expectedError.message
            )
          }
        })
      })
    })

    describe('Valid Message Scenarios', () => {
      const validScenarios = PaymentsRequestHandlerTestScenarios.getValidMessageScenarios()

      validScenarios.forEach(({ name, message }) => {
        it(`should handle ${name} with HTTP context`, async () => {
          // Set up HTTP context
          const httpContext = PaymentsRequestHandlerTestUtils.createHttpContext()
          PaymentsRequestHandlerTestUtils.setupHttpContext(handler, message.messageId, httpContext)

          const params = { message }

          const result = await handler.sendMessage(params)
          
          PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
          PaymentsRequestHandlerAssertions.assertTaskCompleted(result)
        })
      })
    })
  })

  describe('HTTP Context Handling', () => {
    it('should handle valid message with HTTP context', async () => {
      const testScenario = await PaymentsRequestHandlerTestUtils.createTestScenario()
      
      const result = await testScenario.handler.sendMessage(testScenario.params)
      
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
      PaymentsRequestHandlerAssertions.assertTaskCompleted(result)
    })

    it('should handle HTTP context with custom validation', async () => {
      const customHttpContext = PaymentsRequestHandlerTestUtils.createHttpContext({
        validation: { 
          balance: { 
            isSubscriber: true
          } 
        }
      })

      const message = PaymentsRequestHandlerTestUtils.createTestMessage()
      PaymentsRequestHandlerTestUtils.setupHttpContext(handler, message.messageId, customHttpContext)

      const params = { message }
      const result = await handler.sendMessage(params)
      
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
    })

    it('should handle HTTP context with custom bearer token', async () => {
      const customHttpContext = PaymentsRequestHandlerTestUtils.createHttpContext({
        bearerToken: 'custom-test-token-123'
      })

      const message = PaymentsRequestHandlerTestUtils.createTestMessage()
      PaymentsRequestHandlerTestUtils.setupHttpContext(handler, message.messageId, customHttpContext)

      const params = { message }
      const result = await handler.sendMessage(params)
      
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
    })
  })

  describe('Service Integration', () => {
    it('should process messages successfully', async () => {
      const testScenario = await PaymentsRequestHandlerTestUtils.createTestScenario()
      
      const result = await testScenario.handler.sendMessage(testScenario.params)
      
      // Verify the result is valid
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
      PaymentsRequestHandlerAssertions.assertTaskCompleted(result)
    })

    it('should handle multiple message processing', async () => {
      const testScenario = await PaymentsRequestHandlerTestUtils.createTestScenario()
      
      // Send first message
      const result1 = await testScenario.handler.sendMessage(testScenario.params)
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result1)
      
      // Send second message
      const secondMessage = PaymentsRequestHandlerTestUtils.createTestMessage({
        parts: [{ kind: 'text' as const, text: 'Second test message' }]
      })
      PaymentsRequestHandlerTestUtils.setupHttpContext(
        testScenario.handler, 
        secondMessage.messageId, 
        testScenario.httpContext
      )
      
      const result2 = await testScenario.handler.sendMessage({ message: secondMessage })
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result2)
    })
  })

  describe('Error Handling', () => {
    it('should handle missing HTTP context', async () => {
      const handler = PaymentsRequestHandlerFactory.create()
      const message = PaymentsRequestHandlerTestUtils.createTestMessage()

      try {
        await handler.sendMessage({ message })
        expect(true).toBe(false) // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('HTTP context not found')
      }
    })

    it('should handle agent executor errors gracefully', async () => {
      // Create a mock executor with a jest function that can be modified
      const mockExecute = jest.fn().mockRejectedValue(new Error('Agent execution error'))
      const mockCancelTask = jest.fn().mockResolvedValue(undefined)
      
      const mockAgentExecutor = {
        execute: mockExecute,
        cancelTask: mockCancelTask,
      }

      const handler = PaymentsRequestHandlerFactory.create(
        undefined,
        undefined,
        mockAgentExecutor as any,
        MockPaymentsService.create()
      )

      const message = PaymentsRequestHandlerTestUtils.createTestMessage()
      PaymentsRequestHandlerTestUtils.setupHttpContext(handler, message.messageId)

      // The handler should handle the error gracefully by creating a failed task
      // instead of throwing an exception
      const result = await handler.sendMessage({ message })

      // Verify that we get a failed task response (not an exception)
      PaymentsRequestHandlerAssertions.assertTaskFailed(result)
      
      // Verify the error message contains the executor error
      expect((result as any).status.message.parts[0].text).toContain('Agent execution error')
      
      // Verify that the execute method was called
      expect(mockExecute).toHaveBeenCalledTimes(1)
    })
  })

  describe('Configuration and Customization', () => {
    it('should work with custom agent card', async () => {
      const customAgentCard = {
        name: 'Custom Test Agent',
        description: 'Custom test agent for testing',
        capabilities: {
          extensions: [
            {
              uri: 'urn:nevermined:payment',
              params: { 
                agentId: 'custom-agent-id',
                paymentType: 'credits',
                credits: 5
              },
            },
          ],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3000',
        version: '1.0.0',
      }

      const customHandler = PaymentsRequestHandlerFactory.createWithCustomConfig({
        agentCard: customAgentCard,
        agentExecutor: MockAgentExecutor.create(),
        paymentsService: MockPaymentsService.create()
      })

      const testScenario = await PaymentsRequestHandlerTestUtils.createTestScenario({
        handler: customHandler
      })

      const result = await testScenario.handler.sendMessage(testScenario.params)
      
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
      PaymentsRequestHandlerAssertions.assertTaskCompleted(result)
    })

    it('should work with custom task store', async () => {
      const { InMemoryTaskStore } = await import('@a2a-js/sdk/server')
      const customTaskStore = new InMemoryTaskStore()

      const customHandler = PaymentsRequestHandlerFactory.createWithCustomConfig({
        taskStore: customTaskStore,
        agentExecutor: MockAgentExecutor.create(),
        paymentsService: MockPaymentsService.create()
      })

      const testScenario = await PaymentsRequestHandlerTestUtils.createTestScenario({
        handler: customHandler
      })

      const result = await testScenario.handler.sendMessage(testScenario.params)
      
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
      PaymentsRequestHandlerAssertions.assertTaskCompleted(result)
    })
  })

  describe('Edge Cases', () => {
    it('should handle message with empty parts array', async () => {
      const message = PaymentsRequestHandlerTestUtils.createTestMessage({
        parts: []
      })

      const testScenario = await PaymentsRequestHandlerTestUtils.createTestScenario({
        message
      })

      const result = await testScenario.handler.sendMessage(testScenario.params)
      
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
    })

    it('should handle message with multiple parts', async () => {
      const message = PaymentsRequestHandlerTestUtils.createTestMessage({
        parts: [
          { kind: 'text' as const, text: 'First part' },
          { kind: 'text' as const, text: 'Second part' }
        ]
      })

      const testScenario = await PaymentsRequestHandlerTestUtils.createTestScenario({
        message
      })

      const result = await testScenario.handler.sendMessage(testScenario.params)
      
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
      PaymentsRequestHandlerAssertions.assertTaskCompleted(result)
    })

    it('should handle message with metadata', async () => {
      const message = PaymentsRequestHandlerTestUtils.createTestMessage({
        metadata: {
          userId: 'test-user-123',
          sessionId: 'test-session-456',
          timestamp: new Date().toISOString()
        }
      })

      const testScenario = await PaymentsRequestHandlerTestUtils.createTestScenario({
        message
      })

      const result = await testScenario.handler.sendMessage(testScenario.params)
      
      PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.userId).toBe('test-user-123')
    })
  })
}) 