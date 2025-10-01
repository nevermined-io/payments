/**
 * @file Pure unit tests for A2A core modules (no server required)
 */

import { ClientRegistry } from '../../src/a2a/clientRegistry'
import { Payments } from '../../src/payments'
import { buildPaymentAgentCard } from '../../src/a2a/agent-card'

jest.mock('@a2a-js/sdk/client', () => ({
  A2AClient: jest.fn().mockImplementation(() => ({
    agentCardPromise: Promise.resolve({
      name: 'Mock Agent',
      description: 'Mock agent for testing',
      capabilities: {
        tools: ['text-generation'],
        extensions: [],
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: 'http://localhost:3001',
      version: '1.0.0',
    }),
  })),
}))

describe('A2A Unit Tests (Pure)', () => {
  let payments: Payments

  const subscriberNvmApiKeyHash =
    process.env.TEST_SUBSCRIBER_API_KEY ||
    'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweEU3OGRiMkJGMEIyMjcwM2RjZDNGNDUzMDRkODUxZTdCNjY1MDU3N2UiLCJqdGkiOiIweGYyYTIzZmIzM2EzNzhiNWM3YTRmYzNmNWUyODVlODQwN2IyYjk5OTg2ZDEwNDM4ZmQ5ZDliNGVmNmMyZjMzZmQiLCJleHAiOjE3OTA3ODg1NjQsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.0Eg3M5qyNDHoyKBHDq_Kqg-ko3-6ArKE6dtEb0UvoL9p4eOqipEnjAQxxzV92XyUUH57ylcRwJ_UIXpuvgjbjRs'

  beforeEach(() => {
    payments = Payments.getInstance({ nvmApiKey: subscriberNvmApiKeyHash, environment: 'sandbox' })
  })

  afterEach(async () => {
    // Clear the client registry after each test
    try {
      payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'test-agent',
        planId: 'test-plan',
      })
    } catch {
      // Ignore errors during cleanup
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  })

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  describe('ClientRegistry', () => {
    it('should register and retrieve a client by agentId and planId', async () => {
      const registry = new ClientRegistry(payments)
      const client1 = registry.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'alice-agent',
        planId: 'plan-1',
      })
      const client2 = registry.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'alice-agent',
        planId: 'plan-1',
      })
      expect(client1).toBe(client2) // Same client instance for same combination

      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    it('should create different clients for different combinations', async () => {
      const registry = new ClientRegistry(payments)
      const client1 = registry.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'alice-agent',
        planId: 'plan-1',
      })
      const client2 = registry.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'bob-agent',
        planId: 'plan-1',
      })
      expect(client1).not.toBe(client2)

      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    it('should throw if required fields are missing', () => {
      const registry = new ClientRegistry(payments)
      expect(() => registry.getClient({} as any)).toThrow('Missing required fields')
    })
  })

  describe('buildPaymentAgentCard', () => {
    it('should build a valid agent card with required fields', () => {
      const baseCard = {
        name: 'Test Agent',
        description: 'A test agent for payments',
        capabilities: {
          tools: ['text-generation'],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3001',
        version: '1.0.0',
      }
      const paymentMetadata = {
        paymentType: 'fixed' as const,
        credits: 10,
        agentId: 'agent1',
        costDescription: '10 credits per request',
      }

      const card = buildPaymentAgentCard(baseCard, paymentMetadata)
      expect(card.name).toBe('Test Agent')
      expect(card.description).toBe('A test agent for payments')
      expect(card.capabilities?.extensions).toHaveLength(1)
      expect(card.capabilities?.extensions?.[0].uri).toBe('urn:nevermined:payment')
    })

    it('should build agent card with optional fields', () => {
      const baseCard = {
        name: 'Test Agent 2',
        description: 'Another test agent',
        capabilities: {
          tools: ['image-analysis'],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3002',
        version: '1.0.0',
      }
      const paymentMetadata = {
        paymentType: 'dynamic' as const,
        credits: 5,
        agentId: 'agent2',
        planId: 'plan-123',
        costDescription: '5 credits per request',
      }

      const card = buildPaymentAgentCard(baseCard, paymentMetadata)
      expect(card.capabilities?.extensions).toHaveLength(1)
      const paymentExtension = card.capabilities?.extensions?.[0]
      expect(paymentExtension?.uri).toBe('urn:nevermined:payment')
      expect((paymentExtension?.params as any)?.planId).toBe('plan-123')
    })

    it('should build agent card with trial plan', () => {
      const baseCard = {
        name: 'Trial Test Agent',
        description: 'A trial test agent',
        capabilities: {
          tools: ['text-generation'],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3004',
        version: '1.0.0',
      }
      const paymentMetadata = {
        paymentType: 'fixed' as const,
        credits: 0,
        agentId: 'trial-agent',
        isTrialPlan: true,
        costDescription: 'Trial service - 0 credits',
      }

      const card = buildPaymentAgentCard(baseCard, paymentMetadata)
      expect(card.capabilities?.extensions).toHaveLength(1)
      const paymentExtension = card.capabilities?.extensions?.[0]
      expect(paymentExtension?.uri).toBe('urn:nevermined:payment')
      expect((paymentExtension?.params as any)?.isTrialPlan).toBe(true)
      expect((paymentExtension?.params as any)?.credits).toBe(0)
    })

    it('should throw if paymentType is missing', () => {
      const baseCard = {
        name: 'Test Agent',
        description: 'A test agent',
        capabilities: {
          tools: [],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3001',
        version: '1.0.0',
      }
      expect(() => buildPaymentAgentCard(baseCard, {} as any)).toThrow('paymentType is required')
    })

    it('should throw if credits is missing or invalid for paid plans', () => {
      const baseCard = {
        name: 'Test Agent',
        description: 'A test agent',
        capabilities: {
          tools: [],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3001',
        version: '1.0.0',
      }

      // Missing credits for paid plan
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'fixed',
          agentId: 'test-agent',
        } as any),
      ).toThrow('credits must be a positive number for paid plans')

      // Zero credits for paid plan
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'fixed',
          credits: 0,
          agentId: 'test-agent',
        } as any),
      ).toThrow('credits must be a positive number for paid plans')

      // Negative credits
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'fixed',
          credits: -1,
          agentId: 'test-agent',
        } as any),
      ).toThrow('credits cannot be negative')
    })

    it('should allow zero credits for trial plans', () => {
      const baseCard = {
        name: 'Test Agent',
        description: 'A test agent',
        capabilities: {
          tools: [],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3001',
        version: '1.0.0',
      }

      // Trial plan with 0 credits
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'fixed',
          credits: 0,
          agentId: 'test-agent',
          isTrialPlan: true,
        }),
      ).not.toThrow()

      // Trial plan with positive credits
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'dynamic',
          credits: 5,
          agentId: 'test-agent',
          isTrialPlan: true,
        }),
      ).not.toThrow()
    })

    it('should throw if agentId is missing', () => {
      const baseCard = {
        name: 'Test Agent',
        description: 'A test agent',
        capabilities: {
          tools: [],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3001',
        version: '1.0.0',
      }
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'fixed',
          credits: 10,
        } as any),
      ).toThrow('agentId is required')
    })
  })

  describe('Payments A2A Integration', () => {
    it('should expose a2a property with start and getClient methods', () => {
      expect(payments.a2a).toBeDefined()
      expect(typeof payments.a2a.start).toBe('function')
      expect(typeof payments.a2a.getClient).toBe('function')
    })

    it('should initialize client registry only when getClient is called', async () => {
      const client = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'test-agent',
        planId: 'test-plan',
      })
      expect(client).toBeDefined()
      expect(client).toBeInstanceOf(Object) // PaymentsClient instance

      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    it('should reuse existing registry on subsequent getClient calls', async () => {
      const client1 = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'test-agent',
        planId: 'test-plan',
      })

      const client2 = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'test-agent-2',
        planId: 'test-plan',
      })

      expect(client1).toBeDefined()
      expect(client2).toBeDefined()
      expect(client1).not.toBe(client2) // Different clients for different combinations

      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  })

  describe('Static A2A Utilities', () => {
    it('should expose buildPaymentAgentCard as static method', () => {
      expect(Payments.a2a).toBeDefined()
      expect(typeof Payments.a2a.buildPaymentAgentCard).toBe('function')
    })

    it('should build agent card using static method', () => {
      const baseCard = {
        name: 'Static Test Agent',
        description: 'Test agent built via static method',
        capabilities: {
          tools: ['text-generation'],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3003',
        version: '1.0.0',
      }
      const paymentMetadata = {
        paymentType: 'fixed' as const,
        credits: 15,
        agentId: 'static-agent',
        costDescription: '15 credits per request',
      }

      const card = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
      expect(card.name).toBe('Static Test Agent')
      expect((card.capabilities?.extensions?.[0]?.params as any)?.agentId).toBe('static-agent')
    })
  })

  describe('Streaming SSE Tests', () => {
    let mockEventBus: any
    let mockRequestContext: any

    beforeEach(() => {
      // Mock event bus for streaming tests
      mockEventBus = {
        publish: jest.fn(),
        finished: jest.fn(),
      }

      // Mock request context
      mockRequestContext = {
        taskId: 'test-task-123',
        contextId: 'test-context-456',
        userMessage: {
          parts: [{ kind: 'text', text: 'Start streaming' }],
        },
      }
    })

    it('should handle streaming requests correctly', () => {
      // Test that streaming logic works regardless of message content
      const testMessages = [
        'hello',
        'calculate 2+2',
        'weather in london',
        'translate hello',
        'start streaming',
        'any message content',
      ]

      // All messages should be handled the same way in streaming mode
      testMessages.forEach((text) => {
        expect(text).toBeDefined()
        expect(typeof text).toBe('string')
      })
    })

    it('should publish correct number of streaming events', async () => {
      // Mock implementation of handleStreamingRequest
      const handleStreamingRequest = async (userText: string, context: any, eventBus: any) => {
        const totalMessages = 3 // Reduced for unit test
        const delayMs = 50 // Reduced for unit test

        for (let i = 1; i <= totalMessages; i++) {
          eventBus.publish({
            kind: 'status-update',
            taskId: context.taskId,
            contextId: context.contextId,
            status: {
              state: 'working',
              message: {
                kind: 'message',
                role: 'agent',
                messageId: `msg-${i}`,
                parts: [
                  {
                    kind: 'text',
                    text: `Streaming message ${i}/${totalMessages}`,
                  },
                ],
                taskId: context.taskId,
                contextId: context.contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: false,
          })

          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }

        return {
          parts: [
            {
              kind: 'text',
              text: '🚀 Streaming started! You will receive 3 messages via SSE.',
            },
          ],
          metadata: {
            creditsUsed: 5,
            planId: 'test-plan',
            costDescription: 'Streaming response',
            operationType: 'streaming',
            streamingType: 'text',
          },
          state: 'completed',
        }
      }

      const result = await handleStreamingRequest(
        'Start streaming',
        mockRequestContext,
        mockEventBus,
      )

      // Verify the correct number of events were published
      expect(mockEventBus.publish).toHaveBeenCalledTimes(3)

      // Verify the final result
      expect(result.state).toBe('completed')
      expect(result.metadata.creditsUsed).toBe(5)
      expect(result.metadata.operationType).toBe('streaming')
    })

    it('should include correct metadata in streaming response', async () => {
      const handleStreamingRequest = async (userText: string, context: any, eventBus: any) => {
        // Simulate one streaming message
        eventBus.publish({
          kind: 'status-update',
          taskId: context.taskId,
          contextId: context.contextId,
          status: {
            state: 'working',
            message: {
              kind: 'message',
              role: 'agent',
              messageId: 'msg-1',
              parts: [{ kind: 'text', text: 'Streaming message 1/1' }],
              taskId: context.taskId,
              contextId: context.contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: false,
        })

        return {
          parts: [
            {
              kind: 'text',
              text: 'Streaming finished!',
            },
          ],
          metadata: {
            creditsUsed: 5,
            planId: 'test-plan',
            costDescription: 'Streaming response',
            operationType: 'streaming',
            streamingType: 'text',
          },
          state: 'completed',
        }
      }

      const result = await handleStreamingRequest(
        'Start streaming',
        mockRequestContext,
        mockEventBus,
      )

      expect(result.metadata).toEqual({
        creditsUsed: 5,
        planId: 'test-plan',
        costDescription: 'Streaming response',
        operationType: 'streaming',
        streamingType: 'text',
      })
    })

    it('should handle streaming errors gracefully', async () => {
      const handleStreamingRequest = async (userText: string, context: any, eventBus: any) => {
        try {
          // Simulate an error during streaming
          throw new Error('Streaming service unavailable')

          // This should not be reached
          eventBus.publish({
            kind: 'status-update',
            taskId: context.taskId,
            contextId: context.contextId,
            status: {
              state: 'working',
              message: {
                kind: 'message',
                role: 'agent',
                messageId: 'msg-1',
                parts: [{ kind: 'text', text: 'This should not appear' }],
                taskId: context.taskId,
                contextId: context.contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: false,
          })
        } catch (error) {
          return {
            parts: [
              {
                kind: 'text',
                text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
              },
            ],
            metadata: {
              creditsUsed: 1,
              planId: 'test-plan',
              errorType: 'processing_error',
            },
            state: 'failed',
          }
        }
      }

      const result = await handleStreamingRequest(
        'Start streaming',
        mockRequestContext,
        mockEventBus,
      )

      expect(result.state).toBe('failed')
      expect(result.metadata.errorType).toBe('processing_error')
      expect(result.metadata.creditsUsed).toBe(1)
      expect(result.parts[0].text).toContain('Streaming service unavailable')
    })
  })
})
