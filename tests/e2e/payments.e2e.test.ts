import { Address, AgentAccessParams, AgentMetadata, Endpoint, PlanMetadata, PlanPriceType } from '../../src/common/types'
import { EnvironmentName, ZeroAddress } from '../../src/environments'
import { Payments } from '../../src/payments'
import { getERC20PriceConfig, getExpirableDurationConfig, getFiatPriceConfig, getFixedCreditsConfig, getFreePriceConfig, getNativeTokenPriceConfig, getNonExpirableDurationConfig, ONE_DAY_DURATION } from '../../src/plans'
import http from 'http'

describe('Payments API (e2e)', () => {
  const TEST_TIMEOUT = 30_000
  // To configure the test gets the API Keys for the subscriber and the builder from the https://staging.nevermined.app website
  const subscriberNvmApiKeyHash =
    process.env.TEST_SUBSCRIBER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweDUwNTM4NDE5MkJhNmE0RDRiNTBFQUI4NDZlZTY3ZGIzYjlBOTMzNTkiLCJqdGkiOiIweGM1NWNiNTUzN2IzNmQ3MmRmZjBmMGY0MGYzMmY1ZTMwMjVkOWFiYmI5YTJhZjgwNjM2NWEzYmQzOWVkMWJiMWUiLCJleHAiOjE3ODE3MTQyMzF9.s0Pj27izNBnswrO7n8Gjfk7HplSChd4x5dtBMP4WTkYwnNLf-tfvscz-eNPrJshV0cLTb1QIyTZCFxXbPLuW_hs'
  const builderNvmApiKeyHash =  
    process.env.TEST_BUILDER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweDg5MjQ4MDM0NzJiYjQ1M2I3YzI3YTNDOTgyQTA4Zjc1MTVEN2FBNzIiLCJqdGkiOiIweDk2ZWIxNzdkMTg1M2EyNGI2NGM5ZTIzMDYxZjhkYjJmNGQ0ZjUzNDEzYjU1ZjczN2M5ZWY4MmJiYzlkNmNlZjQiLCJleHAiOjE3ODE3MTQyMzB9.G0iWkDVKXM_608hYQ5hUpc1HWZDOlRBasyO6iCo9FdQYleihUWmtlczAlQoHmgThnj6_eS3S6O_pCfKU9EBbpBw'
  const testingEnvironment = process.env.TEST_ENVIRONMENT || 'staging'
  const _SLEEP_DURATION = 3_000
  const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
  const AGENT_ENDPOINTS: Endpoint[] = [
    { 'POST': `http://localhost:8889/test/:agentId/tasks` },
    { 'GET': `http://localhost:8889/test/:agentId/tasks/:taskId` }
  ]

  let paymentsSubscriber: Payments
  let paymentsBuilder: Payments

  let creditsPlanId: string
  let expirablePlanId: string
  let trialPlanId: string
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
      expect(paymentsSubscriber.query).toBeDefined()
      
      paymentsBuilder = Payments.getInstance({
        nvmApiKey: builderNvmApiKeyHash,
        environment: testingEnvironment as EnvironmentName,
      })
      expect(paymentsBuilder).toBeDefined()
      expect(paymentsBuilder.query).toBeDefined()
      builderAddress = paymentsBuilder.accountAddress as Address
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
        const priceConfig = getERC20PriceConfig(20n, ERC20_ADDRESS, builderAddress)
        const creditsConfig = getFixedCreditsConfig(100n)
        console.log(' **** PRICE CONFIG ***', priceConfig)
        const response = await paymentsBuilder.registerCreditsPlan(planMetadata, priceConfig, creditsConfig)
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
        const creditsConfig = getExpirableDurationConfig(ONE_DAY_DURATION) // 1 day
        const response = await paymentsBuilder.registerTimePlan(planMetadata, priceConfig, creditsConfig)
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
        const response = await paymentsBuilder.registerTimeTrialPlan(trialPlanMetadata, priceConfig, creditsConfig)
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
          tags: ['test'],
          dateCreated: new Date()
        }
        const agentApi = {
          endpoints: AGENT_ENDPOINTS
        }
        const paymentPlans = [ creditsPlanId, expirablePlanId ]
        const result = await paymentsBuilder.registerAgent(agentMetadata, agentApi, paymentPlans)
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

        const agentMetadata = { name: 'My AI Payments Agent', tags: ['test2'] }
        const agentApi = { endpoints: [{ 'POST': 'http://localhost:8889/test/:agentId/tasks' }] }
        const cryptoPriceConfig = getNativeTokenPriceConfig(500n, builderAddress)
        const nonExpirableConfig = getNonExpirableDurationConfig()
        
        const { agentId, planId } = await paymentsBuilder.registerAgentAndPlan(
          agentMetadata,
          agentApi,
          planMetadata,
          cryptoPriceConfig,
          nonExpirableConfig,
        )
        expect(agentId).toBeDefined()
        expect(planId).toBeDefined()
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to get a plan',
      async () => {
        const plan = await paymentsBuilder.getPlan(creditsPlanId)
        expect(plan).toBeDefined()
        console.log('Plan', plan)
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to get an agent',
      async () => {
        const agent = await paymentsBuilder.getAgent(agentId)
        expect(agent).toBeDefined()
        console.log('Agent', agent)
      },
      TEST_TIMEOUT,
    )
  })
    

  describe('Plan Purchase', () => {
    it(
      'I should be able to order a Plan',
      async () => {
        console.log(creditsPlanId)
        console.log(' SUBSCRIBER ADDRESS = ', paymentsSubscriber.accountAddress)
        const orderResult = await paymentsSubscriber.orderPlan(creditsPlanId)
        expect(orderResult).toBeDefined()
        expect(orderResult.success).toBeTruthy()
        console.log('Order Result', orderResult)
      },
      TEST_TIMEOUT * 2,
    )

    it('I should be able to check the credits I own', async () => {
      const balanceResult = await paymentsSubscriber.getPlanBalance(creditsPlanId)
      expect(balanceResult).toBeDefined()
      console.log('Balance Result', balanceResult)
      expect(BigInt(balanceResult.balance)).toBeGreaterThan(0)
    })


    it(
      'I should be able to get a Trial Plan',
      async () => {
        console.log(trialPlanId)
        console.log(' SUBSCRIBER ADDRESS = ', paymentsSubscriber.accountAddress)
        const orderResult = await paymentsSubscriber.orderPlan(trialPlanId)
        expect(orderResult).toBeDefined()
        expect(orderResult.success).toBeTruthy()
        console.log('Order Result', orderResult)
      },
      TEST_TIMEOUT * 2,
    )

    it(
      'I should NOT be able to get a Trial Plan twice',
      async () => {
        await expect(
          paymentsSubscriber.orderPlan(trialPlanId)
        ).rejects.toThrow()
      },
      TEST_TIMEOUT * 2,
    )
  })

  describe('E2E Subscriber/Agent flow', () => {

    let server: http.Server
    let agentAccessParams: AgentAccessParams
    const agentURL = 'http://localhost:8889/test/12345/tasks'


    beforeAll(async () => {
      server = http.createServer(async (req, res) => {
        const authHeader = req.headers['authorization']

        const requestedUrl = `http://localhost:8889${req.url}`
        const httpVerb = req.method
        console.log('Received request:', { endpoint: requestedUrl, httpVerb, authHeader })
        let isValidReq
        try {
          isValidReq = await paymentsBuilder.isValidRequest(agentId, authHeader, requestedUrl, httpVerb!)
          console.log('isValidReq', isValidReq)
          if (isValidReq.balance.isSubscriber) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ message: 'Hello from the Agent!' }))
            return
          }
        } catch (error) {
          console.log('Unauthorized access attempt:', authHeader)
        }
        
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
        
      })

      server.listen(8889, () => {
        console.log('Agent server is running on port 8889')
        // done()
      })
    })

    afterAll(async () => {
      server.close()
    })
    // afterAll((done) => {
    //   server.close(done)
    // })

    it('I should be able to generate the agent access token', async () => {
      agentAccessParams = await paymentsSubscriber.getAgentAccessToken(creditsPlanId, agentId)
      expect(agentAccessParams).toBeDefined()
      console.log('Agent Access Params', agentAccessParams)
      expect(agentAccessParams.accessToken.length).toBeGreaterThan(0)
    })

    it('I should be able to send a request DIRECTLY to the agent', async () => {
      const agentHTTPOptions = {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${agentAccessParams.accessToken}`
        },
      }
      const response = await fetch(new URL(agentURL), agentHTTPOptions)
      expect(response).toBeDefined()
      console.log(await response.json())
      expect(response.ok).toBeTruthy()
    }, TEST_TIMEOUT) 

    it('I should NOT be able to query an agent with invalid params', async () => {
      const agentHTTPOptions = {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization:  `Bearer INVALID_TOKEN`
        },
      }
      // await expect(
      //   fetch(new URL(agentURL), agentHTTPOptions)
      // ).rejects.toThrow()
      const response = await fetch(new URL(agentURL), agentHTTPOptions)
      expect(response).toBeDefined()
      expect(response.status).toBe(403)
    }, TEST_TIMEOUT)

  })

  

  describe.skip('Errors', () => {

    it(
      'I should not be able to get a that does not exist',
      async () => {
        const result = await paymentsBuilder.getPlan('11111')
        expect(result).toBeUndefined()
        // expect(() => 
        //   paymentsBuilder.getPlan('11111')
        // ).toThrow(PaymentsError)
      },
      TEST_TIMEOUT,
    )
  })
})
