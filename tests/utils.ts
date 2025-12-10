/**
 * Shared test utilities for polling async conditions (e.g., waiting for RPC sync).
 */
import { ZeroAddress } from '../src/environments.js'

/**
 * Poll until the provided function returns true or timeout elapses.
 */
export async function waitForCondition(
  fn: () => Promise<boolean>,
  label: string,
  timeoutMs = 45_000,
  intervalMs = 3_000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (await fn()) return
    } catch {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`${label} not satisfied within ${timeoutMs}ms`)
}

/**
 * Wait for a plan to be available (and optionally satisfy a predicate).
 */
export function makeWaitForPlan<T = any>(
  getPlan: (planId: string) => Promise<T>,
  label = 'Plan availability',
) {
  return async function waitForPlan(
    planId: string,
    timeoutMs = 45_000,
    intervalMs = 3_000,
  ): Promise<T> {
    let latest: T | undefined
    await waitForCondition(
      async () => {
        try {
          latest = await getPlan(planId)
          if (!latest) return false
          const registry = (latest as any).registry || {}
          const owner = registry.owner ? registry.owner.toLowerCase() : ''
          if (!owner || owner === ZeroAddress.toLowerCase()) return false
          return true
        } catch {
          return false
        }
      },
      label,
      timeoutMs,
      intervalMs,
    )
    return latest as T
  }
}

/**
 * Wait for an agent to be available (and optionally satisfy a predicate).
 */
export function makeWaitForAgent<T = any>(
  getAgent: (agentId: string) => Promise<T>,
  label = 'Agent availability',
) {
  return async function waitForAgent(
    agentId: string,
    timeoutMs = 30_000,
    intervalMs = 2_000,
  ): Promise<T> {
    let latest: T | undefined
    await waitForCondition(
      async () => {
        try {
          latest = await getAgent(agentId)
          return !!latest
        } catch {
          return false
        }
      },
      label,
      timeoutMs,
      intervalMs,
    )
    return latest as T
  }
}
