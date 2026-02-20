import type { Payments } from '@nevermined-io/payments'
import type { NeverminedPluginConfig } from './config.js'

export interface ToolParam {
  name: string
  type: string
  description: string
  required: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  params: ToolParam[]
  handler: (
    payments: Payments,
    config: NeverminedPluginConfig,
    params: Record<string, unknown>,
  ) => Promise<unknown>
}

function requireParam(params: Record<string, unknown>, name: string): string {
  const value = params[name]
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required parameter: ${name}`)
  }
  return String(value)
}

function optionalParam(
  params: Record<string, unknown>,
  name: string,
  fallback?: string,
): string | undefined {
  const value = params[name]
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  return String(value)
}

// --- Subscriber tools ---

const checkBalance: ToolDefinition = {
  name: 'nevermined.checkBalance',
  description: 'Check the credit balance for a Nevermined payment plan',
  params: [
    { name: 'planId', type: 'string', description: 'The payment plan ID', required: false },
  ],
  handler: async (payments, config, params) => {
    const planId = optionalParam(params, 'planId', config.planId)
    if (!planId) {
      throw new Error('planId is required — provide it as a parameter or in the plugin config')
    }
    const balance = await payments.plans.getPlanBalance(planId)
    return {
      planId: balance.planId,
      planName: balance.planName,
      balance: balance.balance.toString(),
      isSubscriber: balance.isSubscriber,
    }
  },
}

const getAccessToken: ToolDefinition = {
  name: 'nevermined.getAccessToken',
  description: 'Get an x402 access token for authenticating requests to a Nevermined agent',
  params: [
    { name: 'planId', type: 'string', description: 'The payment plan ID', required: false },
    { name: 'agentId', type: 'string', description: 'The agent ID', required: false },
  ],
  handler: async (payments, config, params) => {
    const planId = optionalParam(params, 'planId', config.planId)
    if (!planId) {
      throw new Error('planId is required — provide it as a parameter or in the plugin config')
    }
    const agentId = optionalParam(params, 'agentId', config.agentId)
    const result = await payments.x402.getX402AccessToken(planId, agentId)
    return { accessToken: result.accessToken }
  },
}

const orderPlan: ToolDefinition = {
  name: 'nevermined.orderPlan',
  description: 'Order (purchase) a Nevermined payment plan',
  params: [
    { name: 'planId', type: 'string', description: 'The payment plan ID to order', required: false },
  ],
  handler: async (payments, config, params) => {
    const planId = optionalParam(params, 'planId', config.planId)
    if (!planId) {
      throw new Error('planId is required — provide it as a parameter or in the plugin config')
    }
    const result = await payments.plans.orderPlan(planId)
    return result
  },
}

const queryAgent: ToolDefinition = {
  name: 'nevermined.queryAgent',
  description:
    'Query a Nevermined AI agent end-to-end: acquires an x402 access token, sends the prompt to the agent, and returns the response',
  params: [
    { name: 'agentUrl', type: 'string', description: 'The URL of the agent to query', required: true },
    { name: 'prompt', type: 'string', description: 'The prompt to send to the agent', required: true },
    { name: 'planId', type: 'string', description: 'The payment plan ID', required: false },
    { name: 'agentId', type: 'string', description: 'The agent ID', required: false },
    { name: 'method', type: 'string', description: 'HTTP method (default: POST)', required: false },
  ],
  handler: async (payments, config, params) => {
    const agentUrl = requireParam(params, 'agentUrl')
    const prompt = requireParam(params, 'prompt')
    const planId = optionalParam(params, 'planId', config.planId)
    if (!planId) {
      throw new Error('planId is required — provide it as a parameter or in the plugin config')
    }
    const agentId = optionalParam(params, 'agentId', config.agentId)
    const method = optionalParam(params, 'method', 'POST') ?? 'POST'

    const { accessToken } = await payments.x402.getX402AccessToken(planId, agentId)

    const response = await fetch(agentUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': accessToken,
      },
      body: method !== 'GET' ? JSON.stringify({ prompt }) : undefined,
    })

    if (response.status === 402) {
      return {
        error: 'Payment required — insufficient credits. Order the plan first using nevermined.orderPlan.',
        status: 402,
      }
    }

    if (!response.ok) {
      return {
        error: `Agent returned HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
      }
    }

    const body = await response.json()
    return body
  },
}

// --- Builder tools ---

const registerAgent: ToolDefinition = {
  name: 'nevermined.registerAgent',
  description: 'Register a new AI agent with an associated payment plan on Nevermined',
  params: [
    { name: 'name', type: 'string', description: 'Agent name', required: true },
    { name: 'description', type: 'string', description: 'Agent description', required: false },
    { name: 'agentUrl', type: 'string', description: 'The endpoint URL for the agent', required: true },
    { name: 'planName', type: 'string', description: 'Name for the payment plan', required: true },
    { name: 'priceAmounts', type: 'string', description: 'Comma-separated price amounts in wei', required: true },
    { name: 'priceReceivers', type: 'string', description: 'Comma-separated receiver addresses', required: true },
    { name: 'creditsAmount', type: 'number', description: 'Number of credits in the plan', required: true },
  ],
  handler: async (payments, _config, params) => {
    const name = requireParam(params, 'name')
    const description = optionalParam(params, 'description', '')
    const agentUrl = requireParam(params, 'agentUrl')
    const planName = requireParam(params, 'planName')
    const priceAmounts = requireParam(params, 'priceAmounts')
      .split(',')
      .map((s) => BigInt(s.trim()))
    const priceReceivers = requireParam(params, 'priceReceivers')
      .split(',')
      .map((s) => s.trim())
    const creditsAmount = Number(requireParam(params, 'creditsAmount'))

    const result = await payments.agents.registerAgentAndPlan(
      { name, description },
      {
        endpoints: [{ POST: agentUrl }],
        agentDefinitionUrl: agentUrl,
      },
      { name: planName },
      {
        amounts: priceAmounts,
        receivers: priceReceivers,
        isCrypto: true,
      },
      {
        isRedemptionAmountFixed: true,
        redemptionType: 4, // ONLY_SUBSCRIBER
        proofRequired: false,
        durationSecs: 0n,
        amount: BigInt(creditsAmount),
        minAmount: 1n,
        maxAmount: BigInt(creditsAmount),
      },
    )

    return {
      agentId: result.agentId,
      planId: result.planId,
      txHash: result.txHash,
    }
  },
}

const createPlan: ToolDefinition = {
  name: 'nevermined.createPlan',
  description: 'Create a new payment plan on Nevermined',
  params: [
    { name: 'name', type: 'string', description: 'Plan name', required: true },
    { name: 'description', type: 'string', description: 'Plan description', required: false },
    { name: 'priceAmounts', type: 'string', description: 'Comma-separated price amounts in wei', required: true },
    { name: 'priceReceivers', type: 'string', description: 'Comma-separated receiver addresses', required: true },
    { name: 'creditsAmount', type: 'number', description: 'Number of credits in the plan', required: true },
    { name: 'accessLimit', type: 'string', description: '"credits" or "time" (default: credits)', required: false },
  ],
  handler: async (payments, _config, params) => {
    const name = requireParam(params, 'name')
    const description = optionalParam(params, 'description', '')
    const priceAmounts = requireParam(params, 'priceAmounts')
      .split(',')
      .map((s) => BigInt(s.trim()))
    const priceReceivers = requireParam(params, 'priceReceivers')
      .split(',')
      .map((s) => s.trim())
    const creditsAmount = Number(requireParam(params, 'creditsAmount'))
    const accessLimit = optionalParam(params, 'accessLimit', 'credits') as 'credits' | 'time'

    const result = await payments.plans.registerPlan(
      { name, description, accessLimit },
      {
        amounts: priceAmounts,
        receivers: priceReceivers,
        isCrypto: true,
      },
      {
        isRedemptionAmountFixed: true,
        redemptionType: 4,
        proofRequired: false,
        durationSecs: 0n,
        amount: BigInt(creditsAmount),
        minAmount: 1n,
        maxAmount: BigInt(creditsAmount),
      },
      undefined,
      accessLimit,
    )

    return { planId: result.planId }
  },
}

const listPlans: ToolDefinition = {
  name: 'nevermined.listPlans',
  description: "List the builder's payment plans on Nevermined",
  params: [],
  handler: async (payments) => {
    const result = await payments.plans.getPlans()
    return result
  },
}

export const allTools: ToolDefinition[] = [
  // Subscriber
  checkBalance,
  getAccessToken,
  orderPlan,
  queryAgent,
  // Builder
  registerAgent,
  createPlan,
  listPlans,
]
