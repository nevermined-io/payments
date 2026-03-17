/**
 * End-to-end tests for X402 card-delegation flow (Stripe).
 *
 * These tests require:
 * - A running API with .env.backend1 config (Base Sepolia + Stripe/Privy)
 * - A valid Stripe card enrollment
 *
 * Until staging is deployed with PR #1102, these tests will be skipped.
 */

import type {
  Address,
  AgentAPIAttributes,
  AgentMetadata,
  PlanMetadata,
} from '../../src/common/types.js'
import { ZeroAddress } from '../../src/environments.js'
import { Payments } from '../../src/payments.js'
import { getCryptoPriceConfig, getDynamicCreditsConfig } from '../../src/plans.js'
import { makeWaitForAgent, retryWithBackoff } from '../utils.js'
import { createPaymentsBuilder, createPaymentsSubscriber } from './fixtures.js'

// Test configuration
const TEST_TIMEOUT = 90_000

// Set global timeout for all tests in this file
jest.setTimeout(TEST_TIMEOUT)

// Skip these tests unless CARD_DELEGATION_E2E is explicitly enabled
const SKIP = !process.env.CARD_DELEGATION_E2E
const describeOrSkip = SKIP ? describe.skip : describe

describeOrSkip('X402 Card Delegation Flow', () => {
  let paymentsSubscriber: Payments
  let paymentsAgent: Payments
  let agentAddress: Address
  let planId: string
  let agentId: string
  let delegationId: string
  let x402AccessToken: string

  beforeAll(() => {
    paymentsSubscriber = createPaymentsSubscriber()
    paymentsAgent = createPaymentsBuilder()
    agentAddress = paymentsAgent.getAccountAddress() as Address
  })

  test('should create a fiat credits plan', async () => {
    const timestamp = new Date().toISOString()
    const planMetadata: PlanMetadata = {
      name: `E2E Card Delegation Plan ${timestamp}`,
      description: 'Test plan for card delegation integration',
    }

    const priceConfig = getCryptoPriceConfig(0n, agentAddress, ZeroAddress)
    const creditsConfig = getDynamicCreditsConfig(10n, 1n, 2n)

    const response = await retryWithBackoff(
      () => paymentsAgent.plans.registerCreditsPlan(planMetadata, priceConfig, creditsConfig),
      { label: 'Card Delegation Plan Registration', attempts: 6 },
    )

    expect(response).toBeDefined()
    planId = response.planId
    expect(planId).not.toBeNull()
    console.log(`Created card delegation plan with ID: ${planId}`)
  })

  test('should create an agent associated with the plan', async () => {
    const timestamp = new Date().toISOString()
    const agentMetadata: AgentMetadata = {
      name: `E2E Card Agent ${timestamp}`,
      description: 'Test agent for card delegation',
      tags: ['card-delegation', 'test'],
    }

    const agentApi: AgentAPIAttributes = {
      endpoints: [{ POST: 'http://localhost/ask' }],
      openEndpoints: [],
      agentDefinitionUrl: 'http://localhost/agent-definition',
      authType: 'bearer',
    }

    const result = await retryWithBackoff(
      () => paymentsAgent.agents.registerAgent(agentMetadata, agentApi, [planId]),
      { label: 'Card Agent Registration', attempts: 6 },
    )

    expect(result).toBeDefined()
    agentId = result.agentId
    expect(agentId).not.toBeNull()
    console.log(`Created card agent with ID: ${agentId}`)

    const waitForAgent = makeWaitForAgent((id) => paymentsAgent.agents.getAgent(id))
    await waitForAgent(agentId, 20_000, 1_000)
  })

  test('should create a card delegation (Stripe)', async () => {
    // This requires an enrolled card — get the first available payment method
    const cards = await paymentsSubscriber.delegation.listPaymentMethods()
    expect(cards.length).toBeGreaterThan(0)

    const card = cards[0]
    console.log(`Using card: ${card.brand} ...${card.last4}`)

    const delegation = await retryWithBackoff(
      () =>
        paymentsSubscriber.delegation.createDelegation({
          provider: 'stripe',
          providerPaymentMethodId: card.id,
          spendingLimitCents: 10000, // $100
          durationSecs: 604800, // 1 week
        }),
      { label: 'Stripe Delegation Creation', attempts: 3 },
    )

    expect(delegation).toBeDefined()
    expect(delegation.delegationId).toBeDefined()
    delegationId = delegation.delegationId
    console.log(`Created card delegation: ${delegationId}`)
  })

  test('should generate X402 access token with card delegation', async () => {
    const response = await retryWithBackoff(
      () =>
        paymentsSubscriber.x402.getX402AccessToken(planId, agentId, {
          scheme: 'nvm:card-delegation',
          delegationConfig: { delegationId },
        }),
      { label: 'Card Delegation Token Generation', attempts: 3 },
    )

    expect(response).toBeDefined()
    x402AccessToken = response.accessToken
    expect(x402AccessToken).not.toBeNull()
    expect(x402AccessToken.length).toBeGreaterThan(0)
    console.log(`Generated card delegation token (length: ${x402AccessToken.length})`)
  })

  test('should verify permissions with card delegation token', async () => {
    const paymentRequired = {
      x402Version: 2,
      resource: { url: '/test/endpoint' },
      accepts: [
        {
          scheme: 'nvm:card-delegation',
          network: 'stripe',
          planId,
          extra: { agentId },
        },
      ],
      extensions: {},
    }

    const response = await paymentsAgent.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken,
      maxAmount: 2n,
    })

    expect(response).toBeDefined()
    expect(response.isValid).toBe(true)
    console.log(`Card delegation verify response: ${JSON.stringify(response)}`)
  })
})
