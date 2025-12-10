/**
 * Shared test utilities for polling async conditions (e.g., waiting for RPC sync).
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - rootDir restriction doesn't apply to test utilities importing from src
import { ZeroAddress } from '../src/environments.js'

/**
 * Compute exponential backoff delay with jitter.
 *
 * The delay grows exponentially with attempts and includes a small random
 * jitter to avoid thundering herds, capped at max_delay_secs.
 */
function computeBackoffDelay(
  attemptIndex: number,
  baseDelaySecs: number,
  maxDelaySecs: number,
): number {
  const exponential = baseDelaySecs * Math.pow(2, Math.max(0, attemptIndex - 1))
  const jitter = 0.85 + Math.random() * 0.3 // Random between 0.85 and 1.15
  return Math.min(maxDelaySecs, exponential * jitter)
}

/**
 * Run a function with bounded retries and exponential backoff.
 *
 * @param func - Zero-arg function to execute (can be sync or async)
 * @param options - Configuration options:
 *   - label: Human-readable label for logging purposes (default: 'operation')
 *   - attempts: Maximum attempts including the first try (default: 6)
 *   - baseDelaySecs: Initial delay before the second attempt (default: 0.5)
 *   - maxDelaySecs: Upper bound for the backoff delay (default: 8.0)
 *   - retryOn: Exception types/constructors that trigger a retry (default: retries on any error)
 *   - onRetry: Optional callback invoked before sleeping between retries
 * @returns Promise resolving to the return value from func
 * @throws The last caught exception if all attempts fail
 */
export async function retryWithBackoff<T>(
  func: () => T | Promise<T>,
  options: {
    label?: string
    attempts?: number
    baseDelaySecs?: number
    maxDelaySecs?: number
    retryOn?: Array<new (...args: any[]) => Error>
    onRetry?: (attempt: number, error: Error, delaySecs: number) => void
  } = {},
): Promise<T> {
  const {
    label = 'operation',
    attempts = 6,
    baseDelaySecs = 0.5,
    maxDelaySecs = 8.0,
    retryOn,
    onRetry,
  } = options

  let lastError: Error | null = null

  for (let i = 1; i <= Math.max(1, attempts); i++) {
    try {
      return await func()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // If retryOn is specified, check if this error type should trigger a retry
      // If not specified, retry on any error (matching Python's default behavior)
      const shouldRetry =
        retryOn === undefined || retryOn.some((ErrorType) => lastError instanceof ErrorType)

      if (!shouldRetry || i >= attempts) {
        break
      }

      const delay = computeBackoffDelay(i, baseDelaySecs, maxDelaySecs)

      if (onRetry) {
        try {
          onRetry(i, lastError, delay)
        } catch {
          // Never allow logging hooks to break the retry flow
        }
      }

      await new Promise((resolve) => setTimeout(resolve, delay * 1000))
    }
  }

  if (!lastError) {
    throw new Error(`${label} failed after ${attempts} attempts`)
  }

  throw lastError
}

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
