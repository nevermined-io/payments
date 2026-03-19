/**
 * X402 Token Generation API.
 *
 * Provides X402 access token generation functionality for subscribers.
 * Tokens are used to authorize payment verification and settlement.
 */

import { BasePaymentsAPI } from '../api/base-payments.js'
import { API_URL_CREATE_PERMISSION } from '../api/nvm-api.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions, X402TokenOptions, getDefaultNetwork } from '../common/types.js'

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
   * Create a delegation and get an X402 access token for the given plan.
   *
   * This token allows the agent to verify and settle delegations on behalf
   * of the subscriber.
   *
   * For erc4337 scheme, you must pass `tokenOptions.delegationConfig` with either:
   * - `delegationId` to reuse an existing delegation, or
   * - `spendingLimitCents` + `durationSecs` to auto-create a new one.
   *
   * @param planId - The unique identifier of the payment plan
   * @param agentId - The unique identifier of the AI agent (optional)
   * @param tokenOptions - Options controlling scheme and delegation behavior (optional)
   * @returns A promise that resolves to an object containing:
   *   - accessToken: The X402 access token string
   *
   * @throws PaymentsError if the request fails
   *
   * @example
   * ```typescript
   * // Pattern A — auto-create delegation
   * const result = await payments.x402.getX402AccessToken(planId, agentId, {
   *   delegationConfig: { spendingLimitCents: 10000, durationSecs: 604800 }
   * })
   *
   * // Pattern B — reuse existing delegation
   * const result = await payments.x402.getX402AccessToken(planId, agentId, {
   *   delegationConfig: { delegationId: 'existing-delegation-uuid' }
   * })
   * ```
   */
  async getX402AccessToken(
    planId: string,
    agentId?: string,
    tokenOptions?: X402TokenOptions,
  ): Promise<{ accessToken: string; [key: string]: any }> {
    const urlPath = API_URL_CREATE_PERMISSION
    const url = new URL(urlPath, this.environment.backend)

    const scheme = tokenOptions?.scheme ?? 'nvm:erc4337'
    const network = tokenOptions?.network ?? getDefaultNetwork(scheme, this.environmentName)

    // Build x402-aligned request body
    const body: Record<string, any> = {
      accepted: {
        scheme,
        network,
        planId,
        extra: {
          ...(agentId && { agentId }),
        },
      },
    }

    // Add delegation config for both erc4337 and card-delegation schemes
    if (tokenOptions?.delegationConfig) {
      body.delegationConfig = tokenOptions.delegationConfig
    }

    const options = this.getBackendHTTPOptions('POST', body)

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        let errorMessage = 'Failed to create X402 delegation token'
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
        `Network error while creating X402 delegation token: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
