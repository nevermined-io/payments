/**
 * The FacilitatorAPI class provides methods to verify and settle AI agent permissions using X402 access tokens.
 * This allows AI agents to act as facilitators, verifying and settling credits on behalf of subscribers.
 *
 * @example
 * ```typescript
 * import { Payments, X402PaymentRequired } from '@nevermined-io/payments'
 *
 * // Initialize the Payments instance
 * const payments = Payments.getInstance({
 *   nvmApiKey: 'your-nvm-api-key',
 *   environment: 'sandbox'
 * })
 *
 * // The server's 402 PaymentRequired response
 * const paymentRequired: X402PaymentRequired = buildPaymentRequired('123456789', {
 *   endpoint: '/api/v1/agents/task',
 *   agentId: '987654321',
 *   httpVerb: 'POST'
 * })
 *
 * // Get X402 access token from subscriber (x402 v2: payment-signature header)
 * const x402Token = req.headers['payment-signature'] as string
 *
 * // Verify if subscriber has sufficient permissions/credits
 * const verification = await payments.facilitator.verifyPermissions({
 *   paymentRequired,
 *   x402AccessToken: x402Token,
 *   maxAmount: 2n
 * })
 *
 * if (verification.isValid) {
 *   // Settle (burn) the credits
 *   const settlement = await payments.facilitator.settlePermissions({
 *     paymentRequired,
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
import { PaymentOptions, StartAgentRequest, X402SchemeType, X402_SCHEME_NETWORKS } from '../common/types.js'
import type { Payments } from '../payments.js'
import type { VisaPaymentRequired } from './visa-facilitator-api.js'

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
  resource: X402Resource
  /** Array of accepted payment schemes */
  accepts: X402Scheme[]
  /** Extensions object (empty object for nvm:erc4337) */
  extensions: Record<string, unknown>
}

/**
 * x402 PaymentAccepted response (accepted payment scheme)
 */
export interface X402PaymentAccepted {
  /** The x402 version */
  x402Version: number
  /** The accepted payment scheme (nvm:erc4337) */
  accepted: X402Scheme
  /** The payload of the payment accepted */
  payload: {
    signature: string
    authorization: {
      from: string
      sessionKeysProvider: string
      sessionKeys: string[]
    }
  }
  extensions: Record<string, unknown>
}

/**
 * Parameters for verifying permissions
 */
export interface VerifyPermissionsParams {
  /** The server's 402 PaymentRequired response (NVM or Visa flavored) */
  paymentRequired: X402PaymentRequired | VisaPaymentRequired
  /** The X402 access token (base64-encoded) */
  x402AccessToken: string
  /** Maximum credits to verify (optional) */
  maxAmount?: bigint
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
  /** URL pattern that matched the endpoint (Nevermined extension) */
  urlMatching?: string
  /** Agent request context for observability (Nevermined extension) */
  agentRequest?: StartAgentRequest
}

/**
 * Parameters for settling permissions
 */
export interface SettlePermissionsParams {
  /** The server's 402 PaymentRequired response (NVM or Visa flavored) */
  paymentRequired: X402PaymentRequired | VisaPaymentRequired
  /** The X402 access token (base64-encoded) */
  x402AccessToken: string
  /** Number of credits to burn (optional) */
  maxAmount?: bigint
  /** Agent request ID for observability tracking. Returned by verifyPermissions. */
  agentRequestId?: string
  /** Whether this is a batch request (multiple LLM calls under one agentRequestId) */
  batch?: boolean
  /** Margin percentage (0-10) for credit calculation. Mutually exclusive with maxAmount when agentRequestId provided. */
  marginPercent?: number
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
 * Build an X402PaymentRequired object for verify/settle operations.
 *
 * This helper simplifies the creation of payment requirement objects
 * that are needed for the facilitator API.
 *
 * @param planId - The Nevermined plan identifier (required)
 * @param options - Optional configuration with endpoint, agentId, httpVerb, network, description
 * @returns X402PaymentRequired object ready to use with verifyPermissions/settlePermissions
 *
 * @example
 * ```typescript
 * import { buildPaymentRequired } from '@nevermined-io/payments'
 *
 * const paymentRequired = buildPaymentRequired('123456789', {
 *   endpoint: '/api/v1/agents/task',
 *   agentId: '987654321',
 *   httpVerb: 'POST'
 * })
 *
 * const result = await payments.facilitator.verifyPermissions({
 *   paymentRequired,
 *   x402AccessToken: token,
 *   maxAmount: 2n
 * })
 * ```
 */
export function buildPaymentRequired(
  planId: string,
  options?: {
    endpoint?: string
    agentId?: string
    httpVerb?: string
    network?: string
    description?: string
    scheme?: X402SchemeType
  },
): X402PaymentRequired {
  const {
    endpoint,
    agentId,
    httpVerb,
    scheme = 'nvm:erc4337',
    network,
    description,
  } = options || {}
  const resolvedNetwork = network ?? X402_SCHEME_NETWORKS[scheme]

  // Build extra fields if any are provided
  const extra: X402SchemeExtra | undefined =
    agentId || httpVerb
      ? {
          ...(agentId && { agentId }),
          ...(httpVerb && { httpVerb }),
        }
      : undefined

  return {
    x402Version: 2,
    resource: {
      url: endpoint || '',
      ...(description && { description }),
    },
    accepts: [
      {
        scheme,
        network: resolvedNetwork,
        planId,
        ...(extra && { extra }),
      },
    ],
    extensions: {},
  }
}

interface CachedPlanMetadata {
  scheme: X402SchemeType
  cachedAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const planMetadataCache = new Map<string, CachedPlanMetadata>()

async function fetchPlanMetadata(
  payments: Payments,
  planId: string,
): Promise<{ scheme: X402SchemeType }> {
  const cached = planMetadataCache.get(planId)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { scheme: cached.scheme }
  }
  try {
    const plan = await payments.plans.getPlan(planId)
    const isCrypto = plan.registry?.price?.isCrypto
    const scheme: X402SchemeType =
      isCrypto === false ? 'nvm:card-delegation' : 'nvm:erc4337'
    planMetadataCache.set(planId, { scheme, cachedAt: Date.now() })
    return { scheme }
  } catch {
    return { scheme: 'nvm:erc4337' }
  }
}

/**
 * Resolve the x402 scheme for a plan by fetching plan metadata (cached).
 * Used in callsites that don't have a token to extract scheme from
 * (402 responses and token generation).
 *
 * @param payments - The Payments instance for API access
 * @param planId - The plan identifier
 * @param explicitScheme - Optional explicit override; returned immediately if provided
 * @returns The resolved scheme type
 */
export async function resolveScheme(
  payments: Payments,
  planId: string,
  explicitScheme?: X402SchemeType,
): Promise<X402SchemeType> {
  if (explicitScheme) return explicitScheme
  const metadata = await fetchPlanMetadata(payments, planId)
  return metadata.scheme
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
   *   - paymentRequired: x402 PaymentRequired from 402 response (required, for validation)
   *   - x402AccessToken: X402 access token (contains planId, subscriberAddress, agentId)
   *   - maxAmount: maximum credits to verify (optional, bigint)
   * @returns A promise that resolves to a verification result with 'isValid' boolean
   *
   * @throws PaymentsError if verification fails
   */
  async verifyPermissions(params: VerifyPermissionsParams): Promise<VerifyPermissionsResult> {
    const { paymentRequired, x402AccessToken, maxAmount } = params

    const url = new URL(API_URL_VERIFY_PERMISSIONS, this.environment.backend)

    const body: Record<string, unknown> = {
      paymentRequired,
      x402AccessToken,
    }

    if (maxAmount !== undefined) {
      body.maxAmount = maxAmount.toString()
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
   *   - paymentRequired: x402 PaymentRequired from 402 response (required, for validation)
   *   - x402AccessToken: X402 access token (contains planId, subscriberAddress, agentId)
   *   - maxAmount: number of credits to burn (optional, bigint)
   *   - agentRequestId: Agent request ID for observability tracking (optional)
   *   - batch: Whether this is a batch request (optional)
   *   - marginPercent: Margin percentage for credit calculation (optional)
   * @returns A promise that resolves to a settlement result with transaction details
   *
   * @throws PaymentsError if settlement fails
   */
  async settlePermissions(params: SettlePermissionsParams): Promise<SettlePermissionsResult> {
    const { paymentRequired, x402AccessToken, maxAmount, agentRequestId, batch, marginPercent } =
      params

    const url = new URL(API_URL_SETTLE_PERMISSIONS, this.environment.backend)

    const body: Record<string, unknown> = {
      paymentRequired,
      x402AccessToken,
    }

    if (maxAmount !== undefined) {
      body.maxAmount = maxAmount.toString()
    }
    if (agentRequestId !== undefined) {
      body.agentRequestId = agentRequestId
    }
    if (batch !== undefined) {
      body.batch = batch
    }
    if (marginPercent !== undefined) {
      body.marginPercent = marginPercent
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
