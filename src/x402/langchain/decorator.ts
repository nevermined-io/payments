/**
 * LangChain tool wrapper for Nevermined payment protection using the x402 protocol.
 *
 * Wraps a LangChain.js tool implementation function to:
 *
 * 1. Extract the x402 payment token from `config.configurable.payment_token`
 * 2. Verify the subscriber has sufficient credits
 * 3. Execute the wrapped tool function
 * 4. Settle (burn) credits after successful execution
 *
 * Payment errors throw `PaymentRequiredError` so LangChain agents can catch and
 * surface them to the user. The error carries the full `X402PaymentRequired`
 * object for programmatic token acquisition.
 *
 * The `credits` option accepts two forms:
 *   - **Static number**: `credits: 1` — always charges 1 credit
 *   - **Function**: `credits: (ctx) => Math.max(1, ctx.result.length / 100)` — dynamic
 *
 * When `credits` is a function, it receives `{ args, result }` after tool execution.
 *
 * @example
 * ```typescript
 * import { tool } from '@langchain/core/tools'
 * import { z } from 'zod'
 * import { Payments } from '@nevermined-io/payments'
 * import { requiresPayment } from '@nevermined-io/payments/langchain'
 *
 * const payments = Payments.getInstance({ nvmApiKey: '...', environment: 'testing' })
 *
 * const searchData = tool(
 *   requiresPayment(
 *     (args) => `Results for ${args.query}`,
 *     { payments, planId: PLAN_ID, credits: 1 }
 *   ),
 *   { name: 'search_data', description: 'Search for data', schema: z.object({ query: z.string() }) }
 * )
 *
 * // Invoke with payment token
 * const result = await searchData.invoke(
 *   { query: 'AI trends' },
 *   { configurable: { payment_token: accessToken } }
 * )
 * ```
 */

import type { Payments } from '../../payments.js'
import {
  buildPaymentRequired,
  type X402PaymentRequired,
  type VerifyPermissionsResult,
} from '../facilitator-api.js'

/**
 * Context passed to a dynamic credits function after tool execution.
 */
export interface CreditsContext {
  /** The tool's input arguments */
  args: Record<string, unknown>
  /** The tool's return value */
  result: unknown
}

/**
 * Credits can be a static number or a function that receives
 * `{ args, result }` and returns the number of credits to charge.
 */
export type CreditsCallable = (ctx: CreditsContext) => number

/**
 * Options for the `requiresPayment` wrapper.
 */
export interface RequiresPaymentOptions {
  /** The Payments instance (with payments.facilitator) */
  payments: Payments
  /** Single plan ID to accept */
  planId: string
  /** Number of credits to charge, or a function for dynamic pricing (default: 1) */
  credits?: number | CreditsCallable
  /** Optional agent identifier */
  agentId?: string
  /** Blockchain network in CAIP-2 format (default: 'eip155:84532' for Base Sepolia) */
  network?: string
}

/**
 * Thrown when payment verification fails or no token is provided.
 *
 * Carries the `X402PaymentRequired` object so callers can inspect
 * accepted plans and acquire the correct payment token.
 */
export class PaymentRequiredError extends Error {
  /** The x402 PaymentRequired object for programmatic token acquisition */
  paymentRequired: X402PaymentRequired | undefined

  constructor(message: string, paymentRequired?: X402PaymentRequired) {
    super(message)
    this.name = 'PaymentRequiredError'
    this.paymentRequired = paymentRequired
  }
}

/**
 * Payment context stored in `config.configurable.payment_context` after verification.
 */
export interface PaymentContext {
  /** The x402 access token */
  token: string
  /** The payment required object */
  paymentRequired: X402PaymentRequired
  /** Number of credits to settle */
  creditsToSettle: number
  /** Whether verification was successful */
  verified: boolean
  /** Agent request ID for observability tracking */
  agentRequestId?: string
  /** Agent request context for observability */
  agentRequest?: unknown
}

/**
 * Extract the payment token from a LangChain RunnableConfig.
 *
 * In LangChain.js, the config is the optional second parameter to tool functions:
 * `(args, config?) => ...` where config is a `RunnableConfig`.
 */
function extractPaymentToken(config: unknown): string | null {
  if (config == null || typeof config !== 'object') return null

  const configurable = (config as Record<string, unknown>).configurable
  if (configurable == null || typeof configurable !== 'object') return null

  const token = (configurable as Record<string, unknown>).payment_token
  return typeof token === 'string' ? token : null
}

/**
 * Store a value in config.configurable if available.
 */
function storeInConfigurable(config: unknown, key: string, value: unknown): void {
  if (config == null || typeof config !== 'object') return

  const configurable = (config as Record<string, unknown>).configurable
  if (configurable == null || typeof configurable !== 'object') return

  ;(configurable as Record<string, unknown>)[key] = value
}

/**
 * Wraps a LangChain.js tool implementation with x402 payment verification and settlement.
 *
 * This is a higher-order function that takes the tool's implementation function and
 * payment options, returning a new function with the same signature that:
 *
 * 1. Extracts the payment token from `config.configurable.payment_token`
 * 2. Verifies the subscriber has sufficient credits
 * 3. Calls the original tool function
 * 4. Settles (burns) credits
 * 5. Stores `payment_context` and `payment_settlement` in `config.configurable`
 *
 * @param fn - The tool implementation function: `(args, config?) => result`
 * @param options - Payment configuration
 * @returns Wrapped function with the same signature
 *
 * @example Static credits
 * ```typescript
 * const searchData = tool(
 *   requiresPayment(
 *     (args) => `Results for ${args.query}`,
 *     { payments, planId: PLAN_ID, credits: 1 }
 *   ),
 *   { name: 'search_data', description: 'Search', schema: z.object({ query: z.string() }) }
 * )
 * ```
 *
 * @example Dynamic credits
 * ```typescript
 * const summarize = tool(
 *   requiresPayment(
 *     (args) => `Summary of ${args.text}`,
 *     {
 *       payments, planId: PLAN_ID,
 *       credits: (ctx) => Math.max(1, Math.floor(String(ctx.result).length / 100)),
 *     }
 *   ),
 *   { name: 'summarize', description: 'Summarize text', schema: z.object({ text: z.string() }) }
 * )
 * ```
 */
export function requiresPayment<TArgs extends Record<string, unknown>, TResult>(
  fn: (args: TArgs, config?: unknown) => TResult | Promise<TResult>,
  options: RequiresPaymentOptions,
): (args: TArgs, config?: unknown) => Promise<TResult> {
  const { payments, planId, credits = 1, agentId, network } = options

  return async (args: TArgs, config?: unknown): Promise<TResult> => {
    // Build payment required object
    const paymentRequired = buildPaymentRequired(planId, {
      endpoint: fn.name || 'tool',
      agentId,
      network,
    })

    // Extract token from config.configurable.payment_token
    const token = extractPaymentToken(config)
    if (!token) {
      throw new PaymentRequiredError(
        "Payment required: missing payment_token in config.configurable",
        paymentRequired,
      )
    }

    // Resolve pre-execution credits (static only; callable deferred to post-execution)
    const creditsToVerify = typeof credits === 'number' ? credits : 1

    // Verify permissions
    let verification: VerifyPermissionsResult
    try {
      verification = await payments.facilitator.verifyPermissions({
        paymentRequired,
        x402AccessToken: token,
        maxAmount: BigInt(creditsToVerify),
      })
    } catch (error) {
      throw new PaymentRequiredError(
        `Payment verification failed: ${error instanceof Error ? error.message : String(error)}`,
        paymentRequired,
      )
    }

    if (!verification.isValid) {
      throw new PaymentRequiredError(
        `Payment verification failed: ${verification.invalidReason || 'Insufficient credits or invalid token'}`,
        paymentRequired,
      )
    }

    // Store payment context
    const paymentContext: PaymentContext = {
      token,
      paymentRequired,
      creditsToSettle: creditsToVerify,
      verified: true,
      agentRequestId: verification.agentRequest?.agentRequestId || verification.agentRequestId,
      agentRequest: verification.agentRequest,
    }
    storeInConfigurable(config, 'payment_context', paymentContext)

    // Execute the tool function
    const result = await fn(args, config)

    // Resolve final credits (may be dynamic based on result)
    const finalCredits =
      typeof credits === 'function'
        ? credits({ args: args as Record<string, unknown>, result })
        : credits

    // Settle credits
    try {
      const settlement = await payments.facilitator.settlePermissions({
        paymentRequired,
        x402AccessToken: token,
        maxAmount: BigInt(finalCredits),
        agentRequestId: paymentContext.agentRequestId,
      })
      storeInConfigurable(config, 'payment_settlement', settlement)
    } catch (settleError) {
      console.error('Payment settlement failed:', settleError)
      // Still return result even if settlement fails
    }

    return result
  }
}
