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
  PlanMetadata,
} from '../../src/common/types.js'
import { ZeroAddress } from '../../src/environments.js'
import { Payments } from '../../src/payments.js'
import type { PaymentMethodSummary } from '../../src/x402/delegation-api.js'
import { getCryptoPriceConfig, getDynamicCreditsConfig } from '../../src/plans.js'
import { retryWithBackoff, waitForCondition } from '../utils.js'
import { createPaymentsBuilder, createPaymentsSubscriber } from './fixtures.js'

// Test configuration
const TEST_TIMEOUT = 90_000

// Set global timeout for all tests in this file
jest.setTimeout(TEST_TIMEOUT)

// Skip these tests unless CARD_DELEGATION_E2E is explicitly enabled
const SKIP = !process.env.CARD_DELEGATION_E2E
const describeOrSkip = SKIP ? describe.skip : describe

/** Find the first payment method of type 'card' */
function findCard(methods: PaymentMethodSummary[]): PaymentMethodSummary | undefined {
  return methods.find((m) => m.type === 'card')
}

describeOrSkip('X402 Card Delegation Flow', () => {
  let paymentsSubscriber: Payments
  let paymentsAgent: Payments
  let agentAddress: Address
  let planId: string
  let delegationId: string
  let x402AccessToken: string

  beforeAll(() => {
    paymentsSubscriber = createPaymentsSubscriber()
    paymentsAgent = createPaymentsBuilder()
    agentAddress = paymentsAgent.getAccountAddress() as Address
  })

  test('should create a credits plan', async () => {
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

  test('should create a card delegation (Stripe) with explicit delegation', async () => {
    const methods = await paymentsSubscriber.delegation.listPaymentMethods()
    const card = findCard(methods)
    expect(card).toBeDefined()
    console.log(`Using card: ${card!.brand} ...${card!.last4}`)

    const delegation = await retryWithBackoff(
      () =>
        paymentsSubscriber.delegation.createDelegation({
          provider: 'stripe',
          providerPaymentMethodId: card!.id,
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

  test('should generate X402 access token with explicit delegationId (Pattern B)', async () => {
    const response = await retryWithBackoff(
      () =>
        paymentsSubscriber.x402.getX402AccessToken(planId, undefined, {
          scheme: 'nvm:card-delegation',
          delegationConfig: { delegationId },
        }),
      { label: 'Card Delegation Token Generation (explicit)', attempts: 3 },
    )

    expect(response).toBeDefined()
    x402AccessToken = response.accessToken
    expect(x402AccessToken).not.toBeNull()
    expect(x402AccessToken.length).toBeGreaterThan(0)
    console.log(`Generated card delegation token (length: ${x402AccessToken.length})`)
  })

  test('should generate X402 access token with auto-created delegation (Pattern A)', async () => {
    const methods = await paymentsSubscriber.delegation.listPaymentMethods()
    const card = findCard(methods)
    expect(card).toBeDefined()

    const response = await retryWithBackoff(
      () =>
        paymentsSubscriber.x402.getX402AccessToken(planId, undefined, {
          scheme: 'nvm:card-delegation',
          delegationConfig: {
            providerPaymentMethodId: card!.id,
            spendingLimitCents: 5000,
            durationSecs: 3600,
          },
        }),
      { label: 'Card Delegation Token Generation (auto)', attempts: 3 },
    )

    expect(response).toBeDefined()
    expect(response.accessToken).not.toBeNull()
    expect(response.accessToken.length).toBeGreaterThan(0)
    console.log(`Generated auto-delegation token (length: ${response.accessToken.length})`)
  })

  test('should verify permissions with card delegation token', async () => {
    const paymentRequired = {
      x402Version: 2,
      resource: { url: '/test/endpoint' },
      accepts: [{ scheme: 'nvm:card-delegation', network: 'stripe', planId }],
      extensions: {},
    }

    const response = await retryWithBackoff(
      () =>
        paymentsAgent.facilitator.verifyPermissions({
          paymentRequired,
          x402AccessToken,
          maxAmount: 2n,
        }),
      { label: 'Card Delegation Verify', attempts: 3 },
    )

    expect(response).toBeDefined()
    expect(response.isValid).toBe(true)
    console.log(`Card delegation verify response: ${JSON.stringify(response)}`)
  })

  test('should settle (burn credits) with card delegation token', async () => {
    const paymentRequired = {
      x402Version: 2,
      resource: { url: '/test/endpoint' },
      accepts: [{ scheme: 'nvm:card-delegation', network: 'stripe', planId }],
      extensions: {},
    }

    const response = await retryWithBackoff(
      () =>
        paymentsAgent.facilitator.settlePermissions({
          paymentRequired,
          x402AccessToken,
          maxAmount: 2n,
        }),
      { label: 'Card Delegation Settle', attempts: 3 },
    )

    expect(response).toBeDefined()
    expect(response.success).toBe(true)
    expect(response.creditsRedeemed).toBe('2')
    console.log(`Card delegation settle: creditsRedeemed=${response.creditsRedeemed}`)

    // Wait for balance to reflect settlement (should be 8 from 10)
    await waitForCondition(
      async () => {
        try {
          const balance = await paymentsSubscriber.plans.getPlanBalance(planId)
          if (!balance) return false
          const bal = BigInt(balance.balance)
          console.log(`Balance after card settle: ${bal}`)
          return bal === 8n
        } catch (e) {
          console.log(`Error checking balance: ${e}`)
          return false
        }
      },
      'Balance After Card Settlement',
      20_000,
      1_000,
    )
  })
})
