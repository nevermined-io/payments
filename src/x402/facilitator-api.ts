/**
 * The FacilitatorAPI class provides methods to verify and settle AI agent permissions using X402 access tokens.
 * This allows AI agents to act as facilitators, verifying and settling credits on behalf of subscribers.
 *
 * @example
 * ```typescript
 * import { Payments } from '@nevermined-io/payments'
 *
 * // Initialize the Payments instance
 * const payments = Payments.getInstance({
 *   nvmApiKey: 'your-nvm-api-key',
 *   environment: 'testing'
 * })
 *
 * // Get X402 access token from X402 API
 * const tokenResult = await payments.x402.getX402AccessToken('123', '456')
 * const x402Token = tokenResult.accessToken
 *
 * // Verify if subscriber has sufficient permissions/credits
 * const verification = await payments.facilitator.verifyPermissions({
 *   planId: '123',
 *   maxAmount: '2',
 *   x402AccessToken: x402Token,
 *   subscriberAddress: '0x1234...'
 * })
 *
 * if (verification.success) {
 *   // Settle (burn) the credits
 *   const settlement = await payments.facilitator.settlePermissions({
 *     planId: '123',
 *     maxAmount: '2',
 *     x402AccessToken: x402Token,
 *     subscriberAddress: '0x1234...'
 *   })
 *   console.log(`Credits burned: ${settlement.data.creditsBurned}`)
 * }
 * ```
 */

import { PaymentsError } from '../common/payments.error.js'
import { Address, PaymentOptions } from '../common/types.js'
import { BasePaymentsAPI } from '../api/base-payments.js'
import { API_URL_VERIFY_PERMISSIONS, API_URL_SETTLE_PERMISSIONS } from '../api/nvm-api.js'

export interface VerifyPermissionsParams {
  planId: string
  maxAmount: bigint
  x402AccessToken: string
  subscriberAddress: Address
}

export interface VerifyPermissionsResult {
  success: boolean
  [key: string]: any
}

export interface SettlePermissionsParams {
  planId: string
  maxAmount: bigint
  x402AccessToken: string
  subscriberAddress: Address
}

export interface SettlePermissionsResult {
  success: boolean
  data: {
    creditsBurned: string
    [key: string]: any
  }
  [key: string]: any
}

/**
 * The FacilitatorAPI class provides methods to verify and settle AI agent permissions.
 * It enables AI agents to act as facilitators, managing credit verification and settlement
 * for subscribers using X402 access tokens.
 */
export class FacilitatorAPI extends BasePaymentsAPI {
  /**
   * Get a singleton instance of the FacilitatorAPI class.
   *
   * @param options - The options to initialize the payments class
   * @returns The instance of the FacilitatorAPI class
   */
  static getInstance(options: PaymentOptions): FacilitatorAPI {
    return new FacilitatorAPI(options)
  }

  /**
   * Verify if a subscriber has permission to use credits from a payment plan.
   * This method simulates the credit usage without actually burning credits,
   * checking if the subscriber has sufficient balance and permissions.
   *
   * @param params - Verification parameters
   * @param params.planId - The unique identifier of the payment plan
   * @param params.maxAmount - The maximum number of credits to verify (as string)
   * @param params.x402AccessToken - The X402 access token for permission verification
   * @param params.subscriberAddress - The Ethereum address of the subscriber
   * @returns A promise that resolves to a verification result with 'success' boolean
   *
   * @throws PaymentsError if verification fails
   */
  async verifyPermissions(params: VerifyPermissionsParams): Promise<VerifyPermissionsResult> {
    const { planId, maxAmount, x402AccessToken, subscriberAddress } = params

    const url = new URL(API_URL_VERIFY_PERMISSIONS, this.environment.backend)

    const body = {
      planId,
      maxAmount,
      x402AccessToken,
      subscriberAddress,
    }

    const options = this.getBackendHTTPOptions('POST', body)

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        let errorMessage = 'Permission verification failed'
        try {
          const errorData = await response.json()
          errorMessage = errorData.message || errorMessage
        } catch {
          // Use default error message
        }
        throw PaymentsError.fromBackend(errorMessage, {
          message: errorMessage,
          code: `HTTP ${response.status}`,
          planId,
          subscriberAddress,
          maxAmount,
        })
      }
      return await response.json()
    } catch (error) {
      if (error instanceof PaymentsError) {
        throw error
      }
      throw PaymentsError.fromBackend('Network error during permission verification', {
        message: error instanceof Error ? error.message : String(error),
        code: 'network_error',
        planId,
        subscriberAddress,
      })
    }
  }

  /**
   * Settle (burn) credits from a subscriber's payment plan.
   * This method executes the actual credit consumption, burning the specified
   * number of credits from the subscriber's balance. If the subscriber doesn't
   * have enough credits, it will attempt to order more before settling.
   *
   * @param params - Settlement parameters
   * @param params.planId - The unique identifier of the payment plan
   * @param params.maxAmount - The number of credits to burn (as string)
   * @param params.x402AccessToken - The X402 access token for permission settlement
   * @param params.subscriberAddress - The Ethereum address of the subscriber
   * @returns A promise that resolves to a settlement result with transaction details
   *
   * @throws PaymentsError if settlement fails
   */
  async settlePermissions(params: SettlePermissionsParams): Promise<SettlePermissionsResult> {
    const { planId, maxAmount, x402AccessToken, subscriberAddress } = params

    const url = new URL(API_URL_SETTLE_PERMISSIONS, this.environment.backend)

    const body = {
      planId,
      maxAmount,
      x402AccessToken,
      subscriberAddress,
    }

    const options = this.getBackendHTTPOptions('POST', body)

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        let errorMessage = 'Permission settlement failed'
        try {
          const errorData = await response.json()
          errorMessage = errorData.message || errorMessage
        } catch {
          // Use default error message
        }
        throw PaymentsError.fromBackend(errorMessage, {
          message: errorMessage,
          code: `HTTP ${response.status}`,
          planId,
          subscriberAddress,
          maxAmount,
        })
      }
      return await response.json()
    } catch (error) {
      if (error instanceof PaymentsError) {
        throw error
      }
      throw PaymentsError.fromBackend('Network error during permission settlement', {
        message: error instanceof Error ? error.message : String(error),
        code: 'network_error',
        planId,
        subscriberAddress,
      })
    }
  }
}
