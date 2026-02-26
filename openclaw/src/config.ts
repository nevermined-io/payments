import { z } from 'zod'
import { Payments } from '@nevermined-io/payments'
import type { EnvironmentName } from '@nevermined-io/payments'

const PlanEntrySchema = z.object({
  planId: z.string(),
  name: z.string().optional(),
  paymentType: z.enum(['crypto', 'fiat']).default('crypto'),
  credits: z.number().optional(),
  price: z.string().optional(),
})

export type PlanEntry = z.infer<typeof PlanEntrySchema>

export const NeverminedPluginConfigSchema = z.object({
  nvmApiKey: z.string().optional(),
  environment: z.enum(['sandbox', 'live']).default('sandbox'),
  /** @deprecated Use `plans` array instead. Kept for backwards compatibility. */
  planId: z.string().optional(),
  /** @deprecated Use `plans` array instead. Kept for backwards compatibility. */
  fiatPlanId: z.string().optional(),
  plans: z.array(PlanEntrySchema).default([]),
  agentId: z.string().optional(),
  creditsPerRequest: z.number().int().positive().default(1),
  creditsPerMinute: z.number().positive().default(1),
  enablePaidEndpoint: z.boolean().default(false),
  agentEndpointPath: z.string().default('/nevermined/agent'),
  paymentType: z.enum(['crypto', 'fiat']).default('crypto'),
  defaultSpendingLimitCents: z.number().int().positive().default(1000),
  defaultDelegationDurationSecs: z.number().int().positive().default(3600),
})

export type NeverminedPluginConfig = z.infer<typeof NeverminedPluginConfigSchema>

/**
 * Returns the effective list of plans, merging the `plans` array with legacy
 * `planId`/`fiatPlanId` fields for backwards compatibility.
 */
export function getEffectivePlans(config: NeverminedPluginConfig): PlanEntry[] {
  if (config.plans.length > 0) return config.plans

  // Backwards compatibility: build plans array from legacy fields
  const plans: PlanEntry[] = []
  if (config.planId) plans.push({ planId: config.planId, paymentType: 'crypto' })
  if (config.fiatPlanId) plans.push({ planId: config.fiatPlanId, paymentType: 'fiat' })
  return plans
}

export function validateConfig(raw: unknown): NeverminedPluginConfig {
  return NeverminedPluginConfigSchema.parse(raw)
}

export function requireApiKey(config: NeverminedPluginConfig): string {
  if (!config.nvmApiKey) {
    throw new Error('Not authenticated. Run /nvm_login first.')
  }
  return config.nvmApiKey
}

export function createPaymentsFromConfig(config: NeverminedPluginConfig): Payments {
  return Payments.getInstance({
    nvmApiKey: requireApiKey(config),
    environment: config.environment as EnvironmentName,
  })
}
