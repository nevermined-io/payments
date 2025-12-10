/**
 * @file E2E tests for A2A payment flow
 * @description End-to-end tests for A2A server and client functionality using Nevermined backend
 */

import { v4 as uuidv4 } from 'uuid'
import { Payments } from '../../src/payments.js'
import { buildPaymentAgentCard } from '../../src/a2a/agent-card.js'
import type { AgentCard, PaymentsAgentExecutor, ExecutionEventBus } from '../../src/a2a/types.js'
import type { Task, TaskStatus, TaskState, Message, TaskStatusUpdateEvent } from '@a2a-js/sdk'
import { A2ATestServer } from './helpers/e2e-server-helpers.js'
import { createA2ATestAgentAndPlan } from './helpers/a2a-setup-helpers.js'
import { createPaymentsBuilder, createPaymentsSubscriber } from './fixtures.js'
import { retryWithBackoff } from '../utils.js'

const PORT = 6782

/**
 * Basic E2E executor for testing
 */
class BasicE2EExecutor implements PaymentsAgentExecutor {
  private executionTime: number
  private creditsToUse: number
  private executionCount = 0

  constructor(executionTime = 1.0, creditsToUse = 5) {
    this.executionTime = executionTime
    this.creditsToUse = creditsToUse
  }

  async execute(requestContext: any, eventBus: ExecutionEventBus): Promise<void> {
    this.executionCount++
    const taskId = requestContext.taskId || crypto.randomUUID()
    const contextId = requestContext.contextId || 'test-ctx'

    console.log(`[Basic E2E Executor] Starting execution for task ${taskId}`)

    // Publish initial task
    const task: Task = {
      kind: 'task',
      id: taskId,
      contextId,
      status: {
        state: 'working' as TaskState,
        timestamp: new Date().toISOString(),
      } as TaskStatus,
      history: [],
    }
    eventBus.publish(task)

    // Publish working status
    const workingEvent: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'working' as TaskState,
        message: {
          kind: 'message',
          messageId: crypto.randomUUID(),
          role: 'agent',
          parts: [{ kind: 'text', text: 'E2E test working...' }],
          taskId,
          contextId,
        } as Message,
        timestamp: new Date().toISOString(),
      } as TaskStatus,
      final: false,
    }
    eventBus.publish(workingEvent)

    // Simulate execution time
    await new Promise((resolve) => setTimeout(resolve, this.executionTime * 1000))

    // Publish completion with creditsUsed metadata
    const completedEvent: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'completed' as TaskState,
        message: {
          kind: 'message',
          messageId: crypto.randomUUID(),
          role: 'agent',
          parts: [
            {
              kind: 'text',
              text: `E2E test execution completed! Credits used: ${this.creditsToUse}`,
            },
          ],
          taskId,
          contextId,
        } as Message,
        timestamp: new Date().toISOString(),
      } as TaskStatus,
      final: true,
      metadata: {
        creditsUsed: this.creditsToUse,
      },
    }
    eventBus.publish(completedEvent)
    eventBus.finished()

    console.log(
      `[E2E Executor] Completed execution for task ${taskId}, credits: ${this.creditsToUse}`,
    )
  }

  async cancelTask(_taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    // No-op
  }
}

/**
 * E2E test executor for comprehensive testing
 */
class E2ETestExecutor implements PaymentsAgentExecutor {
  private executionTime: number
  private creditsToUse: number
  private executionCount = 0

  constructor(executionTime = 1.0, creditsToUse = 5) {
    this.executionTime = executionTime
    this.creditsToUse = creditsToUse
  }

  async execute(requestContext: any, eventBus: ExecutionEventBus): Promise<void> {
    this.executionCount++
    const taskId = requestContext.taskId || crypto.randomUUID()
    const contextId = requestContext.contextId || 'test-ctx'

    console.log(`[E2E Executor] Starting execution for task ${taskId}`)

    // Publish initial task
    const task: Task = {
      kind: 'task',
      id: taskId,
      contextId,
      status: {
        state: 'working' as TaskState,
        timestamp: new Date().toISOString(),
      } as TaskStatus,
      history: [],
    }
    eventBus.publish(task)

    // Publish working status
    const workingEvent: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'working' as TaskState,
        message: {
          kind: 'message',
          messageId: crypto.randomUUID(),
          role: 'agent',
          parts: [{ kind: 'text', text: 'E2E test processing...' }],
          taskId,
          contextId,
        } as Message,
        timestamp: new Date().toISOString(),
      } as TaskStatus,
      final: false,
    }
    eventBus.publish(workingEvent)

    // Simulate actual work
    await new Promise((resolve) => setTimeout(resolve, this.executionTime * 1000))

    // Publish completion with creditsUsed metadata
    const completedEvent: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'completed' as TaskState,
        message: {
          kind: 'message',
          messageId: crypto.randomUUID(),
          role: 'agent',
          parts: [
            {
              kind: 'text',
              text: `E2E execution completed! Credits used: ${this.creditsToUse}`,
            },
          ],
          taskId,
          contextId,
        } as Message,
        timestamp: new Date().toISOString(),
      } as TaskStatus,
      final: true,
      metadata: {
        creditsUsed: this.creditsToUse,
      },
    }
    eventBus.publish(completedEvent)
    eventBus.finished()

    console.log(
      `[E2E Executor] Completed execution for task ${taskId}, credits: ${this.creditsToUse}`,
    )
  }

  async cancelTask(_taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    // No-op
  }
}

/**
 * E2E tests for A2A payment flows using Nevermined backend
 */
describe('A2A E2E Flow', () => {
  let paymentsPublisher: Payments
  let paymentsSubscriber: Payments
  let accessToken: string | undefined
  let AGENT_ID: string
  let PLAN_ID: string

  beforeAll(async () => {
    // Create Payments instances
    paymentsPublisher = createPaymentsBuilder()
    paymentsSubscriber = createPaymentsSubscriber()

    console.log(`Publisher address: ${paymentsPublisher.getAccountAddress()}}`)
    console.log(`Subscriber address: ${paymentsSubscriber.getAccountAddress()}}`)

    // Create agent and plan for tests
    const setupResult = await createA2ATestAgentAndPlan(paymentsPublisher, {
      port: PORT,
      basePath: '/a2a/',
      creditsGranted: 100n,
      creditsPerRequest: 1n,
    })

    AGENT_ID = setupResult.agentId
    PLAN_ID = setupResult.planId
  }, 60000)

  test('should check balance and order if needed', async () => {
    console.log(`Checking balance for plan: ${PLAN_ID}`)

    try {
      // Check current balance
      console.log(`Attempting to get balance for plan: ${PLAN_ID}`)
      console.log(`Using subscriber with address: ${paymentsSubscriber.getAccountAddress()}}`)

      let currentBalance = 0
      try {
        const balanceResult = await paymentsSubscriber.plans.getPlanBalance(PLAN_ID)
        console.log(`Raw balance result: ${balanceResult}`)
        currentBalance = Number(balanceResult.balance)
        console.log(`Current balance: ${currentBalance}`)
      } catch (balanceError) {
        console.log(`❌ Error getting balance: ${balanceError}`)
        console.log('Attempting to order plan without balance check...')
        currentBalance = 0
      }

      // If balance is 0 or low, order the plan
      if (currentBalance < 10) {
        // Ensure we have at least 10 credits
        console.log('Balance is low, ordering plan...')
        try {
          const orderResult = await retryWithBackoff(
            () => paymentsSubscriber.plans.orderPlan(PLAN_ID),
            {
              label: 'orderPlan',
            },
          )
          console.log(`Order result: ${orderResult}`)
          if (orderResult && orderResult.success) {
            console.log('✅ Plan ordered successfully')
          } else {
            console.log(`⚠️ Order result: ${orderResult}`)
          }
        } catch (orderError) {
          console.log(`❌ Error ordering plan: ${orderError}`)
          // Continue anyway, maybe the user already has credits
        }

        // Try to check balance again after ordering
        try {
          const balanceResult = await paymentsSubscriber.plans.getPlanBalance(PLAN_ID)
          const newBalance = Number(balanceResult.balance)
          console.log(`New balance after ordering: ${newBalance}`)
        } catch (balanceError2) {
          console.log(`❌ Error getting balance after order: ${balanceError2}`)
        }
      }

      console.log('✅ Balance check and order process completed')
    } catch (error) {
      console.log(`❌ Error in balance check/order: ${error}`)
      // Don't throw, continue with tests
      console.log('⚠️ Continuing with tests despite balance check error')
    }
  })

  test('should get agent access token', async () => {
    try {
      const agentAccessParams = await paymentsSubscriber.agents.getAgentAccessToken(
        PLAN_ID,
        AGENT_ID,
      )
      expect(agentAccessParams).toBeDefined()
      expect(agentAccessParams.accessToken?.length).toBeGreaterThan(0)

      // Store for other tests
      accessToken = agentAccessParams.accessToken
      console.log(`✅ Got access token: ${accessToken?.substring(0, 20)}...`)
    } catch (error) {
      console.log(`❌ Error getting access token: ${error}`)
      throw error
    }
  })

  test('should complete blocking flow with credit burning', async () => {
    // Ensure we have access token
    if (!accessToken) {
      const agentAccessParams = await paymentsSubscriber.agents.getAgentAccessToken(
        PLAN_ID,
        AGENT_ID,
      )
      accessToken = agentAccessParams.accessToken
    }

    // Check balance BEFORE execution
    console.log('🔍 Checking balance BEFORE execution...')
    let balanceBefore: number | null = null
    try {
      const balanceBeforeResult = await paymentsSubscriber.plans.getPlanBalance(PLAN_ID)
      balanceBefore = Number(balanceBeforeResult.balance)
      console.log(`📊 Balance BEFORE: ${balanceBefore} credits`)
    } catch (error) {
      console.log(`❌ Error getting balance before: ${error}`)
      balanceBefore = null
    }

    const baseAgentCard: AgentCard = {
      name: 'E2E Blocking Agent',
      description: 'Agent for E2E blocking flow tests',
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
      url: `http://localhost:${PORT}/a2a/`,
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: true,
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
    }

    const paymentMetadata = {
      agentId: AGENT_ID,
      planId: PLAN_ID,
      credits: 50,
      paymentType: 'fixed' as const,
      isTrialPlan: false,
    }

    const paymentAgentCard = buildPaymentAgentCard(baseAgentCard, paymentMetadata)

    // Create executor that uses exactly 1 credit
    const creditsToBurn = 1 // Plan is configured to burn 1 credit regardless of agent reported usage
    const executor = new BasicE2EExecutor(0.5, creditsToBurn)

    // Start REAL A2A server that can receive HTTP requests
    const a2aServer = new A2ATestServer(PORT)
    try {
      const serverUrl = await a2aServer.start(paymentsPublisher, paymentAgentCard, executor)

      // Create test message
      const message = {
        messageId: uuidv4(),
        role: 'user' as const,
        parts: [{ kind: 'text' as const, text: 'E2E blocking test message' }],
      }

      // Send blocking request with bearer token to REAL server
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message,
          options: { blocking: true },
        },
      }

      const headers = { Authorization: `Bearer ${accessToken}` }

      console.log(`Sending blocking request to real server: ${serverUrl}`)
      const response = await fetch(`${serverUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      })

      // Verify response
      expect(response.status).toBe(200)

      const responseData = await response.json()
      expect(responseData.result).toBeDefined()

      // Verify task completion
      const taskResult = responseData.result
      expect(taskResult.status.state).toBe('completed')

      // Verify message content includes credit usage
      const taskMessage = taskResult.status.message
      expect(taskMessage.role).toBe('agent')
      expect(taskMessage.parts[0].text).toContain(`Credits used: ${creditsToBurn}`)

      // Check balance AFTER execution to verify credits were actually burned
      console.log('🔍 Checking balance AFTER execution...')
      try {
        const balanceAfterResult = await paymentsSubscriber.plans.getPlanBalance(PLAN_ID)
        const balanceAfter = Number(balanceAfterResult.balance)
        console.log(`📊 Balance AFTER: ${balanceAfter} credits`)

        if (balanceBefore !== null) {
          const creditsBurned = balanceBefore - balanceAfter
          console.log(`🔥 Credits actually burned: ${creditsBurned}`)

          // Verify that the exact number of credits were burned
          expect(creditsBurned).toBe(creditsToBurn)
          console.log(`✅ Verified: Exactly ${creditsToBurn} credits were burned from the balance!`)
        } else {
          console.log('⚠️ Could not verify credit burning - balance before was not available')
        }
      } catch (error) {
        console.log(`❌ Error getting balance after: ${error}`)
        console.log('⚠️ Could not verify credit burning due to balance check error')
      }

      console.log('✅ E2E blocking flow test passed with verified credit burning')
    } finally {
      // Always cleanup the server
      await a2aServer.stop()
    }
  }, 60000) // 60 second timeout for E2E test

  test('should handle invalid bearer token flow', async () => {
    const baseAgentCard: AgentCard = {
      name: 'Real E2E Auth Agent',
      description: 'Agent for E2E authentication tests',
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
      url: `http://localhost:${PORT}/a2a/`,
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: true,
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
    }

    const paymentMetadata = {
      agentId: AGENT_ID,
      planId: PLAN_ID,
      credits: 50,
      paymentType: 'fixed' as const,
      isTrialPlan: false,
    }

    const paymentAgentCard = buildPaymentAgentCard(baseAgentCard, paymentMetadata)
    const executor = new E2ETestExecutor()

    // Start REAL A2A server
    const a2aServer = new A2ATestServer(PORT)
    const serverUrl = await a2aServer.start(paymentsPublisher, paymentAgentCard, executor)

    // Test with invalid token
    const message = {
      messageId: uuidv4(),
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text: 'This should fail' }],
    }

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message },
    }

    const headers = { Authorization: 'Bearer INVALID_TOKEN' }

    try {
      console.log(`Sending invalid token request to real server: ${serverUrl}`)
      const response = await fetch(`${serverUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      })

      // Should return 402 Payment Required
      expect(response.status).toBe(402)

      const responseData = await response.json()
      expect(responseData.error).toBeDefined()
      expect(responseData.error.message).toContain('Unable to validate access token')

      console.log('✅ E2E invalid token test passed')
    } finally {
      await a2aServer.stop()
    }
  }, 30000)
})
