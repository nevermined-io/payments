/**
 * Express middleware for Nevermined payment protection using the x402 protocol.
 */

export {
  paymentMiddleware,
  X402_HEADERS,
  type ExpressMiddleware,
  type RouteConfig,
  type RouteConfigMap,
  type PaymentMiddlewareOptions,
  type PaymentContext,
} from './middleware.js'
