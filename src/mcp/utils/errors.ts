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
