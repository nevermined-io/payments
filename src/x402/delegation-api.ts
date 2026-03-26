/**
 * Delegation API for managing payment delegations (crypto and card schemes).
 *
 * Provides access to the user's enrolled payment methods and delegations
 * for use with the nvm:erc4337 and nvm:card-delegation x402 schemes.
 */

import { BasePaymentsAPI } from '../api/base-payments.js'
import { PaymentsError } from '../common/payments.error.js'
import { CreateDelegationPayload, CreateDelegationResponse, PaymentOptions } from '../common/types.js'

/**
 * Summary of a user's enrolled payment method.
 */
export interface PaymentMethodSummary {
  /** Payment method ID (Stripe 'pm_...' or Braintree vault token) */
  id: string
  /** Payment method type (e.g., 'card', 'paypal') */
  type: string
  /** Card brand (e.g., 'visa', 'mastercard') or payment method type ('paypal', 'venmo') */
  brand: string
  /** Last 4 digits (cards) or email/username (PayPal/Venmo) */
  last4: string
  /** Expiration month (0 for non-card methods) */
  expMonth: number
  /** Expiration year (0 for non-card methods) */
  expYear: number
  /** Human-readable alias, if set */
  alias?: string | null
  /** Payment provider: 'stripe' or 'braintree' */
  provider?: string
  /** Current status ('Active' or 'Revoked') */
  status?: string
  /** NVM API Key IDs allowed to use this payment method, or null if unrestricted */
  allowedApiKeyIds?: string[] | null
}

/**
 * Summary of a delegation (card or crypto spending).
 */
export interface DelegationSummary {
  delegationId: string
  provider: string
  providerPaymentMethodId: string
  status: string
  spendingLimitCents: string
  amountSpentCents: string
  remainingBudgetCents: string
  currency: string
  transactionCount: number
  expiresAt: string
  createdAt: string
  apiKeyId: string | null
}

/**
 * Paginated list of delegations returned by the API.
 */
export interface DelegationListResponse {
  delegations: DelegationSummary[]
  totalResults: number
  page: number
  offset: number
}

/**
 * Summary of an agent's purchasing power via card delegations.
 */
export interface PurchasingPower {
  cards: PaymentMethodSummary[]
  delegations: DelegationSummary[]
  totalRemainingBudgetCents: number
  currency: string
}

/**
 * DTO for updating a payment method's alias and allowed API keys.
 */
export interface UpdatePaymentMethodDto {
  alias?: string
  allowedApiKeyIds?: string[] | null
}

/**
 * Options for listing payment methods or delegations.
 */
export interface ListOptions {
  /** When true, return only items accessible to the requesting API key */
  accessible?: boolean
}

/**
 * API for managing payment methods and delegations (card and crypto).
 */
export class DelegationAPI extends BasePaymentsAPI {
  static getInstance(options: PaymentOptions): DelegationAPI {
    return new DelegationAPI(options)
  }

  /**
   * List the user's enrolled payment methods for card delegation.
   * When `accessible: true`, only cards accessible to the requesting API key are returned.
   */
  async listPaymentMethods(options?: ListOptions): Promise<PaymentMethodSummary[]> {
    const url = new URL('/api/v1/payment-methods', this.environment.backend)
    if (options?.accessible) url.searchParams.set('accessible', 'true')
    return this.fetchJSON(url, 'GET', 'list payment methods')
  }

  /**
   * List the user's existing delegations.
   * When `accessible: true`, only usable delegations (Active, non-expired, with budget) are returned.
   */
  async listDelegations(options?: ListOptions): Promise<DelegationListResponse> {
    const url = new URL('/api/v1/delegation', this.environment.backend)
    if (options?.accessible) url.searchParams.set('accessible', 'true')
    return this.fetchJSON(url, 'GET', 'list delegations')
  }

  /**
   * Get the agent's purchasing power — accessible cards, active delegations,
   * and combined remaining budget.
   */
  async getPurchasingPower(): Promise<PurchasingPower> {
    const accessible = { accessible: true } satisfies ListOptions
    const [cards, { delegations }] = await Promise.all([
      this.listPaymentMethods(accessible),
      this.listDelegations(accessible),
    ])

    const totalRemainingBudgetCents = delegations.reduce(
      (sum, d) => sum + (parseInt(d.remainingBudgetCents, 10) || 0),
      0,
    )

    return {
      cards,
      delegations,
      totalRemainingBudgetCents,
      currency: delegations[0]?.currency ?? 'usd',
    }
  }

  /**
   * Create a new delegation for either stripe or erc4337 provider.
   *
   * @param payload - The delegation creation parameters
   * @returns The created delegation ID (and token for card delegations)
   */
  async createDelegation(payload: CreateDelegationPayload): Promise<CreateDelegationResponse> {
    const url = new URL('/api/v1/delegation/create', this.environment.backend)
    return this.fetchJSON(url, 'POST', 'create delegation', payload)
  }

  /**
   * Update a payment method's alias and/or allowed API keys.
   */
  async updatePaymentMethod(
    paymentMethodId: string,
    dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodSummary> {
    const url = new URL(`/api/v1/payment-methods/${paymentMethodId}`, this.environment.backend)
    return this.fetchJSON(url, 'PATCH', 'update payment method', dto)
  }

  // --- Private helpers ---

  private async fetchJSON<T>(
    url: URL,
    method: string,
    action: string,
    body?: unknown,
  ): Promise<T> {
    const options = this.getBackendHTTPOptions(method, body)
    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        let msg = `Failed to ${action}`
        try {
          const err = await response.json()
          msg = err.message || msg
        } catch {
          // use default
        }
        throw PaymentsError.internal(`${msg} (HTTP ${response.status})`)
      }
      return await response.json()
    } catch (error) {
      if (error instanceof PaymentsError) throw error
      throw PaymentsError.internal(
        `Network error while ${action}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
