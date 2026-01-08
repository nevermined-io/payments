/**
 * Integration tests for complete message/send flow with credit burning.
 */

import type { Message, Task, TaskState, TaskStatus, TaskStatusUpdateEvent } from '@a2a-js/sdk'
import request from 'supertest'
import { PaymentsA2AServer } from '../../../src/a2a/server.js'
import type { AgentCard, ExecutionEventBus, PaymentsAgentExecutor } from '../../../src/a2a/types.js'
import type { Payments } from '../../../src/payments.js'

jest.mock('../../../src/utils.js', () => ({
  decodeAccessToken: jest.fn(() => ({
    subscriber: '0xsub',
    subscriberAddress: '0xsub',
    planId: 'test-plan',
  })),
}))

class MockFacilitatorAPI {
  validationCallCount = 0
  settleCallCount = 0
  lastSettleAmount: bigint | null = null
  shouldFailValidation = false
  shouldFailSettle = false

  async verifyPermissions(_: {
    planId: string
    maxAmount: bigint
    x402AccessToken: string
    subscriberAddress: string
  }): Promise<{ success: boolean; message?: string }> {
    this.validationCallCount++
    if (this.shouldFailValidation) {
      return { success: false, message: 'Insufficient credits' }
    }
    return { success: true }
  }

  async settlePermissions(_: {
    planId: string
    maxAmount: bigint
    x402AccessToken: string
    subscriberAddress: string
  }): Promise<{ txHash: string; amountOfCredits: bigint }> {
    this.settleCallCount++
    this.lastSettleAmount = _.maxAmount
    if (this.shouldFailSettle) {
      throw new Error('Failed to settle credits')
    }
    return {
      txHash: '0xdeadbeef',
      amountOfCredits: _.maxAmount,
    }
  }
}

class MockPaymentsService {
  facilitator: MockFacilitatorAPI

  constructor() {
    this.facilitator = new MockFacilitatorAPI()
  }
}

class DummyExecutor implements PaymentsAgentExecutor {
  shouldFail: boolean
  creditsToUse: number

  constructor(shouldFail = false, creditsToUse = 5) {
    this.shouldFail = shouldFail
    this.creditsToUse = creditsToUse
  }

  async execute(requestContext: any, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = requestContext.taskId || crypto.randomUUID()
    const contextId = requestContext.contextId || 'test-ctx'

    // Publish initial task if it doesn't exist
    if (!requestContext.task) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId,
        status: {
          state: 'submitted' as TaskState,
          timestamp: new Date().toISOString(),
        } as TaskStatus,
        history: requestContext.userMessage ? [requestContext.userMessage] : [],
        metadata: requestContext.userMessage?.metadata || null,
      }
      await eventBus.publish(initialTask)
    }

    // Publish working status
    const workingStatusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'working' as TaskState,
        message: {
          kind: 'message',
          messageId: crypto.randomUUID(),
          role: 'agent',
          parts: [{ kind: 'text', text: 'Processing your request...' }],
          taskId,
          contextId,
        } as Message,
        timestamp: new Date().toISOString(),
      } as TaskStatus,
      final: false,
    }
    await eventBus.publish(workingStatusUpdate)

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Publish final completed status with agent message
    const agentMessage: Message = {
      kind: 'message',
      messageId: crypto.randomUUID(),
      role: 'agent',
      parts: [{ kind: 'text', text: 'Request completed successfully!' }],
      taskId,
      contextId,
    }

    const finalStatusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: (this.shouldFail ? 'failed' : 'completed') as TaskState,
        message: agentMessage,
        timestamp: new Date().toISOString(),
      } as TaskStatus,
      metadata: {
        creditsUsed: this.creditsToUse,
      },
      final: true,
    }
    await eventBus.publish(finalStatusUpdate)
    eventBus.finished()
  }

  async cancelTask(_taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    // No-op
  }
}

function createNoopExecutor(): PaymentsAgentExecutor {
  return {
    execute: async (_requestContext, eventBus) => {
      eventBus.finished()
    },
    cancelTask: async () => { },
  }
}

function createServer(
  executor: PaymentsAgentExecutor,
  agentCard: AgentCard,
  paymentsService: any,
): { app: any; handler: any; client: ReturnType<typeof request>; close: () => Promise<void> } {
  // Create server without starting HTTP server (like Python's TestClient)
  const result = PaymentsA2AServer.start({
    agentCard,
    executor,
    paymentsService: paymentsService as any as Payments,
    port: 0, // Not used when using supertest
    basePath: '/rpc',
    exposeDefaultRoutes: true,
  })

  // Use supertest to test the app without HTTP server (like Python's TestClient)
  const client = request(result.app)

  return { app: result.app, handler: result.handler, client, close: result.close }
}

describe('Complete Message/Send Flow', () => {
  let agentCard: AgentCard
  let servers: Array<{ close: () => Promise<void> }> = []

  beforeEach(() => {
    agentCard = {
      name: 'TestAgent',
      capabilities: {
        extensions: [
          {
            uri: 'urn:nevermined:payment',
            params: {
              agentId: 'test-agent-123',
              credits: 10,
              planId: 'test-plan',
              paymentType: 'credits',
            },
          },
        ],
      },
    } as unknown as AgentCard
  })

  afterEach(async () => {
    // Close all servers created during tests
    for (const server of servers) {
      await server.close()
    }
    servers = []
  })

  test('should complete message/send flow with successful credit burning', async () => {
    const mockPayments = new MockPaymentsService()
    const dummyExecutor = new DummyExecutor(false, 3)

    const { client, close } = createServer(dummyExecutor, agentCard, mockPayments)
    servers.push({ close })

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: 'msg-123',
          contextId: 'ctx-456',
          role: 'user',
          parts: [{ kind: 'text', text: 'Hello, burn my credits!' }],
        },
      },
    }

    const response = await client
      .post('/rpc')
      .set('Authorization', 'Bearer TEST_TOKEN')
      .send(payload)

    expect(response.status).toBe(200)
    const responseData = response.body
    expect(responseData.result).toBeDefined()

    // Verify that validation was called exactly once
    expect(mockPayments.facilitator.validationCallCount).toBe(1)

    // Verify response contains the completed task
    const taskResult = responseData.result
    expect(taskResult.kind).toBe('task')
    expect(taskResult.status.state).toBe('completed')
    expect(taskResult.status.message.role).toBe('agent')
    expect(taskResult.status.message.parts[0].text).toBe('Request completed successfully!')

    // Verify that credits were burned exactly once
    expect(mockPayments.facilitator.settleCallCount).toBe(1)
    expect(Number(mockPayments.facilitator.lastSettleAmount)).toBe(3)
  }, 15000)

  test('should handle message/send flow when validation fails', async () => {
    const mockPayments = new MockPaymentsService()
    mockPayments.facilitator.shouldFailValidation = true
    const dummyExecutor = new DummyExecutor()

    const { client, close } = createServer(dummyExecutor, agentCard, mockPayments)
    servers.push({ close })

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: 'msg-123',
          contextId: 'ctx-456',
          role: 'user',
          parts: [{ kind: 'text', text: 'This should fail validation' }],
        },
      },
    }

    const response = await client
      .post('/rpc')
      .set('Authorization', 'Bearer INVALID_TOKEN')
      .send(payload)

    // Should return 402 (payment required) due to validation failure
    expect(response.status).toBe(402)
    const responseData = response.body
    expect(responseData.error).toBeDefined()
    expect(responseData.error.message).toMatch(/Payment validation failed/i)

    // Verify validation was attempted exactly once but credits were not burned
    expect(mockPayments.facilitator.validationCallCount).toBe(1)
    expect(mockPayments.facilitator.settleCallCount).toBe(0)
  }, 15000)

  test('should handle message/send without bearer token', async () => {
    const mockPayments = new MockPaymentsService()
    const dummyExecutor = new DummyExecutor()

    const { client, close } = createServer(dummyExecutor, agentCard, mockPayments)
    servers.push({ close })

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: 'msg-no-token',
          contextId: 'ctx-no-token',
          role: 'user',
          parts: [{ kind: 'text', text: 'No token provided' }],
        },
      },
    }

    const response = await client.post('/rpc').send(payload)

    // Should return 401 (unauthorized)
    expect(response.status).toBe(401)
    const responseData = response.body
    expect(responseData.error).toBeDefined()
    expect(responseData.error.message).toMatch(/Missing bearer token/i)

    // No validation or credit burning should occur
    expect(mockPayments.facilitator.validationCallCount).toBe(0)
    expect(mockPayments.facilitator.settleCallCount).toBe(0)
  }, 15000)

  test('should handle non-blocking execution with polling', async () => {
    const mockPayments = new MockPaymentsService()
    const executor = new DummyExecutor(false, 4)

    const { client, close } = createServer(executor, agentCard, mockPayments)
    servers.push({ close })

    // Test non-blocking message/send
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        configuration: {
          blocking: false, // Non-blocking execution
        },
        message: {
          messageId: 'nonblock-msg-123',
          contextId: 'nonblock-ctx-456',
          role: 'user',
          parts: [{ kind: 'text', text: 'Start non-blocking task!' }],
        },
      },
    }

    const response = await client
      .post('/rpc')
      .set('Authorization', 'Bearer NONBLOCK_TEST_TOKEN')
      .send(payload)

    // Verify immediate response (should be submitted state)
    expect(response.status).toBe(200)
    const responseData = response.body
    expect(responseData.result).toBeDefined()

    const task = responseData.result
    expect(task.kind).toBe('task')
    expect(task.status.state).toBe('submitted') // Should return immediately

    const taskId = task.id

    // Verify initial validation occurred exactly once
    const initialValidationCount = mockPayments.facilitator.validationCallCount
    expect(initialValidationCount).toBe(1)

    // Poll for task completion
    const maxAttempts = 10
    let finalTask: any = null

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pollPayload = {
        jsonrpc: '2.0',
        id: 2 + attempt,
        method: 'tasks/get',
        params: { id: taskId },
      }

      const pollResponse = await client
        .post('/rpc')
        .set('Authorization', 'Bearer NONBLOCK_TEST_TOKEN')
        .send(pollPayload)

      if (pollResponse.status === 200) {
        const pollData = pollResponse.body
        if (pollData.result) {
          const taskResult = pollData.result

          if (taskResult.status.state === 'completed') {
            finalTask = taskResult
            break
          } else if (['failed', 'canceled'].includes(taskResult.status.state)) {
            break // Don't continue polling for terminal failure states
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 200)) // Wait before next poll
    }

    // Verify final task completion
    expect(finalTask).not.toBeNull()
    expect(finalTask.status.state).toBe('completed')
    expect(finalTask.status.message.role).toBe('agent')
    expect(finalTask.status.message.parts[0].text).toBe('Request completed successfully!')

    // Verify credit burning occurred after task completion
    expect(mockPayments.facilitator.settleCallCount).toBe(1)
  }, 30000)
})
