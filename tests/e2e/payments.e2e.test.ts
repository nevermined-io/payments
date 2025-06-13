import { Address, AgentMetadata, Endpoint, PlanMetadata, PlanPriceType } from '../../src/common/types'
import { EnvironmentName, ZeroAddress } from '../../src/environments'
import { Payments } from '../../src/payments'
import { getERC20PriceConfig, getExpirableDurationConfig, getFiatPriceConfig, getFixedCreditsConfig, getFreePriceConfig, getNativeTokenPriceConfig, getNonExpirableDurationConfig, ONE_DAY_DURATION } from '../../src/plans'

describe('Payments API (e2e)', () => {
  const TEST_TIMEOUT = 30_000
  // To configure the test gets the API Keys for the subscriber and the builder from the https://staging.nevermined.app website
  const subscriberNvmApiKeyHash =
    process.env.TEST_SUBSCRIBER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweDUwNTM4NDE5MkJhNmE0RDRiNTBFQUI4NDZlZTY3ZGIzYjlBOTMzNTkiLCJqdGkiOiIweGQwYTQwMTAxZTgwMmI4MTcxOTRmZmYzNzdiZGRjZTliMzkxNTQyY2Q5MzYxNTE1YWY2YTkzNTJhNTQ5ZDA5ODkiLCJleHAiOjE3ODEyODUzNzl9.3RnO1_sTNM4K0z_EZ6u2FPDHSZHRDojVQvQcKh6Wa_EAJU1TYxXVCxjngH5y7urN5tfXeEgv1lo_vkwvmX4_ORs'
  const builderNvmApiKeyHash =  
    process.env.TEST_BUILDER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweDg5MjQ4MDM0NzJiYjQ1M2I3YzI3YTNDOTgyQTA4Zjc1MTVEN2FBNzIiLCJqdGkiOiIweDBmNTNhYjNmM2M3MTdiYjYxZWUyMTIwZWU0ODE2YmMyYzc2ZDU0MGI2ZTQ3ODEyZTBiNTY4NTgzYTI4ZTBjMzUiLCJleHAiOjE3ODEyODUzNzh9.vt4nW_AQQpSB-MHPc8KLUEx7k_V8x4ShFL06WsLwd7dbDMGmV4QFHLpnpBKgKvFoZ13rFhVXXAHUkoaEIzgORhw'
  const testingEnvironment = process.env.TEST_ENVIRONMENT || 'staging'
  const _SLEEP_DURATION = 3_000
  const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
  const AGENT_ENDPOINTS: Endpoint[] = [
    { 'POST': `https://one-backend.${testingEnvironment}.nevermined.app/api/v1/agents/(.*)/tasks` },
    { 'GET': `https://one-backend.${testingEnvironment}.nevermined.app/api/v1/agents/(.*)/tasks/(.*)` }
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
        const agentApi = { endpoints: [{ 'POST': 'https://example.com/api/v1/agents/(.*)/tasks' }] }
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

  describe('Querying Agents', () => {

    it('I should be able to generate the agent access token', async () => {
      const agentAccessParams = await paymentsSubscriber.getAgentAccessToken(creditsPlanId, agentId)
      expect(agentAccessParams).toBeDefined()
      console.log('Agent Access Params', agentAccessParams)
      expect(agentAccessParams.accessToken.length).toBeGreaterThan(0)
    })
    
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
