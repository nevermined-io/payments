import { z } from 'zod'
import { Payments } from '@nevermined-io/payments'
import type { EnvironmentName } from '@nevermined-io/payments'

export const NeverminedPluginConfigSchema = z.object({
  nvmApiKey: z.string().optional(),
  environment: z.enum(['sandbox', 'live']).default('sandbox'),
  planId: z.string().optional(),
  agentId: z.string().optional(),
  creditsPerRequest: z.number().int().positive().default(1),
})

export type NeverminedPluginConfig = z.infer<typeof NeverminedPluginConfigSchema>

export function validateConfig(raw: unknown): NeverminedPluginConfig {
  return NeverminedPluginConfigSchema.parse(raw)
}

export function requireApiKey(config: NeverminedPluginConfig): string {
  if (!config.nvmApiKey) {
    throw new Error('Not authenticated. Run nevermined.login or /nvm-login first.')
  }
  return config.nvmApiKey
}

export function createPaymentsFromConfig(config: NeverminedPluginConfig): Payments {
  return Payments.getInstance({
    nvmApiKey: requireApiKey(config),
    environment: config.environment as EnvironmentName,
  })
}
