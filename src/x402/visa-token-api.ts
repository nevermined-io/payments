/**
 * Visa Token API — generates x402 payment payloads via the Visa backend.
 *
 * Instead of generating a cryptographic NVM access token (which requires session keys
 * and smart accounts), this API calls the Visa backend's /access-token endpoint
 * with a vProvisionedTokenID + instructionId + amount to get a base64-encoded
 * PaymentPayload suitable for the PAYMENT-SIGNATURE header.
 */

import { X402TokenAPI } from './token.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions } from '../common/types.js'
import { VisaBackendUrls } from '../environments.js'

/**
 * Response from the Visa backend's /access-token endpoint
 */
export interface VisaPaymentPayloadResponse {
  success: boolean
  payload?: unknown
  payloadEncoded?: string
  error?: string
}

/**
 * Visa Token API — generates payment payloads for Visa x402 flow.
 */
export class VisaTokenAPI extends X402TokenAPI {
  protected visaBackendUrl: string

  constructor(options: PaymentOptions) {
    super(options)
    this.visaBackendUrl = VisaBackendUrls[this.environmentName]
  }

  static override getInstance(options: PaymentOptions): VisaTokenAPI {
    return new VisaTokenAPI(options)
  }

  /**
   * Generate a Visa x402 payment payload.
   *
   * When called with only `amount`, the Visa backend resolves the user's Visa
   * credentials from the NVM API key sent in the Authorization header.
   *
   * When called with explicit Visa credentials (`vProvisionedTokenID` and
   * `instructionId`), those are sent directly to the Visa backend.
   *
   * @param amount - The payment amount (e.g. "1.00")
   * @param vProvisionedTokenID - The Visa Token Service provisioned token ID (optional)
   * @param instructionId - The VIC mandate instruction ID (optional)
   * @returns A promise resolving to an object with `accessToken` (the base64-encoded PaymentPayload)
   *
   * @example
   * ```typescript
   * // Using NVM API key (credentials resolved by backend)
   * const result = await payments.x402.getVisaAccessToken('1.00')
   *
   * // Using explicit Visa credentials
   * const result = await payments.x402.getVisaAccessToken(
   *   '2.00',
   *   'token-id-from-visa',
   *   'instruction-id-from-mandate',
   * )
   * // Use result.accessToken as the PAYMENT-SIGNATURE header value
   * ```
   */
  async getVisaAccessToken(
    amount: string,
    vProvisionedTokenID?: string,
    instructionId?: string,
  ): Promise<{ accessToken: string; [key: string]: any }> {
    const hasExplicitCredentials = vProvisionedTokenID && instructionId

    const url = hasExplicitCredentials
      ? new URL('access-token', this.visaBackendUrl)
      : new URL('access-token/from-nvm-key', this.visaBackendUrl)

    const body = hasExplicitCredentials
      ? { vProvisionedTokenID, instructionId, amount }
      : { amount }

    const fetchOptions = hasExplicitCredentials
      ? {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      : this.getBackendHTTPOptions('POST', body)

    try {
      const response = await fetch(url, fetchOptions)

      if (!response.ok) {
        let errorMessage = 'Failed to generate Visa payment payload'
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorData.message || errorMessage
        } catch {
          // Use default error message
        }
        throw PaymentsError.internal(`${errorMessage} (HTTP ${response.status})`)
      }

      const result: VisaPaymentPayloadResponse = await response.json()

      if (!result.success || !result.payloadEncoded) {
        throw PaymentsError.internal(result.error || 'Failed to generate Visa payment payload')
      }

      return {
        accessToken: result.payloadEncoded,
        payload: result.payload,
      }
    } catch (error) {
      if (error instanceof PaymentsError) {
        throw error
      }
      throw PaymentsError.internal(
        `Network error while generating Visa payment payload: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
