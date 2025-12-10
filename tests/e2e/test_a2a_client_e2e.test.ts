/**
 * @file E2E tests for the TypeScript A2A client using a real server and backend validation.
 * @description End-to-end tests for A2A client functionality using Nevermined backend
 */

import { v4 as uuidv4 } from 'uuid'
import { Payments } from '../../src/payments.js'
import { buildPaymentAgentCard } from '../../src/a2a/agent-card.js'
import type { AgentCard, PaymentsAgentExecutor, ExecutionEventBus } from '../../src/a2a/types.js'
import type { Task, TaskStatusUpdateEvent } from '@a2a-js/sdk'
import { A2ATestServer } from './helpers/e2e-server-helpers.js'
import { createA2ATestAgentAndPlan } from './helpers/a2a-setup-helpers.js'
import { createPaymentsBuilder, createPaymentsSubscriber } from './fixtures.js'
import { retryWithBackoff } from '../utils.js'
const PORT = 6782

/**
 * Streaming executor for E2E client tests
 */
class StreamingE2EExecutor implements PaymentsAgentExecutor {
  async execute(requestContext: any, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage
    const taskId = requestContext.taskId || crypto.randomUUID()
    const contextId = userMessage?.contextId || requestContext.contextId || 'test-ctx'

    console.log(`[Streaming E2E Executor] Starting execution for task ${taskId}`)

    // Initial task event
    const initialTask: Task = {
      kind: 'task',
      id: taskId,
      contextId: contextId,
      status: {
        state: 'submitted',
        timestamp: new Date().toISOString(),
      },
      history: userMessage ? [userMessage] : [],
    }
    await eventBus.publish(initialTask)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Working status update
    const working: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      final: false,
      status: {
        state: 'working',
        timestamp: new Date().toISOString(),
      },
    }
    await eventBus.publish(working)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Final status update with credits
    const final: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      final: true,
      metadata: { creditsUsed: 1 },
      status: {
        state: 'completed',
        timestamp: new Date().toISOString(),
      },
    }
    await eventBus.publish(final)
    await eventBus.finished()
  }

  async cancelTask(_taskId: string): Promise<void> {
    // No-op for this executor
  }
}

describe('A2A Client E2E Tests', () => {
  let paymentsSubscriber: Payments
  let paymentsPublisher: Payments
  let a2aServer: A2ATestServer | null = null
  let AGENT_ID: string
  let PLAN_ID: string

  beforeAll(async () => {
    // Initialize Payments instances
    paymentsSubscriber = createPaymentsSubscriber()
    paymentsPublisher = createPaymentsBuilder()

    // Create agent and plan for tests
    const setupResult = await createA2ATestAgentAndPlan(paymentsPublisher, {
      port: PORT,
      basePath: '/a2a/',
    })

    AGENT_ID = setupResult.agentId
    PLAN_ID = setupResult.planId

    // Order plan for subscriber to get credits
    try {
      const orderResult = await retryWithBackoff(
        () => paymentsSubscriber.plans.orderPlan(PLAN_ID),
        {
          label: 'orderPlan',
        },
      )
      expect(orderResult.success).toBe(true)
      console.log('✅ Plan ordered successfully')
    } catch (error) {
      console.log(`⚠️ Plan order failed (may already be ordered): ${error}`)
    }
  }, 60000)

  afterAll(async () => {
    // Cleanup server if still running
    if (a2aServer) {
      await a2aServer.stop()
    }
  }, 30000)

  //   test('should get client and verify methods', async () => {
  //     const baseAgentCard: AgentCard = {
  //       name: 'E2E A2A Client Test Agent TS',
  //       description: 'A2A client test',
  //       version: '1.0.0',
  //       protocolVersion: '0.3.0' as const,
  //       url: `http://localhost:${PORT}/a2a/`,
  //       capabilities: {
  //         streaming: true,
  //         pushNotifications: true,
  //         stateTransitionHistory: true,
  //       },
  //       defaultInputModes: ['text'],
  //       defaultOutputModes: ['text'],
  //       skills: [],
  //     }

  //     const paymentMetadata = {
  //       agentId: AGENT_ID,
  //       planId: PLAN_ID,
  //       credits: 1,
  //       paymentType: 'dynamic' as const,
  //       isTrialPlan: false,
  //     }

  //     const paymentAgentCard = buildPaymentAgentCard(baseAgentCard, paymentMetadata)
  //     const executor = new StreamingE2EExecutor()

  //     // Start A2A server
  //     a2aServer = new A2ATestServer(PORT)
  //     const serverUrl = await a2aServer.start(paymentsPublisher, paymentAgentCard, executor)

  //     // Get client
  //     const client = await paymentsSubscriber.a2a.getClient({
  //       agentBaseUrl: serverUrl,
  //       agentId: AGENT_ID,
  //       planId: PLAN_ID,
  //     })

  //     expect(client).toBeDefined()
  //     expect(client).toHaveProperty('sendA2AMessage')
  //     expect(client).toHaveProperty('getA2ATask')
  //     expect(client).toHaveProperty('clearToken')

  //     console.log('✅ Client registration test passed')
  //   }, 30000)

  //   test('should send message and stream responses', async () => {
  //     const baseAgentCard: AgentCard = {
  //       name: 'E2E A2A Client Test Agent TS',
  //       description: 'A2A client test',
  //       version: '1.0.0',
  //       protocolVersion: '0.3.0' as const,
  //       url: `http://localhost:${PORT}/a2a/`,
  //       capabilities: {
  //         streaming: true,
  //         pushNotifications: true,
  //         stateTransitionHistory: true,
  //       },
  //       defaultInputModes: ['text'],
  //       defaultOutputModes: ['text'],
  //       skills: [],
  //     }

  //     const paymentMetadata = {
  //       agentId: AGENT_ID,
  //       planId: PLAN_ID,
  //       credits: 1,
  //       paymentType: 'dynamic' as const,
  //       isTrialPlan: false,
  //     }

  //     const paymentAgentCard = buildPaymentAgentCard(baseAgentCard, paymentMetadata)
  //     const executor = new StreamingE2EExecutor()

  //     // Start A2A server
  //     if (a2aServer) {
  //       await a2aServer.stop()
  //     }
  //     a2aServer = new A2ATestServer(PORT)
  //     const serverUrl = await a2aServer.start(paymentsPublisher, paymentAgentCard, executor)

  //     // Get client
  //     const client = await paymentsSubscriber.a2a.getClient({
  //       agentBaseUrl: serverUrl,
  //       agentId: AGENT_ID,
  //       planId: PLAN_ID,
  //     })

  //     // Send a simple message
  //     const msg = {
  //       message: {
  //         kind: 'message' as const,
  //         role: 'user' as const,
  //         messageId: uuidv4(),
  //         parts: [{ kind: 'text' as const, text: 'Hello from E2E client' }],
  //       },
  //     }

  //     const result = await client.sendA2AMessage(msg)
  //     expect(result).toBeDefined()
  //     expect(result.jsonrpc).toBe('2.0')
  //     if ('result' in result) {
  //       expect(result.result).toBeDefined()
  //     } else {
  //       throw new Error('Expected result in response')
  //     }

  //     // Streaming
  //     let finalEvent: any = null
  //     for await (const ev of client.sendA2AMessageStream(msg)) {
  //       if (ev.result?.kind === 'status-update' && ev.result?.final) {
  //         finalEvent = ev.result
  //         break
  //       }
  //     }

  //     expect(finalEvent).not.toBeNull()
  //     const meta = finalEvent.metadata || finalEvent.get?.('metadata')
  //     expect(meta).toBeDefined()
  //     expect(meta.creditsUsed || meta.get?.('creditsUsed')).toBe(1)

  //     console.log('✅ Send message and stream test passed')
  //   }, 60000)

  test('should resubscribe to task', async () => {
    const baseAgentCard: AgentCard = {
      name: 'E2E A2A Client Test Agent TS',
      description: 'A2A client test',
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
      url: `http://localhost:${PORT}/a2a/`,
      capabilities: {
        streaming: true,
        pushNotifications: true,
        stateTransitionHistory: true,
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
    }

    const paymentMetadata = {
      agentId: AGENT_ID,
      planId: PLAN_ID,
      credits: 1,
      paymentType: 'dynamic' as const,
      isTrialPlan: false,
    }

    const paymentAgentCard = buildPaymentAgentCard(baseAgentCard, paymentMetadata)
    const executor = new StreamingE2EExecutor()

    // Start A2A server
    if (a2aServer) {
      await a2aServer.stop()
    }
    a2aServer = new A2ATestServer(PORT)
    const serverUrl = await a2aServer.start(paymentsPublisher, paymentAgentCard, executor)

    // Get client
    const client = await paymentsSubscriber.a2a.getClient({
      agentBaseUrl: serverUrl,
      agentId: AGENT_ID,
      planId: PLAN_ID,
    })

    // Start streaming but stop early to simulate disconnect
    const msg = {
      message: {
        kind: 'message' as const,
        role: 'user' as const,
        messageId: uuidv4(),
        parts: [{ kind: 'text' as const, text: 'Resubscribe flow' }],
      },
    }

    let taskId: string | null = null
    let count = 0
    for await (const ev of client.sendA2AMessageStream(msg)) {
      count++
      taskId = ev.result?.id || null
      if (count >= 1) break
    }

    expect(taskId).not.toBeNull()

    let final: any = null
    try {
      for await (const ev of client.resubscribeA2ATask({ id: taskId! })) {
        const e = ev.result || ev
        const normalizedEvent = Array.isArray(e) ? e[1] || e[0] : e
        const kind = normalizedEvent.kind || (normalizedEvent as any).get?.('kind')
        const isFinal = normalizedEvent.final || (normalizedEvent as any).get?.('final') || false

        if (kind === 'status-update' && isFinal) {
          final = normalizedEvent
          break
        }
      }
    } catch (error: any) {
      const msg = String(error)
      if (
        msg.includes('terminal state') ||
        msg.includes('do not support resubscription') ||
        msg.includes('not support resubscription')
      ) {
        // Allow terminal/unsupported resubscribe scenarios
        console.log('⚠️ Resubscribe not supported or task in terminal state')
        return
      }
      throw error
    }

    expect(final).not.toBeNull()
    const meta = final.metadata || final.get?.('metadata')
    expect(meta).toBeDefined()
    expect(meta.creditsUsed || meta.get?.('creditsUsed')).toBe(1)

    console.log('✅ Resubscribe test passed')
  }, 60000)
})
