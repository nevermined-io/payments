/**
 * X402 Token Generation API.
 *
 * Provides X402 access token generation functionality for subscribers.
 * Tokens are used to authorize payment verification and settlement.
 */

import { BasePaymentsAPI } from '../api/base-payments.js'
import { API_URL_GET_AGENT_X402_ACCESS_TOKEN } from '../api/nvm-api.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions } from '../common/types.js'



/**
 * X402 Token API for generating access tokens.
 *
 * Handles X402 access token generation for subscribers to authorize
 * payment operations with AI agents.
 */
export class X402TokenAPI extends BasePaymentsAPI {
  /**
   * Get a singleton instance of the X402TokenAPI class.
   *
   * @param options - The options to initialize the API
   * @returns The instance of the X402TokenAPI class
   */
  static getInstance(options: PaymentOptions): X402TokenAPI {
    return new X402TokenAPI(options)
  }

  /**
   * Get an X402 access token for the given plan and agent.
   *
   * This token allows the agent to verify and settle permissions on behalf
   * of the subscriber. The token contains cryptographically signed session keys
   * that delegate specific permissions (order, burn) to the agent.
   *
   * @param planId - The unique identifier of the payment plan
   * @param agentId - The unique identifier of the AI agent
   * @returns A promise that resolves to an object containing:
   *   - accessToken: The X402 access token string
   *   - Additional metadata about the token
   *
   * @throws PaymentsError if the request fails
   *
   * @example
   * ```typescript
   * import { Payments } from '@nevermined-io/payments'
   *
   * const payments = Payments.getInstance({
   *   nvmApiKey: 'nvm:subscriber-key',
   *   environment: 'sandbox'
   * })
   *
   * const result = await payments.x402.getX402AccessToken(planId, agentId)
   * const token = result.accessToken
   * ```
   */
  async getX402AccessToken(
    planId: string,
    agentId: string,
  ): Promise<{ accessToken: string;[key: string]: any }> {
    const urlPath = API_URL_GET_AGENT_X402_ACCESS_TOKEN.replace(':planId', planId)
    const url = new URL(urlPath, this.environment.backend)

    // Add agentId as query parameter
    url.searchParams.set('agentId', agentId)

    const options = this.getBackendHTTPOptions('GET')

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        let errorMessage = 'Failed to get X402 access token'
        try {
          const errorData = await response.json()
          errorMessage = errorData.message || errorMessage
        } catch {
          // Use default error message
        }
        throw PaymentsError.internal(`${errorMessage} (HTTP ${response.status})`)
      }
      return await response.json()
    } catch (error) {
      if (error instanceof PaymentsError) {
        throw error
      }
      throw PaymentsError.internal(
        `Network error while getting X402 access token: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
