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
 *   environment: 'sandbox'
 * })
 *
 * // Get X402 access token from X402 API
 * const tokenResult = await payments.x402.getX402AccessToken('123', '456')
 * const x402Token = tokenResult.accessToken
 *
 * // Verify if subscriber has sufficient permissions/credits
 * // Note: planId and subscriberAddress are extracted from the token
 * const verification = await payments.facilitator.verifyPermissions({
 *   x402AccessToken: x402Token,
 *   maxAmount: 2n
 * })
 *
 * if (verification.isValid) {
 *   // Settle (burn) the credits
 *   const settlement = await payments.facilitator.settlePermissions({
 *     x402AccessToken: x402Token,
 *     maxAmount: 2n
 *   })
 *   console.log(`Credits redeemed: ${settlement.creditsRedeemed}`)
 * }
 * ```
 */

import { BasePaymentsAPI } from '../api/base-payments.js'
import { API_URL_SETTLE_PERMISSIONS, API_URL_VERIFY_PERMISSIONS } from '../api/nvm-api.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions } from '../common/types.js'

/**
 * x402 Resource information
 */
export interface X402Resource {
  /** The protected resource URL */
  url: string
  /** Human-readable description */
  description?: string
  /** Expected response MIME type (e.g., "application/json") */
  mimeType?: string
}

/**
 * x402 Scheme extra fields for nvm:erc4337
 */
export interface X402SchemeExtra {
  /** Scheme version (e.g., "1") */
  version?: string
  /** Agent identifier */
  agentId?: string
  /** HTTP method for the endpoint */
  httpVerb?: string
}

/**
 * x402 Scheme definition (nvm:erc4337)
 */
export interface X402Scheme {
  /** Payment scheme identifier (e.g., "nvm:erc4337") */
  scheme: string
  /** Blockchain network in CAIP-2 format (e.g., "eip155:84532") */
  network: string
  /** 256-bit plan identifier */
  planId: string
  /** Scheme-specific extra fields */
  extra?: X402SchemeExtra
}

/**
 * x402 PaymentRequired response (402 response from server)
 */
export interface X402PaymentRequired {
  /** x402 protocol version (always 2) */
  x402Version: number
  /** Human-readable error message */
  error?: string
  /** Protected resource information */
  resource?: X402Resource
  /** Array of accepted payment schemes */
  accepts: X402Scheme[]
  /** Extensions object (empty {} for nvm:erc4337) */
  extensions?: Record<string, unknown>
}

/**
 * Parameters for verifying permissions
 */
export interface VerifyPermissionsParams {
  /** The X402 access token (base64-encoded) */
  x402AccessToken: string
  /** Maximum credits to verify (optional) */
  maxAmount?: bigint
  /** x402 PaymentRequired from 402 response (optional, for validation) */
  paymentRequired?: X402PaymentRequired
}

/**
 * x402 Verify Response - per x402 facilitator spec
 * @see https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md
 */
export interface VerifyPermissionsResult {
  /** Whether the payment authorization is valid */
  isValid: boolean
  /** Reason for invalidity (only present if isValid is false) */
  invalidReason?: string
  /** Address of the payer's wallet */
  payer?: string
  /** Agent request ID for observability tracking (Nevermined extension) */
  agentRequestId?: string
}

/**
 * Parameters for settling permissions
 */
export interface SettlePermissionsParams {
  /** The X402 access token (base64-encoded) */
  x402AccessToken: string
  /** Number of credits to burn (optional) */
  maxAmount?: bigint
  /** x402 PaymentRequired from 402 response (optional, for validation) */
  paymentRequired?: X402PaymentRequired
}

/**
 * x402 Settle Response - per x402 facilitator spec
 * @see https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md
 */
export interface SettlePermissionsResult {
  /** Whether settlement was successful */
  success: boolean
  /** Reason for settlement failure (only present if success is false) */
  errorReason?: string
  /** Address of the payer's wallet */
  payer?: string
  /** Blockchain transaction hash (empty string if settlement failed) */
  transaction: string
  /** Blockchain network identifier in CAIP-2 format */
  network: string
  /** Number of credits redeemed (Nevermined extension) */
  creditsRedeemed?: string
  /** Subscriber's remaining balance (Nevermined extension) */
  remainingBalance?: string
  /** Transaction hash of the order operation if auto top-up occurred (Nevermined extension) */
  orderTx?: string
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
   * The planId and subscriberAddress are extracted from the x402AccessToken.
   *
   * @param params - Verification parameters (see {@link VerifyPermissionsParams}).
   *   - x402AccessToken: X402 access token (contains planId, subscriberAddress, agentId)
   *   - maxAmount: maximum credits to verify (optional, bigint)
   *   - paymentRequired: x402 PaymentRequired from 402 response (optional, for validation)
   * @returns A promise that resolves to a verification result with 'isValid' boolean
   *
   * @throws PaymentsError if verification fails
   */
  async verifyPermissions(params: VerifyPermissionsParams): Promise<VerifyPermissionsResult> {
    const { x402AccessToken, maxAmount, paymentRequired } = params

    const url = new URL(API_URL_VERIFY_PERMISSIONS, this.environment.backend)

    const body: Record<string, unknown> = {
      x402AccessToken,
    }

    if (maxAmount !== undefined) {
      body.maxAmount = maxAmount.toString()
    }
    if (paymentRequired !== undefined) {
      body.paymentRequired = paymentRequired
    }

    const options = this.getPublicHTTPOptions('POST', body)

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
      })
    }
  }

  /**
   * Settle (burn) credits from a subscriber's payment plan.
   * This method executes the actual credit consumption, burning the specified
   * number of credits from the subscriber's balance. If the subscriber doesn't
   * have enough credits, it will attempt to order more before settling.
   *
   * The planId and subscriberAddress are extracted from the x402AccessToken.
   *
   * @param params - Settlement parameters (see {@link SettlePermissionsParams}).
   *   - x402AccessToken: X402 access token (contains planId, subscriberAddress, agentId)
   *   - maxAmount: number of credits to burn (optional, bigint)
   *   - paymentRequired: x402 PaymentRequired from 402 response (optional, for validation)
   * @returns A promise that resolves to a settlement result with transaction details
   *
   * @throws PaymentsError if settlement fails
   */
  async settlePermissions(params: SettlePermissionsParams): Promise<SettlePermissionsResult> {
    const { x402AccessToken, maxAmount, paymentRequired } = params

    const url = new URL(API_URL_SETTLE_PERMISSIONS, this.environment.backend)

    const body: Record<string, unknown> = {
      x402AccessToken,
    }

    if (maxAmount !== undefined) {
      body.maxAmount = maxAmount.toString()
    }
    if (paymentRequired !== undefined) {
      body.paymentRequired = paymentRequired
    }

    const options = this.getPublicHTTPOptions('POST', body)

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
      })
    }
  }
}
