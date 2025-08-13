/**
 * Utilities to work with request metadata and authorization headers.
 */

/**
 * Extract the Authorization header from the MCP extra request info.
 * The lookup is case-insensitive, supports array values taking the first,
 * and searches common locations used by different transports (HTTP, WS, stdio),
 * but ONLY from headers-like containers. No query/env/body fallbacks are allowed.
 *
 * @param extra - Arbitrary extra payload passed by the MCP runtime.
 * @returns The raw Authorization header value, or undefined when missing.
 */
export function extractAuthHeader(extra: any): string | undefined {
  const candidateHeaders: Array<Record<string, unknown> | undefined> = [
    extra?.requestInfo?.headers,
    extra?.request?.headers,
    extra?.headers,
    extra?.connection?.headers,
    extra?.socket?.handshake?.headers,
  ]

  for (const headers of candidateHeaders) {
    if (!headers) continue
    const value = getHeaderCaseInsensitive(headers as Record<string, unknown>, 'authorization')
    if (value) return value
  }
  return undefined
}

/**
 * Case-insensitive header lookup helper. Returns the first string value when arrays are provided.
 * @param headers - A headers-like record object
 * @param name - Header name (case-insensitive)
 */
function getHeaderCaseInsensitive(
  headers: Record<string, unknown>,
  name: string,
): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()] ?? (headers as any)[capitalize(name)]
  const value = direct as string | string[] | undefined
  if (Array.isArray(value)) return value[0]
  if (typeof value === 'string') return value
  // Try a full scan when keys are in unknown casing
  const target = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      if (Array.isArray(v)) return (v as string[])[0]
      if (typeof v === 'string') return v as string
    }
  }
  return undefined
}

/**
 * Capitalize utility for common header key variants.
 */
function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Remove the Bearer prefix from an HTTP Authorization header value.
 * @param header - Authorization header value.
 * @returns The stripped token string.
 */
export function stripBearer(header: string): string {
  return header.startsWith('Bearer ') ? header.slice(7).trim() : header
}
