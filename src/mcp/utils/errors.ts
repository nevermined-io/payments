import { PaymentsError } from '../../common/payments.error.js'

/**
 * Error utilities and common JSON-RPC error codes used by the MCP paywall.
 */

export const ERROR_CODES = {
  Misconfiguration: -32002,
  PaymentRequired: -32003,
} as const

const ERROR_CODES_MAP = {
  [ERROR_CODES.Misconfiguration]: PaymentsError.internal,
  [ERROR_CODES.PaymentRequired]: PaymentsError.paymentRequired,
}

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * Create a JSON-RPC-like error object preserving code and message.
 */
export function createRpcError(code: ErrorCode, message: string, data?: any) {
  return ERROR_CODES_MAP[code](message)
}
