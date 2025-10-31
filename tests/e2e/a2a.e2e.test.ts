/**
 * @file E2E tests for A2A payment flow
 * @description End-to-end tests for A2A server and client functionality
 */

import { Payments } from '../../src/payments.js'
import {
  getERC20PriceConfig,
  getFixedCreditsConfig,
  getDynamicCreditsConfig,
} from '../../src/plans.js'
import {
  E2E_TEST_CONFIG,
  A2AE2EFactory,
  A2AE2EUtils,
  A2AE2EAssertions,
  A2AE2EServerManager,
} from './helpers/a2a-e2e-helpers.js'
import { E2ETestUtils } from './helpers/e2e-test-helpers.js'
import { v4 as uuidv4 } from 'uuid'
import OpenAI from 'openai'
import { getApiKeysForFile } from '../utils/apiKeysPool.js'

/**
 * E2E test with API keys isolation per suite
 */
const testApiKeys = getApiKeysForFile(__filename)

/**
 * Creates a realistic executor that simulates AI processing with observability support
 * @param creditsUsed - Number of credits to charge
 * @param useObservability - Whether to use observability for margin calculation
 * @param useBatch - Whether to use batch redemption (manual control)
 */
function createRealisticExecutorWithObservability(
  creditsUsed: number = 10,
  useObservability: boolean = false,
  useBatch: boolean = false,
): any {
  return {
    execute: async (requestContext: any, eventBus: any) => {
      const taskId = requestContext.taskId
      const contextId = requestContext.userMessage.contextId || uuidv4()
      const userText = requestContext.userMessage.parts[0].text

      // Publish initial task
      eventBus.publish({
        kind: 'task',
        id: taskId,
        contextId: contextId,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        history: [requestContext.userMessage],
        metadata: requestContext.userMessage.metadata,
      })

      try {
        // Simulate AI processing stages
        const processingStages = [
          'Analyzing request...',
          'Processing with AI model...',
          'Generating response...',
          'Finalizing output...',
        ]

        for (let i = 0; i < processingStages.length; i++) {
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
                    text: processingStages[i],
                  },
                ],
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
            final: false,
          })

          await new Promise((resolve) => setTimeout(resolve, 200))
        }

        let actualCost = creditsUsed
        let marginApplied = 0
        if (
          useObservability &&
          requestContext.payments?.authResult?.agentRequest &&
          requestContext.payments?.paymentsService
        ) {
          const openaiApiKey = process.env.OPENAI_API_KEY
          if (!openaiApiKey) {
            throw new Error(
              'OPENAI_API_KEY environment variable is required for observability tests',
            )
          }

          // Get paymentsService from requestContext
          const paymentsServiceInstance = requestContext.payments?.paymentsService
          if (!paymentsServiceInstance) {
            throw new Error('PaymentsService not available in request context')
          }

          const observableOpenAI = paymentsServiceInstance.observability.withOpenAI(
            openaiApiKey,
            requestContext.payments?.authResult?.agentRequest,
            {
              userid: 'test-user',
              operation: 'ai_processing',
            },
          )

          const openai = new OpenAI(observableOpenAI)

          await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: userText }],
            temperature: 0.3,
            max_tokens: 250,
          })

          marginApplied = 10 // 10% margin
        }

        // Handle batch redemption manually if enabled - multiple partial redemptions
        if (useBatch && requestContext.payments?.authResult?.agentRequest) {
          try {
            const paymentsService = requestContext.payments.paymentsService
            const bearerToken = requestContext.payments.httpContext.bearerToken
            const agentRequestId = requestContext.payments.authResult.requestId

            // Simulate multiple partial redemptions during processing
            const partialCredits1 = Math.floor(creditsUsed * 0.3) // 30% first
            const partialCredits2 = Math.floor(creditsUsed * 0.4) // 40% second
            const partialCredits3 = Math.floor(creditsUsed * 0.3) // 30% final

            // First partial redemption - data processing
            const redemption1 = await paymentsService.requests.redeemCreditsFromBatchRequest(
              agentRequestId,
              bearerToken,
              BigInt(partialCredits1),
            )

            await new Promise((resolve) => setTimeout(resolve, 100))

            const redemption2 = await paymentsService.requests.redeemCreditsFromBatchRequest(
              agentRequestId,
              bearerToken,
              BigInt(partialCredits2),
            )

            const redemption3 = await paymentsService.requests.redeemCreditsFromBatchRequest(
              agentRequestId,
              bearerToken,
              BigInt(partialCredits3),
            )
          } catch (error) {
            console.error('Manual batch redemption failed:', error)
          }
        }

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
                  text: `I've processed your request: "${userText}". Here's my response with AI analysis.`,
                },
              ],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
          metadata: {
            creditsUsed,
            planId: 'e2e-test-plan',
            costDescription: useObservability
              ? `AI processing with observability (base: ${actualCost}, margin: ${marginApplied})`
              : useBatch
                ? 'AI processing with manual batch redemption'
                : 'AI processing and response generation',
            operationType: 'ai_processing',
            model: 'gpt-4',
            tokensUsed: 150,
            ...(useObservability && {
              actualCost,
              marginApplied,
              observabilityEnabled: true,
            }),
            ...(useBatch && {
              batchRedemption: true,
              manualRedemption: true,
              partialRedemptions: 3,
              redemptionPhases: [
                { phase: 'data_processing', credits: Math.floor(creditsUsed * 0.3) },
                { phase: 'ai_analysis', credits: Math.floor(creditsUsed * 0.4) },
                { phase: 'response_generation', credits: Math.floor(creditsUsed * 0.3) },
              ],
            }),
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
                { kind: 'text', text: 'Sorry, I encountered an error processing your request.' },
              ],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
        })
      }
    },
  }
}

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

    paymentsBuilder = A2AE2EUtils.createPaymentsInstance(testApiKeys.builder)
    paymentsSubscriber = A2AE2EUtils.createPaymentsInstance(testApiKeys.subscriber)

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
      await serverManager.cleanup()
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

  describe('A2A Redemption Configuration E2E Tests', () => {
    let redemptionPlanId: string
    let redemptionAgentId: string
    let redemptionServer: any
    let redemptionPort: number
    let redemptionUrl: string
    let initialBalance: bigint

    beforeAll(async () => {
      // Create a separate plan for redemption tests
      redemptionPort = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000
      redemptionUrl = `http://localhost:${redemptionPort}/a2a/`

      const redemptionPlanMetadata = { name: `E2E Redemption Test Plan ${Date.now()}` }
      const redemptionPriceConfig = getERC20PriceConfig(
        1n,
        '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        paymentsBuilder.getAccountAddress(),
      )
      const redemptionCreditsConfig = getDynamicCreditsConfig(1000n, 1n, 50n) // min 1, max 50 credits per request

      const redemptionPlanResult = await E2ETestUtils.retryWithBackoff(async () => {
        const result = await paymentsBuilder.plans.registerCreditsPlan(
          redemptionPlanMetadata,
          redemptionPriceConfig,
          redemptionCreditsConfig,
        )
        if (!result.planId)
          throw new Error('Redemption plan registration failed: no planId returned')
        return result
      }, 'Redemption Plan Registration')
      redemptionPlanId = redemptionPlanResult.planId

      // Register agent for redemption tests
      const redemptionAgentMetadata = {
        name: 'E2E Redemption Test Agent',
        description: 'Agent for E2E redemption configuration tests',
        tags: ['a2a', 'test', 'redemption'],
        dateCreated: new Date(),
      }
      const redemptionAgentApi = {
        endpoints: [{ POST: redemptionUrl }],
      }
      const redemptionAgentResult = await E2ETestUtils.retryWithBackoff(async () => {
        const result = await paymentsBuilder.agents.registerAgent(
          redemptionAgentMetadata,
          redemptionAgentApi,
          [redemptionPlanId],
        )
        if (!result.agentId)
          throw new Error('Redemption agent registration failed: no agentId returned')
        return result
      }, 'Redemption Agent Registration')
      redemptionAgentId = redemptionAgentResult.agentId

      // Order the plan
      await E2ETestUtils.retryWithBackoff(async () => {
        const result = await paymentsSubscriber.plans.orderPlan(redemptionPlanId)
        if (!result.success) {
          throw new Error('Redemption plan order failed: success is false')
        }
        return result
      }, 'Redemption Plan Order')

      // Get initial balance
      const balanceResult = await paymentsSubscriber.plans.getPlanBalance(redemptionPlanId)
      initialBalance = BigInt(balanceResult.balance)

      // Create agent card with default configuration
      const baseAgentCard = {
        name: 'E2E Redemption Test Agent',
        description: 'Agent for E2E redemption configuration tests',
        capabilities: {
          streaming: true,
          pushNotifications: true,
          stateTransitionHistory: true,
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: redemptionUrl,
        version: '1.0.0',
        protocolVersion: '0.3.0' as const,
      }

      const agentCard = Payments.a2a.buildPaymentAgentCard(baseAgentCard, {
        paymentType: 'fixed',
        credits: 10,
        costDescription: '10 credits per request',
        planId: redemptionPlanId,
        agentId: redemptionAgentId,
      })

      // Start server with default configuration (no observability)
      redemptionServer = await paymentsBuilder.a2a.start({
        port: redemptionPort,
        basePath: '/a2a/',
        agentCard: agentCard,
        executor: createRealisticExecutorWithObservability(10, false),
        paymentsService: paymentsBuilder,
        exposeAgentCard: true,
        exposeDefaultRoutes: true,
      })
      serverManager.addServer(redemptionServer)
      await A2AE2EUtils.waitForServerReady(redemptionPort, 20, '/a2a')
    }, E2E_TEST_CONFIG.TIMEOUT * 3)

    afterAll(async () => {
      if (redemptionServer) {
        await new Promise<void>((resolve) => {
          redemptionServer.server.close(() => resolve())
        })
      }
    }, E2E_TEST_CONFIG.TIMEOUT)

    it(
      'should complete full flow with default redemption configuration',
      async () => {
        // Create client and send message
        const client = await paymentsSubscriber.a2a.getClient({
          agentBaseUrl: redemptionUrl,
          agentId: redemptionAgentId,
          planId: redemptionPlanId,
        })

        const messageParams = {
          message: A2AE2EFactory.createTestMessage('Hello, test default redemption configuration'),
        }

        const result = await client.sendA2AMessage(messageParams)

        // Verify response structure
        expect(result.jsonrpc).toBe('2.0')
        expect(result.result.kind).toBe('task')
        expect(result.result.status.state).toBe('completed')
        expect(result.result.status.message.role).toBe('agent')
        expect(result.result.status.message.parts[0].text).toContain("I've processed your request")

        // Verify redemption metadata
        expect(result.result.metadata.txHash).toBeDefined()
        expect(result.result.metadata.creditsUsed).toBe(10)

        // Verify credits were actually burned
        const afterBalanceResult = await E2ETestUtils.waitForCondition(
          async () => {
            try {
              const res = await paymentsSubscriber.plans.getPlanBalance(redemptionPlanId)
              const current = BigInt(res.balance)
              return current <= initialBalance - 10n ? res : null
            } catch {}
            return null
          },
          30_000,
          1_000,
        )
        expect(afterBalanceResult).toBeDefined()
        const afterBalance = BigInt(afterBalanceResult!.balance)
        expect(initialBalance - afterBalance).toBe(10n)
      },
      E2E_TEST_CONFIG.TIMEOUT * 2,
    )

    it(
      'should handle useBatch configuration with multiple partial redemptions',
      async () => {
        // Get current balance for this specific test
        const currentBalanceResult = await paymentsSubscriber.plans.getPlanBalance(redemptionPlanId)
        const testInitialBalance = BigInt(currentBalanceResult.balance)

        // Create a dedicated server for batch testing
        const batchPort = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000
        const batchUrl = `http://localhost:${batchPort}/a2a/`

        const baseAgentCard = {
          name: 'E2E Batch Test Agent',
          description: 'Agent for E2E batch redemption tests',
          capabilities: {
            streaming: true,
            pushNotifications: true,
            stateTransitionHistory: true,
          },
          defaultInputModes: ['text'],
          defaultOutputModes: ['text'],
          skills: [],
          url: batchUrl,
          version: '1.0.0',
          protocolVersion: '0.3.0' as const,
        }

        const batchAgentCard = Payments.a2a.buildPaymentAgentCard(baseAgentCard, {
          paymentType: 'fixed',
          credits: 10,
          costDescription: '10 credits per request',
          planId: redemptionPlanId,
          agentId: redemptionAgentId,
          redemptionConfig: {
            useBatch: true,
            useMargin: false,
          },
        })

        const batchServer = await paymentsBuilder.a2a.start({
          port: batchPort,
          basePath: '/a2a/',
          agentCard: batchAgentCard,
          executor: createRealisticExecutorWithObservability(10, false, true), // Enable batch
          paymentsService: paymentsBuilder,
          exposeAgentCard: true,
          exposeDefaultRoutes: true,
        })
        serverManager.addServer(batchServer)
        await A2AE2EUtils.waitForServerReady(batchPort, 20, '/a2a')

        try {
          // Create client and send message
          const client = await paymentsSubscriber.a2a.getClient({
            agentBaseUrl: batchUrl,
            agentId: redemptionAgentId,
            planId: redemptionPlanId,
          })

          const messageParams = {
            message: A2AE2EFactory.createTestMessage(
              'Hello, test batch configuration with partial redemptions',
            ),
          }

          const result = await client.sendA2AMessage(messageParams)

          // Verify response
          expect(result.result.status.state).toBe('completed')
          expect(result.result.metadata.creditsUsed).toBe(10)

          // Verify batch-specific metadata
          expect(result.result.metadata.batchRedemption).toBe(true)
          expect(result.result.metadata.manualRedemption).toBe(true)
          expect(result.result.metadata.partialRedemptions).toBe(3)
          expect(result.result.metadata.redemptionPhases).toHaveLength(3)
          expect(result.result.metadata.redemptionPhases[0].phase).toBe('data_processing')
          expect(result.result.metadata.redemptionPhases[1].phase).toBe('ai_analysis')
          expect(result.result.metadata.redemptionPhases[2].phase).toBe('response_generation')

          // Verify credits were burned through multiple partial redemptions
          const afterBalanceResult = await E2ETestUtils.waitForCondition(
            async () => {
              try {
                const res = await paymentsSubscriber.plans.getPlanBalance(redemptionPlanId)
                const current = BigInt(res.balance)
                // Check that at least 10 credits were burned (this test)
                return current <= testInitialBalance - 10n ? res : null
              } catch {}
              return null
            },
            30_000,
            1_000,
          )
          expect(afterBalanceResult).toBeDefined()
        } finally {
          // Clean up the batch server
          if (batchServer) {
            await new Promise<void>((resolve) => {
              batchServer.server.close(() => resolve())
            })
          }
        }
      },
      E2E_TEST_CONFIG.TIMEOUT * 2,
    )

    it(
      'should handle useMargin configuration with observability',
      async () => {
        // Create a separate server for margin tests with observability
        const marginPort = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000
        const marginUrl = `http://localhost:${marginPort}/a2a/`

        // Create agent card with margin configuration
        const baseAgentCard = {
          name: 'E2E Margin Test Agent',
          description: 'Agent for E2E margin redemption tests',
          capabilities: {
            streaming: true,
            pushNotifications: true,
            stateTransitionHistory: true,
          },
          defaultInputModes: ['text'],
          defaultOutputModes: ['text'],
          skills: [],
          url: marginUrl,
          version: '1.0.0',
          protocolVersion: '0.3.0' as const,
        }

        const agentCard = Payments.a2a.buildPaymentAgentCard(baseAgentCard, {
          paymentType: 'dynamic',
          credits: 10,
          costDescription: '10 credits per request with margin',
          planId: redemptionPlanId,
          agentId: redemptionAgentId,
          redemptionConfig: {
            useMargin: true,
            marginPercent: 20, // 20% margin
          },
        })

        // Start server with margin handler options and observability-enabled executor
        const marginServer = await paymentsBuilder.a2a.start({
          port: marginPort,
          basePath: '/a2a/',
          agentCard: agentCard,
          executor: createRealisticExecutorWithObservability(10, true),
          paymentsService: paymentsBuilder,
          exposeAgentCard: true,
          exposeDefaultRoutes: true,
          handlerOptions: {
            defaultMarginPercent: 20,
          },
        })
        serverManager.addServer(marginServer)
        await A2AE2EUtils.waitForServerReady(marginPort, 20, '/a2a')

        // Create client and send message
        const client = await paymentsSubscriber.a2a.getClient({
          agentBaseUrl: marginUrl,
          agentId: redemptionAgentId,
          planId: redemptionPlanId,
        })

        const messageParams = {
          message: A2AE2EFactory.createTestMessage(
            'Hello, test margin configuration with observability',
          ),
        }

        const result = await client.sendA2AMessage(messageParams)

        // Verify response
        expect(result.result.status.state).toBe('completed')
        expect(result.result.metadata.creditsUsed).toBe(10)

        // Verify observability metadata is present
        expect(result.result.metadata.observabilityEnabled).toBe(true)
        expect(result.result.metadata.actualCost).toBeDefined()
        expect(result.result.metadata.marginApplied).toBeDefined()

        // Verify credits were burned
        const afterBalanceResult = await E2ETestUtils.waitForCondition(
          async () => {
            try {
              const res = await paymentsSubscriber.plans.getPlanBalance(redemptionPlanId)
              const current = BigInt(res.balance)
              return current <= initialBalance - 30n ? res : null // Previous tests + this test
            } catch {}
            return null
          },
          30_000,
          1_000,
        )
        expect(afterBalanceResult).toBeDefined()
      },
      E2E_TEST_CONFIG.TIMEOUT * 2,
    )

    it(
      'should respect server-level handler options over agent card config',
      async () => {
        // Create a separate server for server override tests with observability
        const overridePort = Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000
        const overrideUrl = `http://localhost:${overridePort}/a2a/`

        // Create agent card with different config than server
        const baseAgentCard = {
          name: 'E2E Server Override Test Agent',
          description: 'Agent for testing server-level overrides',
          capabilities: {
            streaming: true,
            pushNotifications: true,
            stateTransitionHistory: true,
          },
          defaultInputModes: ['text'],
          defaultOutputModes: ['text'],
          skills: [],
          url: overrideUrl,
          version: '1.0.0',
          protocolVersion: '0.3.0' as const,
        }

        const agentCard = Payments.a2a.buildPaymentAgentCard(baseAgentCard, {
          paymentType: 'dynamic',
          credits: 10,
          costDescription: '10 credits per request',
          planId: redemptionPlanId,
          agentId: redemptionAgentId,
          redemptionConfig: {
            useBatch: false,
            useMargin: false,
          },
        })

        // Start server with different handler options (should override agent card)
        const overrideServer = await paymentsBuilder.a2a.start({
          port: overridePort,
          basePath: '/a2a/',
          agentCard: agentCard,
          executor: createRealisticExecutorWithObservability(10, true),
          paymentsService: paymentsBuilder,
          exposeAgentCard: true,
          exposeDefaultRoutes: true,
          handlerOptions: {
            defaultBatch: true,
            defaultMarginPercent: 15,
          },
        })
        serverManager.addServer(overrideServer)
        await A2AE2EUtils.waitForServerReady(overridePort, 20, '/a2a')

        // Create client and send message
        const client = await paymentsSubscriber.a2a.getClient({
          agentBaseUrl: overrideUrl,
          agentId: redemptionAgentId,
          planId: redemptionPlanId,
        })

        const messageParams = {
          message: A2AE2EFactory.createTestMessage('Hello, test server-level override'),
        }

        const result = await client.sendA2AMessage(messageParams)

        // Verify response
        expect(result.result.status.state).toBe('completed')
        expect(result.result.metadata.creditsUsed).toBe(10)

        // Server-level configuration should be applied (margin enabled via observability)
        expect(result.result.metadata.observabilityEnabled).toBe(true)
        expect(result.result.metadata.actualCost).toBeDefined()
        expect(result.result.metadata.marginApplied).toBeDefined()

        // Verify credits were burned
        const afterBalanceResult = await E2ETestUtils.waitForCondition(
          async () => {
            try {
              const res = await paymentsSubscriber.plans.getPlanBalance(redemptionPlanId)
              const current = BigInt(res.balance)
              return current <= initialBalance - 40n ? res : null // All previous tests + this test
            } catch {}
            return null
          },
          30_000,
          1_000,
        )
        expect(afterBalanceResult).toBeDefined()
      },
      E2E_TEST_CONFIG.TIMEOUT * 2,
    )
  })
})
