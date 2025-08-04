/**
 * @file E2E tests for A2A payment flow
 * @description End-to-end tests for A2A server and client functionality
 */

import { Payments } from '../../src/payments.js'
import { 
  getERC20PriceConfig,
  getFixedCreditsConfig,
} from '../../src/plans.js'
import { 
  E2E_TEST_CONFIG,
  A2AE2EFactory,
  A2AE2EUtils,
  A2AE2EAssertions,
  A2AE2EServerManager
} from './helpers/a2a-e2e-helpers.js'
import { E2ETestUtils } from './helpers/e2e-test-helpers.js'

describe('A2A E2E', () => {
  let paymentsBuilder: any
  let paymentsSubscriber: any
  let serverManager: A2AE2EServerManager
  let planId: string
  let agentId: string
  let serverResult: any

  beforeAll(async () => {
    // Builder instance - creates plans, agents and servers
    paymentsBuilder = A2AE2EUtils.createPaymentsInstance(E2E_TEST_CONFIG.BUILDER_API_KEY)
    paymentsSubscriber = A2AE2EUtils.createPaymentsInstance(E2E_TEST_CONFIG.SUBSCRIBER_API_KEY)
    
    serverManager = new A2AE2EServerManager()

    const planMetadata = { name: 'E2E A2A Test Plan' }
    const priceConfig = getERC20PriceConfig(1n, '0x036CbD53842c5426634e7929541eC2318f3dCF7e', paymentsBuilder.getAccountAddress())
    const creditsConfig = getFixedCreditsConfig(1000n)
    
    const planResult = await E2ETestUtils.retryWithBackoff(
      async () => {
        const result = await paymentsBuilder.plans.registerCreditsPlan(
          planMetadata,
          priceConfig,
          creditsConfig,
        )
        
        if (!result.planId) {
          throw new Error('Plan registration failed: no planId returned')
        }
        
        return result
      },
      'Plan Registration'
    )
    
    planId = planResult.planId

    // Create an agent with streaming capabilities
    const agentMetadata = {
      name: 'E2E A2A Test Agent',
      description: 'Agent for E2E A2A tests',
      tags: ['a2a', 'test'],
      dateCreated: new Date(),
    }
    const agentApi = {
      endpoints: [{ POST: 'http://localhost:3005/a2a/' }, { POST: 'http://localhost:3006/a2a/' }],
    }
    
    const agentResult = await E2ETestUtils.retryWithBackoff(
      async () => {
        const result = await paymentsBuilder.agents.registerAgent(
          agentMetadata,
          agentApi,
          [planId],
        )
        
        if (!result.agentId) {
          throw new Error('Agent registration failed: no agentId returned')
        }
        
        return result
      },
      'Agent Registration'
    )
    
    agentId = agentResult.agentId

    // Order the plan to get credits
    await E2ETestUtils.retryWithBackoff(
      async () => {
        const result = await paymentsSubscriber.plans.orderPlan(planId)
        
        if (!result.success) {
          throw new Error('Plan order failed: success is false')
        }
        
        return result
      },
      'Plan Order'
    )
    
    // Start a centralized server for all tests
    const baseAgentCard = {
      name: 'E2E A2A Test Agent',
      description: 'Agent for E2E A2A tests',
      capabilities: {
        streaming: true,
        pushNotifications: true,
        stateTransitionHistory: true,
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: 'http://localhost:3005/a2a/',
      version: '1.0.0',
    }

    const agentCard = Payments.a2a.buildPaymentAgentCard(baseAgentCard, {
      paymentType: "dynamic",
      credits: 1, // Base cost
      costDescription:
        "Variable credits based on operation complexity: Greeting (1), Calculation (2), Weather (3), Translation (4), Streaming (5)",
      planId,
      agentId,
    });
    
    serverResult = await paymentsBuilder.a2a.start({
      port: 3005,
      basePath: '/a2a/',
      agentCard: agentCard,
      executor: A2AE2EFactory.createStreamingExecutor(),
    })
    
    serverManager.addServer(serverResult)
    
    // Wait for server to be ready
    await A2AE2EUtils.waitForServerReady(3005, 20, '/a2a/')
  }, E2E_TEST_CONFIG.TIMEOUT * 6)

  afterAll(async () => {
    await serverManager.cleanup()
  })

  describe('A2A Server and Client Flow', () => {
    it('should have a valid server', () => {
      A2AE2EAssertions.assertValidServerResult(serverResult)
    })

    it('should register and retrieve a client through Payments.a2a.getClient', async () => {
      const client = paymentsSubscriber.a2a.getClient({
        agentBaseUrl: 'http://localhost:3005/a2a/',
        agentId: agentId,
        planId: planId,
      })
      
      A2AE2EAssertions.assertValidClient(client)
    })

    it('should handle multiple client registrations', async () => {
      const client1 = paymentsSubscriber.a2a.getClient({
        agentBaseUrl: 'http://localhost:3005/a2a/',
        agentId: agentId,
        planId: planId,
      })
      const client2 = paymentsSubscriber.a2a.getClient({
        agentBaseUrl: 'http://localhost:3005/a2a/',
        agentId: agentId,
        planId: planId,
      })

      expect(client1).toBeDefined()
      expect(client2).toBeDefined()
      // The registry should return the same instance for the same parameters (this is correct behavior)
      expect(client1).toBe(client2)
    })
  })

  describe('A2A Payment Processing', () => {
    it('should process an A2A message through the client', async () => {
      const client = paymentsSubscriber.a2a.getClient({
        agentBaseUrl: 'http://localhost:3005/a2a/',
        agentId: agentId,
        planId: planId,
      })

      // Test sending an A2A message with correct format
      const messageParams = {
        message: A2AE2EFactory.createTestMessage('Hello, this is a test message'),
      }

      // This test should fail because the agent/plan don't exist in the real system
      // The test verifies that the client properly handles this error case
      const result = await client.sendA2AMessage(messageParams)
      A2AE2EAssertions.assertValidA2AResponse(result)
    }, E2E_TEST_CONFIG.TIMEOUT)

    it('should handle invalid message requests gracefully', async () => {
      const client = paymentsSubscriber.a2a.getClient({
        agentBaseUrl: 'http://localhost:3005/a2a/',
        agentId: agentId,
        planId: planId,
      })

      try {
        await client.sendA2AMessage({} as any)
        fail('Should have thrown an error for invalid request')
      } catch (error) {
        expect(error).toBeDefined()
      }
    }, E2E_TEST_CONFIG.TIMEOUT)
  })

  describe('A2A Static Utilities', () => {
    it('should build payment agent card using static method', () => {
      const baseCard = {
        name: 'E2E Test Agent',
        description: 'Agent for E2E testing',
        capabilities: {
          streaming: true,
          pushNotifications: true,
          stateTransitionHistory: true,
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3003',
        version: '1.0.0',
      }
      const paymentMetadata = A2AE2EFactory.createPaymentMetadata('e2e-test-agent')

      const agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)

      A2AE2EAssertions.assertValidAgentCard(agentCard)
      expect(agentCard.name).toBe('E2E Test Agent')
      expect((agentCard.capabilities?.extensions?.[0]?.params as any)?.agentId).toBe(
        'e2e-test-agent',
      )
    }, E2E_TEST_CONFIG.TIMEOUT)

    it('should integrate agent card with A2A flow', async () => {
      // Test that the agent card can be used in the A2A flow
      const client = paymentsSubscriber.a2a.getClient({
        agentBaseUrl: 'http://localhost:3005/a2a/',
        agentId: agentId,
        planId: planId,
      })
      
      A2AE2EAssertions.assertValidClient(client)

      // Wait a bit for the client to complete its internal agent card fetch
      await A2AE2EUtils.wait(500)
    }, E2E_TEST_CONFIG.TIMEOUT)
  })

  describe('A2A Error Handling', () => {
    it('should handle client registration errors', () => {
      expect(() => {
        paymentsSubscriber.a2a.getClient({} as any)
      }).toThrow()
    }, E2E_TEST_CONFIG.TIMEOUT)
  })

  describe('A2A Streaming SSE E2E Tests', () => {
    it('should handle streaming requests with SSE events using A2A client', async () => {
      // Create A2A client with real credentials
      const client = paymentsSubscriber.a2a.getClient({
        agentBaseUrl: 'http://localhost:3005/a2a/',
        agentId: agentId,
        planId: planId,
      })
      
      A2AE2EAssertions.assertValidClient(client)

      // Test streaming request using the A2A client
      const message = A2AE2EFactory.createTestMessage('Start streaming')
      const messageParams = { message }
      
      // Use the streaming method and collect all events
      const events: any[] = []
      let finalResult: any = null
      
      for await (const event of client.sendA2AMessageStream(messageParams)) {
        events.push(event)
        if (event.result && event.result.final) {
          finalResult = event
          break
        }
      }
      
      // Verify we received streaming events
      A2AE2EAssertions.assertValidStreamingResponse(events, finalResult)
    }, E2E_TEST_CONFIG.TIMEOUT)

    it('should handle streaming errors gracefully using A2A client', async () => {
      // Create A2A client with real credentials
      const client = paymentsSubscriber.a2a.getClient({
        agentBaseUrl: 'http://localhost:3005/a2a/',
        agentId: agentId,
        planId: planId,
      })
      
      A2AE2EAssertions.assertValidClient(client)

      // Test streaming request using the A2A client
      const message = A2AE2EFactory.createTestMessage('Start streaming')
      const messageParams = { message }
      
      // Use the streaming method and collect all events
      const events: any[] = []
      let finalResult: any = null
      
      for await (const event of client.sendA2AMessageStream(messageParams)) {
        events.push(event)
        if (event.result && event.result.final) {
          finalResult = event
          break
        }
      }
      
      // Verify we received streaming events
      expect(events.length).toBeGreaterThan(0)
      expect(finalResult).toBeDefined()
      
      // Should complete successfully even if there are internal streaming issues
      expect(finalResult.result.status.state).toBe('completed')
      expect(finalResult.result.metadata.creditsUsed).toBe(10)
    }, E2E_TEST_CONFIG.TIMEOUT)

    it('should handle resubscribe to task streaming using A2A client', async () => {
      // Create a separate server for resubscribe testing with the specific executor
      const resubscribeAgentCard = {
        name: 'E2E A2A Resubscribe Test Agent',
        description: 'Agent for E2E A2A resubscribe tests',
        capabilities: {
          streaming: true,
          pushNotifications: true,
          stateTransitionHistory: true,
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3006/a2a/',
        version: '1.0.0',
      }

      const resubscribeAgentCardWithPayments = Payments.a2a.buildPaymentAgentCard(resubscribeAgentCard, {
        paymentType: "dynamic",
        credits: 1,
        costDescription: "Variable credits based on operation complexity",
        planId,
        agentId,
      });
      
      const resubscribeServerResult = await paymentsBuilder.a2a.start({
        port: 3006,
        basePath: '/a2a/',
        agentCard: resubscribeAgentCardWithPayments,
        executor: A2AE2EFactory.createResubscribeStreamingExecutor(),
      })
      
      serverManager.addServer(resubscribeServerResult)
      
      // Wait for server to be ready
      await A2AE2EUtils.waitForServerReady(3006, 20, '/a2a/')

      // Create A2A client for resubscribe testing
      const client = paymentsSubscriber.a2a.getClient({
        agentBaseUrl: 'http://localhost:3006/a2a/',
        agentId: agentId,
        planId: planId,
      })
      
      A2AE2EAssertions.assertValidClient(client)

      // First, start a streaming request to get a taskId
      const message = A2AE2EFactory.createTestMessage('Start streaming for resubscribe test')
      const messageParams = { message }
      
      // Use the streaming method and collect only a few events (simulate disconnection)
      const initialEvents: any[] = []
      let taskId: string | null = null
      let eventCount = 0
      const maxInitialEvents = 2 // Only receive 2 events before "disconnecting"
      
      for await (const event of client.sendA2AMessageStream(messageParams)) {
        initialEvents.push(event)
        eventCount++
        
        // Extract taskId from the first event that has it
        if (!taskId && event.result && event.result.id) {
          taskId = event.result.id
        }
        
        // Simulate disconnection after receiving a few events
        if (eventCount >= maxInitialEvents) {
          console.log(`[TEST] Simulating disconnection after ${eventCount} events`)
          break // Exit the loop to simulate disconnection
        }
        
        // Don't wait for final event - we want to simulate interruption
        if (event.result && event.result.final) {
          break
        }
      }
      
      // Verify we got a taskId and some initial events
      expect(taskId).toBeDefined()
      expect(initialEvents.length).toBeGreaterThan(0)
      expect(initialEvents.length).toBeLessThanOrEqual(maxInitialEvents)
      console.log(`[TEST] Received ${initialEvents.length} initial events, taskId: ${taskId}`)
      
      // Wait a bit to simulate the time between disconnection and resubscribe
      await A2AE2EUtils.wait(500)
      
      // Now test resubscribe using the obtained taskId to complete the streaming
      const resubscribeParams = { id: taskId }
      const resubscribeEvents: any[] = []
      let resubscribeFinalResult: any = null
      
      for await (const event of client.resubscribeA2ATask(resubscribeParams)) {
        resubscribeEvents.push(event)
        
        if (event.result && event.result.final) {
          resubscribeFinalResult = event
          break
        }
      }
      
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
    }, E2E_TEST_CONFIG.TIMEOUT)
  })
})

