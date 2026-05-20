/**
 * End-to-end tests for the X402 card-delegation flow against a Visa
 * Agentic-Tokens delegation.
 *
 * Intended to run **locally only**. The Visa delegation backing the
 * fixture has a finite `durationSecs` and refreshing it requires a manual
 * browser flow (VGS Collect iframe + WebAuthn passkey ceremony), so this
 * suite is not safe to enable in CI — once the delegation expires it
 * would start failing and block unrelated PRs. The suite is gated on two
 * env vars and is `describe.skip`'d when they aren't set, so CI without
 * the fixture stays green by default.
 *
 * Visa card enrolment and Visa delegation creation both require a real
 * browser, so the SDK cannot do either step programmatically. This suite
 * covers the *consume* side of the flow:
 *
 *   1. listPaymentMethods → find the visa-provider card.
 *   2. getX402AccessToken with the pre-created delegationId.
 *   3. verifyPermissions against the real backend.
 *
 * Settlement is intentionally NOT exercised: the sandbox card providers
 * (Stripe sandbox, Visa sandbox CMP) do not actually charge, so a real
 * settle assertion like `creditsRedeemed === '2'` cannot be made
 * truthful in this environment. End-to-end settlement is validated
 * separately at the platform level.
 *
 * Required env vars:
 *   - NVM_TEST_VISA_DELEGATION_ID       (uuid returned by /delegation/create)
 *   - NVM_TEST_VISA_PAYMENT_METHOD_ID   (Visa Agentic token id, format vat_…)
 *
 * Optional env vars (inherited from fixtures.ts):
 *   - TEST_SUBSCRIBER_API_KEY, TEST_BUILDER_API_KEY, TEST_ENVIRONMENT
 *
 * See TESTING.md → "Visa e2e fixture" for the one-time provisioning
 * runbook and a description of when to refresh the fixture.
 */

import type { Address, PlanMetadata } from '../../src/common/types.js'
import { Payments } from '../../src/payments.js'
import type { PaymentMethodSummary } from '../../src/x402/delegation-api.js'
import { getFiatPriceConfig, getDynamicCreditsConfig } from '../../src/plans.js'
import { retryWithBackoff } from '../utils.js'
import { createPaymentsBuilder, createPaymentsSubscriber } from './fixtures.js'

const TEST_TIMEOUT = 90_000
jest.setTimeout(TEST_TIMEOUT)

const VISA_DELEGATION_ID = process.env.NVM_TEST_VISA_DELEGATION_ID
const VISA_PAYMENT_METHOD_ID = process.env.NVM_TEST_VISA_PAYMENT_METHOD_ID

const describeIfVisa = VISA_DELEGATION_ID && VISA_PAYMENT_METHOD_ID ? describe : describe.skip

function findVisaCard(
  methods: PaymentMethodSummary[],
  paymentMethodId: string,
): PaymentMethodSummary | undefined {
  return methods.find((m) => m.provider === 'visa' && m.id === paymentMethodId)
}

describeIfVisa('X402 Card Delegation Flow (Visa)', () => {
  let paymentsSubscriber: Payments
  let paymentsAgent: Payments
  let agentAddress: Address
  let planId: string
  let x402AccessToken: string

  beforeAll(() => {
    paymentsSubscriber = createPaymentsSubscriber()
    paymentsAgent = createPaymentsBuilder()
    agentAddress = paymentsAgent.getAccountAddress() as Address
  })

  test('should create a fiat credits plan', async () => {
    const timestamp = new Date().toISOString()
    const planMetadata: PlanMetadata = {
      name: `E2E Visa Card Delegation Plan ${timestamp}`,
      description: 'Test plan for Visa card delegation integration',
    }

    const priceConfig = getFiatPriceConfig(1_000_000n, agentAddress)
    const creditsConfig = getDynamicCreditsConfig(10n, 1n, 2n)

    const response = await retryWithBackoff(
      () => paymentsAgent.plans.registerCreditsPlan(planMetadata, priceConfig, creditsConfig),
      { label: 'Visa Card Delegation Plan Registration', attempts: 6 },
    )

    expect(response).toBeDefined()
    planId = response.planId
    expect(planId).not.toBeNull()
    console.log(`Created Visa card delegation plan with ID: ${planId}`)
  })

  test('should list the pre-provisioned Visa payment method', async () => {
    const methods = await paymentsSubscriber.delegation.listPaymentMethods()
    const card = findVisaCard(methods, VISA_PAYMENT_METHOD_ID!)
    expect(card).toBeDefined()
    expect(card!.provider).toBe('visa')
    console.log(`Using Visa card: ${card!.brand} ...${card!.last4} (id: ${card!.id})`)
  })

  test('should generate X402 access token against the pre-created Visa delegation', async () => {
    const response = await retryWithBackoff(
      () =>
        paymentsSubscriber.x402.getX402AccessToken(planId, undefined, {
          scheme: 'nvm:card-delegation',
          network: 'visa',
          delegationConfig: { delegationId: VISA_DELEGATION_ID! },
        }),
      { label: 'Visa Token Generation', attempts: 3 },
    )

    expect(response).toBeDefined()
    x402AccessToken = response.accessToken
    expect(x402AccessToken).toBeTruthy()
    console.log(`Generated Visa delegation token (length: ${x402AccessToken.length})`)
  })

  test('should verify permissions with network: visa', async () => {
    const paymentRequired = {
      x402Version: 2,
      resource: { url: '/test/endpoint' },
      accepts: [{ scheme: 'nvm:card-delegation', network: 'visa', planId }],
      extensions: {},
    }

    const response = await retryWithBackoff(
      () =>
        paymentsAgent.facilitator.verifyPermissions({
          paymentRequired,
          x402AccessToken,
          maxAmount: 2n,
        }),
      { label: 'Visa Delegation Verify', attempts: 3 },
    )

    expect(response).toBeDefined()
    expect(response.isValid).toBe(true)
    expect(response.network).toBe('visa')
    console.log(`Visa verify: isValid=${response.isValid}, network=${response.network}`)
  })
})
