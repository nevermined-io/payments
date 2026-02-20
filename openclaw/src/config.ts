import { z } from 'zod'
import { Payments } from '@nevermined-io/payments'
import type { EnvironmentName } from '@nevermined-io/payments'

export const NeverminedPluginConfigSchema = z.object({
  nvmApiKey: z.string().min(1, 'nvmApiKey is required'),
  environment: z.enum(['sandbox', 'live']).default('sandbox'),
  planId: z.string().optional(),
  agentId: z.string().optional(),
  creditsPerRequest: z.number().int().positive().default(1),
})

export type NeverminedPluginConfig = z.infer<typeof NeverminedPluginConfigSchema>

export function validateConfig(raw: unknown): NeverminedPluginConfig {
  return NeverminedPluginConfigSchema.parse(raw)
}

export function createPaymentsFromConfig(config: NeverminedPluginConfig): Payments {
  return Payments.getInstance({
    nvmApiKey: config.nvmApiKey,
    environment: config.environment as EnvironmentName,
  })
}
