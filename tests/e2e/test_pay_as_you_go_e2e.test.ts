/**
 * End-to-end test for Pay-As-You-Go (PAYG) flow using the TypeScript payments SDK.
 *
 * This mirrors the Python E2E flow: create a PAYG plan, ensure the template
 * address comes from the API, attach the plan to an agent, and order the plan
 * as a subscriber.
 */

import { Payments } from '../../src/payments.js'
import type {
  PaymentOptions,
  PlanMetadata,
  AgentMetadata,
  AgentAPIAttributes,
  Address,
} from '../../src/common/types.js'
import { getPayAsYouGoCreditsConfig } from '../../src/plans.js'
import { getRandomBigInt } from '../../src/utils.js'
import type { EnvironmentName } from '../../src/environments.js'

const TEST_TIMEOUT = 60_000
const TEST_ENVIRONMENT = (process.env.TEST_ENVIRONMENT || 'staging_sandbox') as EnvironmentName
const ERC20_ADDRESS = (process.env.TEST_ERC20_TOKEN ||
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as Address

// Test API keys
const SUBSCRIBER_API_KEY =
  process.env.TEST_SUBSCRIBER_API_KEY ||
  'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweEVCNDk3OTU2OTRBMDc1QTY0ZTY2MzdmMUU5MGYwMjE0Mzg5YjI0YTMiLCJqdGkiOiIweGMzYjYyMWJkYTM5ZDllYWQyMTUyMDliZWY0MDBhMDEzYjM1YjQ2Zjc1NzM4YWFjY2I5ZjdkYWI0ZjQ5MmM5YjgiLCJleHAiOjE3OTQ2NTUwNjAsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.YMkGQUjGh7_m07nj8SKXZReNKSryg9mTU3qwJr_TKYATUixbYQTte3CKucjqvgAGzJAd1Kq2ubz3b37n5Zsllxs'
const BUILDER_API_KEY =
  process.env.TEST_BUILDER_API_KEY ||
  'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweEFDYjY5YTYzZjljMEI0ZTczNDE0NDM2YjdBODM1NDBGNkM5MmIyMmUiLCJqdGkiOiIweDExZWUwYWYyOGQ5NGVlNmNjZGJhNDJmMDcyNDQyNTQ0ODE5OWRmNTk5ZGRkMDcyMWVlMmI5ZTg5Nzg3MzQ3N2IiLCJleHAiOjE3OTQ2NTU0NTIsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.fnnb-AFxE_ngIAgIRZOY6SpLM3KgpB1z210l_z3T0Fl2G2tHQp9svXrflCsIYoYHW_8kbHllLce827gyfmFvMhw'

describe('Pay-As-You-Go E2E', () => {
  let paymentsSubscriber: Payments
  let paymentsBuilder: Payments
  let builderAddress: Address
  let planId: string
  let agentId: string

  beforeAll(async () => {
    const subscriberOpts: PaymentOptions = {
      nvmApiKey: SUBSCRIBER_API_KEY,
      environment: TEST_ENVIRONMENT,
    }
    const builderOpts: PaymentOptions = {
      nvmApiKey: BUILDER_API_KEY,
      environment: TEST_ENVIRONMENT,
    }

    paymentsSubscriber = Payments.getInstance(subscriberOpts)
    paymentsBuilder = Payments.getInstance(builderOpts)
    builderAddress = paymentsBuilder.getAccountAddress() as Address
  }, TEST_TIMEOUT)

  test(
    'create PAYG plan with template from API',
    async () => {
      const templateAddress = await paymentsBuilder.contracts.getPayAsYouGoTemplateAddress()

      const planMetadata: PlanMetadata = {
        name: `E2E PAYG Plan TS ${Date.now()}`,
        description: 'Pay-as-you-go test plan (TS)',
      }

      const priceConfig = await paymentsBuilder.plans.getPayAsYouGoPriceConfig(
        100n,
        builderAddress,
        ERC20_ADDRESS,
      )
      const creditsConfig = getPayAsYouGoCreditsConfig()

      const { planId: createdPlanId } = await paymentsBuilder.plans.registerPlan(
        planMetadata,
        priceConfig,
        creditsConfig,
        getRandomBigInt(),
        'credits',
      )

      expect(createdPlanId).toBeDefined()
      planId = createdPlanId

      const plan = await paymentsBuilder.plans.getPlan(planId)
      const registry = plan.registry || {}
      const price = registry.price || {}
      expect(price.templateAddress?.toLowerCase()).toBe(templateAddress.toLowerCase())
    },
    TEST_TIMEOUT,
  )

  test(
    'register agent with PAYG plan',
    async () => {
      const agentMetadata: AgentMetadata = {
        name: `E2E PAYG Agent TS ${Date.now()}`,
        description: 'Agent for PAYG E2E test',
        tags: ['payg', 'test'],
      }

      const agentApi: AgentAPIAttributes = {
        endpoints: [
          {
            verb: 'POST',
            url: 'https://myagent.ai/api/v1/secret/:agentId/tasks',
          },
        ],
        openEndpoints: [],
        agentDefinitionUrl: 'https://myagent.ai/api-docs',
        authType: 'bearer',
        token: 'my-secret-token',
      }

      const { agentId: createdAgentId } = await paymentsBuilder.agents.registerAgent(
        agentMetadata,
        agentApi,
        [planId],
      )

      expect(createdAgentId).toBeDefined()
      agentId = createdAgentId

      const agent = await paymentsBuilder.agents.getAgent(agentId)
      expect(agent.id).toBe(agentId)
      expect(agent.registry.plans).toContain(planId)
    },
    TEST_TIMEOUT,
  )

  test(
    'subscriber can order PAYG plan',
    async () => {
      const orderResult = await paymentsSubscriber.plans.orderPlan(planId)
      expect(orderResult).toBeDefined()
      expect(orderResult.success).toBe(true)
    },
    TEST_TIMEOUT,
  )
})
