/**
 * Staging e2e. MPP is enabled per deployment (`MPP_SECRET_KEY` + `MPP_REALM`),
 * so this suite probes the challenge route first and skips itself when the
 * environment answers `BCK.MPP.0002` — see nvm-monorepo#2645.
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
