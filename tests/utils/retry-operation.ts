/**
 * @file Shared retry and polling utilities
 */

/**
 * Retries an async operation with exponential backoff.
 * @param operation - Function that returns a Promise
 * @returns The result of the operation
 */
export async function retryOperation<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 6
  let delay = 1200
  const maxDelay = 5000
  const factor = 2
  const jitterRatio = 0.25

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation()
      return result
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts) break
      const jitter = delay * jitterRatio * (Math.random() * 2 - 1) // +/- jitter
      const sleepMs = Math.max(0, Math.floor(delay + jitter))
      await new Promise((r) => setTimeout(r, sleepMs))
      delay = Math.min(delay * factor, maxDelay)
    }
  }
  throw new Error(
    `operation failed after ${maxAttempts} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  )
}

/**
 * Polls a condition until it returns a non-null value or timeout expires.
 * This is different from retryOperation: it waits for a condition to be met,
 * not for an operation to succeed after failures.
 * @param conditionFn - Function that returns a Promise<T | null>. Returns null to continue polling.
 * @param maxAttempts - Maximum number of polling attempts (default: 30)
 * @param intervalMs - Interval between polling attempts in milliseconds (default: 1000)
 * @returns The first non-null value returned by conditionFn
 */
export async function pollForCondition<T>(
  conditionFn: () => Promise<T | null | undefined>,
  maxAttempts: number = 30,
  intervalMs: number = 1000,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await conditionFn()
    if (result !== null && result !== undefined) {
      return result
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  throw new Error(`Condition not met after ${maxAttempts} attempts`)
}

/**
 * Waits for a condition until timeout using polling.
 * Convenience wrapper around pollForCondition that calculates maxAttempts from timeout.
 * @param predicate - Async predicate that returns a truthy value to stop waiting, or null/undefined to continue
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 45000)
 * @param intervalMs - Poll interval in milliseconds (default: 1500)
 * @returns The first truthy value returned by predicate
 */
export async function waitForCondition<T>(
  predicate: () => Promise<T | null | undefined>,
  timeoutMs: number = 45_000,
  intervalMs: number = 1_500,
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(timeoutMs / Math.max(1, intervalMs)))
  return pollForCondition(predicate, maxAttempts, intervalMs)
}
