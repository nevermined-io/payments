/**
 * Error utilities and common JSON-RPC error codes used by the MCP paywall.
 */

export const ERROR_CODES = {
  Misconfiguration: -32002,
  PaymentRequired: -32003,
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * Create a JSON-RPC-like error object preserving numeric code and message.
 * Returns an Error instance augmented with a numeric `code` and optional `data`.
 */
export function createRpcError(code: ErrorCode, message: string, data?: any) {
  const rpcError = new Error(message) as Error & { code: number; data?: any }
  rpcError.name = 'JSONRpcError'
  rpcError.code = code
  if (data !== undefined) rpcError.data = data
  return rpcError
}

/**
 * Raised by the paywall when payment is required (x402 v2 MCP transport).
 *
 * Carries the spec-shaped `PaymentRequired` object so the tool paywall wrapper
 * can surface it *in band* as a `CallToolResult({ isError: true, ... })`. Also
 * exposes a JSON-RPC `code` so that non-tool paths (resources / prompts), which
 * cannot return a tool-result error, still degrade to a JSON-RPC error when the
 * exception propagates. Note: the MCP SDK's low-level catch-all only forwards
 * the error message (not `code`) to the wire for those paths.
 */
export class PaymentRequiredError extends Error {
  code: number = ERROR_CODES.PaymentRequired
  constructor(
    public paymentRequired: Record<string, any>,
    message = 'Payment required',
  ) {
    super(message)
    this.name = 'PaymentRequiredError'
  }
}

/**
 * Raised when settlement fails AFTER the tool has already executed.
 *
 * Same in-band shape as {@link PaymentRequiredError}; the tool paywall wrapper
 * suppresses the already-computed tool content and returns only the payment
 * error, per the x402 v2 MCP transport spec ("do not return the tool's content
 * if settlement fails").
 */
export class SettlementFailedError extends PaymentRequiredError {
  constructor(
    paymentRequired: Record<string, any>,
    message = 'Settlement failed after tool execution',
  ) {
    super(paymentRequired, message)
    this.name = 'SettlementFailedError'
  }
}
