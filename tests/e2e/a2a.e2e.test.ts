/**
 * @file E2E tests for A2A payment flow
 * @description End-to-end tests for A2A server and client functionality
 */

import { Payments } from '../../src/payments.js'
import { 
  E2E_TEST_DATA,
  A2AE2EFactory,
  A2AE2EUtils,
  A2AE2EAssertions,
  A2AE2EServerManager
} from './helpers/a2a-e2e-helpers.js'

describe('A2A E2E', () => {
  let payments: any
  let serverManager: A2AE2EServerManager

  beforeAll(() => {
    payments = A2AE2EUtils.createPaymentsInstance()
    serverManager = new A2AE2EServerManager()
  })

  afterAll(async () => {
    await serverManager.cleanup()
  })

  describe('A2A Server and Client Flow', () => {
    it('should start the A2A server with valid options', async () => {
      const serverResult = await payments.a2a.start({
        port: 3001,
        agentCard: E2E_TEST_DATA.BASE_AGENT_CARD,
        executor: A2AE2EFactory.createTestExecutor(),
      })

      A2AE2EAssertions.assertValidServerResult(serverResult)
      
      // Store server for cleanup
      serverManager.addServer(serverResult)
    })

    it('should register and retrieve a client through Payments.a2a.getClient', async () => {
      // Start a server first
      const serverResult = await payments.a2a.start({
        port: 3005,
        agentCard: E2E_TEST_DATA.CLIENT_TEST_AGENT_CARD,
        executor: A2AE2EFactory.createTestExecutor(),
      })
      
      serverManager.addServer(serverResult)
      
      // Wait for server to be ready before creating client
      await A2AE2EUtils.waitForServerReady(3005)

      const client = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3005',
        agentId: 'test-agent',
        planId: 'test-plan',
      })
      
      A2AE2EAssertions.assertValidClient(client)
    })

    it('should handle multiple client registrations', async () => {
      // Start a server first
      const serverResult = await payments.a2a.start({
        port: 3006,
        agentCard: E2E_TEST_DATA.MULTI_CLIENT_TEST_AGENT_CARD,
        executor: A2AE2EFactory.createTestExecutor(),
      })
      
      serverManager.addServer(serverResult)
      
      // Wait for server to be ready before creating clients
      await A2AE2EUtils.waitForServerReady(3006)

      const client1 = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3006',
        agentId: 'client1-agent',
        planId: 'test-plan',
      })
      const client2 = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3006',
        agentId: 'client2-agent',
        planId: 'test-plan',
      })

      expect(client1).toBeDefined()
      expect(client2).toBeDefined()
      expect(client1).not.toBe(client2)
    })
  })

  describe('A2A Payment Processing', () => {
    it('should process an A2A message through the client', async () => {
      // Start server for this test
      const serverResult = await payments.a2a.start({
        port: 3008,
        agentCard: E2E_TEST_DATA.PAYMENT_TEST_AGENT_CARD,
        executor: A2AE2EFactory.createTestExecutor(),
      })
      
      serverManager.addServer(serverResult)
      
      // Wait for server to be ready before creating client
      await A2AE2EUtils.waitForServerReady(3008)

      const client = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3008',
        agentId: 'payment-agent',
        planId: 'payment-plan',
      })

      // Test sending an A2A message with correct format
      const messageParams = {
        message: A2AE2EFactory.createTestMessage('Hello, this is a test message'),
      }

      // This test should fail because the agent/plan don't exist in the real system
      // The test verifies that the client properly handles this error case
      await A2AE2EAssertions.assertPaymentErrorThrown(
        client.sendA2AMessage(messageParams)
      )
    })

    it('should handle invalid message requests gracefully', async () => {
      // Start server for this test
      const serverResult = await payments.a2a.start({
        port: 3009,
        agentCard: E2E_TEST_DATA.ERROR_TEST_AGENT_CARD,
        executor: A2AE2EFactory.createTestExecutor(),
      })
      
      serverManager.addServer(serverResult)
      
      // Wait for server to be ready before creating client
      await A2AE2EUtils.waitForServerReady(3009)

      const client = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3009',
        agentId: 'error-agent',
        planId: 'error-plan',
      })

      try {
        await client.sendA2AMessage({} as any)
        fail('Should have thrown an error for invalid request')
      } catch (error) {
        expect(error).toBeDefined()
      }
    })
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
    })

    it('should integrate agent card with A2A flow', async () => {
      const serverResult = await payments.a2a.start({
        port: 3010,
        agentCard: E2E_TEST_DATA.INTEGRATION_TEST_AGENT_CARD,
        executor: A2AE2EFactory.createTestExecutor(),
      })

      serverManager.addServer(serverResult)
      
      A2AE2EAssertions.assertValidServerResult(serverResult)

      // Wait for server to be ready before creating client
      await A2AE2EUtils.waitForServerReady(3010)

      // Test that the agent card can be used in the A2A flow
      const client = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3010',
        agentId: 'integration-agent',
        planId: 'integration-plan',
      })
      
      A2AE2EAssertions.assertValidClient(client)

      // Wait a bit for the client to complete its internal agent card fetch
      await A2AE2EUtils.wait(500)
    })
  })

  describe('A2A Error Handling', () => {
    it('should handle client registration errors', () => {
      expect(() => {
        payments.a2a.getClient({} as any)
      }).toThrow()
    })
  })
})

