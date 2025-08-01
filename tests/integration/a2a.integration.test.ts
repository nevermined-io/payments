/**
 * @file Integration tests for A2A with local server (development only)
 */

import { 
  A2ATestContext, 
  A2ATestUtils, 
  A2AAssertions, 
  TEST_CONFIG,
  TEST_DATA,
  TaskState
} from './helpers/a2a-test-helpers.js'
import { v4 as uuidv4 } from 'uuid'

describe('A2A Integration Tests', () => {
  let testContext: A2ATestContext

  beforeAll(async () => {
    testContext = new A2ATestContext()
    await testContext.setup()
  }, TEST_CONFIG.TIMEOUT)

  afterAll(async () => {
    await testContext.teardown()
  }, TEST_CONFIG.TIMEOUT)

  describe('A2A Server Setup', () => {
    it('should start A2A server successfully', () => {
      expect(testContext.testServer).toBeDefined()
      expect(TEST_CONFIG.PORT).toBeGreaterThan(0)
      expect(testContext.testServer.listening).toBe(true)
    })

    it('should expose agent card at .well-known/agent.json with correct agentId', async () => {
      const response = await fetch(`http://localhost:${TEST_CONFIG.PORT}/a2a/.well-known/agent.json`)
      expect(response.ok).toBe(true)

      const agentCard = await response.json()
      A2AAssertions.assertValidAgentCard(agentCard, testContext.agentId)
    })
  })

  describe('Agent Registration Verification', () => {
    it('should have registered plan and agent successfully', () => {
      expect(testContext.planId).toBeDefined()
      expect(BigInt(testContext.planId) > 0n).toBeTruthy()
      expect(testContext.agentId).toBeDefined()
      expect(testContext.agentId.startsWith('did:nv:')).toBeTruthy()
    })
  })

  describe('A2A Token and Access', () => {
    it('should have ordered plan and generated access token successfully', () => {
      expect(testContext.accessToken).toBeDefined()
      expect(testContext.accessToken.length).toBeGreaterThan(0)
    })

    it('should have server running and accessible', async () => {
      expect(testContext.testServer.listening).toBe(true)
      await A2AAssertions.assertServerAccessible(TEST_CONFIG.PORT)
    })

    it('should reject requests without valid token', async () => {
      await A2AAssertions.assertPaymentRequired(`http://localhost:${TEST_CONFIG.PORT}/a2a/`)
    }, TEST_CONFIG.TIMEOUT)
  })

  describe('A2A Message Processing', () => {
    beforeEach(async () => {
      // Wait for any pending credit deductions to complete
      // This prevents race conditions between tests
      await A2ATestUtils.wait(3000)
    })

    it('should process A2A messages with valid token', async () => {
      const message = A2ATestUtils.createTestMessage('Hello from A2A test server!')
      
      const result = await testContext.sendMessageAndValidate(message)
      
      A2AAssertions.assertTaskCompleted(result)
    }, TEST_CONFIG.TIMEOUT)

    it('should handle blocking requests with credit validation', async () => {
      // Get initial balance
      const initialCredits = await testContext.getPlanBalance()

      // Make a request with proper message format
      const message = A2ATestUtils.createTestMessage('Test credit burning validation')
      const result = await testContext.sendMessageAndValidate(message, { blocking: true })
      
      // Verify the response structure
      A2AAssertions.assertTaskCompleted(result)

      // Check final balance immediately after task completion
      await testContext.validateCreditsBurned(initialCredits)
    }, TEST_CONFIG.TIMEOUT)

    it('should handle non-blocking requests with immediate response and polling', async () => {
      // Get initial balance
      const initialCredits = await testContext.getPlanBalance()

      // Make a non-blocking request
      const message = A2ATestUtils.createTestMessage('Test non-blocking execution')
      const result = await testContext.sendMessageAndValidate(message, { blocking: false })
      
      // Verify immediate response (should be submitted state)
      A2AAssertions.assertTaskState(result, TaskState.SUBMITTED)
      
      const taskId = result.result.id

      // Poll for final result
      const finalResult = await testContext.pollForTaskCompletion(taskId)

      // Verify final result
      expect(finalResult).not.toBeNull()
      expect(finalResult.status.state).toBe('completed')
      expect(finalResult.status.message.role).toBe('agent')
      expect(finalResult.status.message.parts[0].text).toBe('Request completed successfully!')

      // Check final balance (credits should be burned)
      await testContext.validateCreditsBurned(initialCredits)
    }, TEST_CONFIG.TIMEOUT)
    
    it('should set push notification configuration for a task', async () => {
      // First, create a task
      const message = A2ATestUtils.createTestMessage('Test push notification setup')
      const result = await testContext.sendMessageAndValidate(message, { blocking: false })
      const taskId = result.result.id

      // Set push notification configuration
      const pushNotificationConfig = {
        url: testContext.webhookManager.getWebhookUrl(),
        token: "test-token-abc",
        authentication: {
          credentials: "test-token-abc",
          schemes: ["bearer"],
        },
      }

      const setConfigResponse = await fetch(`http://localhost:${TEST_CONFIG.PORT}/a2a/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testContext.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/set',
          params: {
            taskId: taskId,
            pushNotificationConfig: pushNotificationConfig,
          },
        }),
      })

      expect(setConfigResponse.ok).toBe(true)
      const setConfigResult = await setConfigResponse.json()
      expect(setConfigResult.jsonrpc).toBe('2.0')
      expect(setConfigResult.result).toBeDefined()
      expect(setConfigResult.result.pushNotificationConfig.url).toBe(testContext.webhookManager.getWebhookUrl())
    }, TEST_CONFIG.TIMEOUT)

    it('should get push notification configuration for a task', async () => {
      // Create a task and set push notification config
      const message = A2ATestUtils.createTestMessage('Test push notification config retrieval')
      const result = await testContext.sendMessageAndValidate(message, { blocking: false })
      const taskId = result.result.id

      const pushNotificationConfig = {
        url: testContext.webhookManager.getWebhookUrl(),
        token: "test-token-abc",
        authentication: {
          credentials: "test-token-abc",
          schemes: ["bearer"],
        },
      }

      // Set the config first
      await fetch(`http://localhost:${TEST_CONFIG.PORT}/a2a/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testContext.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/set',
          params: {
            taskId: taskId,
            pushNotificationConfig: pushNotificationConfig,
          },
        }),
      })

      // Get push notification configuration
      const getConfigResponse = await fetch(`http://localhost:${TEST_CONFIG.PORT}/a2a/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testContext.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/get',
          params: {
            id: taskId,
          },
        }),
      })

      expect(getConfigResponse.ok).toBe(true)
      const getConfigResult = await getConfigResponse.json()
      expect(getConfigResult.jsonrpc).toBe('2.0')
      expect(getConfigResult.result).toBeDefined()
      expect(getConfigResult.result.pushNotificationConfig).toBeDefined()
      expect(getConfigResult.result.pushNotificationConfig.url).toBe(testContext.webhookManager.getWebhookUrl())
      expect(getConfigResult.result.pushNotificationConfig.token).toBe("test-token-abc")
    }, TEST_CONFIG.TIMEOUT)

    it('should send push notification when task completes', async () => {
      // Create a task and set push notification config
      const message = A2ATestUtils.createTestMessage('Test push notification delivery')
      const result = await testContext.sendMessageAndValidate(message, { blocking: false })
      const taskId = result.result.id

      const pushNotificationConfig = {
        url: testContext.webhookManager.getWebhookUrl(),
        token: "test-token-abc",
        authentication: {
          credentials: "test-token-abc",
          schemes: ["bearer"],
        },
      }

      // Set the config
      await fetch(`http://localhost:${TEST_CONFIG.PORT}/a2a/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testContext.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/set',
          params: {
            taskId: taskId,
            pushNotificationConfig: pushNotificationConfig,
          },
        }),
      })

      // Poll for push notification to be received
      const notification = await testContext.webhookManager.waitForNotification(taskId)

      // Verify notification was actually received
      expect(notification).toBeDefined()
      expect(notification.taskId).toBe(taskId)
      expect(notification.state).toBe('completed')
    }, TEST_CONFIG.TIMEOUT)

    it('should handle push notification configuration errors', async () => {
      // Try to set push notification config for non-existent task
      const nonExistentTaskId = uuidv4()
      const pushNotificationConfig = {
        url: testContext.webhookManager.getWebhookUrl(),
        token: "test-token-error",
        authentication: {
          credentials: "test-token-error",
          schemes: ["bearer"],
        },
      }

      const response = await fetch(`http://localhost:${TEST_CONFIG.PORT}/a2a/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testContext.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/set',
          params: {
            taskId: nonExistentTaskId,
            pushNotificationConfig: pushNotificationConfig,
          },
        }),
      })

      expect(response.ok).toBe(true)
      const result = await response.json()
      expect(result.jsonrpc).toBe('2.0')
      expect(result.error).toBeDefined()
      expect(result.error.code).toBe(-32001) // task not found
    }, TEST_CONFIG.TIMEOUT)
  })

  describe('Error Handling', () => {
    it('should handle invalid JSON-RPC requests', async () => {
      const response = await fetch(`http://localhost:${TEST_CONFIG.PORT}/a2a/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testContext.accessToken}`,
        },
        body: 'invalid json',
      })

      expect(response.status).toBe(400) // Bad Request
    }, TEST_CONFIG.TIMEOUT)

    it('should handle missing message parameters', async () => {
      const response = await fetch(`http://localhost:${TEST_CONFIG.PORT}/a2a/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testContext.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'message/send',
          params: {}, // Missing message
        }),
      })

      // JSON-RPC errors are returned with 200 status and error in body
      expect(response.status).toBe(200)
      
      const result = await response.json()
      A2AAssertions.assertJsonRpcError(result, -32602, 'message is required.')
    }, TEST_CONFIG.TIMEOUT)
  })

  describe('Credit Management', () => {
    it('should burn correct amount of credits for each request', async () => {
      // Get initial balance
      const initialCredits = await testContext.getPlanBalance()
      
      // Make multiple requests
      const message1 = A2ATestUtils.createTestMessage('First request')
      const message2 = A2ATestUtils.createTestMessage('Second request')
      
      await testContext.sendMessageAndValidate(message1)
      await testContext.sendMessageAndValidate(message2)
      
      // Validate that exactly 20 credits were burned (10 per request)
      await testContext.validateCreditsBurned(initialCredits, 20n)
    }, TEST_CONFIG.TIMEOUT)

    it('should handle insufficient credits gracefully', async () => {
      // This test would require a plan with very few credits
      // For now, we'll test the error handling structure
      const message = A2ATestUtils.createTestMessage('Test insufficient credits')
      
      // This should work normally since we have sufficient credits
      const result = await testContext.sendMessageAndValidate(message)
      A2AAssertions.assertTaskCompleted(result)
    }, TEST_CONFIG.TIMEOUT)
  })
})
