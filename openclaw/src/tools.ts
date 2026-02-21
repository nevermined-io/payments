import type { Payments } from '@nevermined-io/payments'
import type { NeverminedPluginConfig } from './config.js'

/**
 * Creates all Nevermined payment tools for the OpenClaw plugin.
 * Each tool is an object with { name, description, parameters, execute }
 * compatible with the OpenClaw AnyAgentTool interface.
 */
export function createTools(
  getPayments: () => Payments,
  config: NeverminedPluginConfig,
): ToolObject[] {
  return [
    // --- Subscriber tools ---
    {
      name: 'nevermined_checkBalance',
      label: 'Nevermined Check Balance',
      description: 'Check the credit balance for a Nevermined payment plan',
      parameters: {
        type: 'object' as const,
        properties: {
          planId: { type: 'string', description: 'The payment plan ID (uses config default if omitted)' },
        },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const planId = str(params, 'planId') ?? config.planId
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')

        const balance = await getPayments().plans.getPlanBalance(planId)
        return result({
          planId: balance.planId,
          planName: balance.planName,
          balance: balance.balance.toString(),
          isSubscriber: balance.isSubscriber,
        })
      },
    },

    {
      name: 'nevermined_getAccessToken',
      label: 'Nevermined Get Access Token',
      description: 'Get an x402 access token for authenticating requests to a Nevermined agent',
      parameters: {
        type: 'object' as const,
        properties: {
          planId: { type: 'string', description: 'The payment plan ID' },
          agentId: { type: 'string', description: 'The agent ID' },
        },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const planId = str(params, 'planId') ?? config.planId
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')
        const agentId = str(params, 'agentId') ?? config.agentId

        const token = await getPayments().x402.getX402AccessToken(planId, agentId)
        return result({ accessToken: token.accessToken })
      },
    },

    {
      name: 'nevermined_orderPlan',
      label: 'Nevermined Order Plan',
      description: 'Order (purchase) a Nevermined payment plan',
      parameters: {
        type: 'object' as const,
        properties: {
          planId: { type: 'string', description: 'The payment plan ID to order' },
        },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const planId = str(params, 'planId') ?? config.planId
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')

        const res = await getPayments().plans.orderPlan(planId)
        return result(res)
      },
    },

    {
      name: 'nevermined_queryAgent',
      label: 'Nevermined Query Agent',
      description:
        'Query a Nevermined AI agent end-to-end: acquires an x402 access token, sends the prompt to the agent, and returns the response',
      parameters: {
        type: 'object' as const,
        properties: {
          agentUrl: { type: 'string', description: 'The URL of the agent to query' },
          prompt: { type: 'string', description: 'The prompt to send to the agent' },
          planId: { type: 'string', description: 'The payment plan ID' },
          agentId: { type: 'string', description: 'The agent ID' },
          method: { type: 'string', description: 'HTTP method (default: POST)' },
        },
        required: ['agentUrl', 'prompt'],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const agentUrl = requireStr(params, 'agentUrl')
        const prompt = requireStr(params, 'prompt')
        const planId = str(params, 'planId') ?? config.planId
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')
        const agentId = str(params, 'agentId') ?? config.agentId
        const method = str(params, 'method') ?? 'POST'

        const { accessToken } = await getPayments().x402.getX402AccessToken(planId, agentId)

        const response = await fetch(agentUrl, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'PAYMENT-SIGNATURE': accessToken,
          },
          body: method !== 'GET' ? JSON.stringify({ prompt }) : undefined,
        })

        if (response.status === 402) {
          return result({
            error: 'Payment required — insufficient credits. Order the plan first using nevermined_orderPlan.',
            status: 402,
          })
        }

        if (!response.ok) {
          return result({
            error: `Agent returned HTTP ${response.status}: ${response.statusText}`,
            status: response.status,
          })
        }

        const body = await response.json()
        return result(body)
      },
    },

    // --- Builder tools ---

    {
      name: 'nevermined_registerAgent',
      label: 'Nevermined Register Agent',
      description: 'Register a new AI agent with an associated payment plan on Nevermined',
      parameters: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Agent name' },
          description: { type: 'string', description: 'Agent description' },
          agentUrl: { type: 'string', description: 'The endpoint URL for the agent' },
          planName: { type: 'string', description: 'Name for the payment plan' },
          priceAmounts: { type: 'string', description: 'Comma-separated price amounts in wei' },
          priceReceivers: { type: 'string', description: 'Comma-separated receiver addresses' },
          creditsAmount: { type: 'number', description: 'Number of credits in the plan' },
          tokenAddress: { type: 'string', description: 'ERC20 token address (e.g. USDC). Omit for native token.' },
        },
        required: ['name', 'agentUrl', 'planName', 'priceAmounts', 'priceReceivers', 'creditsAmount'],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const name = requireStr(params, 'name')
        const description = str(params, 'description') ?? ''
        const agentUrl = requireStr(params, 'agentUrl')
        const planName = requireStr(params, 'planName')
        const priceAmounts = requireStr(params, 'priceAmounts')
          .split(',')
          .map((s) => BigInt(s.trim()))
        const priceReceivers = requireStr(params, 'priceReceivers')
          .split(',')
          .map((s) => s.trim())
        const creditsAmount = Number(requireStr(params, 'creditsAmount'))
        const tokenAddress = str(params, 'tokenAddress') as `0x${string}` | undefined

        const priceConfig = {
          amounts: priceAmounts,
          receivers: priceReceivers,
          isCrypto: true,
          ...(tokenAddress ? { tokenAddress } : {}),
        }

        const res = await getPayments().agents.registerAgentAndPlan(
          { name, description },
          { endpoints: [{ POST: agentUrl }], agentDefinitionUrl: agentUrl },
          { name: planName },
          priceConfig,
          {
            isRedemptionAmountFixed: true,
            redemptionType: 4,
            proofRequired: false,
            durationSecs: 0n,
            amount: BigInt(creditsAmount),
            minAmount: 1n,
            maxAmount: BigInt(creditsAmount),
          },
        )

        return result({ agentId: res.agentId, planId: res.planId, txHash: res.txHash })
      },
    },

    {
      name: 'nevermined_createPlan',
      label: 'Nevermined Create Plan',
      description: 'Create a new payment plan on Nevermined',
      parameters: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Plan name' },
          description: { type: 'string', description: 'Plan description' },
          priceAmounts: { type: 'string', description: 'Comma-separated price amounts in wei' },
          priceReceivers: { type: 'string', description: 'Comma-separated receiver addresses' },
          creditsAmount: { type: 'number', description: 'Number of credits in the plan' },
          accessLimit: { type: 'string', description: '"credits" or "time" (default: credits)' },
          tokenAddress: { type: 'string', description: 'ERC20 token address (e.g. USDC). Omit for native token.' },
        },
        required: ['name', 'priceAmounts', 'priceReceivers', 'creditsAmount'],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const name = requireStr(params, 'name')
        const description = str(params, 'description') ?? ''
        const priceAmounts = requireStr(params, 'priceAmounts')
          .split(',')
          .map((s) => BigInt(s.trim()))
        const priceReceivers = requireStr(params, 'priceReceivers')
          .split(',')
          .map((s) => s.trim())
        const creditsAmount = Number(requireStr(params, 'creditsAmount'))
        const accessLimit = (str(params, 'accessLimit') ?? 'credits') as 'credits' | 'time'
        const tokenAddress = str(params, 'tokenAddress') as `0x${string}` | undefined

        const priceConfig = {
          amounts: priceAmounts,
          receivers: priceReceivers,
          isCrypto: true,
          ...(tokenAddress ? { tokenAddress } : {}),
        }

        const res = await getPayments().plans.registerPlan(
          { name, description, accessLimit },
          priceConfig,
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

        return result({ planId: res.planId })
      },
    },

    {
      name: 'nevermined_listPlans',
      label: 'Nevermined List Plans',
      description: "List the builder's payment plans on Nevermined",
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      async execute() {
        const res = await getPayments().plans.getPlans()
        return result(res)
      },
    },
  ]
}

// --- Helpers ---

interface ToolObject {
  name: string
  label: string
  description: string
  parameters: Record<string, unknown>
  execute: (_id: string, params: Record<string, unknown>) => Promise<ToolResult>
}

interface ToolResult {
  content: Array<{ type: string; text: string }>
}

function result(payload: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  }
}

function str(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key]
  if (v === undefined || v === null || v === '') return undefined
  return String(v)
}

function requireStr(params: Record<string, unknown>, key: string): string {
  const v = str(params, key)
  if (!v) throw new Error(`Missing required parameter: ${key}`)
  return v
}
