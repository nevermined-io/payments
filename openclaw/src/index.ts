import { validateConfig, createPaymentsFromConfig, requireApiKey } from './config.js'
import { createTools } from './tools.js'
import { startLoginFlow } from './auth.js'
import { Payments } from '@nevermined-io/payments'
import type { EnvironmentName } from '@nevermined-io/payments'
import type { NeverminedPluginConfig } from './config.js'

export type { NeverminedPluginConfig }
export { validateConfig, createPaymentsFromConfig, requireApiKey }
export { startLoginFlow, openBrowser } from './auth.js'

/**
 * Minimal subset of the OpenClaw Plugin API used by this plugin.
 * The full type is OpenClawPluginApi from openclaw/src/plugins/types.
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
  registerTool(tool: unknown, opts?: { optional?: boolean }): void
  registerCommand(command: {
    name: string
    description: string
    acceptsArgs?: boolean
    requireAuth?: boolean
    handler: (ctx: CommandContext) => Promise<CommandResult> | CommandResult
  }): void
  registerGatewayMethod(method: string, handler: unknown): void
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
}

export default function register(api: OpenClawPluginAPI, options?: RegisterOptions): void {
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

  // --- Register all payment tools ---

  const tools = createTools(getPayments, config)
  for (const tool of tools) {
    api.registerTool(tool, { optional: true })
  }

  api.logger.info(`Registered ${tools.length} Nevermined payment tools`)

  // --- Slash commands for chat channels ---

  api.registerCommand({
    name: 'nvm-login',
    description: 'Authenticate with Nevermined via browser login',
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      try {
        const env = (ctx.args?.trim() || config.environment || 'sandbox') as EnvironmentName
        const result = await startLoginFlow(env)

        config.nvmApiKey = result.nvmApiKey
        config.environment = result.environment as 'sandbox' | 'live'
        payments = null

        return { text: `Authenticated with Nevermined (${result.environment}). You can now use payment tools.` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { text: `Login failed: ${message}` }
      }
    },
  })

  api.registerCommand({
    name: 'nvm-logout',
    description: 'Log out from Nevermined',
    requireAuth: true,
    handler: async () => {
      config.nvmApiKey = undefined
      payments = null
      return { text: 'Logged out from Nevermined. API key has been removed.' }
    },
  })
}
