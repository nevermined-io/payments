import {
  Address,
  AgentAccessCredentials,
  AgentMetadata,
  Endpoint,
  PaginationOptions,
  PlanMetadata,
  PlanPriceType,
} from '../../src/common/types'
import { EnvironmentName, ZeroAddress } from '../../src/environments'
import { Payments } from '../../src/payments'
import {
  getERC20PriceConfig,
  getExpirableDurationConfig,
  getFiatPriceConfig,
  getFixedCreditsConfig,
  getFreePriceConfig,
  getNativeTokenPriceConfig,
  getNonExpirableDurationConfig,
  ONE_DAY_DURATION,
} from '../../src/plans'
import http from 'http'
import { getRandomBigInt } from '../../src/utils'

describe('Payments API (e2e)', () => {
  const TEST_TIMEOUT = 30_000
  // To configure the test gets the API Keys for the subscriber and the builder from the https://staging.nevermined.app website
  const subscriberNvmApiKeyHash =
    process.env.TEST_SUBSCRIBER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDUwNTM4NDE5MkJhNmE0RDRiNTBFQUI4NDZlZTY3ZGIzYjlBOTMzNTkiLCJqdGkiOiIweDg4NTcxYjI2ODY2Yzg5ODY5ODJjZWVjZTgyNTJjYjIwMTA2YjZlMzY3NjkxNjFhYzdlNmIyOTY4ZDUyNDVlMWUiLCJleHAiOjE3ODQ5MDU1NDd9.J1-Q2ZEt8J0zYKOMwP-2lzsFj2PSR4R3_lUZThWwJTUIvs8VGo2iNifk9ASumsr2qd8zcpD1nBqiyKjoYg4CVRs'

  const builderNvmApiKeyHash =
    process.env.TEST_BUILDER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDg5MjQ4MDM0NzJiYjQ1M2I3YzI3YTNDOTgyQTA4Zjc1MTVEN2FBNzIiLCJqdGkiOiIweDgxODljNjQwYTAxMjlhZTA5NzlkNWQ1OGM2ODBhMWUwNDJkOWM1NzFiYjkxYTc4Y2NlYjMyNzBmMDJjZTIzYTgiLCJleHAiOjE3ODQ5MDU1NDV9.4aSxzSfpEon1FqPNGQ-NNaM451UaG03xG5tY8jLpxcRoyhdj6x6Yo28YZRid951JqwYW4jY80f9xOOnxaJuhphs'

  const testingEnvironment = process.env.TEST_ENVIRONMENT || 'staging_sandbox'
  const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
  const AGENT_ENDPOINTS: Endpoint[] = [
    { POST: `http://localhost:41243/a2a` },
    { GET: `http://localhost:41243/a2a/:agentId/tasks/:taskId` },
  ]

  let paymentsSubscriber: Payments
  let paymentsBuilder: Payments

  let creditsPlanId: string
  let expirablePlanId: string
  let trialPlanId: string
  let fiatPlanId: string
  let agentId: string
  let builderAddress: Address
  const planMetadata: PlanMetadata = {
    name: 'E2E test Payments Plan',
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
      'I should be able to register a new Credits Payment Plan',
      async () => {
        const priceConfig = getERC20PriceConfig(1n, ERC20_ADDRESS, builderAddress)
        const creditsConfig = getFixedCreditsConfig(100n)
        console.log(' **** PRICE CONFIG ***', priceConfig)
        const response = await paymentsBuilder.plans.registerCreditsPlan(
          planMetadata,
          priceConfig,
          creditsConfig,
        )
        expect(response).toBeDefined()
        creditsPlanId = response.planId

        expect(creditsPlanId).toBeDefined()
        expect(BigInt(creditsPlanId) > 0n).toBeTruthy()
        console.log('Credits Plan ID', creditsPlanId)
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to register a new Expirable Payment Plan',
      async () => {
        const priceConfig = getERC20PriceConfig(50n, ERC20_ADDRESS, builderAddress)
        const expirablePlanConfig = getExpirableDurationConfig(ONE_DAY_DURATION) // 1 day
        const response = await paymentsBuilder.plans.registerTimePlan(
          planMetadata,
          priceConfig,
          expirablePlanConfig,
        )
        expect(response).toBeDefined()
        expirablePlanId = response.planId

        expect(expirablePlanId).toBeDefined()
        expect(BigInt(expirablePlanId) > 0n).toBeTruthy()
        console.log('Expirable Plan ID', expirablePlanId)
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to register a Trial Plan',
      async () => {
        const trialPlanMetadata: PlanMetadata = {
          name: 'E2E test Trial Payments Plan',
        }
        const priceConfig = getFreePriceConfig()
        const creditsConfig = getExpirableDurationConfig(ONE_DAY_DURATION)
        console.log(' **** PRICE CONFIG ***', priceConfig)
        const response = await paymentsBuilder.plans.registerTimeTrialPlan(
          trialPlanMetadata,
          priceConfig,
          creditsConfig,
        )
        expect(response).toBeDefined()
        trialPlanId = response.planId

        expect(trialPlanId).toBeDefined()
        expect(BigInt(trialPlanId) > 0n).toBeTruthy()
        console.log('Trial Plan ID', trialPlanId)
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
        const paymentPlans = [creditsPlanId, expirablePlanId]
        const result = await paymentsBuilder.agents.registerAgent(
          agentMetadata,
          agentApi,
          paymentPlans,
        )
        agentId = result.agentId
        expect(agentId).toBeDefined()

        expect(agentId.startsWith('did:nv:')).toBeTruthy()
        console.log('Agent ID', agentId)
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

        const result = await paymentsBuilder.agents.registerAgentAndPlan(
          agentMetadata,
          agentApi,
          planMetadata,
          fiatPriceConfig,
          nonExpirableConfig,
        )
        console.log('Agent and Plan Registration Result', result)
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
        console.log('Plan', plan)
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to get an agent',
      async () => {
        const agent = await paymentsBuilder.agents.getAgent(agentId)
        expect(agent).toBeDefined()
        console.log('Agent', agent)
      },
      TEST_TIMEOUT,
    )

    it(
      'Get agents associated to a plan',
      async () => {
        console.log('Credits Plan ID', creditsPlanId)
        const agents = await paymentsBuilder.plans.getAgentsAssociatedToAPlan(
          creditsPlanId,
          new PaginationOptions({ offset: 5 }),
        )
        expect(agents).toBeDefined()
        console.log('Agents associated to the Plan', agents)
        expect(agents.total).toBeGreaterThan(0)
      },
      TEST_TIMEOUT,
    )

    it(
      'Get plans associated to an agent',
      async () => {
        // /agents/:agentId/plans
        console.log('Agent ID', agentId)
        const plans = await paymentsBuilder.agents.getAgentPlans(agentId)
        expect(plans).toBeDefined()
        console.log('Plans associated to an agent', plans)
        expect(plans.total).toBeGreaterThan(0)
      },
      TEST_TIMEOUT,
    )
  })

  describe('Plan Purchase', () => {
    it(
      'I should be able to order a Plan',
      async () => {
        console.log(creditsPlanId)
        console.log(' SUBSCRIBER ADDRESS = ', paymentsSubscriber.getAccountAddress())
        const orderResult = await paymentsSubscriber.plans.orderPlan(creditsPlanId)
        expect(orderResult).toBeDefined()
        console.log('Credits Plan - Order Result', orderResult)
        expect(orderResult.success).toBeTruthy()
      },
      TEST_TIMEOUT * 2,
    )

    // To test the Fiat Plan we need to have a Stripe account configured
    it.skip(
      'I should be able to get the link to finalize the order of a Fiat Plan',
      async () => {
        console.log(fiatPlanId)
        const orderResult = await paymentsSubscriber.plans.orderFiatPlan(fiatPlanId)
        expect(orderResult).toBeDefined()
        console.log('Fiat Plan - Order Result', orderResult)
        expect(orderResult.result.checkoutLink).toBeDefined()
        expect(orderResult.result.checkoutLink).toContain('https://checkout.stripe.com')
      },
      TEST_TIMEOUT * 2,
    )

    it('I should be able to check the credits I own', async () => {
      const balanceResult = await paymentsSubscriber.plans.getPlanBalance(creditsPlanId)
      expect(balanceResult).toBeDefined()
      console.log('Balance Result', balanceResult)
      expect(BigInt(balanceResult.balance)).toBeGreaterThan(0)
    })

    it(
      'I should be able to get a Trial Plan',
      async () => {
        console.log(trialPlanId)
        console.log(' SUBSCRIBER ADDRESS = ', paymentsSubscriber.getAccountAddress())
        const orderResult = await paymentsSubscriber.plans.orderPlan(trialPlanId)
        expect(orderResult).toBeDefined()
        console.log('Trial Plan - Order Result', orderResult)
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
    const agentURL = 'http://localhost:41243/a2a/'

    beforeAll(async () => {
      server = http.createServer(async (req, res) => {
        const authHeader = req.headers['authorization'] as string

        const requestedUrl = `http://localhost:41243${req.url}`
        const httpVerb = req.method
        console.log('Received request:', { endpoint: requestedUrl, httpVerb, authHeader })
        let isValidReq
        try {
          isValidReq = await paymentsBuilder.requests.startProcessingRequest(
            agentId,
            authHeader,
            requestedUrl,
            httpVerb!,
          )
          console.log('isValidReq', isValidReq)
          if (isValidReq.balance.isSubscriber) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ message: 'Hello from the Agent!' }))
            return
          }
        } catch (error) {
          console.log('Unauthorized access attempt:', authHeader)
          console.log('Error details:', error)
        }

        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      })

      server.listen(41243, () => {
        console.log('Agent server is running on port 41243')
        // done()
      })
    })

    afterAll(async () => {
      server.close()
    })

    it('I should be able to generate the agent access token', async () => {
      agentAccessParams = await paymentsSubscriber.agents.getAgentAccessToken(
        creditsPlanId,
        agentId,
      )
      expect(agentAccessParams).toBeDefined()
      console.log('Agent Access Params', agentAccessParams)
      expect(agentAccessParams.accessToken.length).toBeGreaterThan(0)
    })

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
        const response = await fetch(new URL(agentURL), agentHTTPOptions)
        expect(response).toBeDefined()
        console.log(await response.json())
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
        // await expect(
        //   fetch(new URL(agentURL), agentHTTPOptions)
        // ).rejects.toThrow()
        const response = await fetch(new URL(agentURL), agentHTTPOptions)
        expect(response).toBeDefined()
        expect(response.status).toBe(403)
      },
      TEST_TIMEOUT,
    )
  })

  describe.skip('Errors', () => {
    it(
      'I should not be able to get a that does not exist',
      async () => {
        const result = await paymentsBuilder.plans.getPlan('11111')
        expect(result).toBeUndefined()
        // expect(() =>
        //   paymentsBuilder.getPlan('11111')
        // ).toThrow(PaymentsError)
      },
      TEST_TIMEOUT,
    )
  })
})
