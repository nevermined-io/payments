import { PaymentsRequestHandler } from '../../src/a2a/paymentsRequestHandler.js'
import { InMemoryTaskStore } from '@a2a-js/sdk/server'

describe('PaymentsRequestHandler', () => {
  let handler: PaymentsRequestHandler
  let mockPaymentsService: any
  let mockAgentExecutor: any
  let mockAgentCard: any

  beforeEach(() => {
    mockPaymentsService = {
      requests: {
        startProcessingRequest: jest.fn().mockResolvedValue({
          balance: { isSubscriber: true },
        }),
      },
    }

    mockAgentExecutor = {
      execute: jest.fn(),
      cancelTask: jest.fn(),
    }

    mockAgentCard = {
      capabilities: {
        extensions: [
          {
            uri: 'urn:nevermined:payment',
            params: { agentId: 'test-agent-id' },
          },
        ],
      },
    }

    handler = new PaymentsRequestHandler(
      mockAgentCard,
      new InMemoryTaskStore(),
      mockAgentExecutor,
      mockPaymentsService,
    )
  })

  describe('sendMessage validation', () => {
    it('should return JSON-RPC error when message is missing', async () => {
      const params = {
        // message is missing
      }

      try {
        await handler.sendMessage(params as any)
        fail('Should have thrown an error')
      } catch (error: any) {
        // A2AError.invalidParams returns a string, not JSON
        expect(error.message).toBe('message is required.')
        expect(error.code).toBe(-32602) // Invalid params
      }
    })

    it('should return JSON-RPC error when messageId is missing', async () => {
      const params = {
        message: {
          // messageId is missing
          role: 'user',
          parts: [{ kind: 'text', text: 'test' }],
        },
      }

      try {
        await handler.sendMessage(params as any)
        fail('Should have thrown an error')
      } catch (error: any) {
        // A2AError.invalidParams returns a string, not JSON
        expect(error.message).toBe('message.messageId is required.')
        expect(error.code).toBe(-32602) // Invalid params
      }
    })
  })
}) 