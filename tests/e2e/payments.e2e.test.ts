import { Address, AgentMetadata, Endpoint, PlanPriceType } from '../../src/common/types'
import { EnvironmentName, ZeroAddress } from '../../src/environments'
import { Payments } from '../../src/payments'
import { getERC20PriceConfig, getExpirableCreditsConfig, getFiatPriceConfig, getFixedCreditsConfig, getNativeTokenPriceConfig, getNonExpirableCreditsConfig } from '../../src/plans'

describe('Payments API (e2e)', () => {
  const TEST_TIMEOUT = 30_000
  // To configure the test gets the API Keys for the subscriber and the builder from the https://staging.nevermined.app website
  const subscriberNvmApiKeyHash =
    process.env.TEST_SUBSCRIBER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweEZCMzQwRkY0OTZkMUMzNGExYTVENDVBOTc4MjFENmE3MDQ2OTY3NTUiLCJqdGkiOiIweGQ0MWQzYjA2YzJkYmMxMGFkMzczYTY3Y2YzMjZmYmQyYjNlNTYwYTA3ZGY4OGQyMTVhOTNjODBhMDcyZjEyZDMiLCJleHAiOjE3NzkzOTg0MDUsImlhdCI6MTc0Nzg0MDgwNX0.S-W41Lg3SOhlKsxaLMXiirtJULtCjj6SWegewvDr0gtS8wLekfmGZ_78a4W6ldrmecOqHuxzIdTNTKQFAzO-mRw'
  const builderNvmApiKeyHash =  
    process.env.TEST_BUILDER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJp    c3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweGFBOEIzNWQxNThCNzIwQzVlRTJhMmM3OTBDM2Y2QTA4MEIyNzQ4NjIiLCJqdGkiOiIweDgyOGU3YWUzMzBhNTFiMjFhMDczNjllMjZlNGNjMjNhYTZjMDcxNjQ2N2VlNzU5ZGM0ZTdjYWFjN2YyNzEyNWUiLCJleHAiOjE3NzkzOTg0MDQsImlhdCI6MTc0Nzg0MDgwNH0.WGZ5UTIpv9og_8kjOvE7NmhRJ1ZCrmom2lrf7SbrErUde142L7EmPpOL_ihv_d2yOoCrBrjjm1LsTAcXm0Z8dhw'
  const testingEnvironment = process.env.TEST_ENVIRONMENT || 'staging'
  const _SLEEP_DURATION = 3_000
  const ERC20_ADDRESS = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
  const AGENT_ENDPOINTS: Endpoint[] = [
    { 'POST': `https://one-backend.${testingEnvironment}.nevermined.app/api/v1/agents/(.*)/tasks` },
    { 'GET': `https://one-backend.${testingEnvironment}.nevermined.app/api/v1/agents/(.*)/tasks/(.*)` }
  ]

  let paymentsSubscriber: Payments
  let paymentsBuilder: Payments

  let creditsPlanId: string
  let expirablePlanId: string
  let agentDID: string
  let builderAddress: Address

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
        const response = await paymentsBuilder.registerCreditsPlan(priceConfig, creditsConfig)
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
        const creditsConfig = getExpirableCreditsConfig(86400n) // 1 day
        const response = await paymentsBuilder.registerTimePlan(priceConfig, creditsConfig)
        expect(response).toBeDefined()
        expirablePlanId = response.planId 

        expect(expirablePlanId).toBeDefined()
        expect(BigInt(expirablePlanId) > 0n).toBeTruthy()
        console.log('Expirable Plan ID', expirablePlanId)
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
        const response = await paymentsBuilder.registerAgent(agentMetadata, agentApi, paymentPlans)
        expect(response).toBeDefined()
        agentDID = response.did 

        expect(agentDID).toBeDefined()
        expect(agentDID.startsWith('did:nv:')).toBeTruthy()
        console.log('Agent DID', agentDID)
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to register an agent and a plan in one step',
      async () => {

        const agentMetadata = { name: 'My AI Payments Agent', tags: ['test'] }
        const agentApi = { endpoints: [{ 'POST': 'https://example.com/api/v1/agents/(.*)/tasks' }] }
        const cryptoPriceConfig = getNativeTokenPriceConfig(500n, builderAddress)
        const nonExpirableConfig = getNonExpirableCreditsConfig()
        
        const { did, planId } = await paymentsBuilder.registerAgentAndPlan(
          agentMetadata,
          agentApi,
          cryptoPriceConfig,
          nonExpirableConfig,
        )
        expect(did).toBeDefined()
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
        const agent = await paymentsBuilder.getAgent(agentDID)
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

  
  })
})
