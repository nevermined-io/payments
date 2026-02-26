import { validateConfig, createPaymentsFromConfig, requireApiKey } from './config.js'
import { createTools } from './tools.js'
import { startLoginFlow, looksLikeApiKey, getLoginUrl, getApiKeyUrl } from './auth.js'
import { registerPaidEndpoint } from './paid-endpoint.js'
import { Payments } from '@nevermined-io/payments'
import type { EnvironmentName } from '@nevermined-io/payments'
import type { NeverminedPluginConfig } from './config.js'
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
  id: 'openclaw-plugin',
  name: '@nevermined-io/openclaw-plugin',
  description: 'Nevermined plugin for OpenClaw — AI agent payments and access control',

  register(api: OpenClawPluginAPI, options?: RegisterOptions): void {
    const config = validateConfig(api.pluginConfig ?? {})

    // Lazy Payments instance — created on first use after authentication
    let payments: Payments | null = null
    const factory = options?.paymentsFactory ?? createPaymentsFromConfig

    function getPayments(): Payments {
      if (!payments) {
        requireApiKey(config)
        payments = factory(config)
      }
      return payments
    }

    // --- Register tools via factory function ---
    // OpenClaw calls the factory per agent session, providing context.
    // We return the full tool array each time.

    const toolNames = [
      'nevermined_checkBalance',
      'nevermined_getAccessToken',
      'nevermined_orderPlan',
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

    // --- Credit balance injection into agent context ---

    if (api.on) {
      let cachedBalance: { balance: string; planName: string; fetchedAt: number } | null = null
      const CACHE_TTL_MS = 60_000

      api.on('before_prompt_build', async () => {
        if (!config.nvmApiKey || !config.planId) return undefined

        const now = Date.now()
        if (cachedBalance && now - cachedBalance.fetchedAt < CACHE_TTL_MS) {
          return { prependContext: formatBalanceContext(cachedBalance.balance, cachedBalance.planName) }
        }

        try {
          const result = await getPayments().plans.getPlanBalance(config.planId)
          cachedBalance = {
            balance: result.balance.toString(),
            planName: result.planName ?? config.planId,
            fetchedAt: now,
          }
          return { prependContext: formatBalanceContext(cachedBalance.balance, cachedBalance.planName) }
        } catch {
          return undefined
        }
      })
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

          return { text: `Authenticated with Nevermined (${result.environment}). You can now use payment tools.` }
        } catch (_err) {
          // Browser login failed (headless server, timeout, etc.)
          // Provide manual instructions
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
        return { text: 'Logged out from Nevermined. API key has been removed.' }
      },
    })
  },
}

function formatBalanceContext(balance: string, planName: string): string {
  const num = Number(balance)
  const warning = num > 0 && num <= 5 ? ' (LOW — consider ordering more credits)' : ''
  return `[Nevermined] Credits remaining: ${balance} (plan: ${planName})${warning}`
}

export default neverminedPlugin
