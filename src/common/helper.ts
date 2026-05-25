import { Endpoint } from './types.js'

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Safe JSON parse for fetch responses. Reads the body once and tolerates
 * non-JSON payloads (e.g. NGINX HTML 5xx gateway pages) by returning a
 * `{ message }` shell that downstream error code paths can still consume.
 *
 * Prevents the failure mode tracked in #1727: callers doing
 * `throw PaymentsError.fromBackend('...', await response.json())` would
 * otherwise let a SyntaxError from `.json()` escape and surface as an
 * `unhandledRejection` that can take the host Node process down.
 */
export async function safeParseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  // Always consume the body so the underlying socket can be released, even
  // when we decide we can't parse it as JSON.
  const text = await response.text().catch(() => '')
  if (!text) return {}
  if (!contentType.toLowerCase().includes('json')) {
    // Truncate to keep the payload bounded — a full HTML gateway page is
    // noise in an error log.
    const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text
    return { message: `Non-JSON response (${contentType || 'no content-type'}): ${snippet}` }
  }
  try {
    return JSON.parse(text)
  } catch (cause) {
    return {
      message: `Malformed JSON response: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

export const jsonReplacer = (_key: any, value: { toString: () => any }) => {
  return typeof value === 'bigint' ? value.toString() : value
}

export const getServiceHostFromEndpoints = (endpoints: Endpoint[]): string => {
  let serviceHost = ''
  endpoints.some((endpoint) => {
    const _endpoint = Object.values(endpoint)[0]
    serviceHost = new URL(_endpoint).origin
  })
  return serviceHost
}
