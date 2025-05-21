import { Address, AgentMetadata, Endpoint, PlanPriceType } from '../../src/common/types'
import { EnvironmentName, ZeroAddress } from '../../src/environments'
import { Payments } from '../../src/payments'
import { getERC20PriceConfig, getExpirableCreditsConfig, getFiatPriceConfig, getFixedCreditsConfig, getNativeTokenPriceConfig, getNonExpirableCreditsConfig } from '../../src/plans'

describe('Payments API (e2e)', () => {
  const TEST_TIMEOUT = 30_000
  // To configure the test gets the API Keys for the subscriber and the builder from the https://staging.nevermined.app website
  const subscriberNvmApiKeyHash =
    process.env.TEST_SUBSCRIBER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweGFBOEIzNWQxNThCNzIwQzVlRTJhMmM3OTBDM2Y2QTA4MEIyNzQ4NjIiLCJqdGkiOiIweDAxY2NkMmE5MjI5NmE3NjBjM2JlNDFmNGI4Nzk2Njg0NzVkZTQxNGY4NmUzMWJlNTQ1Mzc5Y2RlNjFlMzVmOGMiLCJleHAiOjE3NzkyOTIxMDEsImlhdCI6MTc0NzczNDUwMX0.dsXZa_LCLK083foODGClAvxxSpux2nG8Ok3Euevz3aEHzJQedZrppba7vvZRrH6DOhOmz1fhLfrfz81Yoam6-hs'
  const builderNvmApiKeyHash =  
    process.env.TEST_BUILDER_API_KEY ||
    // 'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDdmRTNFZTA4OGQwY2IzRjQ5ZmREMjBlMTk0RjIzRDY4MzhhY2NjODIiLCJqdGkiOiIweGY2ZDcyMmIzYWY5ZmNhOWY2MTQ2OGI5YjlhNGNmZjk3Yjg5NjE5Yzc1ZjRkYWEyMmY4NTA3Yjc2ODQzM2JkYWQiLCJleHAiOjE3NTk2MDU0MTMsImlhdCI6MTcyODA0NzgxNn0.1JDNV7yT8i1_1DXxC4z_jzMLJQns4XqujaJOEFmLdtwFam7bi-3s8oOF-dbTBObzNY98ddZZFifaCEvJUImYOBw'
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweEZCMzQwRkY0OTZkMUMzNGExYTVENDVBOTc4MjFENmE3MDQ2OTY3NTUiLCJqdGkiOiIweGZkMWFiYjBhZDQzMDhlYmNlNjNmM2M5OTBjMjg0OWZkMDUyYjgyY2Y1ZDUwZmZlOTNlYWQ2ZTQyMDk0ZDc3M2EiLCJleHAiOjE3NzkyOTIxMDIsImlhdCI6MTc0NzczNDUwMn0.92Bww53W789wChrRdIG_--4mhG5iBxXz96pp3Y-nEIIyv8KXukzs0GrdlQ6ALHJ5XE0v2Lw-k47NHnAdURyNOxs'
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
        const priceConfig = getERC20PriceConfig(20n, builderAddress, ERC20_ADDRESS)
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
        const priceConfig = getERC20PriceConfig(50n, builderAddress, ERC20_ADDRESS)
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
  })
    

  describe.skip('Plan Purchase', () => {
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
