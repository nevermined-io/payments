import { randomUUID } from 'crypto'
import { Payments } from '../../src/payments'
import { OrganizationMemberRole } from '../../src/api/organizations-api'
import { PlanMetadata } from '../../src'
import { getFixedCreditsConfig, getFreePriceConfig } from '../../src/plans'

describe('Organizations Integration Test', () => {
  const organizationAdminApiKey =
    'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweGUwODY2NDBmQjcwM0NlMGQyNmZlODI0QTM2YTcyOTVjQjFFNzc2NmQiLCJqdGkiOiIweGU3ZGQ4M2Y3MmFlMGU0NWNkYjViYTgyMzllZDNmNDE1ZGYwYWE3ZWNiNDAwMWRlZjJjYWZmYzM3OTgxNWNjMWEiLCJleHAiOjE3OTA3Nzk5NzAsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.sSDgvyJ79PS2zlXUFKVPRAxMDYAp4uxnDV15cXjXGY9eCc6TxdBFLxElW9JVCqDqf7DQs-MyKSug8tVVa0OsnBs'
  let paymentsOrganization: Payments
  let paymentsBuilder: Payments
  let paymentsSubscriber: Payments
  let builderNvmApiKey: string
  let subscriberNvmApiKey: string
  let trialPlanId: string

  beforeAll(() => {
    paymentsOrganization = Payments.getInstance({
      nvmApiKey: organizationAdminApiKey,
      environment: 'staging_sandbox',
    })
  })

  it('should create a builder and a subscriber user', async () => {
    // create builder user
    const builder = await paymentsOrganization.organizations.createUser(
      randomUUID().toString(),
      `${randomUUID().toString()}@example.com`,
      OrganizationMemberRole.Client,
    )
    expect(builder).toBeDefined()
    expect(builder.alreadyMember).toBe(false)
    expect(builder.userId).toBeDefined()
    expect(builder.userWallet).toBeDefined()
    expect(builder.nvmApiKey).toBeDefined()

    // create subscriber user
    const subscriber = await paymentsOrganization.organizations.createUser(
      randomUUID().toString(),
      `${randomUUID().toString()}@example.com`,
      OrganizationMemberRole.Client,
    )
    expect(subscriber).toBeDefined()
    expect(subscriber.alreadyMember).toBe(false)
    expect(subscriber.userId).toBeDefined()
    expect(subscriber.userWallet).toBeDefined()
    expect(subscriber.nvmApiKey).toBeDefined()

    builderNvmApiKey = builder.nvmApiKey
    subscriberNvmApiKey = subscriber.nvmApiKey
  })

  it('should get the members for the organization', async () => {
    const members = await paymentsOrganization.organizations.getMembers()
    expect(members).toBeDefined()
    expect(members.members.length).toBeGreaterThanOrEqual(2)
    expect(members.total).toBeGreaterThanOrEqual(2)
  })

  it('should create a plan for the builder', async () => {
    paymentsBuilder = Payments.getInstance({
      nvmApiKey: builderNvmApiKey,
      environment: 'staging_sandbox',
    })

    const trialPlanMetadata: PlanMetadata = {
      name: `Organization User Trial Payments Plan ${Date.now()}`,
    }
    const priceConfig = getFreePriceConfig()
    const creditsConfig = getFixedCreditsConfig(100n)
    const result = await paymentsBuilder.plans.registerPlan(
      trialPlanMetadata,
      priceConfig,
      creditsConfig,
    )
    expect(result.planId).toBeDefined()
    trialPlanId = result.planId
  })

  it('should get the plan details for the builder', async () => {
    const plan = await paymentsBuilder.plans.getPlan(trialPlanId)

    expect(plan).toBeDefined()
    expect(plan.id).toBe(trialPlanId)
  })

  it('should list the plans for the builder', async () => {
    const plans = await paymentsBuilder.plans.getPlans()
    expect(plans).toBeDefined()
    expect(plans.total).toBe(1)
  })

  it('should subscribe to the plan for the subscriber', async () => {
    paymentsSubscriber = Payments.getInstance({
      nvmApiKey: subscriberNvmApiKey,
      environment: 'staging_sandbox',
    })

    const orderResult = await paymentsSubscriber.plans.orderPlan(trialPlanId)
    expect(orderResult).toBeDefined()
    expect(orderResult.success).toBeTruthy()
  })

  it('should get the plan balance for the subscriber', async () => {
    const balance = await paymentsSubscriber.plans.getPlanBalance(trialPlanId)
    expect(balance).toBeDefined()
    expect(balance.isSubscriber).toBeTruthy()
  })
})
