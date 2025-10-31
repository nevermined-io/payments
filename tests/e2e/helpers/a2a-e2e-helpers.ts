/**
 * @file A2A E2E Test Helpers
 * @description Utilities and configuration for A2A E2E tests
 */

import { Payments } from '../../../src/payments.js'
import { AgentExecutor, PaymentsRequestContext, ExecutionEventBus } from '../../../src/a2a/types.js'
import { v4 as uuidv4 } from 'uuid'
import { getApiKeysForFile } from '../../utils/apiKeysPool.js'

// Test Configuration
export const E2E_TEST_CONFIG = {
  TIMEOUT: 30_000,
  TESTING_ENVIRONMENT: 'staging_sandbox' as const,

  // API Keys (per-file to avoid race conditions on blockchain)
  get BUILDER_API_KEY() {
    return getApiKeysForFile(__filename).builder
  },

  get SUBSCRIBER_API_KEY() {
    return getApiKeysForFile(__filename).subscriber
  },
}

// Test Data
export const E2E_TEST_DATA = {
  BASE_AGENT_CARD: {
    name: 'Test Agent',
    description: 'Test agent for E2E testing',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3000/',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  },

  CLIENT_TEST_AGENT_CARD: {
    name: 'Client Test Agent',
    description: 'Test agent for client testing',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3005/',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  },

  MULTI_CLIENT_TEST_AGENT_CARD: {
    name: 'Multi Client Test Agent',
    description: 'Test agent for multiple client testing',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3006/',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  },

  PAYMENT_TEST_AGENT_CARD: {
    name: 'Payment Test Agent',
    description: 'Agent for payment testing',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3008/',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  },

  ERROR_TEST_AGENT_CARD: {
    name: 'Error Test Agent',
    description: 'Agent for error testing',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3009/',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  },

  INTEGRATION_TEST_AGENT_CARD: {
    name: 'Integration Test Agent',
    description: 'Agent for integration testing',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3010/',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  },

  STREAMING_TEST_AGENT_CARD: {
    name: 'Streaming Test Agent',
    description: 'Agent for streaming SSE testing',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3010/',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  },

  REGULAR_TEST_AGENT_CARD: {
    name: 'Regular Test Agent',
    description: 'Agent for regular request testing',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3011/',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  },

  DETECTION_TEST_AGENT_CARD: {
    name: 'Detection Test Agent',
    description: 'Agent for request detection testing',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3012/',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  },

  ERROR_STREAMING_TEST_AGENT_CARD: {
    name: 'Error Streaming Test Agent',
    description: 'Agent for streaming error testing',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3013/',
    version: '1.0.0',
    protocolVersion: '0.3.0' as const,
  },
}

// Factory Functions
export class A2AE2EFactory {
  /**
   * Creates a test executor that matches the AgentExecutor interface
   */
  static createTestExecutor(): AgentExecutor {
    return {
      execute: async (requestContext, eventBus) => {
        const taskId = requestContext.taskId
        const contextId = requestContext.userMessage.contextId || uuidv4()

        // Publish initial task if it doesn't exist
        if (!requestContext.task) {
          const initialTask = {
            kind: 'task' as const,
            id: taskId,
            contextId: contextId,
            status: {
              state: 'submitted' as const,
              timestamp: new Date().toISOString(),
            },
            history: [requestContext.userMessage],
            metadata: requestContext.userMessage.metadata,
          }
          eventBus.publish(initialTask)
        }

        // Publish working status
        const workingStatusUpdate = {
          kind: 'status-update' as const,
          taskId: taskId,
          contextId: contextId,
          status: {
            state: 'working' as const,
            message: {
              kind: 'message' as const,
              role: 'agent' as const,
              messageId: uuidv4(),
              parts: [{ kind: 'text' as const, text: 'Processing your request...' }],
              taskId: taskId,
              contextId: contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: false,
        }
        eventBus.publish(workingStatusUpdate)

        // Simulate processing time
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Publish final completed status
        const agentMessage = {
          kind: 'message' as const,
          role: 'agent' as const,
          messageId: uuidv4(),
          parts: [{ kind: 'text' as const, text: 'Request completed successfully!' }],
          taskId: taskId,
          contextId: contextId,
        }

        const finalUpdate = {
          kind: 'status-update' as const,
          taskId: taskId,
          contextId: contextId,
          status: {
            state: 'completed' as const,
            message: agentMessage,
            timestamp: new Date().toISOString(),
          },
          metadata: {
            creditsUsed: 10,
          },
          final: true,
        }
        eventBus.publish(finalUpdate)
      },
      cancelTask: async (taskId) => {
        console.log(`[TEST EXECUTOR] Cancelling task: ${taskId}`)
      },
    }
  }

  /**
   * Creates a test executor that supports streaming SSE
   */
  static createStreamingExecutor(): AgentExecutor {
    return {
      execute: async (requestContext, eventBus) => {
        const taskId = requestContext.taskId
        const contextId = requestContext.userMessage.contextId || uuidv4()
        const userText =
          requestContext.userMessage.parts[0] && requestContext.userMessage.parts[0].kind === 'text'
            ? requestContext.userMessage.parts[0].text
            : ''

        // Publish initial task
        eventBus.publish({
          kind: 'task',
          id: taskId,
          contextId,
          status: {
            state: 'submitted',
            timestamp: new Date().toISOString(),
          },
          artifacts: [],
          history: [requestContext.userMessage],
          metadata: requestContext.userMessage.metadata,
        })

        try {
          // This executor is specifically for streaming tests, so always handle as streaming
          const totalMessages = 3 // Reduced for e2e test
          const delayMs = 100 // Reduced for e2e test

          for (let i = 1; i <= totalMessages; i++) {
            eventBus.publish({
              kind: 'status-update',
              taskId,
              contextId,
              status: {
                state: 'working',
                message: {
                  kind: 'message',
                  role: 'agent',
                  messageId: uuidv4(),
                  parts: [
                    {
                      kind: 'text',
                      text: `Streaming message ${i}/${totalMessages}`,
                    },
                  ],
                  taskId,
                  contextId,
                },
                timestamp: new Date().toISOString(),
              },
              final: false,
            })

            await new Promise((resolve) => setTimeout(resolve, delayMs))
          }

          // Final streaming message
          eventBus.publish({
            kind: 'status-update',
            taskId,
            contextId,
            status: {
              state: 'working',
              message: {
                kind: 'message',
                role: 'agent',
                messageId: uuidv4(),
                parts: [
                  {
                    kind: 'text',
                    text: 'Streaming finished!',
                  },
                ],
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: false,
          })

          // Final status update
          eventBus.publish({
            kind: 'status-update',
            taskId,
            contextId,
            status: {
              state: 'completed',
              message: {
                kind: 'message',
                role: 'agent',
                messageId: uuidv4(),
                parts: [
                  {
                    kind: 'text',
                    text: '🚀 Streaming completed successfully!',
                  },
                ],
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: true,
            metadata: {
              creditsUsed: 10,
              planId: 'test-plan',
              costDescription: 'Streaming response',
              operationType: 'streaming',
              streamingType: 'text',
            },
          })
        } catch (error) {
          eventBus.publish({
            kind: 'status-update',
            taskId,
            contextId,
            status: {
              state: 'failed',
              message: {
                kind: 'message',
                role: 'agent',
                messageId: uuidv4(),
                parts: [
                  {
                    kind: 'text',
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                  },
                ],
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: true,
            metadata: { errorType: 'agent_error' },
          })
        }

        eventBus.finished()
      },
      cancelTask: async (taskId: string) => {
        // Mock implementation for cancelTask
        console.log(`Mock cancelTask called for taskId: ${taskId}`)
      },
    }
  }

  /**
   * Creates a test executor specifically for resubscribe testing with more events and longer delays
   */
  static createResubscribeStreamingExecutor(): AgentExecutor {
    return {
      execute: async (requestContext, eventBus) => {
        const taskId = requestContext.taskId
        const contextId = requestContext.userMessage.contextId || uuidv4()
        const userText =
          requestContext.userMessage.parts[0] && requestContext.userMessage.parts[0].kind === 'text'
            ? requestContext.userMessage.parts[0].text
            : ''

        // Publish initial task
        eventBus.publish({
          kind: 'task',
          id: taskId,
          contextId,
          status: {
            state: 'submitted',
            timestamp: new Date().toISOString(),
          },
          artifacts: [],
          history: [requestContext.userMessage],
          metadata: requestContext.userMessage.metadata,
        })

        try {
          // This executor is specifically for resubscribe tests with more events and longer delays
          const totalMessages = 8 // More messages for resubscribe test
          const delayMs = 300 // Longer delay for resubscribe test

          for (let i = 1; i <= totalMessages; i++) {
            eventBus.publish({
              kind: 'status-update',
              taskId,
              contextId,
              status: {
                state: 'working',
                message: {
                  kind: 'message',
                  role: 'agent',
                  messageId: uuidv4(),
                  parts: [
                    {
                      kind: 'text',
                      text: `Streaming message ${i}/${totalMessages}`,
                    },
                  ],
                  taskId,
                  contextId,
                },
                timestamp: new Date().toISOString(),
              },
              final: false,
            })

            await new Promise((resolve) => setTimeout(resolve, delayMs))
          }

          // Additional intermediate messages for resubscribe testing
          const additionalMessages = 3
          for (let i = 1; i <= additionalMessages; i++) {
            eventBus.publish({
              kind: 'status-update',
              taskId,
              contextId,
              status: {
                state: 'working',
                message: {
                  kind: 'message',
                  role: 'agent',
                  messageId: uuidv4(),
                  parts: [
                    {
                      kind: 'text',
                      text: `Additional message ${i}/${additionalMessages}`,
                    },
                  ],
                  taskId,
                  contextId,
                },
                timestamp: new Date().toISOString(),
              },
              final: false,
            })

            await new Promise((resolve) => setTimeout(resolve, delayMs))
          }

          // Final streaming message
          eventBus.publish({
            kind: 'status-update',
            taskId,
            contextId,
            status: {
              state: 'working',
              message: {
                kind: 'message',
                role: 'agent',
                messageId: uuidv4(),
                parts: [
                  {
                    kind: 'text',
                    text: 'Streaming finished!',
                  },
                ],
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: false,
          })

          // Final status update
          eventBus.publish({
            kind: 'status-update',
            taskId,
            contextId,
            status: {
              state: 'completed',
              message: {
                kind: 'message',
                role: 'agent',
                messageId: uuidv4(),
                parts: [
                  {
                    kind: 'text',
                    text: '🚀 Streaming completed successfully!',
                  },
                ],
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: true,
            metadata: {
              creditsUsed: 10,
              planId: 'test-plan',
              costDescription: 'Streaming response',
              operationType: 'streaming',
              streamingType: 'text',
            },
          })
        } catch (error) {
          eventBus.publish({
            kind: 'status-update',
            taskId,
            contextId,
            status: {
              state: 'failed',
              message: {
                kind: 'message',
                role: 'agent',
                messageId: uuidv4(),
                parts: [
                  {
                    kind: 'text',
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                  },
                ],
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: true,
            metadata: { errorType: 'agent_error' },
          })
        }

        eventBus.finished()
      },
      cancelTask: async (taskId: string) => {
        // Mock implementation for cancelTask
        console.log(`Mock cancelTask called for taskId: ${taskId}`)
      },
    }
  }

  /**
   * Creates a resubscribe-capable executor that also validates PaymentsRequestContext is present
   * and publishes a context check event. Used to E2E-verify that payments context is injected.
   */
  static createResubscribeStreamingExecutorWithContextAssert(): AgentExecutor {
    return {
      execute: async (requestContext: PaymentsRequestContext, eventBus: ExecutionEventBus) => {
        // Assert extended context exists
        const hasPaymentsCtx = !!requestContext?.payments && !!requestContext?.payments?.authResult
        const agentIdFromCtx = requestContext?.payments?.authResult?.agentId || 'unknown'
        const tokenPresent = !!requestContext?.payments?.authResult?.token

        const taskId = requestContext.taskId
        const contextId = requestContext.userMessage.contextId || uuidv4()

        // Publish initial task
        eventBus.publish({
          kind: 'task',
          id: taskId,
          contextId,
          status: { state: 'submitted', timestamp: new Date().toISOString() },
          artifacts: [],
          history: [requestContext.userMessage],
          metadata: requestContext.userMessage.metadata,
        })

        // Publish a context-check status-update
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'working',
            message: {
              kind: 'message',
              role: 'agent',
              messageId: uuidv4(),
              parts: [
                {
                  kind: 'text',
                  text: `CTX_OK:${hasPaymentsCtx ? '1' : '0'} AGENT:${agentIdFromCtx} TOKEN:${
                    tokenPresent ? '1' : '0'
                  }`,
                },
              ],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: false,
        })

        // Then proceed with the regular resubscribe streaming behavior (shortened)
        const totalMessages = 3
        const delayMs = 100
        for (let i = 1; i <= totalMessages; i++) {
          eventBus.publish({
            kind: 'status-update',
            taskId,
            contextId,
            status: {
              state: 'working',
              message: {
                kind: 'message',
                role: 'agent',
                messageId: uuidv4(),
                parts: [{ kind: 'text', text: `Streaming message ${i}/${totalMessages}` }],
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: false,
          })
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }

        // Final success
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'completed',
            message: {
              kind: 'message',
              role: 'agent',
              messageId: uuidv4(),
              parts: [{ kind: 'text', text: 'Streaming completed (ctx asserted).' }],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
          metadata: { creditsUsed: 10, operationType: 'streaming', streamingType: 'text' },
        })

        eventBus.finished()
      },
      cancelTask: async (_taskId: string) => {},
    }
  }

  /**
   * Creates payment metadata for testing
   */
  static createPaymentMetadata(agentId: string, planId?: string) {
    return {
      paymentType: 'fixed' as const,
      credits: 20,
      agentId,
      ...(planId && { planId }),
      costDescription: '20 credits per request',
    }
  }

  /**
   * Creates a test message
   */
  static createTestMessage(text: string = 'Hello, this is a test message') {
    return {
      kind: 'message' as const,
      messageId: uuidv4(),
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text }],
    }
  }
}

// Utility Functions
export class A2AE2EUtils {
  /**
   * Waits for a specified amount of time
   */
  static async wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Creates a Payments instance for testing
   */
  static createPaymentsInstance(API_KEY: string): Payments {
    return Payments.getInstance({
      nvmApiKey: API_KEY,
      environment: E2E_TEST_CONFIG.TESTING_ENVIRONMENT,
    })
  }

  /**
   * Waits for a server to be ready by checking if the agent card endpoint is accessible
   */
  static async waitForServerReady(
    port: number,
    maxRetries: number = 10,
    basePath: string = '',
  ): Promise<void> {
    const agentCardUrl = `http://localhost:${port}${basePath}/.well-known/agent-card.json`

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(agentCardUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        })

        if (response.ok) {
          const agentCard = await response.json()
          if (agentCard && agentCard.name) {
            return
          }
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }

      // Wait before retrying
      await this.wait(1000) // Increased wait time
    }

    throw new Error(`Server on port ${port} did not become ready within ${maxRetries * 1000}ms`)
  }
}

// Assertion Helpers
export class A2AE2EAssertions {
  /**
   * Asserts that a server result is valid
   */
  static assertValidServerResult(serverResult: any) {
    expect(serverResult).toBeDefined()
    expect(serverResult.server).toBeDefined()
  }

  /**
   * Asserts that a client is valid and has expected methods
   */
  static assertValidClient(client: any) {
    expect(client).toBeDefined()
    expect(typeof client.sendA2AMessage).toBe('function')
    expect(typeof client.getA2ATask).toBe('function')
    expect(typeof client.clearToken).toBe('function')
  }

  /**
   * Asserts that an agent card is valid
   */
  static assertValidAgentCard(agentCard: any) {
    expect(agentCard).toBeDefined()
    expect(agentCard.name).toBeDefined()
    expect(agentCard.capabilities).toBeDefined()
  }

  /**
   * Asserts that a payment error is thrown
   */
  static async assertPaymentErrorThrown(promise: Promise<any>) {
    await expect(promise).rejects.toThrow()
  }

  /**
   * Asserts that an a2a agent response is valid
   */
  static assertValidA2AResponse(a2aResponse: any) {
    expect(a2aResponse).toBeDefined()
    expect(a2aResponse.result).toBeDefined()
    expect(a2aResponse.result.status).toBeDefined()
    expect(a2aResponse.result.kind).toMatch(/task|message/)
  }

  /**
   * Asserts that a streaming SSE response is valid
   */
  static assertValidStreamingResponse(events: any[], finalResult: any) {
    // Verify we received streaming events
    expect(events.length).toBeGreaterThan(0)
    expect(finalResult).toBeDefined()

    // Verify streaming response structure
    expect(finalResult.jsonrpc).toBe('2.0')
    expect(finalResult.result).toBeDefined()
    expect(finalResult.result.kind).toBe('status-update')
    expect(finalResult.result.final).toBe(true)
    expect(finalResult.result.status).toBeDefined()
    expect(finalResult.result.status.state).toBe('completed')

    // Verify streaming metadata
    expect(finalResult.result.metadata).toBeDefined()
    expect(finalResult.result.metadata.creditsUsed).toBe(10)
    expect(finalResult.result.metadata.operationType).toBe('streaming')
    expect(finalResult.result.metadata.streamingType).toBe('text')
  }

  /**
   * Asserts that a resubscribe response is valid
   */
  static assertValidResubscribeResponse(
    initialEvents: any[],
    resubscribeEvents: any[],
    resubscribeFinalResult: any,
    taskId: string,
    maxInitialEvents: number,
  ) {
    // Verify we got a taskId and some initial events
    expect(taskId).toBeDefined()
    expect(initialEvents.length).toBeGreaterThan(0)
    expect(initialEvents.length).toBeLessThanOrEqual(maxInitialEvents)

    // Verify resubscribe worked and returned events
    expect(resubscribeEvents.length).toBeGreaterThan(0)
    expect(resubscribeFinalResult).toBeDefined()

    // The resubscribe should return the same task information
    expect(resubscribeFinalResult.result.taskId).toBe(taskId)
    expect(resubscribeFinalResult.result.status.state).toBe('completed')

    // Verify that we have events from both the initial connection and resubscribe
    const totalEvents = initialEvents.length + resubscribeEvents.length
    expect(totalEvents).toBeGreaterThan(maxInitialEvents)

    // Verify the final result contains the expected metadata
    expect(resubscribeFinalResult.result.metadata.creditsUsed).toBe(10)

    // Verify resubscribe response structure
    expect(resubscribeFinalResult.jsonrpc).toBe('2.0')
    expect(resubscribeFinalResult.result).toBeDefined()
    expect(resubscribeFinalResult.result.kind).toBe('status-update')
    expect(resubscribeFinalResult.result.final).toBe(true)
    expect(resubscribeFinalResult.result.status).toBeDefined()
  }
}

// Server Management
export class A2AE2EServerManager {
  private servers: any[] = []

  /**
   * Adds a server to the managed list
   */
  addServer(server: any) {
    this.servers.push(server)
  }

  /**
   * Cleans up all servers
   */
  async cleanup(): Promise<void> {
    const closePromises = this.servers.map(async (server, index) => {
      if (server?.server) {
        try {
          await new Promise<void>((resolve) => {
            server.server.close(() => {
              resolve()
            })
          })
        } catch (error) {}
      }
    })

    // Wait for all servers to close with a timeout
    try {
      await Promise.all(closePromises)
    } catch (error) {}

    this.servers = []
  }
}
