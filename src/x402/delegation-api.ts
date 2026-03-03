/**
 * Delegation API for managing card-delegation payment methods.
 *
 * Provides access to the user's enrolled Stripe payment methods
 * for use with the nvm:card-delegation x402 scheme.
 */

import { BasePaymentsAPI } from '../api/base-payments.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions } from '../common/types.js'

/**
 * Summary of a user's enrolled payment method.
 */
export interface PaymentMethodSummary {
  /** Payment method ID (e.g., 'pm_...') */
  id: string
  /** Card brand (e.g., 'visa', 'mastercard') */
  brand: string
  /** Last 4 digits of the card number */
  last4: string
  /** Card expiration month */
  expMonth: number
  /** Card expiration year */
  expYear: number
}

/**
 * DTO for updating a payment method's alias and allowed API keys.
 */
export interface UpdatePaymentMethodDto {
  /** Human-readable alias for the card */
  alias?: string
  /** List of API key IDs allowed to use this card, or null to allow all */
  allowedApiKeyIds?: string[] | null
}

/**
 * API for listing enrolled payment methods for card delegation.
 */
export class DelegationAPI extends BasePaymentsAPI {
  /**
   * Get an instance of the DelegationAPI class.
   *
   * @param options - The options to initialize the API
   * @returns The instance of the DelegationAPI class
   */
  static getInstance(options: PaymentOptions): DelegationAPI {
    return new DelegationAPI(options)
  }

  /**
   * List the user's enrolled payment methods for card delegation.
   *
   * @returns A promise that resolves to an array of payment method summaries
   * @throws PaymentsError if the request fails
   */
  async listPaymentMethods(): Promise<PaymentMethodSummary[]> {
    const url = new URL('/api/v1/delegation/payment-methods', this.environment.backend)
    const options = this.getBackendHTTPOptions('GET')

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        let errorMessage = 'Failed to list payment methods'
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
        `Network error while listing payment methods: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * List the user's existing delegations.
   *
   * @returns A promise that resolves to an array of delegation objects
   * @throws PaymentsError if the request fails
   */
  async listDelegations(): Promise<any[]> {
    const url = new URL('/api/v1/delegation', this.environment.backend)
    const options = this.getBackendHTTPOptions('GET')

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        let errorMessage = 'Failed to list delegations'
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
        `Network error while listing delegations: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Update a payment method's alias and/or allowed API keys.
   *
   * @param paymentMethodId - The UUID of the PaymentMethod entity to update
   * @param dto - The fields to update (alias, allowedApiKeyIds)
   * @returns A promise that resolves to the updated payment method
   * @throws PaymentsError if the request fails
   */
  async updatePaymentMethod(
    paymentMethodId: string,
    dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodSummary> {
    const url = new URL(
      `/api/v1/delegation/payment-methods/${paymentMethodId}`,
      this.environment.backend,
    )
    const options = this.getBackendHTTPOptions('PATCH', dto)

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        let errorMessage = 'Failed to update payment method'
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
        `Network error while updating payment method: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
