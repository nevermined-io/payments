/**
 * @file Shared retryOperation without logging (pure backoff utility)
 */

/**
 * Retries an async operation with exponential backoff and logs attempts.
 * @param operation - Function that returns a Promise
 */
export async function retryOperation<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 6
  let delay = 800
  const maxDelay = 15000
  const factor = 2
  const jitterRatio = 0.25
  const isRetryable = defaultRetryable

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation()
      return result
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts || !isRetryable(err)) break
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

function defaultRetryable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  // Retry on network/5xx/general server errors
  return (
    /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg) ||
    /Internal Server Error/i.test(msg) ||
    /5\d\d/.test(msg) ||
    /rate limit/i.test(msg)
  )
}
