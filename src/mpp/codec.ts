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

/** A bare token (RFC 9110 §5.6.2, used for auth-scheme names and auth-param keys). */
const TOKEN = "[!#$%&'*+\\-.^_`|~0-9A-Za-z]+"
/** Matches the start of a `key=` auth-param, i.e. a Payment challenge continuing. */
const AUTH_PARAM_START = new RegExp(`^${TOKEN}\\s*=`)

/**
 * Extracts the `Payment` scheme from a header value that may carry several
 * schemes comma-separated (RFC 9110 §11.6.1).
 *
 * The `Payment` scheme takes one of two shapes on our wire: a bare token68
 * credential (`Payment <base64url>`, which cannot itself contain a comma) or
 * a structured challenge (`Payment id="...", realm="...", ...`, comma-
 * separated `key="value"` auth-params). Bounding the match at the next
 * literal "Payment " occurrence — or at end-of-string otherwise — corrupts
 * the first shape whenever a *different* trailing scheme follows: e.g.
 * `Payment <token>, Bearer <jwt>` used to extract the whole remainder
 * including the trailing scheme. Instead: a bare token68 is bounded by its
 * first top-level comma; a structured challenge is bounded by whichever
 * comes first — a following literal "Payment " (the merged-challenge case
 * `parseChallengeHeader` relies on) or a following comma-delimited segment
 * that does not itself look like a continuing `key=value` auth-param.
 */
export function extractPaymentScheme(headerValue: string): string | null {
  const schemeMatch = /Payment\s+/i.exec(headerValue)
  if (!schemeMatch || schemeMatch.index === undefined) return null

  const start = schemeMatch.index
  const contentStart = start + schemeMatch[0].length
  const rest = headerValue.slice(contentStart)

  if (!AUTH_PARAM_START.test(rest)) {
    // Bare token68 credential: bounded by its first top-level comma, since a
    // token68 cannot itself contain one.
    const commaIndex = rest.indexOf(',')
    const end = commaIndex === -1 ? headerValue.length : contentStart + commaIndex
    return headerValue.slice(start, end).trim()
  }

  // Structured challenge: consume comma-separated key=value segments for as
  // long as each next segment still looks like one; stop at the first
  // segment that doesn't (a new scheme name), at a following literal
  // "Payment " (the existing merged-challenge case), or at end-of-string.
  const nextPayment = /Payment\s+/i.exec(rest)
  const searchSpace = nextPayment ? rest.slice(0, nextPayment.index) : rest

  const segments = searchSpace.split(',')
  let consumed = segments[0].length
  for (let i = 1; i < segments.length; i++) {
    if (!AUTH_PARAM_START.test(segments[i].trimStart())) break
    consumed += 1 + segments[i].length // +1 for the comma rejoining it
  }

  const end = contentStart + consumed
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

  const params = parseAuthParams(scheme.replace(/^Payment\s+/i, ''))
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
