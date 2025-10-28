/**
 * @file Shared retryOperation without logging (pure backoff utility)
 */

/**
 * Retries an async operation with exponential backoff and logs attempts.
 * @param operation - Function that returns a Promise
 */
export async function retryOperation<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 6
  let delay = 1200
  const maxDelay = 15000
  const factor = 2
  const jitterRatio = 0.25

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation()
      return result
    } catch (err) {
      console.log('retryOperation error on attempt ', attempt, err)
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
