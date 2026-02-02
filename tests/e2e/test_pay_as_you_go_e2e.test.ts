/**
 * End-to-end test for Pay-As-You-Go (PAYG) flow using the TypeScript payments SDK.
 *
 * This mirrors the Python E2E flow: create a PAYG plan, ensure the template
 * address comes from the API, attach the plan to an agent, and order the plan
 * as a subscriber.
 */

import { Payments } from '../../src/payments.js'
import type {
  PlanMetadata,
  AgentMetadata,
  AgentAPIAttributes,
  Address,
} from '../../src/common/types.js'
import { getPayAsYouGoCreditsConfig } from '../../src/plans.js'
import { getRandomBigInt } from '../../src/utils.js'
import { makeWaitForPlan, makeWaitForAgent, retryWithBackoff } from '../utils.js'
import { ZeroAddress } from '../../src/environments.js'
import { createPaymentsBuilder, createPaymentsSubscriber, ERC20_ADDRESS } from './fixtures.js'

const TEST_TIMEOUT = 60_000

describe('Pay-As-You-Go E2E', () => {
  let paymentsSubscriber: Payments
  let paymentsBuilder: Payments
  let builderAddress: Address
  let planId: string
  let agentId: string
  let waitForPlan: (planId: string, timeoutMs?: number, intervalMs?: number) => Promise<any>
  let waitForAgent: (agentId: string, timeoutMs?: number, intervalMs?: number) => Promise<any>

  beforeAll(async () => {
    paymentsSubscriber = createPaymentsSubscriber()
    paymentsBuilder = createPaymentsBuilder()
    builderAddress = paymentsBuilder.getAccountAddress() as Address
    waitForPlan = makeWaitForPlan((id) => paymentsBuilder.plans.getPlan(id))
    waitForAgent = makeWaitForAgent((id) => paymentsBuilder.agents.getAgent(id))
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

      const result = await retryWithBackoff<{ planId: string }>(
        () =>
          paymentsBuilder.plans.registerPlan(
            planMetadata,
            priceConfig,
            creditsConfig,
            getRandomBigInt(),
            'credits',
          ),
        {
          label: 'registerPlan (PAYG)',
          attempts: 6,
        },
      )

      expect(result.planId).toBeDefined()
      planId = result.planId

      const plan = await waitForPlan(planId, 20_000, 1_000)
      const registry = (plan as any).registry || {}
      const price = registry.price || {}
      expect(price.templateAddress?.toLowerCase()).not.toBe(ZeroAddress.toLowerCase())
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

      const result = await retryWithBackoff<{ agentId: string }>(
        () => paymentsBuilder.agents.registerAgent(agentMetadata, agentApi, [planId]),
        {
          label: 'registerAgent (PAYG)',
          attempts: 6,
        },
      )

      expect(result.agentId).toBeDefined()
      agentId = result.agentId

      const agent = await waitForAgent(agentId, 20_000, 1_000)
      expect(agent.id).toBe(agentId)
      expect(agent.registry.plans).toContain(planId)
    },
    TEST_TIMEOUT,
  )

  test(
    'subscriber can order PAYG plan',
    async () => {
      const orderResult = await retryWithBackoff(
        () => paymentsSubscriber.plans.orderPlan(planId),
        {
          label: 'orderPlan (PAYG)',
          attempts: 3,
        },
      )
      expect(orderResult).toBeDefined()
      expect(orderResult.success).toBe(true)
    },
    TEST_TIMEOUT,
  )
})
