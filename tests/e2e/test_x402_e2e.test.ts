/**
 * End-to-end tests for X402 Access Token functionality with delegation flow.
 *
 * This test suite validates the X402 access token flow using delegations:
 * 1. Create plan + agent
 * 2. Create a crypto delegation
 * 3. Generate token with delegationId
 * 4. Verify + settle
 * 5. Reuse delegation for another token generation
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
import { isAccessTokenAlreadyUsed } from '../../src/x402/token-version.js'
import { makeWaitForAgent, retryWithBackoff, waitForCondition } from '../utils.js'
import { createPaymentsBuilder, createPaymentsSubscriber } from './fixtures.js'

// Test configuration
const TEST_TIMEOUT = 60_000

// Set global timeout for all tests in this file
jest.setTimeout(TEST_TIMEOUT)

describe('X402 Delegation Flow', () => {
  let paymentsSubscriber: Payments
  let paymentsAgent: Payments
  let subscriberAddress: Address
  let agentAddress: Address
  let planId: string
  let agentId: string
  let delegationId: string
  let x402AccessToken: string

  beforeAll(() => {
    // Initialize Payments instances
    paymentsSubscriber = createPaymentsSubscriber()
    paymentsAgent = createPaymentsBuilder()

    subscriberAddress = paymentsSubscriber.getAccountAddress() as Address
    agentAddress = paymentsAgent.getAccountAddress() as Address
  })

  test('should create a credits plan for X402 integration', async () => {
    expect(agentAddress).not.toBeNull()

    const timestamp = new Date().toISOString()
    const planMetadata: PlanMetadata = {
      name: `E2E X402 Credits Plan TYPESCRIPT ${timestamp}`,
      description: 'Test plan for X402 Delegation integration',
    }

    // Create a free crypto plan (amount = 0) for testing
    const priceConfig = getCryptoPriceConfig(0n, agentAddress, ZeroAddress) // Free plan

    // Configure credits: 10 total credits, min=1, max=2 per burn
    const creditsConfig = getDynamicCreditsConfig(10n, 1n, 2n)

    const response = await retryWithBackoff(
      () => paymentsAgent.plans.registerCreditsPlan(planMetadata, priceConfig, creditsConfig),
      {
        label: 'X402 Credits Plan Registration',
        attempts: 6,
      },
    )

    expect(response).toBeDefined()
    planId = response.planId
    expect(planId).not.toBeNull()
    expect(BigInt(planId) > 0n).toBeTruthy()
    console.log(`Created X402 Credits Plan with ID: ${planId}`)
  })

  test('should create an agent associated with the X402 plan', async () => {
    expect(planId).not.toBeNull()

    const timestamp = new Date().toISOString()
    const agentMetadata: AgentMetadata = {
      name: `E2E X402 Agent TYPESCRIPT ${timestamp}`,
      description: 'Test agent for X402 Delegation integration',
      tags: ['x402', 'delegation', 'test'],
    }

    const agentApi: AgentAPIAttributes = {
      endpoints: [
        {
          POST: 'https://myagent.ai/api/v1/secret/:agentId/tasks',
        },
      ],
      openEndpoints: [],
      agentDefinitionUrl: 'https://myagent.ai/api-docs',
      authType: 'bearer',
      token: 'my-secret-token',
    }

    const result = await retryWithBackoff(
      () => paymentsAgent.agents.registerAgent(agentMetadata, agentApi, [planId]),
      {
        label: 'X402 Agent Registration',
        attempts: 6,
      },
    )

    expect(result).toBeDefined()
    agentId = result.agentId
    expect(agentId).not.toBeNull()
    console.log(`Created X402 Agent with ID: ${agentId}`)

    // Wait for agent to be available
    const waitForAgent = makeWaitForAgent((id) => paymentsAgent.agents.getAgent(id))
    await waitForAgent(agentId, 20_000, 1_000)
  })

  test('should create a crypto delegation', async () => {
    const delegation = await retryWithBackoff(
      () =>
        paymentsSubscriber.delegation.createDelegation({
          provider: 'erc4337',
          spendingLimitCents: 100000, // $1000 USDC
          durationSecs: 604800, // 1 week
          currency: 'usdc',
        }),
      {
        label: 'Crypto Delegation Creation',
        attempts: 3,
      },
    )

    expect(delegation).toBeDefined()
    expect(delegation.delegationId).toBeDefined()
    delegationId = delegation.delegationId
    console.log(`Created crypto delegation with ID: ${delegationId}`)
  })

  test('should generate X402 access token using delegationId', async () => {
    expect(planId).not.toBeNull()
    expect(agentId).not.toBeNull()
    expect(delegationId).not.toBeNull()

    console.log(`Generating X402 Access Token for plan: ${planId}, agent: ${agentId}`)

    const response = await retryWithBackoff(
      () =>
        paymentsSubscriber.x402.getX402AccessToken(planId, agentId, {
          delegationConfig: { delegationId },
        }),
      {
        label: 'X402 Access Token Generation',
        attempts: 3,
      },
    )

    expect(response).toBeDefined()
    x402AccessToken = response.accessToken
    expect(x402AccessToken).not.toBeNull()
    expect(x402AccessToken.length).toBeGreaterThan(0)
    console.log(`Generated X402 Access Token (length: ${x402AccessToken.length})`)
  })

  test('should verify permissions using X402 access token', async () => {
    expect(planId).not.toBeNull()
    expect(x402AccessToken).not.toBeNull()

    console.log(`Verifying permissions for plan: ${planId}, max_amount: 2`)

    const paymentRequired = {
      x402Version: 2,
      resource: { url: '/test/endpoint' },
      accepts: [{ scheme: 'nvm:erc4337', network: 'eip155:84532', planId, extra: { agentId } }],
      extensions: {},
    }
    const response = await paymentsAgent.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken,
      maxAmount: 2n,
    })

    expect(response).toBeDefined()
    expect(response.isValid).toBe(true)
    console.log(`Verify permissions response: ${JSON.stringify(response)}`)
  })

  // Skipped: this free, delegation-based plan cannot be burned against on the
  // shared test account — settle answers `success: false` with
  // `errorReason: "Cannot order plan"` and a balance of 0, so neither the burn
  // nor the balance poll can be met. Re-enable once the test account can order
  // (or hold credits on) the plans these tests create.
  test.skip('should settle (burn) credits using X402 access token', async () => {
    expect(planId).not.toBeNull()
    expect(x402AccessToken).not.toBeNull()

    console.log(`Settling permissions for plan: ${planId}, max_amount: 2`)

    const paymentRequired = {
      x402Version: 2,
      resource: { url: '/test/endpoint' },
      accepts: [{ scheme: 'nvm:erc4337', network: 'eip155:84532', planId, extra: { agentId } }],
      extensions: {},
    }
    const response = await retryWithBackoff(
      () =>
        paymentsAgent.facilitator.settlePermissions({
          paymentRequired,
          x402AccessToken,
          maxAmount: 2n,
        }),
      {
        label: 'X402 Settle Permissions',
        attempts: 3,
      },
    )

    expect(response).toBeDefined()
    expect(response.success).toBe(true)
    expect(response.creditsRedeemed).toBe('2')
    console.log(`Settle permissions response: ${JSON.stringify(response)}`)
    console.log(`Credits redeemed: ${response.creditsRedeemed}`)

    // Wait for balance to be updated (should now be 8)
    await waitForCondition(
      async () => {
        try {
          const balance = await paymentsSubscriber.plans.getPlanBalance(planId)
          if (!balance) {
            return false
          }
          const bal = BigInt(balance.balance)
          console.log(`Current balance: ${bal}`)
          return bal === 8n
        } catch (e) {
          console.log(`Error checking balance: ${e}`)
          return false
        }
      },
      'Balance Update After Settlement',
      20_000,
      1_000,
    )
  })

  test('should reuse delegation for another token generation', async () => {
    expect(planId).not.toBeNull()
    expect(delegationId).not.toBeNull()

    // Generate a second token using the same delegation (demonstrates plan-agnostic reuse)
    const response = await retryWithBackoff(
      () =>
        paymentsSubscriber.x402.getX402AccessToken(planId, agentId, {
          delegationConfig: { delegationId },
        }),
      {
        label: 'X402 Access Token Reuse Delegation',
        attempts: 3,
      },
    )

    expect(response).toBeDefined()
    expect(response.accessToken).not.toBeNull()
    expect(response.accessToken.length).toBeGreaterThan(0)
    console.log('Successfully reused delegation for another token generation')
  })

  // --- Single-use, seller/resource-bound tokens (v3) ---
  //
  // v3 is opt-in and gated on the backend supporting it. A deployment that
  // predates nvm-monorepo#2646 DROPS `tokenVersion: 3` without an error and
  // mints v2, so these legs branch on the version detected from the returned
  // token — never on the version requested. Until staging carries the v3
  // struct they exercise the request path and log a skip.
  // Must be an endpoint the agent actually registers (see the agentApi above):
  // the backend checks the token's resource against the agent's endpoint
  // allowlist and answers "Endpoint not included in the agent api" for anything
  // else — before any v3 semantics are reached.
  const v3ResourceUrl = () => `https://myagent.ai/api/v1/secret/${agentId}/tasks`

  const v3PaymentRequired = () => ({
    x402Version: 2,
    resource: { url: v3ResourceUrl() },
    accepts: [
      {
        scheme: 'nvm:erc4337',
        network: 'eip155:84532',
        planId,
        extra: { agentId, httpVerb: 'POST' },
      },
    ],
    extensions: {},
  })

  const mintV3Token = async () => {
    const response = await retryWithBackoff(
      () =>
        paymentsSubscriber.x402.getX402AccessToken(planId, agentId, {
          delegationConfig: { delegationId },
          resource: { url: v3ResourceUrl() },
          httpVerb: 'POST',
          tokenVersion: 3,
        }),
      { label: 'X402 v3 Access Token Generation', attempts: 3 },
    )
    return response
  }

  test('should request a v3 token and report the version actually minted', async () => {
    expect(planId).not.toBeNull()
    expect(delegationId).not.toBeNull()

    const response = await mintV3Token()

    expect(response.accessToken).toBeDefined()
    expect(response.accessToken.length).toBeGreaterThan(0)

    // Independent oracle: decode the envelope here rather than calling
    // detectAccessTokenVersion, which is what produced `tokenVersion` in the
    // first place — comparing those two is f(x) === f(x) and holds however
    // wrong f is. The discriminator is a non-empty signed nonce.
    const authorization = JSON.parse(Buffer.from(response.accessToken, 'base64').toString('utf-8'))
      ?.payload?.authorization
    const carriesNonce = typeof authorization?.nonce === 'string' && authorization.nonce !== ''
    expect(response.tokenVersion).toBe(carriesNonce ? 3 : 2)
    console.log(`Backend minted a v${response.tokenVersion} token for a tokenVersion: 3 request`)

    if (response.tokenVersion === 3) {
      // The rest of the v3 binding is signed alongside the nonce.
      expect(authorization.resourceUrl).toBe(v3ResourceUrl())
      expect(authorization.httpVerb).toBe('POST')
      expect(authorization.agentId).toBe(agentId)
    }
  })

  test('a v3 token settles exactly once; a second settle reports BCK.X402.0059', async () => {
    expect(planId).not.toBeNull()
    expect(delegationId).not.toBeNull()

    const { accessToken, tokenVersion } = await mintV3Token()

    if (tokenVersion !== 3) {
      console.log(
        'Skipping single-use assertions: this backend does not support token v3 yet ' +
          '(tokenVersion was stripped and a v2 token was minted).',
      )
      return
    }

    const paymentRequired = v3PaymentRequired()

    // verify() never consumes the token — it stays repeatable.
    const firstVerify = await paymentsAgent.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken: accessToken,
      maxAmount: 1n,
    })
    expect(firstVerify.isValid).toBe(true)
    const secondVerify = await paymentsAgent.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken: accessToken,
      maxAmount: 1n,
    })
    expect(secondVerify.isValid).toBe(true)

    // settle() consumes it.
    const settlement = await paymentsAgent.facilitator.settlePermissions({
      paymentRequired,
      x402AccessToken: accessToken,
      maxAmount: 1n,
    })
    console.log(`v3 settle #1: ${JSON.stringify(settlement)}`)
    // Asserted, not skipped: single-use only exists downstream of a settle that
    // burned, so a settle that does not burn must fail this test rather than
    // let it pass green having verified nothing. (This used to return early to
    // survive the `Cannot order plan` wall — nvm-monorepo#3296, fixed.)
    expect(settlement.success).toBe(true)

    // The second settle must be refused as spent — not retried, not accepted.
    // Deliberately NOT wrapped in retryWithBackoff: a replay is exactly what
    // must not be retried.
    const replayError = await paymentsAgent.facilitator
      .settlePermissions({
        paymentRequired,
        x402AccessToken: accessToken,
        maxAmount: 1n,
      })
      .then(() => null)
      .catch((error) => error)

    expect(replayError).not.toBeNull()
    expect(isAccessTokenAlreadyUsed(replayError)).toBe(true)
    expect(String(replayError.message)).toContain('mint a new token')
  })

  test('should generate X402 access token with auto-created delegation (Pattern A)', async () => {
    expect(planId).not.toBeNull()

    const response = await retryWithBackoff(
      () =>
        paymentsSubscriber.x402.getX402AccessToken(planId, agentId, {
          delegationConfig: {
            spendingLimitCents: 50000,
            durationSecs: 3600,
            currency: 'usdc',
          },
        }),
      {
        label: 'X402 Access Token Auto-Delegation',
        attempts: 3,
      },
    )

    expect(response).toBeDefined()
    expect(response.accessToken).not.toBeNull()
    expect(response.accessToken.length).toBeGreaterThan(0)
    console.log('Successfully generated token with auto-created delegation')
  })

  // Skipped: same settle vs get-plan-balance discrepancy as above (settle
  // succeeds; getPlanBalance() stays 0 on the rotated staging account).
  test.skip('should settle the remaining credits in smaller amounts', async () => {
    expect(planId).not.toBeNull()
    expect(x402AccessToken).not.toBeNull()

    // Settle 2 more credits (should have 6 remaining after previous settlement)
    console.log('Settling 2 more credits...')
    const paymentRequired = {
      x402Version: 2,
      resource: { url: '/test/endpoint' },
      accepts: [{ scheme: 'nvm:erc4337', network: 'eip155:84532', planId, extra: { agentId } }],
      extensions: {},
    }
    const response = await retryWithBackoff(
      () =>
        paymentsAgent.facilitator.settlePermissions({
          paymentRequired,
          x402AccessToken,
          maxAmount: 2n,
        }),
      {
        label: 'X402 Settle Additional Credits',
        attempts: 3,
      },
    )

    expect(response).toBeDefined()
    expect(response.success).toBe(true)
    expect(response.creditsRedeemed).toBe('2')
    console.log('Successfully redeemed 2 more credits')

    // Wait for balance to be updated (should now be 6)
    await waitForCondition(
      async () => {
        try {
          const balance = await paymentsSubscriber.plans.getPlanBalance(planId)
          if (!balance) {
            return false
          }
          const bal = BigInt(balance.balance)
          console.log(`Final balance: ${bal}`)
          return bal === 6n
        } catch (e) {
          console.log(`Error checking final balance: ${e}`)
          return false
        }
      },
      'Final Balance After Additional Settlement',
      20_000,
      1_000,
    )
    console.log('X402 E2E test suite completed successfully!')
  })
})
