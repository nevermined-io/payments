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
 * when SDK's \@types/express version differs from consumer's.
 */
export type ExpressMiddleware = (req: Request, res: Response, next: NextFunction) => void
import type { Payments } from '../../payments.js'
import type { StartAgentRequest, X402SchemeType } from '../../common/types.js'
import {
  buildPaymentRequired,
  resolveNetwork,
  resolveScheme,
  type X402PaymentRequired,
  type VerifyPermissionsResult,
} from '../facilitator-api.js'
import {
  MPP_HEADERS,
  extractCredential,
  mppResource,
  mppVerb,
  resolveMppOption,
  type MppRouteOption,
} from './mpp-support.js'
import { computeBodyDigest, getRawBody } from './raw-body.js'
import { MppError, MppCredentialRejectedError, isRetryableMppCode } from '../../mpp/errors.js'
import { normalizeCredits } from '../../mpp/mpp-api.js'

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
  /** Network identifier (default: auto-derived from scheme) */
  network?: string
  /** x402 scheme override (auto-detected from plan metadata if omitted) */
  scheme?: X402SchemeType
  /** Human-readable description of the protected resource */
  description?: string
  /** Expected response MIME type (e.g., "application/json") */
  mimeType?: string
  /**
   * Accept MPP (Machine Payments Protocol) on this route in addition to x402.
   * Default off. `{ bindBody: true }` additionally binds the challenge to the
   * request body, which requires `captureRawBody` on the body parser.
   */
  mpp?: MppRouteOption
}

/**
 * Route configuration map: "METHOD \/path" -> RouteConfig
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
  /** MPP framing details, present only when the route was paid over MPP. */
  mpp?: {
    /** The `Authorization: Payment …` value the buyer presented. */
    credential: string
    resource: string
    httpVerb: string
  }
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
  onAfterVerify?: (req: Request, verification: VerifyPermissionsResult) => void | Promise<void>
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
 * @param routes - Map of routes to protect: \{ "METHOD \/path": \{ planId, credits \} \}
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
 * Whether a request carries a body, per RFC 9110 §6.4.1 / what `type-is`'s
 * `hasBody()` encodes: a `Transfer-Encoding` header (chunked, streamed —
 * never carries `Content-Length`), or a non-zero `Content-Length`.
 *
 * `bindBody`'s guard used to check `Content-Length` alone, so a chunked
 * request (no `Content-Length` at all) took neither the "captured" nor the
 * "refuse" branch: the challenge was minted unbound, silently. Both
 * `Content-Length` and `Transfer-Encoding` are the BUYER's choice, so a guard
 * that only recognizes one of the two shapes lets the buyer — not the seller
 * — decide whether the seller's opt-in body binding applies.
 */
function requestHasBody(req: Request): boolean {
  if (req.headers['transfer-encoding'] !== undefined) return true
  const contentLength = req.headers['content-length']
  return contentLength !== undefined && contentLength !== '0'
}

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

  res.status(402).setHeader(X402_HEADERS.PAYMENT_REQUIRED, paymentRequiredBase64).json({
    error: 'Payment Required',
    message,
  })
}

/**
 * Credentials currently between "verified" and "settled", shared across
 * every `handleMppRequest` call in this process.
 *
 * `verifyCredential` burns nothing (its own docstring says so explicitly)
 * and `settleCredential` settling the SAME credential twice burns once —
 * that idempotency is what makes settlement safe to retry, and it is
 * exactly what makes concurrent delivery cheap: N concurrent requests
 * presenting the same credential would each pass verify, each get served,
 * and the N settles would collapse to a single burn. This set closes that
 * window WITHIN one Node process: a second request presenting a credential
 * already in this set is refused rather than served.
 *
 * What this does NOT close: multiple processes or horizontally-scaled
 * instances of this middleware, which do not share this in-memory set and
 * would need a shared store (e.g. Redis) this package does not provide.
 * Deployments that scale this middleware horizontally need an external
 * mitigation for the same race across instances.
 */
const inFlightMppCredentials = new Set<string>()

/**
 * The MPP request path.
 *
 * Kept whole and separate from the x402 path so that with `mpp` unset nothing
 * here runs and the x402 behaviour is unchanged.
 */
async function handleMppRequest(args: {
  req: Request
  res: Response
  next: NextFunction
  payments: Payments
  routeConfig: RouteConfig
  paymentRequired: X402PaymentRequired
  bindBody: boolean
  hooks: {
    onPaymentError?: PaymentMiddlewareOptions['onPaymentError']
    onBeforeVerify?: PaymentMiddlewareOptions['onBeforeVerify']
    onAfterVerify?: PaymentMiddlewareOptions['onAfterVerify']
    onAfterSettle?: PaymentMiddlewareOptions['onAfterSettle']
  }
}): Promise<void> {
  const { req, res, payments, routeConfig, paymentRequired } = args
  const { planId, credits = 1, agentId, description } = routeConfig
  const resource = mppResource(req)
  const httpVerb = mppVerb(req)
  const { onPaymentError, onBeforeVerify, onAfterVerify, onAfterSettle } = args.hooks

  // Credits are sealed into the challenge, so a credits function is evaluated
  // exactly once — here. MPP has no equivalent of the x402 re-evaluation at
  // settle time; the backend settles the amount the challenge carries.
  const creditsToCharge = typeof credits === 'function' ? await credits(req, res) : credits

  // A bound challenge must be minted, verified and settled against the SAME
  // digest. A request with no body binds nothing, which is correct: there
  // are no bytes to bind.
  //
  // The guard is intentionally FAIL CLOSED: `requestHasBody(req)` recognizes
  // both a non-zero Content-Length AND a bare Transfer-Encoding (chunked —
  // the shape a Content-Length-only check let straight through, unbound and
  // silent). Whenever the request has a body and the raw bytes were never
  // captured, we refuse rather than mint an unbound challenge — the buyer
  // must never get to decide whether the seller's bindBody applies.
  let bodyDigest: string | undefined
  let bindBodyRefusal: { status: number; message: string; loud: boolean } | undefined
  if (args.bindBody) {
    const raw = getRawBody(req)
    if (raw === undefined && requestHasBody(req)) {
      const contentType = req.headers['content-type'] ?? ''
      if (contentType.toLowerCase().startsWith('application/json')) {
        // The documented setup is express.json({ verify: captureRawBody }).
        // A JSON body with no captured bytes means that hook was never
        // wired — a seller configuration mistake, not the buyer's fault.
        bindBodyRefusal = {
          status: 500,
          loud: true,
          message:
            'paymentMiddleware: mpp.bindBody requires the raw request body. ' +
            "Mount the parser as express.json({ verify: captureRawBody }) — import { captureRawBody } from '@nevermined-io/payments/express'.",
        }
      } else {
        // captureRawBody only runs for content-types the mounted parser
        // matches. A buyer sending a content-type this route's parser was
        // never wired for is a client-side mismatch, not a server bug.
        bindBodyRefusal = {
          status: 400,
          loud: false,
          message: `paymentMiddleware: this route requires a captured request body, and Content-Type '${contentType || '(none)'}' is not supported here.`,
        }
      }
    } else if (raw) {
      bodyDigest = computeBodyDigest(raw)
    }
  }
  if (bindBodyRefusal) {
    const error = new Error(bindBodyRefusal.message)
    if (onPaymentError) {
      onPaymentError(error, req, res)
      return
    }
    // Loud in the server-side log either way — a seller can act on both
    // causes — but never as an uncaught throw: that would skip a configured
    // onPaymentError and fall through to Express's default error handler,
    // leaking a stack trace to the client on every request the guard
    // rejects, exactly the failure sendChallenge below guards against too.
    if (bindBodyRefusal.loud) {
      console.error('MPP bindBody misconfiguration:', bindBodyRefusal.message)
    } else {
      console.warn('MPP bindBody could not capture the request body:', bindBodyRefusal.message)
    }
    if (!res.headersSent) {
      res.status(bindBodyRefusal.status).json({
        error: bindBodyRefusal.status >= 500 ? 'Internal Server Error' : 'Bad Request',
        message: bindBodyRefusal.message,
      })
    }
    return
  }

  const sendChallenge = async (message: string, code?: string): Promise<void> => {
    // issueChallenge itself can fail (e.g. MPP is turned off on this
    // environment: BCK.MPP.0002 -> MppNotConfiguredError). This call site is
    // reached from three places — no credential, rejected credential, and the
    // verifyCredential catch block — so a failure here must never propagate
    // out of handleMppRequest: unhandled it would skip a configured
    // onPaymentError and fall through to Express's default error handler,
    // which leaks a stack trace to the client on every unauthenticated
    // request to the route.
    let challenge: string
    try {
      const issued = await payments.mpp.issueChallenge({
        planId,
        // Normalized here (not left to MppAPI.issueChallenge) so the exact
        // wire shape is visible to a mocked payments.mpp in tests, matching
        // the decimal-string contract of IssueMppChallengeParams.credits —
        // and so a NaN/Infinity/non-integer credits function result is
        // rejected before a mocked payments.mpp in a test could hide the
        // defect by never validating it itself.
        credits: normalizeCredits(creditsToCharge),
        ...(agentId && { agentId }),
        resource,
        httpVerb,
        ...(bodyDigest && { digest: bodyDigest }),
        ...(description && { description }),
      })
      challenge = issued.challenge
    } catch (challengeError) {
      if (onPaymentError) {
        onPaymentError(challengeError as Error, req, res)
        return
      }
      console.error('MPP challenge issuance failed:', challengeError)
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Unable to issue an MPP payment challenge. Please try again later.',
        })
      }
      return
    }

    const paymentRequiredBase64 = Buffer.from(JSON.stringify(paymentRequired)).toString('base64')
    res
      .status(402)
      .setHeader(MPP_HEADERS.CHALLENGE, challenge)
      // Advertise x402 on the same 402 so an x402 buyer is unaffected.
      .setHeader(X402_HEADERS.PAYMENT_REQUIRED, paymentRequiredBase64)
      // The backend's own BCK.MPP.* code rides along when we have one, so a
      // buyer can tell "this credential was refused" (terminal — paying
      // again with a fresh one is pointless) from "here is a fresh challenge,
      // pay it" (retryable). This echoes a distinction the backend itself
      // already publishes on the wire; it adds no new detail and does not
      // reopen the "one rejection code" forgery-oracle discipline.
      //
      // `retryable` is carried alongside the code as an explicit wire signal
      // rather than leaving every buyer to hardcode which BCK.MPP.* codes are
      // exceptions to "code present means terminal": BCK.MPP.0004 (expired)
      // and BCK.MPP.0005 (body digest mismatch) are both retryable against
      // the fresh challenge on this same 402, while BCK.MPP.0003 (refused)
      // is not.
      .json({
        error: 'Payment Required',
        message,
        ...(code && { code, retryable: isRetryableMppCode(code) }),
      })
  }

  const credential = extractCredential(req)
  if (!credential) {
    await sendChallenge('Payment required. Present the challenge credential in Authorization.')
    return
  }

  let verification: VerifyPermissionsResult
  try {
    // Hook: before verification, mirroring the x402 path (middleware.ts's
    // x402 branch calls it in the same position). Dropped entirely here
    // before this fix: adding mpp: true to a working route silently
    // disabled a documented PaymentMiddlewareOptions hook.
    if (onBeforeVerify) {
      await onBeforeVerify(req, paymentRequired)
    }

    verification = await payments.mpp.verifyCredential({
      credential,
      resource,
      httpVerb,
      ...(bodyDigest && { bodyDigest }),
    })
  } catch (error) {
    if (onPaymentError) {
      onPaymentError(error as Error, req, res)
      return
    }
    // Every MPP rejection — expired, replayed, refused — is answered with a
    // fresh challenge, so a buyer can always make progress by paying again.
    // The backend's BCK.MPP.* code (when the failure carries one) rides
    // along so the buyer can tell which kind of rejection this was; it is
    // confined to BCK.MPP.* so an unrelated code (network_error, http_500,
    // a backend code from a different namespace) is never forwarded as if
    // it were one of ours.
    const code =
      error instanceof MppError && error.code?.startsWith('BCK.MPP.') ? error.code : undefined
    // Log the full detail — MppAPI.post folds a backend `hint` onto the
    // error's message — for the seller's own diagnostics. The buyer only
    // ever sees a fixed generic message plus the coarse code: forwarding
    // error.message verbatim would re-widen the anti-oracle discipline
    // src/mpp/errors.ts documents, handing a hint the backend deliberately
    // withheld straight back to the caller most likely to probe for it.
    console.error('MPP credential verification failed:', error)
    await sendChallenge('Credential rejected', code)
    return
  }

  if (!verification.isValid) {
    // This IS a credential rejection, even though VerifyPermissionsResult
    // carries no code of its own. The wire contract is positional, not
    // incidental: any 402 answering a request that presented a credential
    // must carry a code, or a buyer cannot tell this fresh-but-otherwise-
    // unmarked challenge apart from "you had not paid yet" and mints a
    // second credential for a rejection that already proved terminal.
    // 'BCK.MPP.0003' is the backend's own generic rejection code — nothing
    // new is invented or published beyond it.
    const rejectionError = new MppCredentialRejectedError(
      verification.invalidReason || 'Credential rejected',
    )
    // Matches the x402 path: a seller who wires onPaymentError is notified
    // of every rejected payment, not just the ones where verifyCredential
    // itself threw.
    if (onPaymentError) {
      onPaymentError(rejectionError, req, res)
      return
    }
    await sendChallenge(rejectionError.message, rejectionError.code)
    return
  }

  // onAfterVerify runs OUTSIDE the verify try/catch above: a bug in the
  // seller's OWN hook, after the credential has already been proven valid,
  // must never be misreported as a payment rejection (no re-challenge) and
  // must never leak the hook's own exception text into the buyer-visible
  // 402 body the catch above would otherwise build from it.
  if (onAfterVerify) {
    try {
      await onAfterVerify(req, verification)
    } catch (hookError) {
      if (onPaymentError) {
        onPaymentError(hookError as Error, req, res)
        return
      }
      console.error('MPP onAfterVerify hook failed:', hookError)
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'A server-side hook failed after payment verification.',
        })
      }
      return
    }
  }

  // The credential is now verified but not yet settled — exactly the window
  // where an idempotent settle makes concurrent delivery cheap: a second
  // request presenting this SAME credential right now would also pass
  // verify (verifyCredential burns nothing) and also get served, while the
  // two settles collapse into a single burn. Refuse it instead.
  if (inFlightMppCredentials.has(credential)) {
    const error = new MppCredentialRejectedError(
      'This credential is already being processed by a concurrent request.',
    )
    if (onPaymentError) {
      onPaymentError(error, req, res)
      return
    }
    if (!res.headersSent) {
      res.status(409).json({ error: 'Conflict', message: error.message })
    }
    return
  }
  inFlightMppCredentials.add(credential)
  // Released on 'close', not from inside the settlement promise: 'close'
  // fires whether this request ends in a successful settle, a failed one, a
  // non-2xx handler response that never reaches settlement at all, or the
  // connection simply dropping — the one event that reliably covers every
  // exit from here, so the credential can never be left claimed forever.
  res.on('close', () => {
    inFlightMppCredentials.delete(credential)
  })

  const paymentContext: PaymentContext = {
    token: credential,
    paymentRequired,
    creditsToSettle: creditsToCharge,
    verified: true,
    agentRequest: verification.agentRequest,
    agentRequestId: verification.agentRequest?.agentRequestId || verification.agentRequestId,
    mpp: { credential, resource, httpVerb },
  }
  ;(req as Request & { paymentContext?: PaymentContext }).paymentContext = paymentContext

  const originalEnd = res.end.bind(res) as (...a: Parameters<Response['end']>) => Response
  let settlementStarted = false

  const runSettlement = (): Promise<void> =>
    payments.mpp
      .settleCredential({
        credential,
        resource,
        httpVerb,
        ...(bodyDigest && { bodyDigest }),
      })
      .then((settlement) => {
        // Never call res.setHeader with an undefined value: MppSettleResult's
        // type says success: true implies a string paymentReceipt, but a
        // real backend response isn't statically checked, so this is
        // defensive too. Distinguishing the three cases matters: a genuine
        // settlement failure, a successful settle that (contrary to the
        // type) carried no receipt, and the normal success-with-receipt
        // path each get their own accurate log — collapsing them all into
        // "MPP settlement failed" pointed an on-call engineer at the wrong
        // system when the burn had actually succeeded.
        if (settlement.success && settlement.paymentReceipt) {
          if (!res.headersSent) {
            res.setHeader(MPP_HEADERS.RECEIPT, settlement.paymentReceipt)
          } else {
            console.warn(
              '[paymentMiddleware] headers already flushed; Payment-Receipt not attached',
            )
          }
        } else if (!settlement.success) {
          console.error(
            'MPP settlement failed:',
            settlement.errorReason ?? 'no errorReason provided',
          )
        } else {
          console.warn(
            '[paymentMiddleware] MPP settlement succeeded but carried no paymentReceipt',
          )
        }

        // The amount actually burned is whatever the challenge sealed on an
        // EARLIER request, reported back on the settlement — not
        // creditsToCharge, which is recomputed on THIS request and can
        // diverge from the minting request when `credits` is a function
        // (evaluated once per request, so at least twice per payment cycle).
        const creditsSettled =
          settlement.creditsRedeemed !== undefined
            ? Number(settlement.creditsRedeemed)
            : creditsToCharge
        paymentContext.creditsToSettle = creditsSettled

        if (onAfterSettle) {
          return Promise.resolve(onAfterSettle(req, creditsSettled, settlement)).then(
            () => undefined,
          )
        }
        return undefined
      })
      .catch((settleError) => {
        console.error('MPP settlement failed:', settleError)
      })

  ;(res as unknown as { end: Response['end'] }).end = function (
    this: Response,
    ...endArgs: Parameters<Response['end']>
  ): Response {
    const isSuccess = res.statusCode >= 200 && res.statusCode < 300
    if (settlementStarted || !isSuccess) return originalEnd(...endArgs)
    settlementStarted = true

    if (res.headersSent) {
      void runSettlement()
      return originalEnd(...endArgs)
    }

    runSettlement().finally(() => {
      originalEnd(...endArgs)
    })
    return res
  } as Response['end']

  args.next()
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

      const {
        planId,
        credits = 1,
        agentId,
        network,
        scheme: explicitScheme,
        description,
        mimeType,
      } = routeConfig

      // Resolve scheme and network from plan metadata (cached) or explicit overrides
      const scheme = await resolveScheme(payments, planId, explicitScheme)
      const resolvedNetwork = await resolveNetwork(payments, planId, network)

      // Build payment required object (needed for both error responses and verification)
      const paymentRequired = buildPaymentRequired(planId, {
        endpoint: req.originalUrl || req.url,
        agentId,
        httpVerb: req.method,
        network: resolvedNetwork,
        description,
        mimeType,
        scheme,
        environment: payments.getEnvironmentName(),
      })

      // Extract token from headers (x402 v2: payment-signature)
      const token = extractToken(req, tokenHeader)

      const mppOption = resolveMppOption(routeConfig.mpp)
      // The 402 an MPP-enabled route sends advertises both a WWW-Authenticate
      // challenge and the x402 payment-required header, so both protocols
      // must be payable, not just the one that minted the 402. An MPP
      // credential always takes the MPP path; with no MPP credential but a
      // valid x402 token present, fall through to the existing x402 flow
      // below unchanged. With neither present, handleMppRequest still runs so
      // the 402 keeps advertising both.
      if (mppOption.enabled && (extractCredential(req) || !token)) {
        await handleMppRequest({
          req,
          res,
          next,
          payments,
          routeConfig,
          paymentRequired,
          bindBody: mppOption.bindBody,
          hooks: { onPaymentError, onBeforeVerify, onAfterVerify, onAfterSettle },
        })
        return
      }
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

        // Wrap res.end so settlement runs no matter how the handler responds
        // (res.json, res.send, res.sendFile, res.end, res.pipe → res.end).
        // Previously only res.json was intercepted, so any other response
        // method would deliver the resource without burning credits and
        // without emitting the payment-response receipt header (#1728).
        const originalEnd = res.end.bind(res) as (...args: Parameters<Response['end']>) => Response
        let settlementStarted = false

        const runSettlement = (): Promise<void> => {
          return (
            typeof credits === 'function'
              ? Promise.resolve(credits(req, res))
              : Promise.resolve(creditsToVerify)
          )
            .then((creditsToSettle) => {
              paymentContext.creditsToSettle = creditsToSettle
              return payments.facilitator
                .settlePermissions({
                  paymentRequired,
                  x402AccessToken: token,
                  maxAmount: BigInt(creditsToSettle),
                  agentRequestId: paymentContext.agentRequestId,
                })
                .then((settlement) => {
                  // Only attach the receipt header if headers haven't flushed
                  // yet — streaming responses fire writeHead on the first
                  // chunk and may have already sent them by the time we land
                  // here.
                  if (!res.headersSent) {
                    const settlementBase64 = Buffer.from(JSON.stringify(settlement)).toString(
                      'base64',
                    )
                    res.setHeader(X402_HEADERS.PAYMENT_RESPONSE, settlementBase64)
                  } else {
                    console.warn(
                      '[paymentMiddleware] headers already flushed; payment-response receipt not attached',
                    )
                  }
                  if (onAfterSettle) {
                    return Promise.resolve(onAfterSettle(req, creditsToSettle, settlement)).then(
                      () => undefined,
                    )
                  }
                  return undefined
                })
            })
            .catch((settleError) => {
              console.error('Payment settlement failed:', settleError)
            })
        }

        ;(res as unknown as { end: Response['end'] }).end = function (
          this: Response,
          ...args: Parameters<Response['end']>
        ): Response {
          // Only bill on 2xx success. Skipping 3xx avoids charging when the
          // handler redirects (e.g. `res.redirect(...)`), 304 Not Modified,
          // etc. Skipping 4xx/5xx avoids charging when the handler signals
          // failure — including `sendPaymentRequired`'s 402 which lands here.
          const isSuccess = res.statusCode >= 200 && res.statusCode < 300
          if (settlementStarted || !isSuccess) {
            return originalEnd(...args)
          }
          settlementStarted = true

          // If the handler streamed before calling end, headers were already
          // flushed. Settle anyway (so we still charge the card) but accept
          // we cannot inject the receipt header.
          if (res.headersSent) {
            void runSettlement()
            return originalEnd(...args)
          }

          // Buffered response path: defer the real `end` until settlement
          // finishes so the receipt header makes it into the same response.
          runSettlement().finally(() => {
            originalEnd(...args)
          })
          return res
        } as Response['end']

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
