/**
 * @file E2E tests for A2A payment flow
 * @description End-to-end tests for A2A server and client functionality
 */

import { Payments } from '../../src/payments.js'
import { getERC20PriceConfig, getFixedCreditsConfig } from '../../src/plans.js'
import {
  E2E_TEST_CONFIG,
  A2AE2EFactory,
  A2AE2EUtils,
  A2AE2EAssertions,
  A2AE2EServerManager,
} from './helpers/a2a-e2e-helpers.js'
import { E2ETestUtils } from './helpers/e2e-test-helpers.js'

describe('A2A E2E', () => {
  let paymentsBuilder: any
  let paymentsSubscriber: any
  let serverManager: A2AE2EServerManager
  let planId: string
  let agentId: string
  let serverResult: any

  let MAIN_PORT: number
  let MAIN_URL: string

  beforeAll(async () => {
    MAIN_PORT = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000
    MAIN_URL = `http://localhost:${MAIN_PORT}/a2a/`

    paymentsBuilder = A2AE2EUtils.createPaymentsInstance(E2E_TEST_CONFIG.BUILDER_API_KEY)
    paymentsSubscriber = A2AE2EUtils.createPaymentsInstance(E2E_TEST_CONFIG.SUBSCRIBER_API_KEY)

    serverManager = new A2AE2EServerManager()

    const planMetadata = { name: `E2E A2A Test Plan ${Date.now()}` }
    const priceConfig = getERC20PriceConfig(
      1n,
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      paymentsBuilder.getAccountAddress(),
    )
    const creditsConfig = getFixedCreditsConfig(1000n, 10n)
    const planResult = await E2ETestUtils.retryWithBackoff(async () => {
      const result = await paymentsBuilder.plans.registerCreditsPlan(
        planMetadata,
        priceConfig,
        creditsConfig,
      )
      if (!result.planId) throw new Error('Plan registration failed: no planId returned')
      return result
    }, 'Plan Registration')
    planId = planResult.planId

    const agentMetadata = {
      name: 'E2E A2A Test Agent',
      description: 'Agent for E2E A2A tests',
      tags: ['a2a', 'test'],
      dateCreated: new Date(),
    }
    const agentApi = {
      endpoints: [{ POST: MAIN_URL }],
    }
    const agentResult = await E2ETestUtils.retryWithBackoff(async () => {
      const result = await paymentsBuilder.agents.registerAgent(agentMetadata, agentApi, [planId])
      if (!result.agentId) throw new Error('Agent registration failed: no agentId returned')
      return result
    }, 'Agent Registration')
    agentId = agentResult.agentId

    await E2ETestUtils.retryWithBackoff(async () => {
      const result = await paymentsSubscriber.plans.orderPlan(planId)

      if (!result.success) {
        throw new Error('Plan order failed: success is false')
      }

      return result
    }, 'Plan Order')

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
      url: MAIN_URL,
      version: '1.0.0',
      protocolVersion: '0.3.0' as const,
    }

    const agentCard = Payments.a2a.buildPaymentAgentCard(baseAgentCard, {
      paymentType: 'dynamic',
      credits: 1, // Base cost
      costDescription:
        'Variable credits based on operation complexity: Greeting (1), Calculation (2), Weather (3), Translation (4), Streaming (5)',
      planId,
      agentId,
    })

    serverResult = await paymentsBuilder.a2a.start({
      port: MAIN_PORT,
      basePath: '/a2a/',
      agentCard: agentCard,
      executor: A2AE2EFactory.createResubscribeStreamingExecutor(),
    })

    serverManager.addServer(serverResult)

    await A2AE2EUtils.waitForServerReady(MAIN_PORT, 20, '/a2a')
  }, E2E_TEST_CONFIG.TIMEOUT * 6)

  afterAll(async () => {
    try {
      console.log('E2E test cleanup starting...')
      await serverManager.cleanup()
      console.log('E2E test cleanup completed')
    } catch (error) {
      console.error('Error during E2E test cleanup:', error)
    }
  }, E2E_TEST_CONFIG.TIMEOUT)

  describe('A2A Server and Client Flow', () => {
    it('should have a valid server', () => {
      A2AE2EAssertions.assertValidServerResult(serverResult)
    })

    it('should register and retrieve a client through Payments.a2a.getClient', async () => {
      const client = await paymentsSubscriber.a2a.getClient({
        agentBaseUrl: MAIN_URL,
        agentId: agentId,
        planId: planId,
      })

      A2AE2EAssertions.assertValidClient(client)
    })

    it('should handle multiple client registrations', async () => {
      const client1 = await paymentsSubscriber.a2a.getClient({
        agentBaseUrl: MAIN_URL,
        agentId: agentId,
        planId: planId,
      })
      const client2 = await paymentsSubscriber.a2a.getClient({
        agentBaseUrl: MAIN_URL,
        agentId: agentId,
        planId: planId,
      })

      expect(client1).toBeDefined()
      expect(client2).toBeDefined()
      const msg = { message: A2AE2EFactory.createTestMessage('ping') }
      const send1 = await E2ETestUtils.retryWithBackoff(
        async () => client1.sendA2AMessage(msg),
        'A2A send client1',
      )
      const send2 = await E2ETestUtils.retryWithBackoff(
        async () => client2.sendA2AMessage(msg),
        'A2A send client2',
      )
      expect(send1).toBeDefined()
      expect(send2).toBeDefined()
    })
  })

  describe('A2A Payment Processing', () => {
    it(
      'should process an A2A message through the client',
      async () => {
        const client = await paymentsSubscriber.a2a.getClient({
          agentBaseUrl: MAIN_URL,
          agentId: agentId,
          planId: planId,
        })

        const messageParams = {
          message: A2AE2EFactory.createTestMessage('Hello, this is a test message'),
        }

        const result = await client.sendA2AMessage(messageParams)
        A2AE2EAssertions.assertValidA2AResponse(result)
      },
      E2E_TEST_CONFIG.TIMEOUT,
    )

    it(
      'should handle invalid message requests gracefully',
      async () => {
        const client = await paymentsSubscriber.a2a.getClient({
          agentBaseUrl: MAIN_URL,
          agentId: agentId,
          planId: planId,
        })

        const result = await client.sendA2AMessage({} as any)

        expect(result).toBeDefined()
        expect(result.error).toBeDefined()
        expect(result.error.code).toBe(-32602)
        expect(result.error.message).toContain('message is required')
      },
      E2E_TEST_CONFIG.TIMEOUT,
    )
  })

  describe('A2A Static Utilities', () => {
    it(
      'should build payment agent card using static method',
      () => {
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
          protocolVersion: '0.3.0' as const,
        }
        const paymentMetadata = A2AE2EFactory.createPaymentMetadata('e2e-test-agent')

        const agentCard = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)

        A2AE2EAssertions.assertValidAgentCard(agentCard)
        expect(agentCard.name).toBe('E2E Test Agent')
        expect((agentCard.capabilities?.extensions?.[0]?.params as any)?.agentId).toBe(
          'e2e-test-agent',
        )
      },
      E2E_TEST_CONFIG.TIMEOUT,
    )

    it(
      'should integrate agent card with A2A flow',
      async () => {
        const client = await paymentsSubscriber.a2a.getClient({
          agentBaseUrl: MAIN_URL,
          agentId: agentId,
          planId: planId,
        })

        A2AE2EAssertions.assertValidClient(client)

        await A2AE2EUtils.wait(500)
      },
      E2E_TEST_CONFIG.TIMEOUT,
    )
  })

  describe('A2A Error Handling', () => {
    it(
      'should handle client registration errors',
      async () => {
        await expect(paymentsSubscriber.a2a.getClient({} as any)).rejects.toThrow()
      },
      E2E_TEST_CONFIG.TIMEOUT,
    )
  })

  describe('A2A Streaming SSE E2E Tests', () => {
    it(
      'should pass PaymentsRequestContext to executor (E2E)',
      async () => {
        // Register a new agent specifically for context verification
        const contextPort = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000
        const contextUrl = `http://localhost:${contextPort}/a2a/`

        const contextAgentMetadata = {
          name: 'E2E Context Test Agent',
          description: 'Agent for verifying PaymentsRequestContext passing',
          tags: ['a2a', 'test', 'context'],
          dateCreated: new Date(),
        }
        const contextAgentApi = {
          endpoints: [{ POST: contextUrl }],
        }
        const contextAgentResult = await E2ETestUtils.retryWithBackoff(async () => {
          const result = await paymentsBuilder.agents.registerAgent(
            contextAgentMetadata,
            contextAgentApi,
            [planId],
          )
          if (!result.agentId)
            throw new Error('Context agent registration failed: no agentId returned')
          return result
        }, 'Context Agent Registration')
        const contextAgentId = contextAgentResult.agentId

        // Build agent card with context verification executor
        const contextAgentCard = {
          name: 'E2E Context Test Agent',
          description: 'Agent for verifying PaymentsRequestContext passing',
          capabilities: {
            streaming: true,
            pushNotifications: true,
            stateTransitionHistory: true,
          },
          defaultInputModes: ['text'],
          defaultOutputModes: ['text'],
          skills: [],
          url: contextUrl,
          version: '1.0.0',
          protocolVersion: '0.3.0' as const,
        }

        const contextAgentCardWithPayments = Payments.a2a.buildPaymentAgentCard(contextAgentCard, {
          paymentType: 'dynamic',
          credits: 1,
          costDescription: 'Context verification test',
          planId,
          agentId: contextAgentId,
        })

        // Start server with executor that verifies context
        const contextServer = await paymentsBuilder.a2a.start({
          port: contextPort,
          basePath: '/a2a/',
          agentCard: contextAgentCardWithPayments,
          executor: A2AE2EFactory.createResubscribeStreamingExecutorWithContextAssert(),
          paymentsService: paymentsBuilder,
          exposeAgentCard: true,
          exposeDefaultRoutes: true,
        })
        serverManager.addServer(contextServer)
        await A2AE2EUtils.waitForServerReady(contextPort, 20, '/a2a')

        // Create client for the context test agent
        const client = await paymentsSubscriber.a2a.getClient({
          agentBaseUrl: contextUrl,
          agentId: contextAgentId,
          planId: planId,
        })

        A2AE2EAssertions.assertValidClient(client)

        const message = A2AE2EFactory.createTestMessage('Start E2E ctx passing')
        const messageParams = { message }

        const events: any[] = []
        let finalResult: any = null
        let sawContextCheck = false

        for await (const event of client.sendA2AMessageStream(messageParams)) {
          events.push(event)
          const text = event?.result?.status?.message?.parts?.[0]?.text || ''
          if (typeof text === 'string' && text.startsWith('CTX_OK:')) {
            sawContextCheck = true
            expect(text).toContain('CTX_OK:1')
            expect(text).toContain(`AGENT:${contextAgentId}`)
            expect(text).toContain('TOKEN:1')
          }
          if (event.result && event.result.final) {
            finalResult = event
            break
          }
        }

        // Verify we saw the context check message
        expect(sawContextCheck).toBe(true)
        A2AE2EAssertions.assertValidStreamingResponse(events, finalResult)
      },
      E2E_TEST_CONFIG.TIMEOUT,
    )
    it(
      'should handle streaming requests with SSE events using A2A client',
      async () => {
        const beforeBalanceResult = await paymentsSubscriber.plans.getPlanBalance(planId)
        const beforeBalance = BigInt(beforeBalanceResult.balance)

        const client = await paymentsSubscriber.a2a.getClient({
          agentBaseUrl: MAIN_URL,
          agentId: agentId,
          planId: planId,
        })

        A2AE2EAssertions.assertValidClient(client)

        const message = A2AE2EFactory.createTestMessage('Start streaming')
        const messageParams = { message }

        const events: any[] = []
        let finalResult: any = null

        for await (const event of client.sendA2AMessageStream(messageParams)) {
          events.push(event)
          if (event.result && event.result.final) {
            finalResult = event
            break
          }
        }

        A2AE2EAssertions.assertValidStreamingResponse(events, finalResult)

        const expectedBurn = 10n
        const afterBalanceResult = await E2ETestUtils.waitForCondition(
          async () => {
            try {
              const res = await paymentsSubscriber.plans.getPlanBalance(planId)
              const current = BigInt(res.balance)
              return current <= beforeBalance - expectedBurn ? res : null
            } catch {}
            return null
          },
          60_000,
          2_000,
        )
        expect(afterBalanceResult).toBeDefined()
        const afterBalance = BigInt(afterBalanceResult!.balance)
        expect(beforeBalance - afterBalance).toBe(expectedBurn)
      },
      E2E_TEST_CONFIG.TIMEOUT * 3,
    )

    it(
      'should handle streaming errors gracefully using A2A client',
      async () => {
        const beforeBalanceResult = await paymentsSubscriber.plans.getPlanBalance(planId)
        const beforeBalance = BigInt(beforeBalanceResult.balance)

        const client = await paymentsSubscriber.a2a.getClient({
          agentBaseUrl: MAIN_URL,
          agentId: agentId,
          planId: planId,
        })

        A2AE2EAssertions.assertValidClient(client)

        const message = A2AE2EFactory.createTestMessage('Start streaming')
        const messageParams = { message }

        const events: any[] = []
        let finalResult: any = null

        for await (const event of client.sendA2AMessageStream(messageParams)) {
          events.push(event)
          if (event.result && event.result.final) {
            finalResult = event
            break
          }
        }

        expect(events.length).toBeGreaterThan(0)
        expect(finalResult).toBeDefined()

        expect(finalResult.result.status.state).toBe('completed')
        expect(finalResult.result.metadata.creditsUsed).toBe(10)

        const expectedBurn = 10n
        const afterBalanceResult = await E2ETestUtils.waitForCondition(
          async () => {
            try {
              const res = await paymentsSubscriber.plans.getPlanBalance(planId)
              const current = BigInt(res.balance)
              return current <= beforeBalance - expectedBurn ? res : null
            } catch {}
            return null
          },
          60_000,
          2_000,
        )
        expect(afterBalanceResult).toBeDefined()
        const afterBalance = BigInt(afterBalanceResult!.balance)
        expect(beforeBalance - afterBalance).toBe(expectedBurn)
      },
      E2E_TEST_CONFIG.TIMEOUT * 3,
    )

    it(
      'should handle resubscribe to task streaming using A2A client',
      async () => {
        const beforeBalanceResult = await paymentsSubscriber.plans.getPlanBalance(planId)
        const beforeBalance = BigInt(beforeBalanceResult.balance)

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
          url: MAIN_URL,
          version: '1.0.0',
          protocolVersion: '0.3.0' as const,
        }

        const resubscribeAgentCardWithPayments = Payments.a2a.buildPaymentAgentCard(
          resubscribeAgentCard,
          {
            paymentType: 'dynamic',
            credits: 1,
            costDescription: 'Variable credits based on operation complexity',
            planId,
            agentId,
          },
        )

        const client = await paymentsSubscriber.a2a.getClient({
          agentBaseUrl: MAIN_URL,
          agentId: agentId,
          planId: planId,
        })

        A2AE2EAssertions.assertValidClient(client)

        const message = A2AE2EFactory.createTestMessage('Start streaming for resubscribe test')
        const messageParams = { message }

        const initialEvents: any[] = []
        let taskId: string | null = null
        let eventCount = 0
        const maxInitialEvents = 2

        for await (const event of client.sendA2AMessageStream(messageParams)) {
          initialEvents.push(event)
          eventCount++

          if (!taskId && event.result && event.result.id) {
            taskId = event.result.id
          }

          if (eventCount >= maxInitialEvents) {
            break
          }

          if (event.result && event.result.final) {
            break
          }
        }

        await A2AE2EUtils.wait(500)

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

        A2AE2EAssertions.assertValidResubscribeResponse(
          initialEvents,
          resubscribeEvents,
          resubscribeFinalResult,
          taskId!,
          maxInitialEvents,
        )

        const expectedBurn = 10n
        const afterBalanceResult = await E2ETestUtils.waitForCondition(
          async () => {
            try {
              const res = await paymentsSubscriber.plans.getPlanBalance(planId)
              const current = BigInt(res.balance)
              return current <= beforeBalance - expectedBurn ? res : null
            } catch {}
            return null
          },
          60_000,
          2_000,
        )
        expect(afterBalanceResult).toBeDefined()
        const afterBalance = BigInt(afterBalanceResult!.balance)
        expect(beforeBalance - afterBalance).toBe(expectedBurn)
      },
      E2E_TEST_CONFIG.TIMEOUT * 3,
    )
  })
})
