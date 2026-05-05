import type { Payments, X402TokenOptions } from '@nevermined-io/payments'
import type { NeverminedPluginConfig } from './config.js'
import { getEffectivePlans } from './config.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** Default USDC token addresses per Nevermined environment */
const DEFAULT_USDC_ADDRESS: Record<string, `0x${string}`> = {
  sandbox: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',      // Base Sepolia USDC
  staging_sandbox: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  live: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',          // Base Mainnet USDC
  staging_live: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
}

/**
 * Resolve the default planId for the given payment type using the
 * config.plans array (preferred) or legacy planId/fiatPlanId fields.
 */
function resolveDefaultPlanId(config: NeverminedPluginConfig, paymentType: string): string | undefined {
  const plans = getEffectivePlans(config)
  const match = plans.find((p) => p.paymentType === paymentType)
  if (match) return match.planId
  // Fallback: return first plan regardless of type
  if (plans.length > 0) return plans[0].planId
  return undefined
}

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
        const planId = str(params, 'planId') ?? resolveDefaultPlanId(config, 'crypto')
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
        const planId = str(params, 'planId') ?? resolveDefaultPlanId(config, paymentType)
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')
        const agentId = str(params, 'agentId') ?? config.agentId

        const tokenOptions = await buildTokenOptions(getPayments, params, config)
        const token = await getPayments().x402.getX402AccessToken(planId, agentId, tokenOptions)
        return result({ accessToken: token.accessToken })
      },
    },

    {
      name: 'nevermined_orderPlan',
      label: 'Nevermined Order Plan',
      description: 'Order (purchase) a Nevermined crypto payment plan. Two-step: returns a quote until called again with confirm:true.',
      parameters: {
        type: 'object' as const,
        properties: {
          planId: { type: 'string', description: 'The payment plan ID to order' },
          confirm: { type: 'boolean', description: 'Set to true to execute the on-chain purchase. Without confirm:true the tool returns the plan summary only.' },
        },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const planId = str(params, 'planId') ?? resolveDefaultPlanId(config, 'crypto')
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')

        if (!isConfirmed(params)) {
          return result(await buildOrderQuote(getPayments, planId, 'crypto', config))
        }

        const res = await getPayments().plans.orderPlan(planId)
        return result(res)
      },
    },

    {
      name: 'nevermined_orderFiatPlan',
      label: 'Nevermined Order Fiat Plan',
      description: 'Order a fiat payment plan — returns a Stripe checkout URL. Two-step: returns a quote until called again with confirm:true.',
      parameters: {
        type: 'object' as const,
        properties: {
          planId: { type: 'string', description: 'The payment plan ID to order' },
          confirm: { type: 'boolean', description: 'Set to true to receive the Stripe checkout URL. Without confirm:true the tool returns the plan summary only.' },
        },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const planId = str(params, 'planId') ?? resolveDefaultPlanId(config, 'fiat')
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')

        if (!isConfirmed(params)) {
          return result(await buildOrderQuote(getPayments, planId, 'fiat', config))
        }

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
        const planId = str(params, 'planId') ?? resolveDefaultPlanId(config, paymentType)
        if (!planId) throw new Error('planId is required — provide it as a parameter or in the plugin config')
        const agentId = str(params, 'agentId') ?? config.agentId
        const method = str(params, 'method') ?? 'POST'

        warnIfInsecureUrl(agentUrl)

        const tokenOptions = await buildTokenOptions(getPayments, params, config)
        const { accessToken } = await getPayments().x402.getX402AccessToken(planId, agentId, tokenOptions)

        const response = await fetch(agentUrl, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'payment-signature': accessToken,
          },
          body: method !== 'GET' ? JSON.stringify({ prompt }) : undefined,
        })

        if (response.status === 402) {
          const guidance = paymentType === 'fiat'
            ? 'Order a fiat plan using nevermined_orderFiatPlan, or enroll a card at nevermined.app.'
            : 'Order the plan first using nevermined_orderPlan, or try paymentType "fiat" if the plan supports card payments.'
          return result({
            error: `Payment required — insufficient credits. ${guidance}`,
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
          priceAmounts: { type: 'string', description: 'Comma-separated price amounts. Supports dollar notation (e.g. "$0.10", "$1.50") which auto-converts based on pricing type, or raw amounts in smallest unit (e.g. "1000000" for 1 USDC)' },
          priceReceivers: { type: 'string', description: 'Comma-separated receiver addresses. Defaults to the authenticated user wallet.' },
          creditsAmount: { type: 'number', description: 'Number of credits in the plan' },
          tokenAddress: { type: 'string', description: 'ERC20 token address (e.g. USDC). Omit for native token.' },
          pricingType: { type: 'string', description: '"crypto" (default), "erc20", or "fiat"' },
        },
        required: ['name', 'agentUrl', 'planName', 'priceAmounts', 'creditsAmount'],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const name = requireStr(params, 'name')
        const description = str(params, 'description') ?? ''
        const agentUrl = requireStr(params, 'agentUrl')
        const planName = requireStr(params, 'planName')
        const tokenAddress = str(params, 'tokenAddress') as `0x${string}` | undefined
        const pricingType = (str(params, 'pricingType') ?? 'crypto') as 'fiat' | 'erc20' | 'crypto'
        const priceAmounts = requireStr(params, 'priceAmounts')
          .split(',')
          .map((s) => parsePriceToBigInt(s, pricingType))
        const priceReceiversRaw = str(params, 'priceReceivers')
        const priceReceivers = priceReceiversRaw
          ? priceReceiversRaw.split(',').map((s) => s.trim())
          : [getPayments().getAccountAddress() ?? (() => { throw new Error('priceReceivers is required — no wallet address found in API key') })()]
        const creditsAmount = Number(requireStr(params, 'creditsAmount'))

        const isCrypto = pricingType !== 'fiat'

        const priceConfig = {
          amounts: priceAmounts,
          receivers: priceReceivers,
          isCrypto,
          tokenAddress: tokenAddress ?? (pricingType === 'erc20' ? (DEFAULT_USDC_ADDRESS[config.environment ?? 'sandbox'] ?? ZERO_ADDRESS) : ZERO_ADDRESS),
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
            onchainMirror: false,
            durationSecs: 0n,
            amount: BigInt(creditsAmount),
            minAmount: 1n,
            maxAmount: BigInt(creditsAmount),
          },
        )

        // Auto-store IDs so the paid endpoint works immediately
        if (res.planId) config.planId = res.planId
        if (res.agentId) config.agentId = res.agentId

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
          priceAmount: { type: 'string', description: 'Price amount. Supports dollar notation (e.g. "$0.10", "$1.50") which auto-converts based on pricing type, or raw amounts in smallest unit (e.g. "1000000" for 1 USDC, "100" for $1.00 fiat)' },
          receiver: { type: 'string', description: 'Receiver wallet address (0x...). Defaults to the authenticated user wallet.' },
          creditsAmount: { type: 'number', description: 'Number of credits in the plan' },
          pricingType: { type: 'string', description: '"fiat" for Stripe/USD, "erc20" for ERC20 tokens like USDC, "crypto" for native token (default: crypto)' },
          accessLimit: { type: 'string', description: '"credits" or "time" (default: credits)' },
          tokenAddress: { type: 'string', description: 'ERC20 token contract address. Required when pricingType is "erc20".' },
        },
        required: ['name', 'priceAmount', 'creditsAmount'],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const name = requireStr(params, 'name')
        const description = str(params, 'description') ?? ''
        const pricingType = (str(params, 'pricingType') ?? 'crypto') as 'fiat' | 'erc20' | 'crypto'
        const priceAmount = parsePriceToBigInt(requireStr(params, 'priceAmount'), pricingType)
        const receiver = str(params, 'receiver') ?? getPayments().getAccountAddress() ?? (() => { throw new Error('receiver is required — no wallet address found in API key') })()
        const creditsAmount = Number(requireStr(params, 'creditsAmount'))
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
          case 'erc20': {
            const resolvedToken = tokenAddress ?? DEFAULT_USDC_ADDRESS[config.environment ?? 'sandbox']
            if (!resolvedToken) throw new Error('tokenAddress is required when pricingType is "erc20" (no default USDC address for this environment)')
            priceConfig = {
              amounts: [priceAmount],
              receivers: [receiver],
              isCrypto: true,
              tokenAddress: resolvedToken,
              contractAddress: ZERO_ADDRESS,
              feeController: ZERO_ADDRESS,
              externalPriceAddress: ZERO_ADDRESS,
              templateAddress: ZERO_ADDRESS,
            }
            break
          }
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
            onchainMirror: false,
            durationSecs: 0n,
            amount: BigInt(creditsAmount),
            minAmount: 1n,
            maxAmount: BigInt(creditsAmount),
          },
          undefined,
          accessLimit,
        )

        // Auto-store planId so the paid endpoint works immediately
        if (res.planId) config.planId = res.planId

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
  const methods = await getPayments().delegation.listPaymentMethods()
  if (!paymentMethodId) {
    const card = methods.find((m) => m.type === 'card' || m.type === 'paypal')
    if (!card) throw new Error('No enrolled payment method found. Enroll one at https://nevermined.app')
    paymentMethodId = card.id
  }
  const matched = methods.find((m) => m.id === paymentMethodId)
  const network = matched?.provider ?? 'stripe'

  return {
    scheme: 'nvm:card-delegation',
    network,
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

/** Token decimal places per pricing type */
const DECIMALS: Record<string, number> = {
  erc20: 6,   // USDC
  fiat: 2,    // cents
  crypto: 18, // native token (ETH)
}

/**
 * Parse a price string that may use dollar notation (e.g. "$0.10", "$1.50")
 * into the token's smallest unit as a bigint.
 * Plain numeric strings are passed through as-is.
 */
function parsePriceToBigInt(priceStr: string, pricingType: string): bigint {
  const trimmed = priceStr.trim()
  if (trimmed.startsWith('$')) {
    const dollars = parseFloat(trimmed.slice(1))
    if (isNaN(dollars)) throw new Error(`Invalid dollar amount: ${trimmed}`)
    const decimals = DECIMALS[pricingType] ?? 6
    return BigInt(Math.round(dollars * 10 ** decimals))
  }
  return BigInt(trimmed)
}

/** Whether the caller passed an explicit confirm:true. Anything else (false, "false", undefined) is treated as a quote request. */
function isConfirmed(params: Record<string, unknown>): boolean {
  const raw = params.confirm
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') return raw.toLowerCase() === 'true'
  return false
}

/**
 * Shape of the response returned by `payments.plans.getPlan(planId)`. Only the
 * fields we actually read for the quote are typed here — see
 * `apps/api/src/plans/dto/get-plan-dto.ts` and `metadata.dto.ts` in nvm-monorepo
 * for the full definition.
 */
interface GetPlanResponse {
  id?: string
  metadata?: {
    main?: { name?: string; price?: string }
    plan?: {
      accessLimit?: 'credits' | 'time'
      currency?: string
      fiatPaymentProvider?: 'stripe' | 'braintree'
    }
  }
  registry?: {
    price?: { isCrypto?: boolean; amounts?: bigint[] }
    credits?: { amount?: bigint }
  }
}

/**
 * Fetch a plan summary so the agent can show price, credits, and environment to the user
 * before they pass `confirm: true`. Used to gate the order tools per ClawHub finding #1.
 *
 * Field paths follow the canonical `getPlan` response shape (`metadata.main.*`,
 * `metadata.plan.*`, `registry.credits.amount`, `registry.price.*`); BigInts are
 * stringified so the JSON envelope serialises safely.
 */
export async function buildOrderQuote(
  getPayments: () => Payments,
  planId: string,
  paymentType: 'crypto' | 'fiat',
  config: NeverminedPluginConfig,
): Promise<Record<string, unknown>> {
  let summary: Record<string, unknown> = { planId }
  try {
    const plan = (await getPayments().plans.getPlan(planId)) as GetPlanResponse | undefined
    if (plan && typeof plan === 'object') {
      const main = plan.metadata?.main
      const planMeta = plan.metadata?.plan
      const creditsAmount = plan.registry?.credits?.amount
      // Always echo the user-provided planId so a follow-up `confirm: true` call
      // re-uses the same identifier the agent already showed the user.
      summary = {
        planId,
        name: main?.name,
        price: main?.price,
        credits: creditsAmount !== undefined ? creditsAmount.toString() : undefined,
        accessLimit: planMeta?.accessLimit,
        currency: planMeta?.currency,
        fiatPaymentProvider: planMeta?.fiatPaymentProvider,
      }
    }
  } catch {
    // Plan lookup failures shouldn't block the quote — the LLM can still confirm explicitly.
  }
  return {
    ...summary,
    paymentType,
    environment: config.environment ?? 'sandbox',
    requiresConfirmation: true,
    message: 'Re-call with confirm: true to proceed.',
  }
}

/**
 * Redact a bearer token / payment-signature for safe logging. Output forms:
 *   - Empty / non-string input  → `"<empty>"`
 *   - Length ≤ 12               → `"ab…yz"`           (head 2 + ellipsis + tail 2 = 5 chars)
 *   - Length > 12               → `"eyJhbG…aA1c"`     (head 6 + ellipsis + tail 4 = 11 chars)
 *
 * Intended for debug output and log redactors — never reconstructs the token.
 */
export function redactToken(token: unknown): string {
  if (typeof token !== 'string' || token.length === 0) return '<empty>'
  if (token.length <= 12) return `${token.slice(0, 2)}…${token.slice(-2)}`
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}

/**
 * Warn (do not throw) when an agent URL is not HTTPS. Local development
 * (`localhost`, `127.0.0.1`, `::1`) is allowed silently. ClawHub finding #6.
 */
function warnIfInsecureUrl(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') return
    const host = parsed.hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return
    console.warn(
      `[nevermined] agentUrl uses ${parsed.protocol}//${host} — payment-signature tokens must only be sent over HTTPS in production.`,
    )
  } catch {
    // Invalid URLs will be surfaced by the fetch call itself.
  }
}
