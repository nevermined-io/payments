/**
 * In-band x402 metadata helpers for the MCP transport (x402 v2 MCP spec).
 *
 * The x402 v2 MCP transport signals payments *in band* via the MCP tool-call
 * machinery instead of HTTP status codes / headers:
 *
 * - The client sends the `PaymentPayload` in the request params
 *   `_meta["x402/payment"]` (plain JSON).
 * - The server returns the settlement receipt in the response
 *   `_meta["x402/payment-response"]` (plain JSON).
 * - Payment-required is signalled as a tool result with `isError: true` whose
 *   `structuredContent` carries the `PaymentRequired` object and whose
 *   `content[0].text` is the JSON-stringified copy of it.
 *
 * Nevermined-specific observability (txHash, creditsRedeemed, …) is kept under
 * a namespaced `_meta["nevermined/credits"]` key so it never collides with the
 * spec-defined keys.
 */

/** Spec-defined JSON-RPC `_meta` keys (x402 v2 MCP transport). */
export const X402_PAYMENT_META_KEY = 'x402/payment'
export const X402_PAYMENT_RESPONSE_META_KEY = 'x402/payment-response'

/** Nevermined-namespaced observability key (NOT part of the x402 spec). */
export const NEVERMINED_CREDITS_META_KEY = 'nevermined/credits'

/**
 * Read the in-band x402 payment payload from the current request's `_meta`.
 *
 * The MCP TS SDK exposes the incoming request `_meta` on the tool handler's
 * `extra` argument (`extra._meta`), and its schema is a passthrough object, so
 * non-standard keys like `"x402/payment"` survive parsing.
 *
 * @param extra - The MCP handler `extra` argument.
 * @returns The decoded PaymentPayload object, or `undefined` when absent.
 */
export function readPaymentPayload(extra: any): Record<string, any> | undefined {
  const value = extra?._meta?.[X402_PAYMENT_META_KEY]
  return value && typeof value === 'object' ? value : undefined
}

/**
 * Build a spec-shaped payment-required tool result.
 *
 * Per the x402 v2 MCP transport, payment-required is an *error* tool result
 * that carries the `PaymentRequired` object in BOTH `structuredContent` (the
 * object) and `content[0].text` (the JSON-stringified copy, for clients that
 * cannot read structured content).
 *
 * @param paymentRequired - The `PaymentRequired` object.
 * @returns A `CallToolResult`-shaped object with `isError: true`.
 */
export function paymentRequiredResult(paymentRequired: Record<string, any>) {
  return {
    isError: true,
    structuredContent: paymentRequired,
    content: [{ type: 'text' as const, text: JSON.stringify(paymentRequired) }],
  }
}
