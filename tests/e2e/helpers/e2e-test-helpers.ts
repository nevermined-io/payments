/**
 * @file E2E Test Helpers
 * @description Utilities and configuration for E2E tests
 */

// E2E Test Configuration
export const E2E_TEST_CONFIG = {
  TIMEOUT: 30_000,
}

/**
 * Utility functions for E2E tests
 * Note: For retry and polling operations, use retryOperation, pollForCondition,
 * and waitForCondition from '../utils/retry-operation.js' instead.
 */
export class E2ETestUtils {
  /**
   * Waits for a specified amount of time
   */
  static async wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
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
