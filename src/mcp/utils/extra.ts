/**
 * Build an MCP-compatible extra object from raw HTTP headers.
 * This normalizes the shape to { requestInfo: { headers } } so the
 * authenticator can extract the Authorization header consistently across transports.
 *
 * @param headers - A headers-like record (e.g., Node/Express headers)
 * @returns Extra object with requestInfo.headers
 */
export function buildExtraFromHttpHeaders(headers: Record<string, unknown>) {
  return { requestInfo: { headers } }
}

/**
 * Build an MCP-compatible extra object from an HTTP request-like object.
 * The function extracts req.headers and delegates to buildExtraFromHttpHeaders.
 *
 * @param req - Any object with a 'headers' property
 * @returns Extra object with requestInfo.headers
 */
export function buildExtraFromHttpRequest(req: { headers: Record<string, unknown> }) {
  return buildExtraFromHttpHeaders(req?.headers || {})
}
