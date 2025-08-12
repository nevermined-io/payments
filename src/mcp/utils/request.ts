/**
 * Utilities to work with request metadata and authorization headers.
 */

/**
 * Extract the Authorization header from the MCP extra request info.
 * The lookup is case-insensitive and supports array values taking the first.
 * @param extra - Arbitrary extra payload passed by the MCP runtime.
 * @returns The raw Authorization header value, or undefined when missing.
 */
export function extractAuthHeader(extra: any): string | undefined {
  const headers = extra?.requestInfo?.headers ?? {}
  const raw = (headers['authorization'] ?? (headers as any)['Authorization']) as
    | string
    | string[]
    | undefined
  return Array.isArray(raw) ? raw[0] : raw
}

/**
 * Remove the Bearer prefix from an HTTP Authorization header value.
 * @param header - Authorization header value.
 * @returns The stripped token string.
 */
export function stripBearer(header: string): string {
  return header.startsWith('Bearer ') ? header.slice(7).trim() : header
}
