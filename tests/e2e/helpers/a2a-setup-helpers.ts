/**
 * @file A2A Setup Helpers
 * @description Utilities for setting up agents and plans for A2A E2E tests
 */

import type { Payments } from '../../../src/payments.js'
import type { AgentMetadata, PlanMetadata } from '../../../src/common/types.js'
import type { Address } from '../../../src/common/types.js'
import { getERC20PriceConfig, getFixedCreditsConfig } from '../../../src/plans.js'

const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address

/**
 * Configuration for A2A E2E test setup
 */
export interface A2ATestSetupConfig {
  /** Port where the A2A server will run */
  port: number
  /** Base path for the A2A server */
  basePath?: string
  /** Number of credits to grant in the plan */
  creditsGranted?: bigint
  /** Credits per request */
  creditsPerRequest?: bigint
}

/**
 * Result of setting up an A2A test agent and plan
 */
export interface A2ATestSetupResult {
  /** The created agent ID */
  agentId: string
  /** The created plan ID */
  planId: string
  /** The base URL for the A2A server */
  serverBaseUrl: string
}

const getRandomBigInt = (min: bigint, max: bigint): bigint => {
  return BigInt(Math.floor(Math.random() * (Number(max) - Number(min) + 1)) + Number(min))
}

/**
 * Creates an agent and plan for A2A E2E tests
 *
 * @param paymentsBuilder - Payments instance with builder permissions
 * @param config - Configuration for the test setup
 * @returns The agent ID, plan ID, and server base URL
 */
export async function createA2ATestAgentAndPlan(
  paymentsBuilder: Payments,
  config: A2ATestSetupConfig,
): Promise<A2ATestSetupResult> {
  const { port, basePath = '/a2a/', creditsPerRequest = 1n } = config

  const builderAddress = paymentsBuilder.getAccountAddress() as Address
  const timestamp = new Date().toISOString()

  // Create plan metadata
  const planMetadata: PlanMetadata = {
    name: `A2A E2E Test Plan ${timestamp}`,
    description: `Payment plan for A2A E2E tests ${timestamp}`,
    isTrialPlan: false,
  }

  // Create agent metadata
  const agentMetadata: AgentMetadata = {
    name: `A2A E2E Test Agent ${timestamp}`,
    description: `Agent for A2A E2E tests ${timestamp}`,
    tags: ['a2a', 'e2e', 'test'],
  }

  // Create agent API with A2A endpoint
  const serverBaseUrl = `http://localhost:${port}${basePath}`
  const agentDefinitionUrl = `${serverBaseUrl}.well-known/agent.json`
  const agentApi = {
    endpoints: [{ POST: serverBaseUrl }],
    agentDefinitionUrl: agentDefinitionUrl,
  }

  // Use random price and credits for tests (random between 1 and 1000)
  const price = getRandomBigInt(1n, 1000n)
  const creditsGranted = getRandomBigInt(1n, 1000n)

  const priceConfig = getERC20PriceConfig(price, ERC20_ADDRESS, builderAddress)

  // Create credits config
  const creditsConfig = getFixedCreditsConfig(creditsGranted, creditsPerRequest)

  // First, register the plan
  const planResult = await paymentsBuilder.plans.registerCreditsPlan(
    planMetadata,
    priceConfig,
    creditsConfig,
  )

  const planId = planResult.planId

  // Then, register the agent with the created plan
  const agentResult = await paymentsBuilder.agents.registerAgent(agentMetadata, agentApi, [planId])

  const agentId = agentResult.agentId

  console.log(`✅ Created A2A test agent and plan - Agent ID: ${agentId}, Plan ID: ${planId}`)

  return {
    agentId,
    planId,
    serverBaseUrl,
  }
}
