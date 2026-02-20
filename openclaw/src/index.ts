import { validateConfig, createPaymentsFromConfig } from './config.js'
import { allTools } from './tools.js'
import type { Payments } from '@nevermined-io/payments'
import type { NeverminedPluginConfig } from './config.js'
import type { ToolDefinition } from './tools.js'

export type { NeverminedPluginConfig, ToolDefinition }
export { validateConfig, createPaymentsFromConfig, allTools }

export interface OpenClawPluginAPI {
  getConfig(namespace: string): unknown
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
}

export interface RegisterOptions {
  paymentsFactory?: (config: NeverminedPluginConfig) => Payments
}

export function register(api: OpenClawPluginAPI, options?: RegisterOptions): void {
  const rawConfig = api.getConfig('nevermined')
  const config = validateConfig(rawConfig)
  const factory = options?.paymentsFactory ?? createPaymentsFromConfig
  const payments = factory(config)

  for (const tool of allTools) {
    api.registerGatewayMethod(tool.name, {
      description: tool.description,
      params: tool.params,
      handler: async (params) => {
        try {
          return await tool.handler(payments, config, params)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          throw new Error(`[nevermined] ${tool.name} failed: ${message}`)
        }
      },
    })
  }
}
