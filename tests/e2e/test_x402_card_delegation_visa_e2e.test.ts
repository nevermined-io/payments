/**
 * End-to-end tests for the X402 card-delegation flow against a Visa
 * Agentic-Tokens delegation.
 *
 * Intended to run **locally only**. The Visa delegation backing the
 * fixture has a finite `durationSecs` and refreshing it requires a manual
 * browser flow (VGS Collect iframe + WebAuthn passkey ceremony), so this
 * suite is not safe to enable in CI — once the delegation expires it
 * would start failing and block unrelated PRs. The suite is gated on the
 * three env vars below and is `describe.skip`'d when any are missing, so
 * CI without the fixture stays green by default.
 *
 * Visa card enrolment and Visa delegation creation both require a real
 * browser, so the SDK cannot do either step programmatically. The plan
 * itself also has to exist beforehand — the backend binds each Visa
 * delegation to a single plan at creation time (BCK.VISA.0015) and
 * rejects a mismatch between delegation.planId and the planId used to
 * mint or verify the access token. So the suite creates nothing: it
 * exercises only the *consume* side of an already-provisioned plan +
 * card + delegation triple:
 *
 *   1. listPaymentMethods → find the visa-provider card.
 *   2. getX402AccessToken using the pre-created delegationId + planId.
 *   3. verifyPermissions against the real backend.
 *
 * Settlement is intentionally NOT exercised: the sandbox card providers
 * (Stripe sandbox, Visa sandbox CMP) do not actually charge, so a real
 * settle assertion like `creditsRedeemed === '2'` cannot be made
 * truthful in this environment. End-to-end settlement is validated
 * separately at the platform level.
 *
 * Required env vars:
 *   - NVM_TEST_VISA_PLAN_ID             (plan id the delegation is bound
 *                                        to, created by the builder
 *                                        whose key is TEST_BUILDER_API_KEY)
 *   - NVM_TEST_VISA_DELEGATION_ID       (uuid returned by /delegation/create)
 *   - NVM_TEST_VISA_PAYMENT_METHOD_ID   (Visa Agentic token id, format vat_…)
 *
 * Optional env vars (inherited from fixtures.ts):
 *   - TEST_SUBSCRIBER_API_KEY, TEST_BUILDER_API_KEY, TEST_ENVIRONMENT
 *
 * See TESTING.md → "Visa e2e fixture" for the one-time provisioning
 * runbook and when to refresh the fixture.
 */

import { Payments } from '../../src/payments.js'
import type { PaymentMethodSummary } from '../../src/x402/delegation-api.js'
import { retryWithBackoff } from '../utils.js'
import { createPaymentsBuilder, createPaymentsSubscriber } from './fixtures.js'

const TEST_TIMEOUT = 90_000
jest.setTimeout(TEST_TIMEOUT)

const VISA_PLAN_ID = process.env.NVM_TEST_VISA_PLAN_ID
const VISA_DELEGATION_ID = process.env.NVM_TEST_VISA_DELEGATION_ID
const VISA_PAYMENT_METHOD_ID = process.env.NVM_TEST_VISA_PAYMENT_METHOD_ID

// Truthiness alone is not enough: silently skipping when only some of
// the env vars are set hides developer typos. Same for malformed values
// like `NVM_TEST_VISA_DELEGATION_ID=TODO` — those would slip through and
// fail on the API call instead of at gate time.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VAT_RE = /^vat_/
const PLAN_ID_RE = /^[0-9]+$/

const allOrNone = [VISA_PLAN_ID, VISA_DELEGATION_ID, VISA_PAYMENT_METHOD_ID]
const setCount = allOrNone.filter(Boolean).length
if (setCount > 0 && setCount < allOrNone.length) {
  console.warn(
    '[visa e2e] only some of NVM_TEST_VISA_{PLAN_ID,DELEGATION_ID,PAYMENT_METHOD_ID} are set — all three are required. Skipping.',
  )
}

const planLooksValid = !!VISA_PLAN_ID && PLAN_ID_RE.test(VISA_PLAN_ID)
const delegationLooksValid = !!VISA_DELEGATION_ID && UUID_RE.test(VISA_DELEGATION_ID)
const paymentMethodLooksValid = !!VISA_PAYMENT_METHOD_ID && VAT_RE.test(VISA_PAYMENT_METHOD_ID)
if (VISA_PLAN_ID && !planLooksValid) {
  console.warn(`[visa e2e] NVM_TEST_VISA_PLAN_ID is not a decimal uint256 — skipping.`)
}
if (VISA_DELEGATION_ID && !delegationLooksValid) {
  console.warn(`[visa e2e] NVM_TEST_VISA_DELEGATION_ID is not a UUID — skipping.`)
}
if (VISA_PAYMENT_METHOD_ID && !paymentMethodLooksValid) {
  console.warn(`[visa e2e] NVM_TEST_VISA_PAYMENT_METHOD_ID does not start with 'vat_' — skipping.`)
}

const describeIfVisa =
  planLooksValid && delegationLooksValid && paymentMethodLooksValid ? describe : describe.skip

function findVisaCard(
  methods: PaymentMethodSummary[],
  paymentMethodId: string,
): PaymentMethodSummary | undefined {
  return methods.find((m) => m.provider === 'visa' && m.id === paymentMethodId)
}

describeIfVisa('X402 Card Delegation Flow (Visa)', () => {
  let paymentsSubscriber: Payments
  let paymentsAgent: Payments
  let x402AccessToken: string

  beforeAll(() => {
    paymentsSubscriber = createPaymentsSubscriber()
    paymentsAgent = createPaymentsBuilder()
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
        paymentsSubscriber.x402.getX402AccessToken(VISA_PLAN_ID!, undefined, {
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
      accepts: [{ scheme: 'nvm:card-delegation', network: 'visa', planId: VISA_PLAN_ID! }],
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
