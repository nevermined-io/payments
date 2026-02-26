import { validateConfig, createPaymentsFromConfig, requireApiKey, getEffectivePlans } from './config.js'
import { createTools } from './tools.js'
import { startLoginFlow, looksLikeApiKey, getLoginUrl, getApiKeyUrl } from './auth.js'
import { registerPaidEndpoint } from './paid-endpoint.js'
import { Payments, buildPaymentRequired } from '@nevermined-io/payments'
import type { EnvironmentName, X402PaymentRequired, X402TokenOptions } from '@nevermined-io/payments'
import type { NeverminedPluginConfig, PlanEntry } from './config.js'
import type { AgentHandler } from './paid-endpoint.js'

export type { NeverminedPluginConfig }
export type { AgentHandler }
export { validateConfig, createPaymentsFromConfig, requireApiKey }
export { startLoginFlow, openBrowser } from './auth.js'
export { registerPaidEndpoint, mockWeatherHandler } from './paid-endpoint.js'

/**
 * HTTP route handler signature used by OpenClaw's registerHttpRoute.
 */
export type HttpRouteHandler = (
  req: HttpIncomingMessage,
  res: HttpServerResponse,
) => void | Promise<void>

export interface HttpIncomingMessage {
  headers: Record<string, string | string[] | undefined>
  on(event: string, cb: (data?: unknown) => void): void
}

export interface HttpServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/**
 * Minimal subset of the OpenClaw Plugin API used by this plugin.
 */
export interface OpenClawPluginAPI {
  id: string
  pluginConfig?: Record<string, unknown>
  config: Record<string, unknown>
  logger: {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  }
  registerTool(tool: unknown, opts?: { optional?: boolean; names?: string[] }): void
  registerCommand(command: {
    name: string
    description: string
    acceptsArgs?: boolean
    requireAuth?: boolean
    handler: (ctx: CommandContext) => Promise<CommandResult> | CommandResult
  }): void
  registerGatewayMethod(method: string, handler: unknown): void
  registerHttpRoute?(route: { path: string; handler: HttpRouteHandler }): void
  on?(hookName: string, handler: (...args: unknown[]) => unknown): void
}

export interface CommandContext {
  senderId?: string
  channel: string
  isAuthorizedSender: boolean
  args?: string
  commandBody: string
  config: Record<string, unknown>
}

export interface CommandResult {
  text: string
}

export interface RegisterOptions {
  paymentsFactory?: (config: NeverminedPluginConfig) => Payments
  agentHandler?: AgentHandler
}

export interface ToolContext {
  config?: Record<string, unknown>
  workspaceDir?: string
  agentDir?: string
  agentId?: string
  sessionKey?: string
}

/**
 * OpenClaw plugin definition object.
 * Exports id, name, description, and a register function.
 */
const neverminedPlugin = {
  id: 'nevermined',
  name: '@nevermined-io/openclaw-plugin',
  description: 'Nevermined plugin for OpenClaw — AI agent payments and access control',

  register(api: OpenClawPluginAPI, options?: RegisterOptions): void {
    const config = validateConfig(api.pluginConfig ?? {})
    const plans = getEffectivePlans(config)

    // Lazy Payments instance — created on first use after authentication
    let payments: Payments | null = null
    let catalogCache: { text: string; fetchedAt: number } | null = null
    const factory = options?.paymentsFactory ?? createPaymentsFromConfig

    function getPayments(): Payments {
      if (!payments) {
        requireApiKey(config)
        payments = factory(config)
      }
      return payments
    }

    // --- Register tools via factory function ---

    const toolNames = [
      'nevermined_checkBalance',
      'nevermined_getAccessToken',
      'nevermined_orderPlan',
      'nevermined_orderFiatPlan',
      'nevermined_listPaymentMethods',
      'nevermined_queryAgent',
      'nevermined_registerAgent',
      'nevermined_createPlan',
      'nevermined_listPlans',
    ]

    api.registerTool(
      (_ctx: ToolContext) => createTools(getPayments, config),
      { names: toolNames },
    )

    api.logger.info(`Registered ${toolNames.length} Nevermined payment tools`)

    // --- Paid HTTP endpoint ---

    if (config.enablePaidEndpoint && api.registerHttpRoute) {
      registerPaidEndpoint(api, getPayments, config, options?.agentHandler)
    }

    // --- Credit balance + plan catalog injection into agent context ---

    if (api.on && plans.length > 0) {
      const CACHE_TTL_MS = 60_000

      api.on('before_prompt_build', async () => {
        if (!config.nvmApiKey) return undefined

        const now = Date.now()
        if (catalogCache && now - catalogCache.fetchedAt < CACHE_TTL_MS) {
          return { prependContext: catalogCache.text }
        }

        try {
          const p = getPayments()
          const balances = await Promise.all(
            plans.map(async (plan) => {
              try {
                const b = await p.plans.getPlanBalance(plan.planId)
                return {
                  ...plan,
                  planName: b.planName ?? plan.name ?? plan.planId,
                  balance: Number(b.balance),
                  isSubscriber: b.isSubscriber,
                }
              } catch {
                return { ...plan, planName: plan.name ?? plan.planId, balance: 0, isSubscriber: false }
              }
            }),
          )

          const text = formatPlanCatalog(balances, config.creditsPerMinute)
          catalogCache = { text, fetchedAt: now }
          return { prependContext: text }
        } catch {
          return undefined
        }
      })
    }

    // --- x402 credit enforcement for non-plugin tool calls ---

    if (api.on && plans.length > 0) {
      const pendingSettlements = new Map<string, {
        paymentRequired: X402PaymentRequired
        accessToken: string
        creditsUsed: bigint
      }>()

      api.on('before_tool_call', async (event: unknown) => {
        const { toolName, params } = event as { toolName: string; params: Record<string, unknown> }

        // Skip nevermined tools — they handle their own payments
        if (toolName.startsWith('nevermined_')) return undefined

        if (!config.nvmApiKey) {
          return { block: true, blockReason: 'Not authenticated with Nevermined. Run /nvm_login first.' }
        }

        // Calculate credits needed based on meeting duration (for calendar tools)
        const creditsNeeded = calculateCreditsNeeded(toolName, params, config.creditsPerMinute)

        try {
          const p = getPayments()

          // Cache payment methods for fiat plans (fetched once per hook call)
          let cachedPaymentMethods: { id: string }[] | null = null

          // Try each plan until one verifies successfully
          for (const plan of plans) {
            try {
              // Build token options: fiat plans use nvm:card-delegation scheme
              let tokenOptions: X402TokenOptions | undefined
              if (plan.paymentType === 'fiat') {
                if (!cachedPaymentMethods) {
                  try {
                    cachedPaymentMethods = await p.delegation.listPaymentMethods()
                  } catch {
                    cachedPaymentMethods = []
                  }
                }
                if (cachedPaymentMethods.length === 0) continue // no cards enrolled, skip fiat plan
                tokenOptions = {
                  scheme: 'nvm:card-delegation',
                  delegationConfig: {
                    providerPaymentMethodId: cachedPaymentMethods[0].id,
                    spendingLimitCents: config.defaultSpendingLimitCents ?? 1000,
                    durationSecs: config.defaultDelegationDurationSecs ?? 3600,
                  },
                }
              }

              const { accessToken } = await p.x402.getX402AccessToken(
                plan.planId, config.agentId, undefined, undefined, undefined, tokenOptions,
              )

              const paymentRequired = buildPaymentRequired(plan.planId, {
                endpoint: `tool:${toolName}`,
                agentId: config.agentId,
                httpVerb: 'POST',
              })

              const verification = await p.facilitator.verifyPermissions({
                paymentRequired,
                x402AccessToken: accessToken,
                maxAmount: creditsNeeded,
              })

              api.logger.info(`x402: verify result for ${plan.name ?? plan.planId}: ${JSON.stringify(verification)}`)

              if (verification.isValid) {
                pendingSettlements.set(toolName, { paymentRequired, accessToken, creditsUsed: creditsNeeded })
                api.logger.info(`x402: verified ${creditsNeeded} credits on plan ${plan.name ?? plan.planId} for ${toolName}`)
                return undefined // allow
              }
            } catch (planErr) {
              api.logger.warn(`x402: plan ${plan.name ?? plan.planId} failed: ${planErr instanceof Error ? planErr.message : String(planErr)}`)
            }
          }

          // No plan had enough credits
          const cryptoOptions = plans
            .filter((p) => p.paymentType === 'crypto')
            .map((p) => `- ${p.name ?? p.planId}: use nevermined_orderPlan with planId="${p.planId}"`)
          const fiatFailed = plans.some((p) => p.paymentType === 'fiat')

          const parts = [`Insufficient credits (need ${creditsNeeded}).`]
          if (fiatFailed) {
            parts.push('Fiat card-delegation failed — the user may not have an enrolled credit card. They can enroll at https://nevermined.app.')
          }
          if (cryptoOptions.length > 0) {
            parts.push(`Purchase crypto credits:\n${cryptoOptions.join('\n')}`)
          }

          return {
            block: true,
            blockReason: parts.join(' '),
          }
        } catch (err) {
          return {
            block: true,
            blockReason: `Payment verification failed: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      })

      api.on('after_tool_call', async (event: unknown) => {
        const { toolName, error } = event as { toolName: string; error?: string }

        if (toolName.startsWith('nevermined_')) return
        if (error) {
          pendingSettlements.delete(toolName)
          return
        }

        const pending = pendingSettlements.get(toolName)
        if (!pending) return
        pendingSettlements.delete(toolName)

        try {
          const settlement = await getPayments().facilitator.settlePermissions({
            paymentRequired: pending.paymentRequired,
            x402AccessToken: pending.accessToken,
            maxAmount: pending.creditsUsed,
          })
          api.logger.info(`x402: settled ${pending.creditsUsed} credits for ${toolName} — result: ${JSON.stringify(settlement)}`)
        } catch (err) {
          api.logger.warn(`Credit settlement failed for ${toolName}: ${err instanceof Error ? err.message : String(err)}`)
        }
      })

      api.logger.info(`Registered x402 credit enforcement hooks (${plans.length} plans)`)
    }

    // --- Slash commands for chat channels ---

    api.registerCommand({
      name: 'nvm_login',
      description: 'Authenticate with Nevermined. Usage: /nvm_login [environment] or /nvm_login <api-key>',
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => {
        const input = ctx.args?.trim() || ''

        // --- Flow 1: User pasted an API key directly ---
        if (looksLikeApiKey(input)) {
          const apiKey = input
          const keyEnv = apiKey.split(':')[0] as 'sandbox' | 'live'

          config.nvmApiKey = apiKey
          config.environment = keyEnv
          payments = null
          catalogCache = null

          api.logger.info(`Nevermined: authenticated via API key (${keyEnv})`)
          return { text: `Authenticated with Nevermined (${keyEnv}). You can now use payment tools.` }
        }

        // --- Flow 2: Try browser login, fall back to manual instructions ---
        const env = (input || config.environment || 'sandbox') as EnvironmentName

        try {
          const result = await startLoginFlow(env)

          config.nvmApiKey = result.nvmApiKey
          config.environment = result.environment as 'sandbox' | 'live'
          payments = null
          catalogCache = null

          return { text: `Authenticated with Nevermined (${result.environment}). You can now use payment tools.` }
        } catch (_err) {
          const loginUrl = getLoginUrl(env)
          const apiKeyUrl = getApiKeyUrl(env)

          return {
            text: [
              `I couldn't open a browser for automatic login. Here's how to authenticate manually:`,
              ``,
              `1. Open this URL and log in: ${loginUrl}`,
              `2. Go to API Keys to get your API key: ${apiKeyUrl}`,
              `3. Copy the API key and send it here:`,
              `   /nvm_login <your-api-key>`,
              ``,
              `API keys look like: ${env}:eyJhbG...`,
            ].join('\n'),
          }
        }
      },
    })

    api.registerCommand({
      name: 'nvm_logout',
      description: 'Log out from Nevermined',
      requireAuth: true,
      handler: async () => {
        config.nvmApiKey = undefined
        payments = null
        catalogCache = null
        return { text: 'Logged out from Nevermined. API key has been removed.' }
      },
    })
  },
}

// --- Helpers ---

interface PlanBalance extends PlanEntry {
  planName: string
  balance: number
  isSubscriber: boolean
}

function formatPlanCatalog(plans: PlanBalance[], creditsPerMinute: number): string {
  const lines = [
    `[Nevermined Payment Plans]`,
    `Cost: ${creditsPerMinute} credit per minute of meeting duration.`,
    ``,
    `Available plans:`,
  ]

  for (const p of plans) {
    const method = p.paymentType === 'fiat' ? 'Credit Card' : 'Crypto (USDC)'
    const priceStr = p.price ? ` — ${p.price}` : ''
    const creditsStr = p.credits ? ` for ${p.credits} credits` : ''
    if (p.paymentType === 'crypto') {
      const balanceStr = p.isSubscriber ? ` [balance: ${p.balance} credits]` : ' [not subscribed]'
      lines.push(`  ${p.planName} (${method})${priceStr}${creditsStr}${balanceStr}`)
    } else {
      lines.push(`  ${p.planName} (${method})${priceStr}${creditsStr} [auto-charge]`)
    }
  }

  lines.push('')
  lines.push('MANDATORY WORKFLOW — You MUST follow these steps for EVERY meeting booking:')
  lines.push('1. Calculate the cost: credits = meeting duration in minutes × ' + creditsPerMinute)
  lines.push('2. Present ALL available payment plans to the user with their prices')
  lines.push('3. Ask the user which plan they prefer and get explicit confirmation')
  lines.push('   Example: "This 30-min meeting costs 30 credits. Here are the payment options:')
  lines.push('   - Fiat Meetings (USD): $1 via credit card (auto-charged)')
  lines.push('   - Meeting Credits 30 (USDC): 2 USDC via crypto')
  lines.push('   Which option do you prefer?"')
  lines.push('4. After the user confirms, proceed to book the meeting. Payment is processed automatically.')
  lines.push('5. After booking, inform the user that the payment was processed successfully.')
  lines.push('')
  lines.push('IMPORTANT: Do NOT call nevermined_orderFiatPlan or nevermined_orderPlan. Payments are handled automatically by the system when tools are used.')
  lines.push('IMPORTANT: NEVER book a meeting without first presenting the payment options and getting user confirmation.')

  return lines.join('\n')
}

/**
 * Calculate credits needed based on tool name and params.
 * For calendar_createEvent: 1 credit per minute of meeting duration.
 * For other tools: use the default creditsPerRequest.
 */
function calculateCreditsNeeded(
  toolName: string,
  params: Record<string, unknown>,
  creditsPerMinute: number,
): bigint {
  if (toolName === 'calendar_createevent' || toolName === 'calendar_createEvent') {
    const start = params.startDateTime as string | undefined
    const end = params.endDateTime as string | undefined
    if (start && end) {
      const durationMs = new Date(end).getTime() - new Date(start).getTime()
      const minutes = Math.max(1, Math.ceil(durationMs / 60_000))
      return BigInt(Math.ceil(minutes * creditsPerMinute))
    }
  }

  // Default: 1 credit for non-calendar tools
  return BigInt(Math.ceil(creditsPerMinute))
}

export default neverminedPlugin
