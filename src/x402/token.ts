/**
 * X402 Token Generation API.
 *
 * Provides X402 access token generation functionality for subscribers.
 * Tokens are used to authorize payment verification and settlement.
 */

import { BasePaymentsAPI } from '../api/base-payments.js'
import { API_URL_CREATE_PERMISSION } from '../api/nvm-api.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions, X402TokenOptions, X402_SCHEME_NETWORKS } from '../common/types.js'

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
   * Create a permission and get an X402 access token for the given plan.
   *
   * This token allows the agent to verify and settle permissions on behalf
   * of the subscriber. The token contains cryptographically signed session keys
   * that delegate specific permissions (order, burn) to the agent.
   *
   * @param planId - The unique identifier of the payment plan
   * @param agentId - The unique identifier of the AI agent (optional). If provided, permissions are restricted to that specific agent.
   * @param redemptionLimit - Maximum number of interactions/redemptions allowed (optional)
   * @param orderLimit - Maximum spend limit in token units (wei) for ordering (optional)
   * @param expiration - Expiration date in ISO 8601 format, e.g. "2025-02-01T10:00:00Z" (optional)
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
    agentId?: string,
    redemptionLimit?: number,
    orderLimit?: string,
    expiration?: string,
    tokenOptions?: X402TokenOptions,
  ): Promise<{ accessToken: string;[key: string]: any }> {
    const urlPath = API_URL_CREATE_PERMISSION
    const url = new URL(urlPath, this.environment.backend)

    const scheme = tokenOptions?.scheme ?? 'nvm:erc4337'
    const network = tokenOptions?.network ?? X402_SCHEME_NETWORKS[scheme]

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

    // Add delegation config for card-delegation scheme
    if (scheme === 'nvm:card-delegation' && tokenOptions?.delegationConfig) {
      body.delegationConfig = tokenOptions.delegationConfig
    }

    // Add session key config if any options are provided (erc4337 only)
    if (scheme === 'nvm:erc4337') {
      const sessionKeyConfig: Record<string, any> = {}
      if (redemptionLimit !== undefined) {
        sessionKeyConfig.redemptionLimit = redemptionLimit
      }
      if (orderLimit !== undefined) {
        sessionKeyConfig.orderLimit = orderLimit
      }
      if (expiration !== undefined) {
        sessionKeyConfig.expiration = expiration
      }
      if (Object.keys(sessionKeyConfig).length > 0) {
        body.sessionKeyConfig = sessionKeyConfig
      }
    }

    const options = this.getBackendHTTPOptions('POST', body)

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        let errorMessage = 'Failed to create X402 permission'
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
        `Network error while creating X402 permission: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
