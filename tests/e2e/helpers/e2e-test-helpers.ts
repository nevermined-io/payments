/**
 * @file E2E Test Helpers
 * @description Utilities and configuration for E2E tests
 */

// E2E Test Configuration
export const E2E_TEST_CONFIG = {
  TIMEOUT: 30_000,
  RETRY_CONFIG: {
    MAX_ATTEMPTS: 5,
    INITIAL_DELAY: 1000, // 1 second
    MAX_DELAY: 10000, // 10 seconds
    BACKOFF_MULTIPLIER: 2,
  },
}

/**
 * Utility functions for E2E tests
 */
export class E2ETestUtils {
  /**
   * Waits for a specified amount of time
   */
  static async wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Retries an operation with exponential backoff
   * @param operation - The operation to retry
   * @param operationName - Name of the operation for logging
   * @param maxAttempts - Maximum number of attempts
   * @param initialDelay - Initial delay in milliseconds
   * @param maxDelay - Maximum delay in milliseconds
   * @param backoffMultiplier - Multiplier for exponential backoff
   * @returns The result of the operation
   */
  static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationName: string = 'Operation',
    maxAttempts: number = E2E_TEST_CONFIG.RETRY_CONFIG.MAX_ATTEMPTS,
    initialDelay: number = E2E_TEST_CONFIG.RETRY_CONFIG.INITIAL_DELAY,
    maxDelay: number = E2E_TEST_CONFIG.RETRY_CONFIG.MAX_DELAY,
    backoffMultiplier: number = E2E_TEST_CONFIG.RETRY_CONFIG.BACKOFF_MULTIPLIER,
  ): Promise<T> {
    let lastError: Error | null = null
    let delay = initialDelay

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await operation()
        return result
      } catch (error) {
        lastError = error as Error

        if (attempt === maxAttempts) {
          throw new Error(
            `${operationName} failed after ${maxAttempts} attempts. Last error: ${lastError.message}`,
          )
        }

        // Wait before next attempt with exponential backoff
        // Add small jitter (±15%) to avoid thundering herds
        const jitter = 1 + (Math.random() * 0.3 - 0.15)
        await this.wait(Math.floor(delay * jitter))
        delay = Math.min(delay * backoffMultiplier, maxDelay)
      }
    }

    throw lastError!
  }

  /**
   * Polls for a condition to be met
   */
  static async pollForCondition<T>(
    conditionFn: () => Promise<T | null>,
    maxAttempts: number = 30,
    intervalMs: number = 1000,
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await conditionFn()
      if (result !== null) {
        return result
      }

      if (attempt < maxAttempts) {
        await this.wait(intervalMs)
      }
    }

    throw new Error(`Condition not met after ${maxAttempts} attempts`)
  }

  /**
   * Waits for a condition until timeout using polling (convenience wrapper around pollForCondition)
   * @param predicate Async predicate that returns a truthy value (or value) to stop waiting, or null/undefined to continue
   * @param timeoutMs Maximum time to wait in milliseconds
   * @param intervalMs Poll interval in milliseconds
   */
  static async waitForCondition<T>(
    predicate: () => Promise<T | null | undefined>,
    timeoutMs: number = 45_000,
    intervalMs: number = 1_500,
  ): Promise<T> {
    const maxAttempts = Math.max(1, Math.floor(timeoutMs / Math.max(1, intervalMs)))
    return this.pollForCondition(
      async () => {
        const value = await predicate()
        return value ? value : null
      },
      maxAttempts,
      intervalMs,
    )
  }

  /**
   * Fetch wrapper with timeout using AbortController to avoid hanging tests
   * @param url Request URL
   * @param options Fetch options
   * @param timeoutMs Timeout in milliseconds (default 10000)
   */
  static async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = 10_000,
  ): Promise<Response> {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      return response
    } finally {
      clearTimeout(id)
    }
  }
}
