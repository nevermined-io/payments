/**
 * @file A2A Integration Test Helpers
 * @description Utilities and configuration for A2A integration tests
 */

import { Payments } from '../../../src/payments.js'
import { AgentExecutor } from '@a2a-js/sdk/server'
import { AgentCard } from '../../../src/a2a/types.js'
import { EnvironmentName } from '../../../src/environments.js'
import { Address } from '../../../src/common/types.js'
import { getERC20PriceConfig, getFixedCreditsConfig } from '../../../src/plans.js'
import http from 'http'
import { v4 as uuidv4 } from 'uuid'

// Test Configuration
export const TEST_CONFIG = {
  TIMEOUT: 30_000,
  ERC20_ADDRESS: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`,
  PORT: parseInt(process.env.PORT || '41242'),
  WEBHOOK_PORT: 4001,
  TESTING_ENVIRONMENT: 'staging_sandbox' as EnvironmentName,
  
  // Retry configuration for critical operations
  RETRY_CONFIG: {
    MAX_ATTEMPTS: 5,
    INITIAL_DELAY: 1000, // 1 second
    MAX_DELAY: 10000,    // 10 seconds
    BACKOFF_MULTIPLIER: 2,
  },
  
  // API Keys (with fallbacks for testing)
  BUILDER_API_KEY: process.env.TEST_BUILDER_API_KEY || 
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDhmMDQ1QkM3QzA0RjRjYzViNjNjOTcyNWM1YTZCMzI5OWQ0YUMxRTIiLCJqdGkiOiIweDMxNDYzZWNhMThhMWE3YjA0YmE3OWYwZGQ5MjcyZGJhOTJmN2RhODdjMzk4ZTUzMzI2ZGVlMTIyMmM5NWQ1ODEiLCJleHAiOjE3ODU1MDMwNjl9.-7CTE0shh75g09x66adB1-B4tz1KRx8_1jtm2tqDlj12gXeb29_kiBg1dL3Tc7pgFEuTU0AD5EWrRr8ys4RO2Rw',
  
  SUBSCRIBER_API_KEY: process.env.TEST_SUBSCRIBER_API_KEY || 
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweGMxNTA4ZDEzMTczMkNBNDVlN2JDQTE4OGMyNjA4YUU4ODhmMDI2OGQiLCJqdGkiOiIweDk1NmMyMzZjMjAyNDQyNDM0MjUzZjY4MmQyOTI3NDMwOGMwNDY2NDExOGU5MjJiMjI2YjA1YThhNDYxYzA3NmYiLCJleHAiOjE3ODU1MDMxMzR9.QjsshT4fbWGG9lASW0ENToI2Mg6E-Z7U_8HANlQk-VIRjlMVvBouSE2xMWnEFjtjkkzt1qbnpXGVtJLyUu4Oghw'
}

// Test Data
export const TEST_DATA = {
  PLAN_METADATA: {
    name: 'A2A Integration Test Plan',
  },
  
  AGENT_METADATA: {
    name: 'A2A Integration Test Agent',
    description: 'Test agent for A2A integration',
    tags: ['test', 'a2a'],
    dateCreated: new Date(),
  },
  
  BASE_AGENT_CARD: {
    name: 'Test A2A Agent',
    description: 'Test agent for A2A integration tests',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3000',
    version: '1.0.0',
  } as AgentCard,
  
  PAYMENT_METADATA: {
    paymentType: 'fixed' as const,
    credits: 10,
    costDescription: 'Test A2A agent - 10 credits per request',
  }
}

// Test States
export enum TaskState {
  SUBMITTED = 'submitted',
  WORKING = 'working',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum TestScenario {
  BLOCKING_REQUEST = 'blocking_request',
  NON_BLOCKING_REQUEST = 'non_blocking_request',
  PUSH_NOTIFICATION = 'push_notification',
  ERROR_HANDLING = 'error_handling'
}

// Factory Functions
export class A2ATestFactory {
  /**
   * Creates a test executor that simulates A2A agent behavior
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
              state: TaskState.SUBMITTED,
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
            state: TaskState.WORKING,
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
            state: TaskState.COMPLETED,
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
        const userText = requestContext.userMessage.parts[0] && 
          requestContext.userMessage.parts[0].kind === 'text' 
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
          const totalMessages = 3 // Reduced for integration test
          const delayMs = 100 // Reduced for integration test

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
   * Creates payment metadata for testing
   */
  static createPaymentMetadata(agentId: string) {
    return {
      ...TEST_DATA.PAYMENT_METADATA,
      agentId,
    }
  }

  /**
   * Creates agent API configuration
   */
  static createAgentApi(port: number) {
    return {
      endpoints: [{ POST: `http://localhost:${port}/a2a/` }],
    }
  }

  /**
   * Creates push notification configuration
   */
  static createPushNotificationConfig(webhookUrl: string, token: string = 'test-token-abc') {
    return {
      url: webhookUrl,
      token,
      authentication: {
        credentials: token,
        schemes: ['bearer'],
      },
    }
  }
}

// Utility Functions
export class A2ATestUtils {
  /**
   * Waits for a specified amount of time
   */
  static async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Retries an operation with exponential backoff
   * @param operation - The operation to retry
   * @param operationName - Name of the operation for logging
   * @param maxAttempts - Maximum number of attempts
   * @param initialDelay - Initial delay in milliseconds
   * @param maxDelay - Maximum delay in milliseconds
   * @param backoffMultiplier - Multiplier for exponential backoff
   * @returns The result of the operation
   */
  static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationName: string = 'Operation',
    maxAttempts: number = TEST_CONFIG.RETRY_CONFIG.MAX_ATTEMPTS,
    initialDelay: number = TEST_CONFIG.RETRY_CONFIG.INITIAL_DELAY,
    maxDelay: number = TEST_CONFIG.RETRY_CONFIG.MAX_DELAY,
    backoffMultiplier: number = TEST_CONFIG.RETRY_CONFIG.BACKOFF_MULTIPLIER
  ): Promise<T> {
    let lastError: Error | null = null
    let delay = initialDelay

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await operation()
        return result
      } catch (error) {
        lastError = error as Error
        
        if (attempt === maxAttempts) {
          throw new Error(`${operationName} failed after ${maxAttempts} attempts. Last error: ${lastError.message}`)
        }
        
        // Wait before next attempt with exponential backoff
        await this.wait(delay)
        delay = Math.min(delay * backoffMultiplier, maxDelay)
      }
    }
    
    throw lastError!
  }

  /**
   * Polls for a condition to be met
   */
  static async pollForCondition<T>(
    conditionFn: () => Promise<T | null>,
    maxAttempts: number = 30,
    intervalMs: number = 1000
  ): Promise<T> {
    let attempts = 0
    
    while (attempts < maxAttempts) {
      const result = await conditionFn()
      if (result !== null) {
        return result
      }
      
      await this.wait(intervalMs)
      attempts++
    }
    
    throw new Error(`Condition not met after ${maxAttempts} attempts`)
  }

  /**
   * Checks if a server is listening on a port
   */
  static async isServerListening(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${port}/a2a/.well-known/agent.json`)
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Creates a unique test message
   */
  static createTestMessage(text: string = 'Test message') {
    return {
      messageId: uuidv4(),
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text }],
    }
  }

  /**
   * Creates a JSON-RPC request payload
   */
  static createJsonRpcRequest(method: string, params: any, id?: number) {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      method,
      params,
    }
  }
}

// Assertion Helpers
export class A2AAssertions {
  /**
   * Asserts that a task response is valid
   */
  static assertValidTaskResponse(result: any) {
    expect(result.jsonrpc).toBe('2.0')
    expect(result.result).toBeDefined()
    expect(result.result.kind).toBe('task')
    expect(result.result.id).toBeDefined()
    expect(result.result.contextId).toBeDefined()
    expect(result.result.status).toBeDefined()
    expect(result.result.history).toBeDefined()
    expect(result.result.history.length).toBeGreaterThan(0)
  }

  /**
   * Asserts that a task is in a specific state
   */
  static assertTaskState(result: any, expectedState: TaskState) {
    expect(result.result.status.state).toBe(expectedState)
  }

  /**
   * Asserts that a task is completed with agent message
   */
  static assertTaskCompleted(result: any) {
    this.assertTaskState(result, TaskState.COMPLETED)
    expect(result.result.status.message).toBeDefined()
    expect(result.result.status.message.role).toBe('agent')
    expect(result.result.status.message.parts).toBeDefined()
    expect(result.result.status.message.parts.length).toBe(1)
    expect(result.result.status.message.parts[0].kind).toBe('text')
    expect(result.result.status.message.parts[0].text).toBe('Request completed successfully!')
  }

  /**
   * Asserts that credits were burned correctly
   */
  static assertCreditsBurned(initialCredits: bigint, finalCredits: bigint, expectedBurned: bigint = 10n) {
    expect(finalCredits).toBeLessThan(initialCredits)
    const creditsBurned = initialCredits - finalCredits
    expect(creditsBurned).toBe(expectedBurned)
  }

  /**
   * Asserts that a JSON-RPC error response is valid
   */
  static assertJsonRpcError(result: any, expectedCode: number, expectedMessage?: string) {
    expect(result.jsonrpc).toBe('2.0')
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe(expectedCode)
    if (expectedMessage) {
      expect(result.error.message).toBe(expectedMessage)
    }
  }

  /**
   * Asserts that an agent card is valid and contains payment extension
   */
  static assertValidAgentCard(agentCard: any, expectedAgentId?: string) {
    expect(agentCard.name).toBeDefined()
    expect(agentCard.capabilities?.extensions).toBeDefined()
    expect(agentCard.capabilities?.extensions).toHaveLength(1)
    
    const paymentExtension = agentCard.capabilities?.extensions?.[0]
    expect(paymentExtension?.uri).toBe('urn:nevermined:payment')
    expect(paymentExtension?.params?.paymentType).toBe('fixed')
    expect(paymentExtension?.params?.credits).toBe(10)
    
    if (expectedAgentId) {
      expect(paymentExtension?.params?.agentId).toBe(expectedAgentId)
    }
  }

  /**
   * Asserts that a server is listening and accessible
   */
  static async assertServerAccessible(port: number) {
    const response = await fetch(`http://localhost:${port}/a2a/.well-known/agent.json`)
    expect(response.ok).toBe(true)
  }

  /**
   * Asserts that a request is rejected with payment required status
   */
  static async assertPaymentRequired(url: string, token: string = 'invalid-token') {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: "message/send",
        params: {
          task: {
            taskId: 'test-task-1',
            input: { message: 'Hello' },
          },
        },
      }),
    })
    expect(response.status).toBe(402) // Payment Required
  }
}

// Webhook Server Management
export class WebhookServerManager {
  private server: any
  private port: number
  private receivedNotifications: any[] = []
  private webhookUrl: string = ''

  constructor(port: number = TEST_CONFIG.WEBHOOK_PORT) {
    this.port = port
  }

  /**
   * Starts the webhook server
   */
  async start(): Promise<string> {
    const express = require('express')
    const app = express()
    app.use(express.json())
    
    app.post('/webhook', (req: any, res: any) => {
      this.receivedNotifications.push(req.body)
      res.status(200).send('OK')
    })
    
    return new Promise((resolve) => {
      this.server = app.listen(this.port, () => {
        this.webhookUrl = `http://localhost:${this.port}/webhook`
        console.log(`[WEBHOOK] Test server listening on ${this.webhookUrl}`)
        resolve(this.webhookUrl)
      })
    })
  }

  /**
   * Stops the webhook server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => resolve())
      })
    }
  }

  /**
   * Gets the webhook URL
   */
  getWebhookUrl(): string {
    return this.webhookUrl
  }

  /**
   * Gets received notifications
   */
  getReceivedNotifications(): any[] {
    return [...this.receivedNotifications]
  }

  /**
   * Clears received notifications
   */
  clearNotifications(): void {
    this.receivedNotifications = []
  }

  /**
   * Waits for a specific notification
   */
  async waitForNotification(taskId: string, timeoutMs: number = 30000): Promise<any> {
    return A2ATestUtils.pollForCondition(
      () => {
        const notification = this.receivedNotifications.find(n => n.taskId === taskId)
        return notification || null
      },
      Math.ceil(timeoutMs / 1000),
      1000
    )
  }
}

// Test Context Management
export class A2ATestContext {
  public paymentsBuilder: Payments
  public paymentsSubscriber: Payments
  public testServer: http.Server
  public webhookManager: WebhookServerManager
  public agentId: string = ''
  public planId: string = ''
  public accessToken: string = ''
  public testAgentCard: AgentCard

  constructor() {
    this.paymentsBuilder = Payments.getInstance({
      nvmApiKey: TEST_CONFIG.BUILDER_API_KEY,
      environment: TEST_CONFIG.TESTING_ENVIRONMENT,
    })

    this.paymentsSubscriber = Payments.getInstance({
      nvmApiKey: TEST_CONFIG.SUBSCRIBER_API_KEY,
      environment: TEST_CONFIG.TESTING_ENVIRONMENT,
    })

    this.webhookManager = new WebhookServerManager()
    this.testAgentCard = { ...TEST_DATA.BASE_AGENT_CARD }
  }

  /**
   * Sets up the complete test environment
   */
  async setup(): Promise<void> {
    // Register payment plan
    await this.setupPaymentPlan()
    
    // Register agent
    await this.setupAgent()
    
    // Start A2A server
    await this.setupA2AServer()
    
    // Order plan and get access token
    await this.setupAccessToken()
    
    // Start webhook server
    await this.webhookManager.start()
  }

  /**
   * Tears down the test environment
   */
  async teardown(): Promise<void> {
    if (this.testServer) {
      await new Promise<void>((resolve) => {
        this.testServer.close(() => resolve())
      })
    }
    
    await this.webhookManager.stop()
  }

  /**
   * Gets the current plan balance
   */
  async getPlanBalance(): Promise<bigint> {
    const balanceResult = await this.paymentsSubscriber.plans.getPlanBalance(this.planId)
    return BigInt(balanceResult.balance)
  }

  /**
   * Validates that credits were burned correctly
   */
  async validateCreditsBurned(initialCredits: bigint, expectedBurned: bigint = 10n): Promise<void> {
    // Wait for credit deduction to complete
    await A2ATestUtils.wait(5000)
    
    const finalCredits = await this.getPlanBalance()
    A2AAssertions.assertCreditsBurned(initialCredits, finalCredits, expectedBurned)
  }

  /**
   * Sends a message and validates the response
   */
  async sendMessageAndValidate(message: any, configuration?: any): Promise<any> {
    const response = await fetch(`http://localhost:${TEST_CONFIG.PORT}/a2a/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          ...(configuration && { configuration }),
          message,
        },
      }),
    })

    expect(response.ok).toBe(true)
    const result = await response.json()
    A2AAssertions.assertValidTaskResponse(result)
    return result
  }

  /**
   * Polls for task completion
   */
  async pollForTaskCompletion(taskId: string, maxAttempts: number = 5): Promise<any> {
    return A2ATestUtils.pollForCondition(
      async () => {
        const response = await fetch(`http://localhost:${TEST_CONFIG.PORT}/a2a/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tasks/get',
            params: { id: taskId },
          }),
        })

        if (!response.ok) return null
        
        const result = await response.json()
        if (result.result?.status?.state === 'completed') {
          return result.result
        }
        
        return null
      },
      maxAttempts,
      1000
    )
  }

  protected async setupPaymentPlan(): Promise<void> {
    const accountAddress = this.paymentsBuilder.getAccountAddress() as Address
    const priceConfig = getERC20PriceConfig(1n, TEST_CONFIG.ERC20_ADDRESS, accountAddress)
    const creditsConfig = getFixedCreditsConfig(200n, 10n)

    const planResponse = await A2ATestUtils.retryWithBackoff(
      async () => {
        const response = await this.paymentsBuilder.plans.registerCreditsPlan(
          TEST_DATA.PLAN_METADATA,
          priceConfig,
          creditsConfig,
        )
        
        // Validate the response
        if (!response.planId) {
          throw new Error('Plan registration failed: no planId returned')
        }
        
        return response
      },
      'Plan Registration'
    )

    this.planId = planResponse.planId
    await A2ATestUtils.wait(1000)
  }

  protected async setupAgent(): Promise<void> {
    const agentApi = A2ATestFactory.createAgentApi(TEST_CONFIG.PORT)
    
    const agentResult = await A2ATestUtils.retryWithBackoff(
      async () => {
        const response = await this.paymentsBuilder.agents.registerAgent(
          TEST_DATA.AGENT_METADATA, 
          agentApi, 
          [this.planId]
        )
        
        // Validate the response
        if (!response.agentId) {
          throw new Error('Agent registration failed: no agentId returned')
        }
        
        return response
      },
      'Agent Registration'
    )

    this.agentId = agentResult.agentId
    const paymentMetadata = A2ATestFactory.createPaymentMetadata(this.agentId)
    this.testAgentCard = Payments.a2a.buildPaymentAgentCard(TEST_DATA.BASE_AGENT_CARD, paymentMetadata)
  }

  protected async setupA2AServer(): Promise<void> {
    const serverResult = this.paymentsBuilder.a2a.start({
      agentCard: this.testAgentCard,
      executor: this.getExecutor(),
      port: TEST_CONFIG.PORT,
      basePath: '/a2a/',
      exposeAgentCard: true,
      exposeDefaultRoutes: true,
    })

    this.testServer = serverResult.server

    // Wait for server to be ready with retries
    await A2ATestUtils.retryWithBackoff(
      async () => {
        return new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Server startup timeout'))
          }, 10000) // 10 second timeout
          
          this.testServer.on('listening', () => {
            clearTimeout(timeout)
            resolve()
          })
          
          this.testServer.on('error', (error) => {
            clearTimeout(timeout)
            reject(new Error(`Server startup error: ${error.message}`))
          })
        })
      },
      'A2A Server Startup'
    )
  }

  /**
   * Gets the executor to use for the A2A server
   * Can be overridden by subclasses to use different executors
   */
  protected getExecutor(): AgentExecutor {
    return A2ATestFactory.createTestExecutor()
  }

  protected async setupAccessToken(): Promise<void> {
    // Order plan with retries
    const orderResult = await A2ATestUtils.retryWithBackoff(
      async () => {
        const response = await this.paymentsSubscriber.plans.orderPlan(this.planId)
        
        // Validate the response
        if (!response.success) {
          throw new Error('Plan order failed: success is false')
        }
        
        return response
      },
      'Plan Order'
    )
    
    await A2ATestUtils.wait(1000)
    
    // Get access token with retries
    const accessParams = await A2ATestUtils.retryWithBackoff(
      async () => {
        const response = await this.paymentsSubscriber.agents.getAgentAccessToken(this.planId, this.agentId)
        
        // Validate the response
        if (!response.accessToken || response.accessToken.length === 0) {
          throw new Error('Access token retrieval failed: no token returned')
        }
        
        return response
      },
      'Access Token Retrieval'
    )
    
    this.accessToken = accessParams.accessToken
  }
} 