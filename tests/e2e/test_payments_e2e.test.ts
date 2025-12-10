/**
 * @file End-to-end tests for the Payments class
 * @description E2E tests for Payments functionality using Nevermined backend
 */

import http from 'http'
import { Payments } from '../../src/payments.js'
import type {
  PlanMetadata,
  Address,
  AgentAccessCredentials,
  AgentMetadata,
} from '../../src/common/types.js'
import { ZeroAddress } from '../../src/environments.js'
import { ONE_DAY_DURATION } from '../../src/plans.js'
import { getRandomBigInt } from '../../src/utils.js'
import { createPaymentsBuilder, createPaymentsSubscriber, ERC20_ADDRESS } from './fixtures.js'
import { retryWithBackoff } from '../utils.js'

// Test configuration
const TEST_TIMEOUT = 30000

// Test endpoints
const AGENT_ENDPOINTS: Array<{ POST?: string; GET?: string }> = [
  { POST: 'http://localhost:8889/test/:agentId/tasks' },
  { GET: 'http://localhost:8889/test/:agentId/tasks/:taskId' },
]

// Global variables to store test IDs
let creditsPlanId: string | null = null
let expirablePlanId: string | null = null
let trialPlanId: string | null = null
let agentId: string | null = null
let builderAddress: Address | null = null
let agentAccessParams: AgentAccessCredentials | null = null

/**
 * Mock HTTP Server for Agent testing
 */
class MockAgentServer {
  private server: http.Server | null = null
  private port = 8889
  private paymentsBuilder: Payments | null = null
  private agentId: string | null = null
  private startupTimeout: NodeJS.Timeout | null = null

  async start(paymentsBuilder: Payments, agentId: string): Promise<void> {
    // Store references for use in request handler
    this.paymentsBuilder = paymentsBuilder
    this.agentId = agentId

    this.server = http.createServer(async (req, res) => {
      const authHeader = req.headers['authorization'] as string
      const requestedUrl = `http://localhost:${this.port}${req.url}`
      const httpVerb = req.method

      console.log(
        `Received request: endpoint=${requestedUrl}, httpVerb=${httpVerb}, authHeader=${authHeader?.substring(0, 20)}...`,
      )

      try {
        if (this.paymentsBuilder && this.agentId) {
          // Validate the request using the real Nevermined logic
          const result = await this.paymentsBuilder.requests.startProcessingRequest(
            this.agentId,
            authHeader,
            requestedUrl,
            httpVerb || 'GET',
          )
          // If the request is valid and the user is a subscriber
          if (result && result.balance.isSubscriber) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ message: 'Hello from the Agent!' }))
            return
          }
        }
      } catch (error) {
        console.log(
          `Unauthorized access attempt: ${authHeader?.substring(0, 20)}..., error: ${error}`,
        )
      }

      // If the request is not valid or there is an exception, respond with 402
      res.writeHead(402, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
    })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'))
      }, 5000)
      this.server!.listen(this.port, () => {
        clearTimeout(timeout)
        resolve()
      })
      this.server!.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    // Wait a bit for server to start
    await new Promise<void>((resolve) => {
      this.startupTimeout = setTimeout(() => {
        this.startupTimeout = null
        resolve()
      }, 1000)
    })
  }

  async stop(): Promise<void> {
    // Clear startup timeout if still pending
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout)
      this.startupTimeout = null
    }

    if (this.server) {
      const serverToClose = this.server
      this.server = null

      // Close all active connections first
      serverToClose.closeAllConnections()

      // Wait for server to close
      await new Promise<void>((resolve) => {
        const closeTimeout = setTimeout(() => {
          // Force close on timeout
          serverToClose.closeAllConnections()
          serverToClose.close(() => {
            clearTimeout(closeTimeout)
            // Give a moment for all connections to close
            setTimeout(resolve, 100)
          })
        }, 5000)

        serverToClose.close(() => {
          clearTimeout(closeTimeout)
          // Give a moment for all connections to close
          setTimeout(resolve, 100)
        })
      })
    }

    // Clear references
    this.paymentsBuilder = null
    this.agentId = null
  }
}

describe('Payments E2E Tests', () => {
  let paymentsSubscriber: Payments
  let paymentsBuilder: Payments
  let mockServer: MockAgentServer

  beforeAll(() => {
    // Initialize Payments instances
    paymentsSubscriber = createPaymentsSubscriber()
    paymentsBuilder = createPaymentsBuilder()
    mockServer = new MockAgentServer()
  }, TEST_TIMEOUT)

  afterAll(async () => {
    if (mockServer) {
      await mockServer.stop()
    }
  }, TEST_TIMEOUT)

  test('should initialize Payments instances correctly', () => {
    expect(paymentsSubscriber).toBeDefined()
    expect(paymentsSubscriber.query).toBeDefined()
    expect(paymentsBuilder).toBeDefined()
    expect(paymentsBuilder.query).toBeDefined()
    expect(paymentsBuilder.getAccountAddress()).toBeDefined()
    builderAddress = paymentsBuilder.getAccountAddress() as Address
  })

  test('should get FIAT price config setup', () => {
    if (!builderAddress) {
      builderAddress = '0x0000000000000000000000000000000000000001' as Address
    }
    const fiatPriceConfig = paymentsBuilder.plans.getFiatPriceConfig(100n, builderAddress)
    expect(fiatPriceConfig).toBeDefined()
    expect(fiatPriceConfig.tokenAddress).toBe(ZeroAddress)
    expect(fiatPriceConfig.isCrypto).toBe(false)
    expect(fiatPriceConfig.amounts[0]).toBe(100n)
    expect(fiatPriceConfig.receivers[0]).toBe(builderAddress)
  })

  test('should get CRYPTO price config setup', () => {
    if (!builderAddress) {
      builderAddress = '0x0000000000000000000000000000000000000001' as Address
    }
    const cryptoPriceConfig = paymentsBuilder.plans.getNativeTokenPriceConfig(100n, builderAddress)
    expect(cryptoPriceConfig).toBeDefined()
    expect(cryptoPriceConfig.isCrypto).toBe(true)
    expect(cryptoPriceConfig.amounts[0]).toBe(100n)
    expect(cryptoPriceConfig.receivers[0]).toBe(builderAddress)
    expect(cryptoPriceConfig.tokenAddress).toBe(ZeroAddress)
  })

  test(
    'should create a credits plan',
    async () => {
      if (!builderAddress) {
        builderAddress = paymentsBuilder.getAccountAddress() as Address
      }
      const priceConfig = paymentsBuilder.plans.getERC20PriceConfig(
        20n,
        ERC20_ADDRESS,
        builderAddress,
      )
      const creditsConfig = paymentsBuilder.plans.getFixedCreditsConfig(100n)

      const response = await retryWithBackoff(
        () =>
          paymentsBuilder.plans.registerCreditsPlan(
            { name: `E2E test Payments Plan ${Date.now()}` },
            priceConfig,
            creditsConfig,
          ),
        {
          label: 'registerCreditsPlan',
        },
      )

      expect(response).toBeDefined()
      creditsPlanId = response.planId
      expect(creditsPlanId).toBeDefined()
      expect(BigInt(creditsPlanId) > 0n).toBeTruthy()
      console.log('Credits Plan ID', creditsPlanId)
    },
    TEST_TIMEOUT * 2,
  )

  test(
    'should create a time plan',
    async () => {
      if (!builderAddress) {
        builderAddress = paymentsBuilder.getAccountAddress() as Address
      }
      const priceConfig = paymentsBuilder.plans.getERC20PriceConfig(
        50n,
        ERC20_ADDRESS,
        builderAddress,
      )
      const creditsConfig = paymentsBuilder.plans.getExpirableDurationConfig(ONE_DAY_DURATION) // 1 day

      const response = await retryWithBackoff(
        () =>
          paymentsBuilder.plans.registerTimePlan(
            { name: `E2E test Time Plan ${Date.now()}` },
            priceConfig,
            creditsConfig,
          ),
        {
          label: 'registerTimePlan',
        },
      )

      expect(response).toBeDefined()
      expirablePlanId = response.planId
      expect(expirablePlanId).toBeDefined()
      expect(BigInt(expirablePlanId) > 0n).toBeTruthy()
      console.log('Expirable Plan ID', expirablePlanId)
    },
    TEST_TIMEOUT * 2,
  )

  test(
    'should create a trial plan',
    async () => {
      const trialPlanMetadata: PlanMetadata = { name: `E2E test Trial Payments Plan ${Date.now()}` }
      const priceConfig = paymentsBuilder.plans.getFreePriceConfig()
      const creditsConfig = paymentsBuilder.plans.getExpirableDurationConfig(ONE_DAY_DURATION)

      const response = await retryWithBackoff(
        () =>
          paymentsBuilder.plans.registerTimeTrialPlan(
            trialPlanMetadata,
            priceConfig,
            creditsConfig,
          ),
        {
          label: 'registerTimeTrialPlan',
        },
      )

      expect(response).toBeDefined()
      trialPlanId = response.planId
      expect(trialPlanId).toBeDefined()
      expect(BigInt(trialPlanId) > 0n).toBeTruthy()
      console.log('Trial Plan ID', trialPlanId)
    },
    TEST_TIMEOUT * 2,
  )

  test(
    'should create an agent with associated plans',
    async () => {
      expect(creditsPlanId).not.toBeNull()
      expect(expirablePlanId).not.toBeNull()

      const agentMetadata: AgentMetadata = {
        name: `E2E Payments Agent ${Date.now()}`,
        tags: ['test'],
        dateCreated: new Date(),
        description: `E2E Payments Agent ${Date.now()}`,
      }
      const agentApi = {
        endpoints: AGENT_ENDPOINTS,
        agentDefinitionUrl: 'http://localhost:8889/test/openapi.json',
      }
      const paymentPlans = [creditsPlanId!, expirablePlanId!].filter((p) => p)

      const result = await retryWithBackoff<{ agentId: string }>(
        () => paymentsBuilder.agents.registerAgent(agentMetadata, agentApi, paymentPlans),
        {
          label: 'registerAgent',
        },
      )
      agentId = result.agentId
      expect(agentId).toBeDefined()
      console.log('Agent ID', agentId)
    },
    TEST_TIMEOUT * 2,
  )

  test(
    'should create an agent and plan in one step',
    async () => {
      if (!builderAddress) {
        builderAddress = paymentsBuilder.getAccountAddress() as Address
      }
      const timestamp = new Date().toISOString()
      const planMetadata: PlanMetadata = {
        name: `E2E test Payments Plan ${timestamp}`,
      }
      const agentMetadata: AgentMetadata = {
        name: 'My AI FIAT Payments Agent',
        description: 'This is a test agent for the E2E Payments tests',
        tags: ['fiat', 'test2'],
      }
      const agentApi = {
        endpoints: [{ POST: 'http://localhost:8889/test/:agentId/tasks' }],
        agentDefinitionUrl: 'http://localhost:8889/test/openapi.json',
      }
      const cryptoPriceConfig = paymentsBuilder.plans.getCryptoPriceConfig(
        10_000_000n,
        builderAddress,
        ERC20_ADDRESS,
      )
      const nonExpirableConfig = paymentsBuilder.plans.getNonExpirableDurationConfig()
      // Force randomness of the plan by setting a random duration
      nonExpirableConfig.durationSecs = getRandomBigInt()

      const result = await retryWithBackoff<{ agentId: string; planId: string }>(
        () =>
          paymentsBuilder.agents.registerAgentAndPlan(
            agentMetadata,
            agentApi,
            planMetadata,
            cryptoPriceConfig,
            nonExpirableConfig,
          ),
        {
          label: 'registerAgentAndPlan',
        },
      )
      const agentAndPlanAgentId = result.agentId
      const agentAndPlanPlanId = result.planId
      expect(agentAndPlanAgentId).toBeDefined()
      expect(agentAndPlanPlanId).toBeDefined()
    },
    TEST_TIMEOUT * 2,
  )

  test(
    'should get a plan',
    async () => {
      expect(creditsPlanId).not.toBeNull()
      const plan = await paymentsBuilder.plans.getPlan(creditsPlanId!)
      expect(plan).toBeDefined()
      expect(plan.id).toBe(creditsPlanId)
      console.log('Plan', plan)
    },
    TEST_TIMEOUT,
  )

  test(
    'should get an agent',
    async () => {
      expect(agentId).not.toBeNull()
      const agent = await paymentsBuilder.agents.getAgent(agentId!)
      expect(agent).toBeDefined()
      expect(agent.id).toBe(agentId)
      console.log('Agent', agent)
    },
    TEST_TIMEOUT,
  )

  test(
    'should order a plan',
    async () => {
      expect(creditsPlanId).not.toBeNull()
      console.log(creditsPlanId)
      console.log(' SUBSCRIBER ADDRESS = ', paymentsSubscriber.getAccountAddress())

      const orderResult = await retryWithBackoff<{ success: boolean }>(
        () => paymentsSubscriber.plans.orderPlan(creditsPlanId!),
        {
          label: 'orderPlan',
        },
      )
      expect(orderResult).toBeDefined()
      console.log('Order Result', orderResult)
      expect(orderResult.success).toBe(true)
    },
    TEST_TIMEOUT * 2,
  )

  test(
    'should get plan balance',
    async () => {
      expect(creditsPlanId).not.toBeNull()

      // Poll balance briefly to account for backend latency
      let finalBalance: any = null
      const start = Date.now()
      const timeout = 60000 // 60 seconds
      const pollInterval = 2000 // 2 seconds

      while (Date.now() - start < timeout) {
        try {
          const result = await paymentsSubscriber.plans.getPlanBalance(creditsPlanId!)
          if (result) {
            try {
              const bal = BigInt(result.balance)
              if (bal > 0n && result.isSubscriber) {
                finalBalance = result
                break
              }
            } catch (e) {
              // Continue polling
            }
          }
        } catch (e) {
          // Continue polling
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
      }

      expect(finalBalance).not.toBeNull()
      expect(BigInt(finalBalance.balance) > 0n).toBeTruthy()
    },
    TEST_TIMEOUT * 3,
  )

  test(
    'should order a trial plan',
    async () => {
      expect(trialPlanId).not.toBeNull()

      const orderResult = await retryWithBackoff<{ success: boolean }>(
        () => paymentsSubscriber.plans.orderPlan(trialPlanId!),
        {
          label: 'orderPlan',
        },
      )
      expect(orderResult).toBeDefined()
      expect(orderResult.success).toBe(true)
      console.log('Order Result', orderResult)
    },
    TEST_TIMEOUT * 2,
  )

  test(
    'should fail to order a trial plan twice',
    async () => {
      expect(trialPlanId).not.toBeNull()

      await expect(paymentsSubscriber.plans.orderPlan(trialPlanId!)).rejects.toThrow()
    },
    TEST_TIMEOUT * 2,
  )

  describe('E2E Subscriber/Agent flow', () => {
    beforeAll(async () => {
      // Setup mock HTTP server for agent testing
      // This must be done after agent_id is set by previous test
      expect(agentId).not.toBeNull()
      await mockServer.start(paymentsBuilder, agentId!)
    }, TEST_TIMEOUT)

    afterAll(async () => {
      await mockServer.stop()
    }, TEST_TIMEOUT)

    test(
      'should generate agent access token',
      async () => {
        expect(creditsPlanId).not.toBeNull()
        expect(agentId).not.toBeNull()

        agentAccessParams = await paymentsSubscriber.agents.getAgentAccessToken(
          creditsPlanId!,
          agentId!,
        )
        expect(agentAccessParams).toBeDefined()
        console.log('Agent Access Params', agentAccessParams)
        expect(agentAccessParams.accessToken.length).toBeGreaterThan(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'should send request to agent',
      async () => {
        expect(agentAccessParams).not.toBeNull()

        const agentUrl = 'http://localhost:8889/test/12345/tasks'
        const headers = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentAccessParams!.accessToken}`,
        }

        const response = await fetch(agentUrl, {
          method: 'POST',
          headers,
        })
        expect(response).toBeDefined()
        const json = await response.json()
        console.log(json)
        expect(response.status).toBe(200)
      },
      TEST_TIMEOUT,
    )

    test(
      'should reject invalid agent request',
      async () => {
        const agentUrl = 'http://localhost:8889/test/12345/tasks'
        const headers = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer INVALID_TOKEN',
        }

        const response = await fetch(agentUrl, {
          method: 'POST',
          headers,
        })
        expect(response).toBeDefined()
        expect(response.status).toBe(402)
      },
      TEST_TIMEOUT,
    )

    test(
      'should reject wrong endpoint agent request',
      async () => {
        expect(agentAccessParams).not.toBeNull()

        // Use an incorrect endpoint
        const wrongAgentUrl = 'http://localhost:8889/wrong/endpoint'
        const headers = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentAccessParams!.accessToken}`,
        }

        const response = await fetch(wrongAgentUrl, {
          method: 'POST',
          headers,
        })
        expect(response).toBeDefined()
        console.log(`Wrong endpoint response: ${response.status} ${await response.text()}`)
        expect(response.status).toBe(402)
      },
      TEST_TIMEOUT,
    )

    test(
      'should fix agent endpoints',
      async () => {
        expect(agentId).not.toBeNull()

        const agentMetadata: AgentMetadata = {
          name: 'E2E Payments Agent Updated',
          description: 'This is a test agent for the E2E Payments tests',
          tags: ['test'],
        }
        const agentApi = {
          endpoints: [{ POST: 'http://localhost:8889/test/12345/tasks' }],
          agentDefinitionUrl: 'http://localhost:8889/test/openapi.json',
        }

        const result = await paymentsBuilder.agents.updateAgentMetadata(
          agentId!,
          agentMetadata,
          agentApi,
        )
        expect(result).toBeDefined()
        console.log(`Update agent result: ${JSON.stringify(result)}`)
        expect(result.success !== false).toBeTruthy() // Accept true or missing (legacy)
      },
      TEST_TIMEOUT,
    )
  })

  test(
    'should fail to get nonexistent plan',
    async () => {
      await expect(paymentsBuilder.plans.getPlan('11111')).rejects.toThrow()
    },
    TEST_TIMEOUT,
  )
})
