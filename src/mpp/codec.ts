/**
 * The MPP wire format, hand-written so the SDK takes no protocol dependency.
 *
 * The one rule that matters: the backend re-derives the challenge id as
 * `HMAC(secret, realm|method|intent|canonicalize(request)|expires|digest|opaque)`
 * from the fields carried inside the credential. `request` and `opaque` are
 * therefore passed through as the exact base64url strings received — this file
 * never re-encodes them.
 */

import type { MppChallenge, MppChallengeRequest, MppReceipt } from './types.js'

const PAYMENT_SCHEME = /^Payment\s+/i

/**
 * Extracts the `Payment` scheme from a header value that may carry several
 * schemes comma-separated (RFC 9110 §11.6.1).
 */
export function extractPaymentScheme(headerValue: string): string | null {
  const starts: number[] = []
  for (const match of headerValue.matchAll(/Payment\s+/gi)) {
    if (match.index !== undefined) starts.push(match.index)
  }
  if (starts.length === 0) return null
  const start = starts[0]
  const end = starts.length > 1 ? starts[1] : headerValue.length
  return headerValue.slice(start, end).replace(/,\s*$/, '').trim()
}

/** Splits `key="value", key2="value2"` into a map, tolerating unquoted values. */
function parseAuthParams(value: string): Record<string, string> {
  const params: Record<string, string> = {}
  const pattern = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g
  for (const match of value.matchAll(pattern)) {
    params[match[1]] = match[2] ?? match[3] ?? ''
  }
  return params
}

function decodeBase64UrlJson<T>(encoded: string): T {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T
}

/**
 * Parses a `WWW-Authenticate` header into a challenge.
 *
 * @returns the challenge, or `null` when the header carries no `Payment`
 * scheme — which is how a caller tells "not an MPP endpoint" from "malformed".
 */
export function parseChallengeHeader(headerValue: string): MppChallenge | null {
  const scheme = extractPaymentScheme(headerValue)
  if (!scheme) return null

  const params = parseAuthParams(scheme.replace(PAYMENT_SCHEME, ''))
  const { id, realm, method, intent, request, expires, digest, opaque, description } = params
  if (!id || !realm || !method || !intent || !request) return null

  return {
    id,
    realm,
    method,
    intent,
    request: decodeBase64UrlJson<MppChallengeRequest>(request),
    requestEncoded: request,
    ...(expires && { expires }),
    ...(digest && { digest }),
    ...(opaque && { opaque }),
    ...(description && { description }),
  }
}

/**
 * Builds the `Authorization: Payment …` value for a challenge.
 *
 * Key order in the JSON is irrelevant — the server parses it — but the two
 * base64url strings are emitted untouched, which is what keeps the HMAC valid.
 */
export function buildCredentialHeader(
  challenge: MppChallenge,
  payload: { accessToken: string },
): string {
  const wire = {
    challenge: {
      id: challenge.id,
      realm: challenge.realm,
      method: challenge.method,
      intent: challenge.intent,
      ...(challenge.expires && { expires: challenge.expires }),
      ...(challenge.digest && { digest: challenge.digest }),
      ...(challenge.description && { description: challenge.description }),
      ...(challenge.opaque && { opaque: challenge.opaque }),
      request: challenge.requestEncoded,
    },
    payload,
  }
  return `Payment ${Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url')}`
}

/** Decodes a `Payment-Receipt` header value. */
export function parseReceiptHeader(headerValue: string): MppReceipt {
  return decodeBase64UrlJson<MppReceipt>(headerValue.trim())
}
