import type { Payments, X402TokenOptions } from '@nevermined-io/payments'
import type { NeverminedPluginConfig } from './config.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

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
      description: 'Get an x402 access token for authenticating requests to a Nevermined agent. Supports crypto (default) and fiat (credit card) payment types.',
      parameters: {
        type: 'object' as const,
        properties: {
          planId: { type: 'string', description: 'The payment plan ID' },
          agentId: { type: 'string', description: 'The agent ID' },
          paymentType: { type: 'string', description: '"crypto" (default, nvm:erc4337 scheme) or "fiat" (nvm:card-delegation scheme)' },
          paymentMethodId: { type: 'string', description: 'Stripe payment method ID (pm_...). Required for fiat; auto-selects first enrolled card if omitted.' },
          spendingLimitCents: { type: 'number', description: 'Max spend in cents for fiat (default: 1000 = $10)' },
          delegationDurationSecs: { type: 'number', description: 'Delegation duration in seconds for fiat (default: 3600 = 1 hour)' },
        },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const paymentType = str(params, 'paymentType') ?? config.paymentType ?? 'crypto'
        const planId = str(params, 'planId') ?? (paymentType === 'fiat' ? config.fiatPlanId : undefined) ?? config.planId
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')
        const agentId = str(params, 'agentId') ?? config.agentId

        const tokenOptions = await buildTokenOptions(getPayments, params, config)
        const token = await getPayments().x402.getX402AccessToken(planId, agentId, undefined, undefined, undefined, tokenOptions)
        return result({ accessToken: token.accessToken })
      },
    },

    {
      name: 'nevermined_orderPlan',
      label: 'Nevermined Order Plan',
      description: 'Order (purchase) a Nevermined crypto payment plan',
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
      name: 'nevermined_orderFiatPlan',
      label: 'Nevermined Order Fiat Plan',
      description: 'Order a fiat payment plan — returns a Stripe checkout URL for completing the purchase',
      parameters: {
        type: 'object' as const,
        properties: {
          planId: { type: 'string', description: 'The payment plan ID to order' },
        },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const planId = str(params, 'planId') ?? config.fiatPlanId ?? config.planId
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')

        const res = await getPayments().plans.orderFiatPlan(planId)
        return result(res)
      },
    },

    {
      name: 'nevermined_listPaymentMethods',
      label: 'Nevermined List Payment Methods',
      description: 'List enrolled credit cards available for fiat payments',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      async execute() {
        const methods = await getPayments().delegation.listPaymentMethods()
        return result(methods)
      },
    },

    {
      name: 'nevermined_queryAgent',
      label: 'Nevermined Query Agent',
      description:
        'Query a Nevermined AI agent end-to-end: acquires an x402 access token, sends the prompt to the agent, and returns the response. Supports crypto (default) and fiat (credit card) payment types.',
      parameters: {
        type: 'object' as const,
        properties: {
          agentUrl: { type: 'string', description: 'The URL of the agent to query' },
          prompt: { type: 'string', description: 'The prompt to send to the agent' },
          planId: { type: 'string', description: 'The payment plan ID' },
          agentId: { type: 'string', description: 'The agent ID' },
          method: { type: 'string', description: 'HTTP method (default: POST)' },
          paymentType: { type: 'string', description: '"crypto" (default, nvm:erc4337 scheme) or "fiat" (nvm:card-delegation scheme)' },
          paymentMethodId: { type: 'string', description: 'Stripe payment method ID (pm_...). Required for fiat; auto-selects first enrolled card if omitted.' },
          spendingLimitCents: { type: 'number', description: 'Max spend in cents for fiat (default: 1000 = $10)' },
          delegationDurationSecs: { type: 'number', description: 'Delegation duration in seconds for fiat (default: 3600 = 1 hour)' },
        },
        required: ['agentUrl', 'prompt'],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const agentUrl = requireStr(params, 'agentUrl')
        const prompt = requireStr(params, 'prompt')
        const paymentType = str(params, 'paymentType') ?? config.paymentType ?? 'crypto'
        const planId = str(params, 'planId') ?? (paymentType === 'fiat' ? config.fiatPlanId : undefined) ?? config.planId
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')
        const agentId = str(params, 'agentId') ?? config.agentId
        const method = str(params, 'method') ?? 'POST'

        const tokenOptions = await buildTokenOptions(getPayments, params, config)
        const { accessToken } = await getPayments().x402.getX402AccessToken(planId, agentId, undefined, undefined, undefined, tokenOptions)

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
          priceAmounts: { type: 'string', description: 'Comma-separated price amounts in wei (crypto) or cents (fiat)' },
          priceReceivers: { type: 'string', description: 'Comma-separated receiver addresses' },
          creditsAmount: { type: 'number', description: 'Number of credits in the plan' },
          tokenAddress: { type: 'string', description: 'ERC20 token address (e.g. USDC). Omit for native token.' },
          pricingType: { type: 'string', description: '"crypto" (default), "erc20", or "fiat"' },
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
        const pricingType = (str(params, 'pricingType') ?? 'crypto') as 'fiat' | 'erc20' | 'crypto'

        const isCrypto = pricingType !== 'fiat'

        const priceConfig = {
          amounts: priceAmounts,
          receivers: priceReceivers,
          isCrypto,
          tokenAddress: tokenAddress ?? ZERO_ADDRESS,
          contractAddress: ZERO_ADDRESS,
          feeController: ZERO_ADDRESS,
          externalPriceAddress: ZERO_ADDRESS,
          templateAddress: ZERO_ADDRESS,
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
      description: 'Create a new payment plan on Nevermined. Supports fiat (Stripe), ERC20 tokens (USDC), and native crypto pricing.',
      parameters: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Plan name' },
          description: { type: 'string', description: 'Plan description' },
          priceAmount: { type: 'string', description: 'Price amount — in cents for fiat (e.g. "100" = $1.00), in token smallest unit for crypto (e.g. "1000000" = 1 USDC)' },
          receiver: { type: 'string', description: 'Receiver wallet address (0x...)' },
          creditsAmount: { type: 'number', description: 'Number of credits in the plan' },
          pricingType: { type: 'string', description: '"fiat" for Stripe/USD, "erc20" for ERC20 tokens like USDC, "crypto" for native token (default: crypto)' },
          accessLimit: { type: 'string', description: '"credits" or "time" (default: credits)' },
          tokenAddress: { type: 'string', description: 'ERC20 token contract address. Required when pricingType is "erc20".' },
        },
        required: ['name', 'priceAmount', 'receiver', 'creditsAmount'],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const name = requireStr(params, 'name')
        const description = str(params, 'description') ?? ''
        const priceAmount = BigInt(requireStr(params, 'priceAmount'))
        const receiver = requireStr(params, 'receiver')
        const creditsAmount = Number(requireStr(params, 'creditsAmount'))
        const pricingType = (str(params, 'pricingType') ?? 'crypto') as 'fiat' | 'erc20' | 'crypto'
        const accessLimit = (str(params, 'accessLimit') ?? 'credits') as 'credits' | 'time'
        const tokenAddress = str(params, 'tokenAddress') as `0x${string}` | undefined

        let priceConfig
        switch (pricingType) {
          case 'fiat':
            priceConfig = {
              amounts: [priceAmount],
              receivers: [receiver],
              isCrypto: false,
              tokenAddress: ZERO_ADDRESS,
              contractAddress: ZERO_ADDRESS,
              feeController: ZERO_ADDRESS,
              externalPriceAddress: ZERO_ADDRESS,
              templateAddress: ZERO_ADDRESS,
            }
            break
          case 'erc20':
            if (!tokenAddress) throw new Error('tokenAddress is required when pricingType is "erc20"')
            priceConfig = {
              amounts: [priceAmount],
              receivers: [receiver],
              isCrypto: true,
              tokenAddress,
              contractAddress: ZERO_ADDRESS,
              feeController: ZERO_ADDRESS,
              externalPriceAddress: ZERO_ADDRESS,
              templateAddress: ZERO_ADDRESS,
            }
            break
          default:
            priceConfig = {
              amounts: [priceAmount],
              receivers: [receiver],
              isCrypto: true,
              tokenAddress: tokenAddress ?? ZERO_ADDRESS,
              contractAddress: ZERO_ADDRESS,
              feeController: ZERO_ADDRESS,
              externalPriceAddress: ZERO_ADDRESS,
              templateAddress: ZERO_ADDRESS,
            }
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

async function buildTokenOptions(
  getPayments: () => Payments,
  params: Record<string, unknown>,
  config: NeverminedPluginConfig,
): Promise<X402TokenOptions | undefined> {
  const paymentType = str(params, 'paymentType') ?? config.paymentType ?? 'crypto'
  if (paymentType !== 'fiat') return undefined

  let paymentMethodId = str(params, 'paymentMethodId')
  if (!paymentMethodId) {
    const methods = await getPayments().delegation.listPaymentMethods()
    if (methods.length === 0) throw new Error('No enrolled payment methods found. Enroll a card at https://nevermined.app')
    paymentMethodId = methods[0].id
  }

  return {
    scheme: 'nvm:card-delegation',
    delegationConfig: {
      providerPaymentMethodId: paymentMethodId,
      spendingLimitCents: Number(str(params, 'spendingLimitCents') ?? config.defaultSpendingLimitCents ?? 1000),
      durationSecs: Number(str(params, 'delegationDurationSecs') ?? config.defaultDelegationDurationSecs ?? 3600),
    },
  }
}

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
