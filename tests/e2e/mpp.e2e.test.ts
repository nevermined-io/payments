/**
 * Staging e2e. MPP is enabled per deployment (`MPP_SECRET_KEY` + `MPP_REALM`),
 * so this suite probes the challenge route first. When the environment answers
 * `BCK.MPP.0002` (MPP not configured — nvm-monorepo#2645) the test body
 * returns without exercising anything, but `expect.hasAssertions()` still
 * fails it: a bare no-op run must never read as a silent pass in CI. Any
 * other `beforeAll` failure (e.g. the MPP routes being entirely absent from
 * the deployment) already fails the suite on its own.
 */
import { Payments } from '../../src/payments.js'
import { MppNotConfiguredError } from '../../src/mpp/errors.js'

const subscriberKey = process.env.TEST_SUBSCRIBER_API_KEY!
const builderKey = process.env.TEST_BUILDER_API_KEY!
const environment = process.env.TEST_ENVIRONMENT as any
const planId = process.env.TEST_PLAN_ID!
const delegationId = process.env.TEST_DELEGATION_ID!

describe('MPP end to end', () => {
  const builder = Payments.getInstance({ nvmApiKey: builderKey, environment })
  const subscriber = Payments.getInstance({ nvmApiKey: subscriberKey, environment })
  let mppEnabled = true

  beforeAll(async () => {
    try {
      await builder.mpp.issueChallenge({
        planId,
        credits: '1',
        resource: '/ask',
        httpVerb: 'POST',
      })
    } catch (error) {
      if (error instanceof MppNotConfiguredError) {
        mppEnabled = false
        console.warn('MPP is not configured on this environment — skipping the MPP e2e suite')
        return
      }
      throw error
    }
  })

  it('burns credits for a credential minted from an existing delegation', async () => {
    // A self-skip must not read as a silent pass in CI: require at least one
    // assertion, so a run that returns early because MPP is not configured
    // fails loudly instead of blending in with a real pass. A genuine failure
    // in beforeAll (anything other than MppNotConfiguredError, e.g. the MPP
    // routes being entirely absent from the deployment) already fails the
    // suite on its own and never reaches this point.
    expect.hasAssertions()
    if (!mppEnabled) return

    const { challenge } = await builder.mpp.issueChallenge({
      planId,
      credits: '1',
      resource: '/ask',
      httpVerb: 'POST',
    })
    const { parseChallengeHeader, buildCredentialHeader } = await import('../../src/mpp/codec.js')
    const parsed = parseChallengeHeader(challenge)!
    const { accessToken } = await subscriber.mpp.getMppAccessToken(planId, undefined, {
      delegationConfig: { delegationId },
    })
    const credential = buildCredentialHeader(parsed, { accessToken })

    const verification = await builder.mpp.verifyCredential({
      credential,
      resource: '/ask',
      httpVerb: 'POST',
    })
    expect(verification.isValid).toBe(true)

    const settlement = await builder.mpp.settleCredential({
      credential,
      resource: '/ask',
      httpVerb: 'POST',
    })
    expect(settlement.success).toBe(true)
    expect(settlement.paymentReceipt).toBeTruthy()
  })
})
