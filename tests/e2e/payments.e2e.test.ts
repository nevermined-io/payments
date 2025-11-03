import { getApiKeysForFile } from '../utils/apiKeysPool.js'
import {
  Address,
  AgentAccessCredentials,
  AgentMetadata,
  Endpoint,
  PaginationOptions,
  PlanMetadata,
  PlanPriceType,
} from '../../src/common/types.js'
import { EnvironmentName, ZeroAddress } from '../../src/environments.js'
import { Payments } from '../../src/payments.js'
import {
  getERC20PriceConfig,
  getExpirableDurationConfig,
  getFiatPriceConfig,
  getFixedCreditsConfig,
  getFreePriceConfig,
  getDynamicCreditsConfig,
  getNativeTokenPriceConfig,
  getNonExpirableDurationConfig,
  ONE_DAY_DURATION,
} from '../../src/plans.js'
import http from 'http'
import { getRandomBigInt } from '../../src/utils.js'
import { retryOperation, waitForCondition } from '../utils/retry-operation.js'
import { E2ETestUtils } from './helpers/e2e-test-helpers.js'

// Deterministic per-file API keys to avoid manual indexing and race conditions
const testApiKeys = getApiKeysForFile(__filename)

describe('Payments API (e2e)', () => {
  const TEST_TIMEOUT = 60_000
  // Per-suite API keys (do not share across suites to avoid blockchain race conditions)
  const subscriberNvmApiKeyHash = testApiKeys.subscriber

  const builderNvmApiKeyHash = testApiKeys.builder

  const testingEnvironment = process.env.TEST_ENVIRONMENT || 'staging_sandbox'
  const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
  const AGENT_ENDPOINTS: Endpoint[] = [
    { POST: `http://example.com/kkk/a2a` },
    { GET: `http://example.com/kkk/a2a/:agentId/tasks/:taskId` },
  ]

  let paymentsSubscriber: Payments
  let paymentsBuilder: Payments

  let creditsPlanId: string
  let dynamicCreditsPlanId: string
  let expirablePlanId: string
  let trialPlanId: string
  let fiatPlanId: string
  let agentId: string
  let builderAddress: Address
  const planMetadata: PlanMetadata = {
    name: `E2E test Payments Plan ${Date.now()}`,
  }

  describe('Payments Setup', () => {
    it('The Payments client can be initialized correctly', () => {
      paymentsSubscriber = Payments.getInstance({
        nvmApiKey: subscriberNvmApiKeyHash,
        environment: testingEnvironment as EnvironmentName,
      })

      expect(paymentsSubscriber).toBeDefined()
      expect(paymentsSubscriber.agents).toBeDefined()

      paymentsBuilder = Payments.getInstance({
        nvmApiKey: builderNvmApiKeyHash,
        environment: testingEnvironment as EnvironmentName,
      })
      expect(paymentsBuilder).toBeDefined()
      expect(paymentsBuilder.plans).toBeDefined()
      builderAddress = paymentsBuilder.getAccountAddress() as Address
      expect(paymentsBuilder.plans.getAccountAddress()).toBe(builderAddress)
    })
  })

  describe('AI Builder Publication', () => {
    it('I get a FIAT price config setup', async () => {
      const fiatPriceConfig = getFiatPriceConfig(100n, builderAddress)
      expect(fiatPriceConfig).toBeDefined()
      expect(fiatPriceConfig.priceType).toBe(PlanPriceType.FIXED_FIAT_PRICE)
      expect(fiatPriceConfig.amounts[0]).toBe(100n)
      expect(fiatPriceConfig.receivers[0]).toBe(builderAddress)
    })

    it('I get a CRYPTO price config setup', async () => {
      const cryptoPriceConfig = getNativeTokenPriceConfig(100n, builderAddress)
      expect(cryptoPriceConfig).toBeDefined()
      expect(cryptoPriceConfig.priceType).toBe(PlanPriceType.FIXED_PRICE)
      expect(cryptoPriceConfig.amounts[0]).toBe(100n)
      expect(cryptoPriceConfig.receivers[0]).toBe(builderAddress)
      expect(cryptoPriceConfig.tokenAddress).toBe(ZeroAddress)
    })

    it(
      'I should be able to register a new Fixed Credits Payment Plan',
      async () => {
        const priceConfig = getERC20PriceConfig(1n, ERC20_ADDRESS, builderAddress)
        const creditsConfig = getFixedCreditsConfig(100n)

        const response = await retryOperation(async () => {
          const result = await paymentsBuilder.plans.registerCreditsPlan(
            planMetadata,
            priceConfig,
            creditsConfig,
          )

          // Validate the response
          if (!result.planId) {
            throw new Error('Credits plan registration failed: no planId returned')
          }

          return result
        })

        expect(response).toBeDefined()
        creditsPlanId = response.planId

        expect(creditsPlanId).toBeDefined()
        expect(BigInt(creditsPlanId) > 0n).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to register a new Dynamic Credits Payment Plan',
      async () => {
        const priceConfig = getERC20PriceConfig(10_000n, ERC20_ADDRESS, builderAddress)
        const creditsConfig = getDynamicCreditsConfig(1000n, 5n, 15n)

        const response = await retryOperation(async () => {
          const result = await paymentsBuilder.plans.registerCreditsPlan(
            { ...planMetadata, name: 'Dynamic Credits Plan' },
            priceConfig,
            creditsConfig,
          )

          // Validate the response
          if (!result.planId) {
            throw new Error('Credits plan registration failed: no planId returned')
          }

          return result
        })

        expect(response).toBeDefined()
        dynamicCreditsPlanId = response.planId

        expect(dynamicCreditsPlanId).toBeDefined()
        expect(BigInt(dynamicCreditsPlanId) > 0n).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to register a new Expirable Payment Plan',
      async () => {
        const priceConfig = getERC20PriceConfig(50n, ERC20_ADDRESS, builderAddress)
        const expirablePlanConfig = getExpirableDurationConfig(ONE_DAY_DURATION) // 1 day

        const response = await retryOperation(async () => {
          const result = await paymentsBuilder.plans.registerTimePlan(
            planMetadata,
            priceConfig,
            expirablePlanConfig,
          )

          // Validate the response
          if (!result.planId) {
            throw new Error('Expirable plan registration failed: no planId returned')
          }

          return result
        })

        expect(response).toBeDefined()
        expirablePlanId = response.planId

        expect(expirablePlanId).toBeDefined()
        expect(BigInt(expirablePlanId) > 0n).toBeTruthy()
      },
      TEST_TIMEOUT * 2,
    )

    it(
      'I should be able to register a Trial Plan',
      async () => {
        const trialPlanMetadata: PlanMetadata = {
          name: `E2E test Trial Payments Plan ${Date.now()}`,
        }
        const priceConfig = getFreePriceConfig()
        const creditsConfig = getExpirableDurationConfig(ONE_DAY_DURATION)

        const response = await retryOperation(async () => {
          const result = await paymentsBuilder.plans.registerTimeTrialPlan(
            trialPlanMetadata,
            priceConfig,
            creditsConfig,
          )

          // Validate the response
          if (!result.planId) {
            throw new Error('Trial plan registration failed: no planId returned')
          }

          return result
        })

        expect(response).toBeDefined()
        trialPlanId = response.planId

        expect(trialPlanId).toBeDefined()
        expect(BigInt(trialPlanId) > 0n).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to register a new Agent with 2 plans associated',
      async () => {
        const agentMetadata: AgentMetadata = {
          name: 'E2E Payments Agent',
          description: 'This is a test agent for the E2E Payments tests',
          tags: ['test'],
          dateCreated: new Date(),
        }
        const agentApi = {
          endpoints: AGENT_ENDPOINTS,
        }
        const paymentPlans = [creditsPlanId, expirablePlanId, dynamicCreditsPlanId]

        const result = await retryOperation(async () => {
          const response = await paymentsBuilder.agents.registerAgent(
            agentMetadata,
            agentApi,
            paymentPlans,
          )

          // Validate the response
          if (!response.agentId) {
            throw new Error('Agent registration failed: no agentId returned')
          }

          return response
        })

        agentId = result.agentId
        expect(agentId).toBeDefined()

        expect(agentId.startsWith('did:nv:')).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to register an agent and a plan in one step',
      async () => {
        const agentMetadata = {
          name: 'My AI FIAT Payments Agent',
          description: 'This is a test agent for the E2E Payments tests',
          tags: ['fiat', 'test2'],
        }
        const agentApi = { endpoints: [{ POST: 'http://localhost:8889/test/:agentId/tasks' }] }
        const fiatPriceConfig = getFiatPriceConfig(10_000_000n, builderAddress)
        const nonExpirableConfig = getNonExpirableDurationConfig()
        nonExpirableConfig.durationSecs = getRandomBigInt() // we force the randomness of the plan

        const result = await retryOperation(async () => {
          const response = await paymentsBuilder.agents.registerAgentAndPlan(
            agentMetadata,
            agentApi,
            planMetadata,
            fiatPriceConfig,
            nonExpirableConfig,
          )

          // Validate the response
          if (!response.planId || !response.agentId) {
            throw new Error('Agent and plan registration failed: missing planId or agentId')
          }

          return response
        })

        expect(result.planId).toBeDefined()
        expect(result.agentId).toBeDefined()
        expect(result.agentId.startsWith('did:nv:')).toBeTruthy()
        fiatPlanId = result.planId
      },
      TEST_TIMEOUT,
    )
  })

  describe('Search & Discovery', () => {
    it(
      'I should be able to get a plan',
      async () => {
        const plan = await paymentsBuilder.plans.getPlan(creditsPlanId)

        expect(plan).toBeDefined()
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to get an agent',
      async () => {
        const agent = await paymentsBuilder.agents.getAgent(agentId)
        expect(agent).toBeDefined()
      },
      TEST_TIMEOUT,
    )

    it(
      'Get agents associated to a plan',
      async () => {
        const agents = await paymentsBuilder.plans.getAgentsAssociatedToAPlan(
          creditsPlanId,
          new PaginationOptions({ offset: 5 }),
        )
        expect(agents).toBeDefined()
        expect(agents.total).toBeGreaterThan(0)
      },
      TEST_TIMEOUT,
    )

    it(
      'Get plans associated to an agent',
      async () => {
        // /agents/:agentId/plans
        const plans = await paymentsBuilder.agents.getAgentPlans(agentId)
        expect(plans).toBeDefined()
        expect(plans.total).toBeGreaterThan(0)
      },
      TEST_TIMEOUT,
    )
  })

  describe('Plan Purchase', () => {
    it(
      'I should be able to order a Plan',
      async () => {
        const orderResult = await retryOperation(async () => {
          const result = await paymentsSubscriber.plans.orderPlan(creditsPlanId)

          // Validate the response
          if (!result.success) {
            throw new Error('Plan order failed: success is false')
          }

          return result
        })

        expect(orderResult).toBeDefined()
        expect(orderResult.success).toBeTruthy()
        // Wait for eventual consistency on backend before checking balance
        // Replaces fixed sleep with a condition wait similar to Python helpers
        await waitForCondition(
          async () => {
            try {
              const bal = await paymentsSubscriber.plans.getPlanBalance(creditsPlanId)
              if (bal && BigInt(bal.balance) > 0n && bal.isSubscriber) return bal
            } catch {}
            return null
          },
          60_000,
          2_000,
        )
      },
      TEST_TIMEOUT * 2,
    )

    // To test the Fiat Plan we need to have a Stripe account configured
    it.skip(
      'I should be able to get the link to finalize the order of a Fiat Plan',
      async () => {
        const orderResult = await paymentsSubscriber.plans.orderFiatPlan(fiatPlanId)
        expect(orderResult).toBeDefined()
        expect(orderResult.result.checkoutLink).toBeDefined()
        expect(orderResult.result.checkoutLink).toContain('https://checkout.stripe.com')
      },
      TEST_TIMEOUT * 2,
    )

    it('I should be able to check the credits I own', async () => {
      const balanceResult = await waitForCondition(
        async () => {
          try {
            const result = await paymentsSubscriber.plans.getPlanBalance(creditsPlanId)
            if (result && BigInt(result.balance) > 0n && result.isSubscriber) return result
          } catch {}
          return null
        },
        60_000,
        2_000,
      )
      expect(balanceResult).toBeDefined()
      expect(BigInt(balanceResult!.balance)).toBeGreaterThan(0n)
    })

    it(
      'I should be able to get a Trial Plan',
      async () => {
        const orderResult = await retryOperation(async () => {
          const result = await paymentsSubscriber.plans.orderPlan(trialPlanId)

          // Validate the response
          if (!result.success) {
            throw new Error('Trial plan order failed: success is false')
          }

          return result
        })

        expect(orderResult).toBeDefined()
        expect(orderResult.success).toBeTruthy()
      },
      TEST_TIMEOUT * 2,
    )

    it(
      'I should NOT be able to get a Trial Plan twice',
      async () => {
        await expect(paymentsSubscriber.plans.orderPlan(trialPlanId)).rejects.toThrow()
      },
      TEST_TIMEOUT * 2,
    )
  })

  describe('E2E Subscriber/Agent flow', () => {
    let server: http.Server
    let agentAccessParams: AgentAccessCredentials
    const agentURL = 'http://localhost:41244/a2a/'

    beforeAll(async () => {
      server = http.createServer(async (req, res) => {
        const authHeader = req.headers['authorization'] as string

        const requestedUrl = `http://localhost:41244${req.url}`
        const httpVerb = req.method
        let isValidReq
        try {
          isValidReq = await paymentsBuilder.requests.startProcessingRequest(
            agentId,
            authHeader,
            requestedUrl,
            httpVerb!,
          )
          if (isValidReq?.balance?.isSubscriber) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ message: 'Hello from the Agent!' }))
            return
          }
          throw new Error('Unauthorized access attempt')
        } catch (error) {
          console.log('Error details:', error)
        }

        res.writeHead(402, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      })

      await new Promise<void>((resolve, reject) => {
        const onError = (err: unknown) => reject(err)
        server.once('error', onError)
        server.listen(41244, () => {
          server.off('error', onError)
          resolve()
        })
      })
    }, TEST_TIMEOUT * 6)

    afterAll(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()))
        // Small wait to ensure port is released
        await E2ETestUtils.wait(50)
      }
    })

    it('I should be able to generate the agent access token', async () => {
      agentAccessParams = await retryOperation(async () => {
        const result = await paymentsSubscriber.agents.getAgentAccessToken(creditsPlanId, agentId)

        // Validate the response
        if (!result.accessToken || result.accessToken.length === 0) {
          throw new Error('Access token generation failed: no token returned')
        }

        return result
      })

      expect(agentAccessParams).toBeDefined()
      expect(agentAccessParams.accessToken.length).toBeGreaterThan(0)
    })

    it(
      'I should NOT be able to query an agent using the wrong endpoint',
      async () => {
        const agentHTTPOptions = {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${agentAccessParams.accessToken}`,
          },
        }

        const response = await E2ETestUtils.fetchWithTimeout(
          agentURL,
          agentHTTPOptions as any,
          10_000,
        )
        expect(response).toBeDefined()
        expect(response.status).toBe(402)
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to fix the endpoints',
      async () => {
        const agentMetadata: AgentMetadata = {
          name: 'E2E Payments Agent Updated',
          description: 'This is a test agent for the E2E Payments tests',
          tags: ['test'],
          dateCreated: new Date(),
        }
        const agentApi = {
          endpoints: [{ POST: `${agentURL}` }],
        }

        const result = await retryOperation(async () => {
          const response = await paymentsBuilder.agents.updateAgentMetadata(
            agentId,
            agentMetadata,
            agentApi,
          )

          // Validate the response
          if (!response.success) {
            throw new Error('Agent metadata update failed: success is false')
          }

          return response
        })

        expect(result).toBeDefined()
        expect(result.success).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to send a request DIRECTLY to the agent',
      async () => {
        const agentHTTPOptions = {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${agentAccessParams.accessToken}`,
          },
        }
        const response = await E2ETestUtils.fetchWithTimeout(
          agentURL,
          agentHTTPOptions as any,
          10_000,
        )
        expect(response).toBeDefined()
        expect(response.ok).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    it(
      'I should NOT be able to query an agent with invalid params',
      async () => {
        const agentHTTPOptions = {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer INVALID_TOKEN`,
          },
        }

        const response = await E2ETestUtils.fetchWithTimeout(
          agentURL,
          agentHTTPOptions as any,
          10_000,
        )
        expect(response).toBeDefined()
        expect(response.status).toBe(402)
      },
      TEST_TIMEOUT,
    )
  })

  describe('Errors', () => {
    it(
      'I should not be able to get a plan that does not exist',
      async () => {
        await expect(paymentsBuilder.plans.getPlan('11111')).rejects.toThrow()
      },
      TEST_TIMEOUT,
    )
  })
})
