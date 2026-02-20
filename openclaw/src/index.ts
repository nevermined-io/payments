import { validateConfig, createPaymentsFromConfig, requireApiKey } from './config.js'
import { allTools } from './tools.js'
import { startLoginFlow } from './auth.js'
import { Payments, Environments } from '@nevermined-io/payments'
import type { EnvironmentName } from '@nevermined-io/payments'
import type { NeverminedPluginConfig } from './config.js'
import type { ToolDefinition } from './tools.js'

export type { NeverminedPluginConfig, ToolDefinition }
export { validateConfig, createPaymentsFromConfig, requireApiKey, allTools }
export { startLoginFlow, openBrowser } from './auth.js'

export interface OpenClawPluginAPI {
  getConfig(namespace: string): unknown
  setConfig(namespace: string, key: string, value: unknown): void
  registerGatewayMethod(
    name: string,
    options: {
      description: string
      params: Array<{
        name: string
        type: string
        description: string
        required: boolean
      }>
      handler: (params: Record<string, unknown>) => Promise<unknown>
    },
  ): void
  registerCommand(options: {
    name: string
    description: string
    acceptsArgs?: boolean
    requireAuth?: boolean
    handler: (ctx: CommandContext) => Promise<{ text: string }>
  }): void
}

export interface CommandContext {
  senderId: string
  channel: string
  isAuthorizedSender: boolean
  args: string
  commandBody: string
  config: Record<string, unknown>
}

export interface RegisterOptions {
  paymentsFactory?: (config: NeverminedPluginConfig) => Payments
}

export function register(api: OpenClawPluginAPI, options?: RegisterOptions): void {
  const rawConfig = api.getConfig('nevermined')
  const config = validateConfig(rawConfig)

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

  // --- Login/Logout gateway tools ---

  api.registerGatewayMethod('nevermined.login', {
    description: 'Authenticate with Nevermined via browser login to obtain an API key',
    params: [
      { name: 'environment', type: 'string', description: 'Target environment: sandbox or live (default: from config)', required: false },
    ],
    handler: async (params) => {
      const env = (params.environment as string) || config.environment || 'sandbox'
      const result = await startLoginFlow(env as EnvironmentName)

      config.nvmApiKey = result.nvmApiKey
      config.environment = result.environment as 'sandbox' | 'live'
      payments = null // Reset so next call creates a fresh instance

      api.setConfig('nevermined', 'nvmApiKey', result.nvmApiKey)
      api.setConfig('nevermined', 'environment', result.environment)

      return {
        authenticated: true,
        environment: result.environment,
      }
    },
  })

  api.registerGatewayMethod('nevermined.logout', {
    description: 'Log out from Nevermined by removing the stored API key',
    params: [],
    handler: async () => {
      config.nvmApiKey = undefined
      payments = null

      api.setConfig('nevermined', 'nvmApiKey', '')

      return { authenticated: false }
    },
  })

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

        api.setConfig('nevermined', 'nvmApiKey', result.nvmApiKey)
        api.setConfig('nevermined', 'environment', result.environment)

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

      api.setConfig('nevermined', 'nvmApiKey', '')

      return { text: 'Logged out from Nevermined. API key has been removed.' }
    },
  })

  // --- Payment tools (require authentication) ---

  for (const tool of allTools) {
    api.registerGatewayMethod(tool.name, {
      description: tool.description,
      params: tool.params,
      handler: async (params) => {
        try {
          return await tool.handler(getPayments(), config, params)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          throw new Error(`[nevermined] ${tool.name} failed: ${message}`)
        }
      },
    })
  }
}
