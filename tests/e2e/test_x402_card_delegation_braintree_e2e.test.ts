/**
 * End-to-end tests for X402 card-delegation flow (Braintree).
 *
 * These tests require:
 * - A running API with Braintree credentials configured
 * - A Braintree-enrolled payment method for the subscriber account
 * - A Braintree-connected merchant (seller) for the agent account
 */

import type { Address, PlanMetadata } from '../../src/common/types.js'
import { Payments } from '../../src/payments.js'
import type { PaymentMethodSummary } from '../../src/x402/delegation-api.js'
import { getFiatPriceConfig, getDynamicCreditsConfig } from '../../src/plans.js'
import { retryWithBackoff, waitForCondition } from '../utils.js'
import { createPaymentsBuilder, createPaymentsSubscriber } from './fixtures.js'

const TEST_TIMEOUT = 90_000
jest.setTimeout(TEST_TIMEOUT)

/** Find the first Braintree payment method */
function findBraintreeMethod(methods: PaymentMethodSummary[]): PaymentMethodSummary | undefined {
  return methods.find((m) => m.provider === 'braintree')
}

describe('X402 Card Delegation Flow (Braintree)', () => {
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

  test('should create a fiat credits plan', async () => {
    const timestamp = new Date().toISOString()
    const planMetadata: PlanMetadata = {
      name: `E2E Braintree Card Delegation Plan ${timestamp}`,
      description: 'Test plan for Braintree card delegation integration',
    }

    // Fiat plan (isCrypto=false): 1000000 = $1.00 in USDC 6-decimal format
    const priceConfig = getFiatPriceConfig(1_000_000n, agentAddress)
    const creditsConfig = getDynamicCreditsConfig(10n, 1n, 2n)

    const response = await retryWithBackoff(
      () => paymentsAgent.plans.registerCreditsPlan(planMetadata, priceConfig, creditsConfig),
      { label: 'Braintree Card Delegation Plan Registration', attempts: 6 },
    )

    expect(response).toBeDefined()
    planId = response.planId
    expect(planId).not.toBeNull()
    console.log(`Created Braintree card delegation plan with ID: ${planId}`)
  })

  test('should find a Braintree payment method', async () => {
    const methods = await paymentsSubscriber.delegation.listPaymentMethods()
    const pm = findBraintreeMethod(methods)
    expect(pm).toBeDefined()
    console.log(
      `Found Braintree payment method: ${pm!.brand} ${pm!.last4} (provider: ${pm!.provider})`,
    )
  })

  test('should create a delegation with Braintree payment method', async () => {
    const methods = await paymentsSubscriber.delegation.listPaymentMethods()
    const pm = findBraintreeMethod(methods)
    expect(pm).toBeDefined()

    const delegation = await retryWithBackoff(
      () =>
        paymentsSubscriber.delegation.createDelegation({
          provider: 'braintree',
          providerPaymentMethodId: pm!.id,
          spendingLimitCents: 10000,
          durationSecs: 604800,
        }),
      { label: 'Braintree Delegation Creation', attempts: 3 },
    )

    expect(delegation).toBeDefined()
    expect(delegation.delegationId).toBeDefined()
    delegationId = delegation.delegationId
    console.log(`Created Braintree delegation: ${delegationId}`)
  })

  test('should generate X402 access token with explicit delegationId', async () => {
    const response = await retryWithBackoff(
      () =>
        paymentsSubscriber.x402.getX402AccessToken(planId, undefined, {
          scheme: 'nvm:card-delegation',
          network: 'braintree',
          delegationConfig: { delegationId },
        }),
      { label: 'Braintree Token Generation', attempts: 3 },
    )

    expect(response).toBeDefined()
    x402AccessToken = response.accessToken
    expect(x402AccessToken).not.toBeNull()
    expect(x402AccessToken.length).toBeGreaterThan(0)
    console.log(`Generated Braintree delegation token (length: ${x402AccessToken.length})`)
  })

  test('should verify permissions with network: braintree', async () => {
    const paymentRequired = {
      x402Version: 2,
      resource: { url: '/test/endpoint' },
      accepts: [{ scheme: 'nvm:card-delegation', network: 'braintree', planId }],
      extensions: {},
    }

    const response = await retryWithBackoff(
      () =>
        paymentsAgent.facilitator.verifyPermissions({
          paymentRequired,
          x402AccessToken,
          maxAmount: 2n,
        }),
      { label: 'Braintree Delegation Verify', attempts: 3 },
    )

    expect(response).toBeDefined()
    expect(response.isValid).toBe(true)
    expect(response.network).toBe('braintree')
    console.log(`Braintree verify: isValid=${response.isValid}, network=${response.network}`)
  })

  test('should settle (burn credits) via Braintree Shared Vault', async () => {
    const paymentRequired = {
      x402Version: 2,
      resource: { url: '/test/endpoint' },
      accepts: [{ scheme: 'nvm:card-delegation', network: 'braintree', planId }],
      extensions: {},
    }

    const response = await retryWithBackoff(
      () =>
        paymentsAgent.facilitator.settlePermissions({
          paymentRequired,
          x402AccessToken,
          maxAmount: 2n,
        }),
      { label: 'Braintree Delegation Settle', attempts: 3 },
    )

    expect(response).toBeDefined()
    expect(response.success).toBe(true)
    expect(response.creditsRedeemed).toBe('2')
    expect(response.network).toBe('braintree')
    console.log(`Braintree settle: creditsRedeemed=${response.creditsRedeemed}`)

    await waitForCondition(
      async () => {
        try {
          const balance = await paymentsSubscriber.plans.getPlanBalance(planId)
          if (!balance) return false
          const bal = BigInt(balance.balance)
          console.log(`Balance after Braintree settle: ${bal}`)
          return bal === 8n
        } catch (e) {
          console.log(`Error checking balance: ${e}`)
          return false
        }
      },
      'Balance After Braintree Settlement',
      20_000,
      1_000,
    )
  })
})
