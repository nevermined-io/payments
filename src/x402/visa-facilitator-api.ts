/**
 * Visa Facilitator API — verifies and settles payments via the Visa x402 backend.
 *
 * Unlike the base FacilitatorAPI (which sends JSON bodies to the NVM backend),
 * the Visa flow uses the PAYMENT-SIGNATURE HTTP header to transport a base64-encoded
 * PaymentPayload to the Visa backend's /verify and /settle endpoints.
 *
 * @example
 * ```typescript
 * import { Payments } from '@nevermined-io/payments'
 *
 * const payments = Payments.getInstance({
 *   nvmApiKey: 'your-nvm-api-key',
 *   environment: 'sandbox',
 *   scheme: 'visa',
 * })
 *
 * const paymentRequired = buildVisaPaymentRequired({
 *   amount: '2.00',
 *   asset: 'USD',
 *   payTo: 'merchant-id',
 *   endpoint: '/tools/random-article',
 * })
 *
 * // The PAYMENT-SIGNATURE header from the client request
 * const paymentSignature = req.headers['payment-signature'] as string
 *
 * const verification = await payments.facilitator.verifyPermissions({
 *   paymentRequired,
 *   x402AccessToken: paymentSignature,
 * })
 *
 * if (verification.isValid) {
 *   const settlement = await payments.facilitator.settlePermissions({
 *     paymentRequired,
 *     x402AccessToken: paymentSignature,
 *   })
 * }
 * ```
 */

import { FacilitatorAPI } from './facilitator-api.js'
import type {
  VerifyPermissionsParams,
  VerifyPermissionsResult,
  SettlePermissionsParams,
  SettlePermissionsResult,
  X402Resource,
} from './facilitator-api.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions } from '../common/types.js'
import { VisaBackendUrls } from '../environments.js'

// ---------------------------------------------------------------------------
// Visa-specific x402 types
// ---------------------------------------------------------------------------

/**
 * Visa-specific extra fields in PaymentRequirements
 */
export interface VisaPaymentExtra {
  /** Visa Token Service provisioned token ID */
  vProvisionedTokenID: string
  /** VIC instruction ID from mandate creation */
  instructionId: string
  /** Maximum number of times this payment can be used */
  maxUsage: number
  /** Merchant name */
  merchantName?: string
  /** Merchant URL */
  merchantUrl?: string
  /** Merchant country code */
  merchantCountryCode?: string
}

/**
 * Visa payment requirements (x402 v2 with scheme: "visa")
 */
export interface VisaPaymentRequirements {
  scheme: 'visa'
  network: 'visa:vts'
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra: VisaPaymentExtra
}

/**
 * Visa-specific PaymentRequired response
 */
export interface VisaPaymentRequired {
  x402Version: 2
  error?: string
  resource: X402Resource
  accepts: VisaPaymentRequirements[]
  extensions?: Record<string, unknown>
}

/**
 * Visa verify response
 */
export interface VisaVerifyResponse {
  isValid: boolean
  payer?: string
  invalidReason?: string
  remainingUsage?: number
}

/**
 * Visa settlement response
 */
export interface VisaSettlementResponse {
  success: boolean
  transaction: string
  network: 'visa:vts'
  payer?: string
  errorReason?: string
}

// ---------------------------------------------------------------------------
// Visa x402 header names
// ---------------------------------------------------------------------------

export const VISA_X402_HEADERS = {
  PAYMENT_REQUIRED: 'PAYMENT-REQUIRED',
  PAYMENT_SIGNATURE: 'PAYMENT-SIGNATURE',
  PAYMENT_RESPONSE: 'PAYMENT-RESPONSE',
} as const

// ---------------------------------------------------------------------------
// Helper: build a Visa PaymentRequired
// ---------------------------------------------------------------------------

/**
 * Build a Visa-flavored X402PaymentRequired object.
 *
 * This is the Visa counterpart of `buildPaymentRequired` (which builds NVM-flavored ones).
 */
export function buildVisaPaymentRequired(options: {
  amount: string
  asset?: string
  payTo: string
  endpoint?: string
  description?: string
  maxTimeoutSeconds?: number
  merchantName?: string
  merchantUrl?: string
  merchantCountryCode?: string
}): VisaPaymentRequired {
  const {
    amount,
    asset = 'USD',
    payTo,
    endpoint = '',
    description,
    maxTimeoutSeconds = 3600,
    merchantName,
    merchantUrl,
    merchantCountryCode,
  } = options

  return {
    x402Version: 2,
    resource: {
      url: endpoint,
      ...(description && { description }),
    },
    accepts: [
      {
        scheme: 'visa',
        network: 'visa:vts',
        amount,
        asset,
        payTo,
        maxTimeoutSeconds,
        extra: {
          vProvisionedTokenID: '',
          instructionId: '',
          maxUsage: 1,
          ...(merchantName && { merchantName }),
          ...(merchantUrl && { merchantUrl }),
          ...(merchantCountryCode && { merchantCountryCode }),
        },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// VisaFacilitatorAPI
// ---------------------------------------------------------------------------

/**
 * Visa Facilitator API — sends PAYMENT-SIGNATURE header to the Visa backend
 * for verify and settle operations.
 */
export class VisaFacilitatorAPI extends FacilitatorAPI {
  protected visaBackendUrl: string

  constructor(options: PaymentOptions) {
    super(options)
    this.visaBackendUrl = VisaBackendUrls[this.environmentName]
  }

  static override getInstance(options: PaymentOptions): VisaFacilitatorAPI {
    return new VisaFacilitatorAPI(options)
  }

  /**
   * Verify a Visa payment authorization.
   *
   * Sends the base64-encoded PaymentPayload as a PAYMENT-SIGNATURE header
   * to the Visa backend's POST /verify endpoint.
   *
   * @param params - contains x402AccessToken, the base64-encoded PaymentPayload from the client
   */
  override async verifyPermissions(
    params: VerifyPermissionsParams,
  ): Promise<VerifyPermissionsResult> {
    const { x402AccessToken } = params
    const url = new URL('verify', this.visaBackendUrl)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          [VISA_X402_HEADERS.PAYMENT_SIGNATURE]: x402AccessToken,
        },
      })

      if (!response.ok) {
        let errorMessage = 'Visa payment verification failed'
        try {
          const errorData = await response.json()
          errorMessage = errorData.invalidReason || errorData.message || errorMessage
        } catch {
          // Use default error message
        }
        throw PaymentsError.fromBackend(errorMessage, {
          message: errorMessage,
          code: `HTTP ${response.status}`,
        })
      }

      const visaResult: VisaVerifyResponse = await response.json()

      // Map Visa response to the standard VerifyPermissionsResult shape
      return {
        isValid: visaResult.isValid,
        payer: visaResult.payer,
        invalidReason: visaResult.invalidReason,
      }
    } catch (error) {
      if (error instanceof PaymentsError) {
        throw error
      }
      throw PaymentsError.fromBackend('Network error during Visa payment verification', {
        message: error instanceof Error ? error.message : String(error),
        code: 'network_error',
      })
    }
  }

  /**
   * Settle a Visa payment transaction.
   *
   * Sends the base64-encoded PaymentPayload as a PAYMENT-SIGNATURE header
   * to the Visa backend's POST /settle endpoint.
   *
   * @param params - contains x402AccessToken, the base64-encoded PaymentPayload from the client
   */
  override async settlePermissions(
    params: SettlePermissionsParams,
  ): Promise<SettlePermissionsResult> {
    const { x402AccessToken } = params
    const url = new URL('settle', this.visaBackendUrl)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          [VISA_X402_HEADERS.PAYMENT_SIGNATURE]: x402AccessToken,
        },
      })

      if (!response.ok) {
        let errorMessage = 'Visa payment settlement failed'
        try {
          const errorData = await response.json()
          errorMessage = errorData.errorReason || errorData.message || errorMessage
        } catch {
          // Use default error message
        }
        throw PaymentsError.fromBackend(errorMessage, {
          message: errorMessage,
          code: `HTTP ${response.status}`,
        })
      }

      const visaResult: VisaSettlementResponse = await response.json()

      // Map Visa response to the standard SettlePermissionsResult shape
      return {
        success: visaResult.success,
        transaction: visaResult.transaction,
        network: visaResult.network,
        payer: visaResult.payer,
        errorReason: visaResult.errorReason,
      }
    } catch (error) {
      if (error instanceof PaymentsError) {
        throw error
      }
      throw PaymentsError.fromBackend('Network error during Visa payment settlement', {
        message: error instanceof Error ? error.message : String(error),
        code: 'network_error',
      })
    }
  }
}
