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
    MAX_DELAY: 10000,    // 10 seconds
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
    return new Promise(resolve => setTimeout(resolve, ms))
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
    backoffMultiplier: number = E2E_TEST_CONFIG.RETRY_CONFIG.BACKOFF_MULTIPLIER
  ): Promise<T> {
    let lastError: Error | null = null
    let delay = initialDelay

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[E2E RETRY] ${operationName} - Attempt ${attempt}/${maxAttempts}`)
        const result = await operation()
        console.log(`[E2E RETRY] ${operationName} - Success on attempt ${attempt}`)
        return result
      } catch (error) {
        lastError = error as Error
        console.log(`[E2E RETRY] ${operationName} - Attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`)
        
        if (attempt === maxAttempts) {
          console.log(`[E2E RETRY] ${operationName} - All ${maxAttempts} attempts failed`)
          throw new Error(`${operationName} failed after ${maxAttempts} attempts. Last error: ${lastError.message}`)
        }
        
        // Wait before next attempt with exponential backoff
        await this.wait(delay)
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
    intervalMs: number = 1000
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
} 