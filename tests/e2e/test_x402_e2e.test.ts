/**
 * End-to-end tests for X402 Access Token functionality.
 *
 * This test suite validates the X402 access token flow which allows AI agents
 * to verify and settle permissions on behalf of subscribers using delegated session keys.
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
import { makeWaitForAgent, retryWithBackoff, waitForCondition } from '../utils.js'
import { createPaymentsBuilder, createPaymentsSubscriber } from './fixtures.js'

// Test configuration
const TEST_TIMEOUT = 60_000

// Set global timeout for all tests in this file
jest.setTimeout(TEST_TIMEOUT)

describe('X402 Access Token Flow', () => {
  let paymentsSubscriber: Payments
  let paymentsAgent: Payments
  let subscriberAddress: Address
  let agentAddress: Address
  let planId: string
  let agentId: string
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
      description: 'Test plan for X402 Access Token integration',
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
      description: 'Test agent for X402 Access Token integration',
      tags: ['x402', 'test'],
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

  test('should generate X402 access token for the subscriber', async () => {
    expect(planId).not.toBeNull()
    expect(agentId).not.toBeNull()

    console.log(`Generating X402 Access Token for plan: ${planId}, agent: ${agentId}`)

    const response = await retryWithBackoff(
      () => paymentsSubscriber.x402.getX402AccessToken(planId, agentId),
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
    expect(subscriberAddress).not.toBeNull()

    console.log(
      `Verifying permissions for plan: ${planId}, max_amount: 2, subscriber: ${subscriberAddress}`,
    )

    const response = await paymentsAgent.facilitator.verifyPermissions({
      planId,
      maxAmount: 2n,
      x402AccessToken,
      subscriberAddress,
      agentId,
      endpoint: `https://myagent.ai/api/v1/secret/${agentId}/tasks`,
      httpVerb: 'POST',
    })

    expect(response).toBeDefined()
    expect(response.success).toBe(true)
    console.log(`Verify permissions response: ${JSON.stringify(response)}`)
  })

  test('should settle (burn) credits using X402 access token', async () => {
    expect(planId).not.toBeNull()
    expect(x402AccessToken).not.toBeNull()
    expect(subscriberAddress).not.toBeNull()

    console.log(
      `Settling permissions for plan: ${planId}, max_amount: 2, subscriber: ${subscriberAddress}`,
    )

    const response = await retryWithBackoff(
      () =>
        paymentsAgent.facilitator.settlePermissions({
          planId,
          maxAmount: 2n,
          x402AccessToken,
          subscriberAddress,
          agentId,
          endpoint: `https://myagent.ai/api/v1/secret/${agentId}/tasks`,
          httpVerb: 'POST',
        }),
      {
        label: 'X402 Settle Permissions',
        attempts: 3,
      },
    )

    expect(response).toBeDefined()
    expect(response.success).toBe(true)
    expect(response.data).toBeDefined()
    expect(response.data.creditsBurned).toBe('2')
    console.log(`Settle permissions response: ${JSON.stringify(response)}`)
    console.log(`Credits burned: ${response.data.creditsBurned}`)

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

  test('should settle the remaining credits in smaller amounts', async () => {
    expect(planId).not.toBeNull()
    expect(x402AccessToken).not.toBeNull()
    expect(subscriberAddress).not.toBeNull()

    // Settle 2 more credits (should have 6 remaining after previous settlement)
    console.log('Settling 2 more credits...')
    const response = await retryWithBackoff(
      () =>
        paymentsAgent.facilitator.settlePermissions({
          planId,
          maxAmount: 2n,
          x402AccessToken,
          subscriberAddress,
          agentId,
          endpoint: `https://myagent.ai/api/v1/secret/${agentId}/tasks`,
          httpVerb: 'POST',
        }),
      {
        label: 'X402 Settle Additional Credits',
        attempts: 3,
      },
    )

    expect(response).toBeDefined()
    expect(response.success).toBe(true)
    expect(response.data.creditsBurned).toBe('2')
    console.log('Successfully burned 2 more credits')

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
