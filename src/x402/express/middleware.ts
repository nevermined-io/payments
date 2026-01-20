/**
 * Express middleware for Nevermined payment protection using the x402 protocol.
 *
 * This middleware provides a simple way to protect Express routes with
 * Nevermined payment verification and settlement.
 *
 * ## x402 HTTP Transport Headers
 *
 * Following the x402 spec (https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md):
 *
 * - **Client → Server**: `payment-signature` header with base64-encoded token
 * - **Server → Client (402)**: `payment-required` header with base64-encoded PaymentRequired
 * - **Server → Client (success)**: `payment-response` header with settlement receipt
 *
 * @example
 * ```typescript
 * import express from 'express'
 * import { Payments } from '@nevermined-io/payments'
 * import { paymentMiddleware } from '@nevermined-io/payments/express'
 *
 * const app = express()
 * const payments = Payments.getInstance({ nvmApiKey: '...', environment: 'testing' })
 *
 * // Protect routes with payment middleware
 * app.use(paymentMiddleware(payments, {
 *   'POST /ask': { planId: '123', credits: 1 },
 *   'POST /generate': { planId: '123', credits: 5 },
 * }))
 *
 * // Route handlers - no payment logic needed!
 * app.post('/ask', (req, res) => res.json({ answer: '...' }))
 * ```
 *
 * @example Client usage
 * ```typescript
 * const token = await payments.x402.getX402AccessToken(planId)
 *
 * const response = await fetch('/ask', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'payment-signature': token.accessToken, // x402 header
 *   },
 *   body: JSON.stringify({ query: 'Hello!' }),
 * })
 * ```
 */

import type { Request, Response, NextFunction } from 'express'

/**
 * Express middleware function type.
 * Using explicit signature instead of RequestHandler to avoid type resolution issues
 * when SDK's @types/express version differs from consumer's.
 */
export type ExpressMiddleware = (req: Request, res: Response, next: NextFunction) => void
import type { Payments } from '../../payments.js'
import type { StartAgentRequest } from '../../common/types.js'
import {
  buildPaymentRequired,
  type X402PaymentRequired,
  type VerifyPermissionsResult,
} from '../facilitator-api.js'

/**
 * Configuration for a protected route
 */
export interface RouteConfig {
  /** The Nevermined plan ID that protects this route */
  planId: string
  /** Number of credits to charge for this route (default: 1) */
  credits?: number | ((req: Request, res: Response) => number | Promise<number>)
  /** Optional agent ID */
  agentId?: string
  /** Network identifier (default: 'eip155:84532' for Base Sepolia) */
  network?: string
}

/**
 * Route configuration map: "METHOD /path" -> RouteConfig
 */
export type RouteConfigMap = Record<string, RouteConfig>

/**
 * x402 HTTP Transport header names (v2 spec)
 * @see https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md
 */
export const X402_HEADERS = {
  /** Client sends payment token in this header */
  PAYMENT_SIGNATURE: 'payment-signature',
  /** Server sends PaymentRequired in this header (base64-encoded) */
  PAYMENT_REQUIRED: 'payment-required',
  /** Server sends settlement receipt in this header (base64-encoded) */
  PAYMENT_RESPONSE: 'payment-response',
} as const

/**
 * Payment context attached to the request after verification.
 * Available as `req.paymentContext` in route handlers.
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
  /** Agent request context for observability (from verification response) */
  agentRequest?: StartAgentRequest
  /** Agent request ID for observability tracking */
  agentRequestId?: string
}

/**
 * Options for the payment middleware
 */
export interface PaymentMiddlewareOptions {
  /**
   * Header name(s) to check for the x402 access token.
   * Default: 'payment-signature' (x402 v2 compliant)
   */
  tokenHeader?: string | string[]
  /** Custom error handler for payment failures */
  onPaymentError?: (error: Error, req: Request, res: Response) => void
  /** Hook called before verification */
  onBeforeVerify?: (req: Request, paymentRequired: X402PaymentRequired) => void | Promise<void>
  /**
   * Hook called after successful verification.
   * Use this to access agentRequest for observability configuration.
   */
  onAfterVerify?: (
    req: Request,
    verification: VerifyPermissionsResult,
  ) => void | Promise<void>
  /** Hook called after successful settlement */
  onAfterSettle?: (req: Request, creditsUsed: number, result: unknown) => void | Promise<void>
}

/**
 * Default header for token extraction (x402 v2 compliant)
 */
const DEFAULT_TOKEN_HEADERS = [X402_HEADERS.PAYMENT_SIGNATURE]

/**
 * Extract the x402 access token from the request headers.
 * Checks multiple headers in priority order.
 */
function extractToken(req: Request, headerNames: string | string[]): string | null {
  const headers = Array.isArray(headerNames) ? headerNames : [headerNames]

  for (const headerName of headers) {
    const header = req.headers[headerName.toLowerCase()]
    if (header && typeof header === 'string') {
      return header
    }
  }

  return null
}

/**
 * Match a request to a route config.
 * Returns the config if found, null otherwise.
 */
function matchRoute(req: Request, routes: RouteConfigMap): RouteConfig | null {
  const method = req.method.toUpperCase()
  const path = req.path

  // Try exact match first: "POST /ask"
  const exactKey = `${method} ${path}`
  if (routes[exactKey]) {
    return routes[exactKey]
  }

  // Try pattern matching with path parameters
  for (const [routeKey, config] of Object.entries(routes)) {
    const [routeMethod, routePath] = routeKey.split(' ')
    if (routeMethod !== method) continue

    // Simple pattern matching: /users/:id -> /users/123
    const routeParts = routePath.split('/')
    const pathParts = path.split('/')

    if (routeParts.length !== pathParts.length) continue

    let match = true
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) continue // Parameter - always matches
      if (routeParts[i] !== pathParts[i]) {
        match = false
        break
      }
    }

    if (match) return config
  }

  return null
}

/**
 * Create an Express middleware that protects routes with Nevermined payments.
 *
 * The middleware:
 * 1. Checks if the request matches a protected route
 * 2. Extracts the x402 token from headers
 * 3. Verifies the subscriber has sufficient credits
 * 4. Lets the route handler execute
 * 5. Settles (burns) the credits after successful response
 *
 * @param payments - The Payments instance
 * @param routes - Map of routes to protect: { "METHOD /path": { planId, credits } }
 * @param options - Optional middleware configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * app.use(paymentMiddleware(payments, {
 *   'POST /ask': { planId: PLAN_ID, credits: 1 },
 *   'POST /generate': { planId: PLAN_ID, credits: 5 },
 *   'GET /status/:id': { planId: PLAN_ID, credits: 0 }, // Free but requires auth
 * }))
 * ```
 */
/**
 * Helper to send a 402 Payment Required response with proper x402 headers.
 */
function sendPaymentRequired(
  res: Response,
  paymentRequired: X402PaymentRequired,
  message: string,
): void {
  // Base64 encode the PaymentRequired object for the header (per x402 spec)
  const paymentRequiredBase64 = Buffer.from(JSON.stringify(paymentRequired)).toString('base64')

  res
    .status(402)
    .setHeader(X402_HEADERS.PAYMENT_REQUIRED, paymentRequiredBase64)
    .json({
      error: 'Payment Required',
      message,
    })
}

export function paymentMiddleware(
  payments: Payments,
  routes: RouteConfigMap,
  options: PaymentMiddlewareOptions = {},
): ExpressMiddleware {
  const {
    tokenHeader = DEFAULT_TOKEN_HEADERS,
    onPaymentError,
    onBeforeVerify,
    onAfterVerify,
    onAfterSettle,
  } = options

  return (req: Request, res: Response, next: NextFunction): void => {
    // Wrap async logic to handle promises properly
    const handleRequest = async (): Promise<void> => {
      // Check if this route requires payment
      const routeConfig = matchRoute(req, routes)
      if (!routeConfig) {
        // Route not protected - pass through
        next()
        return
      }

      const { planId, credits = 1, agentId, network } = routeConfig

      // Build payment required object (needed for both error responses and verification)
      const paymentRequired = buildPaymentRequired(planId, {
        endpoint: req.originalUrl || req.url,
        agentId,
        httpVerb: req.method,
        network,
      })

      // Extract token from headers (x402 v2: payment-signature)
      const token = extractToken(req, tokenHeader)
      if (!token) {
        const error = new Error('Payment required: missing x402 access token')
        if (onPaymentError) {
          onPaymentError(error, req, res)
          return
        }
        sendPaymentRequired(
          res,
          paymentRequired,
          `Missing x402 payment token. Send token in ${X402_HEADERS.PAYMENT_SIGNATURE} header.`,
        )
        return
      }

      // Calculate credits to verify
      const creditsToVerify = typeof credits === 'function' ? await credits(req, res) : credits

      try {
        // Hook: before verification
        if (onBeforeVerify) {
          await onBeforeVerify(req, paymentRequired)
        }

        // Verify permissions
        const verification = await payments.facilitator.verifyPermissions({
          paymentRequired,
          x402AccessToken: token,
          maxAmount: BigInt(creditsToVerify),
        })

        if (!verification.isValid) {
          const error = new Error(verification.invalidReason || 'Payment verification failed')
          if (onPaymentError) {
            onPaymentError(error, req, res)
            return
          }
          sendPaymentRequired(
            res,
            paymentRequired,
            verification.invalidReason || 'Insufficient credits or invalid token',
          )
          return
        }

        // Hook: after verification (use for observability setup)
        if (onAfterVerify) {
          await onAfterVerify(req, verification)
        }

        // Store payment context for settlement and route handler access
        const paymentContext: PaymentContext = {
          token,
          paymentRequired,
          creditsToSettle: creditsToVerify,
          verified: true,
          agentRequest: verification.agentRequest,
          agentRequestId: verification.agentRequest?.agentRequestId || verification.agentRequestId,
        }

        // Attach to request for potential use by route handler
        ;(req as Request & { paymentContext?: PaymentContext }).paymentContext = paymentContext

        // Override res.json to settle BEFORE sending response
        // This ensures credits are burned and payment-response header is included
        const originalJson = res.json.bind(res)
        res.json = function (body: unknown) {
          // Settle credits synchronously before sending response
          // Pass agentRequestId to enable observability updates
          payments.facilitator
            .settlePermissions({
              paymentRequired,
              x402AccessToken: token,
              maxAmount: BigInt(creditsToVerify),
              agentRequestId: paymentContext.agentRequestId,
            })
            .then((settlement) => {
              // Add settlement response header (base64-encoded per x402 spec)
              const settlementBase64 = Buffer.from(JSON.stringify(settlement)).toString('base64')
              res.setHeader(X402_HEADERS.PAYMENT_RESPONSE, settlementBase64)

              // Hook: after settlement
              if (onAfterSettle) {
                return Promise.resolve(onAfterSettle(req, creditsToVerify, settlement)).then(
                  () => settlement,
                )
              }
              return settlement
            })
            .catch((settleError) => {
              console.error('Payment settlement failed:', settleError)
              // Still send response even if settlement fails
            })
            .finally(() => {
              // Send the actual response after settlement completes
              originalJson(body)
            })

          // Return res for chaining (Express pattern)
          return res
        }

        // Continue to route handler
        next()
      } catch (error) {
        if (onPaymentError) {
          onPaymentError(error as Error, req, res)
          return
        }
        sendPaymentRequired(
          res,
          paymentRequired,
          error instanceof Error ? error.message : 'Payment verification failed',
        )
      }
    }

    // Execute async handler with error handling
    handleRequest().catch(next)
  }
}

export default paymentMiddleware
