/**
 * The DelegationAPI class provides methods to manage fiat spending delegations.
 * Delegations allow clients to authorize AI agents to make payments on their behalf
 * using saved payment methods (e.g., Stripe) within defined spending limits.
 *
 * @example
 * ```typescript
 * import { Payments } from '@nevermined-io/payments'
 *
 * const payments = Payments.getInstance({
 *   nvmApiKey: 'your-nvm-api-key',
 *   environment: 'sandbox'
 * })
 *
 * // 1. Create a SetupIntent to save a payment method
 * const { clientSecret } = await payments.delegation.createSetupIntent()
 *
 * // 2. After confirming with Stripe.js, list saved payment methods
 * const methods = await payments.delegation.listPaymentMethods()
 *
 * // 3. Create a delegation with spending limits
 * const { delegationToken, delegationId } = await payments.delegation.createDelegation({
 *   providerPaymentMethodId: methods[0].id,
 *   spendingLimitCents: 10000, // $100
 *   durationSecs: 604800, // 7 days
 * })
 *
 * // 4. Use the delegationToken as the x402 access token (payment-signature header)
 * // The verify/settle endpoints auto-detect the JWT delegation token
 * ```
 */

import { BasePaymentsAPI } from '../api/base-payments.js'
import {
  API_URL_DELEGATION_SETUP_INTENT,
  API_URL_DELEGATION_CREATE,
  API_URL_DELEGATION_LIST,
  API_URL_DELEGATION_GET,
  API_URL_DELEGATION_PAYMENT_METHODS,
} from '../api/nvm-api.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions } from '../common/types.js'

/**
 * Parameters for creating a spending delegation
 */
export interface CreateDelegationParams {
  /** Stripe payment method ID (e.g., 'pm_xxx') */
  providerPaymentMethodId: string
  /** Maximum spending limit in cents */
  spendingLimitCents: number
  /** Duration of the delegation in seconds */
  durationSecs: number
  /** Currency code (default: 'usd') */
  currency?: string
  /** Optional: restrict to a specific plan */
  planId?: string
  /** Optional: restrict to a specific merchant */
  merchantAccountId?: string
  /** Optional: maximum number of transactions */
  maxTransactions?: number
}

/**
 * Summary of a saved payment method
 */
export interface PaymentMethodSummary {
  id: string
  type: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

/**
 * Summary of a delegation (matches server DelegationSummaryDto)
 */
export interface DelegationSummary {
  delegationId: string
  provider: string
  status: string
  spendingLimitCents: string
  amountSpentCents: string
  remainingBudgetCents: string
  currency: string
  expiresAt: string
  createdAt: string
}

/**
 * Detailed delegation information (matches server DelegationDetailsDto)
 */
export interface DelegationDetails extends DelegationSummary {
  providerPaymentMethodId: string
  planId: string | null
  merchantAccountId: string | null
  maxTransactions: number | null
  transactionCount: number
  lastUsedAt: string | null
}

/**
 * Paginated delegation list (matches server DelegationListDto)
 */
export interface DelegationListResult {
  delegations: DelegationSummary[]
  totalResults: number
  page: number
  offset: number
}

/**
 * Delegation transaction record (matches server DelegationTransactionDto)
 */
export interface DelegationTransaction {
  id: string
  providerTransactionId: string
  amountCents: string
  currency: string
  status: string
  failureReason: string | null
  createdAt: string
}

/**
 * Paginated transaction list (matches server DelegationTransactionListDto)
 */
export interface DelegationTransactionListResult {
  transactions: DelegationTransaction[]
  totalResults: number
  page: number
  offset: number
}

/**
 * The DelegationAPI class provides methods to manage fiat spending delegations.
 * It enables clients to save payment methods, create delegations with spending limits,
 * and manage delegation lifecycle.
 */
export class DelegationAPI extends BasePaymentsAPI {
  static getInstance(options: PaymentOptions): DelegationAPI {
    return new DelegationAPI(options)
  }

  /** Create a Stripe SetupIntent for saving a payment method. */
  async createSetupIntent(): Promise<{ clientSecret: string }> {
    return this.fetchJson('POST', API_URL_DELEGATION_SETUP_INTENT)
  }

  /** List saved payment methods for the authenticated user. */
  async listPaymentMethods(): Promise<PaymentMethodSummary[]> {
    return this.fetchJson('GET', API_URL_DELEGATION_PAYMENT_METHODS)
  }

  /** Create a spending delegation and return a signed JWT token. */
  async createDelegation(
    params: CreateDelegationParams,
  ): Promise<{ delegationToken: string; delegationId: string }> {
    return this.fetchJson('POST', API_URL_DELEGATION_CREATE, { body: params })
  }

  /** List all delegations for the authenticated user. */
  async listDelegations(page = 1, offset = 10): Promise<DelegationListResult> {
    return this.fetchJson('GET', API_URL_DELEGATION_LIST, {
      query: { page: String(page), offset: String(offset) },
    })
  }

  /** Get detailed delegation information including remaining budget. */
  async getDelegation(delegationId: string): Promise<DelegationDetails> {
    return this.fetchJson('GET', `${API_URL_DELEGATION_GET}/${delegationId}`)
  }

  /** Revoke an active delegation. This immediately prevents any further charges. */
  async revokeDelegation(delegationId: string): Promise<{ success: boolean }> {
    return this.fetchJson('DELETE', `${API_URL_DELEGATION_GET}/${delegationId}`)
  }

  /** List transactions for a specific delegation. */
  async getTransactions(
    delegationId: string,
    page = 1,
    offset = 10,
  ): Promise<DelegationTransactionListResult> {
    return this.fetchJson('GET', `${API_URL_DELEGATION_GET}/${delegationId}/transactions`, {
      query: { page: String(page), offset: String(offset) },
    })
  }

  // --- Private helpers ---

  private async fetchJson<T>(
    method: string,
    path: string,
    opts?: { body?: any; query?: Record<string, string> },
  ): Promise<T> {
    const url = new URL(path, this.environment.backend)
    if (opts?.query) {
      for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v)
    }
    const fetchOpts = this.getBackendHTTPOptions(method, opts?.body)

    try {
      const response = await fetch(url, fetchOpts)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw PaymentsError.fromBackend(errorData.message || `Request failed: ${method} ${path}`, {
          message: errorData.message,
          code: `HTTP ${response.status}`,
        })
      }
      return await response.json()
    } catch (error) {
      if (error instanceof PaymentsError) throw error
      throw PaymentsError.fromBackend(`Network error: ${method} ${path}`, {
        message: error instanceof Error ? error.message : String(error),
        code: 'network_error',
      })
    }
  }
}
