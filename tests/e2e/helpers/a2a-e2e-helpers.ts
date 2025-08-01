/**
 * @file A2A E2E Test Helpers
 * @description Utilities and configuration for A2A E2E tests
 */

import { Payments } from '../../../src/payments.js'
import { AgentExecutor } from '@a2a-js/sdk/server'
import { v4 as uuidv4 } from 'uuid'

// Test Configuration
export const E2E_TEST_CONFIG = {
  TIMEOUT: 30_000,
  TESTING_ENVIRONMENT: 'staging_sandbox' as const,
  
  // API Keys (with fallbacks for testing)
  BUILDER_API_KEY: process.env.TEST_BUILDER_API_KEY || 
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDhmMDQ1QkM3QzA0RjRjYzViNjNjOTcyNWM1YTZCMzI5OWQ0YUMxRTIiLCJqdGkiOiIweDMxNDYzZWNhMThhMWE3YjA0YmE3OWYwZGQ5MjcyZGJhOTJmN2RhODdjMzk4ZTUzMzI2ZGVlMTIyMmM5NWQ1ODEiLCJleHAiOjE3ODU1MDMwNjl9.-7CTE0shh75g09x66adB1-B4tz1KRx8_1jtm2tqDlj12gXeb29_kiBg1dL3Tc7pgFEuTU0AD5EWrRr8ys4RO2Rw',
  
  SUBSCRIBER_API_KEY: process.env.TEST_SUBSCRIBER_API_KEY || 
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweGMxNTA4ZDEzMTczMkNBNDVlN2JDQTE4OGMyNjA4YUU4ODhmMDI2OGQiLCJqdGkiOiIweDk1NmMyMzZjMjAyNDQyNDM0MjUzZjY4MmQyOTI3NDMwOGMwNDY2NDExOGU5MjJiMjI2YjA1YThhNDYxYzA3NmYiLCJleHAiOjE3ODU1MDMxMzR9.QjsshT4fbWGG9lASW0ENToI2Mg6E-Z7U_8HANlQk-VIRjlMVvBouSE2xMWnEFjtjkkzt1qbnpXGVtJLyUu4Oghw'
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
  }
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
        await new Promise(resolve => setTimeout(resolve, 100))
        
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
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Creates a Payments instance for testing
   */
  static createPaymentsInstance(): Payments {
    return Payments.getInstance({ 
      nvmApiKey: E2E_TEST_CONFIG.BUILDER_API_KEY, 
      environment: E2E_TEST_CONFIG.TESTING_ENVIRONMENT 
    })
  }

  /**
   * Waits for a server to be ready by checking if the agent card endpoint is accessible
   */
  static async waitForServerReady(port: number, maxRetries: number = 10): Promise<void> {
    const agentCardUrl = `http://localhost:${port}/.well-known/agent.json`
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(agentCardUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        })
        
        if (response.ok) {
          const agentCard = await response.json()
          if (agentCard && agentCard.name) {
            console.log(`[E2E] Server on port ${port} is ready`)
            return
          }
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }
      
      // Wait before retrying
      await this.wait(500)
    }
    
    throw new Error(`Server on port ${port} did not become ready within ${maxRetries * 500}ms`)
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
    // Clean up all servers
    for (const server of this.servers) {
      if (server && server.server) {
        await new Promise<void>((resolve) => {
          server.server.close(() => resolve())
        })
      }
    }
    this.servers = []
    
    // Clean up any pending async operations
    await A2AE2EUtils.wait(100)
  }
} 