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
 * Finds where a structured challenge's auth-param list ends within `rest`
 * (the content right after "Payment "), scanning quote-aware so a comma
 * inside a `"…"` value — e.g. a seller-supplied `description` like
 * `"Standard, non-refundable request"` — is never mistaken for a boundary.
 *
 * A top-level (non-quoted) comma only ends the scheme if what follows it
 * does NOT itself look like a continuing `key=value` auth-param — which is
 * also how a following literal "Payment " (the merged-challenge case) is
 * recognized as a new scheme: "Payment" followed by whitespace never matches
 * `AUTH_PARAM_START`, since that requires "=" immediately (module optional
 * whitespace) after the leading token.
 */
function findStructuredChallengeEnd(rest: string): number {
  let inQuotes = false
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (ch === ',' && !inQuotes) {
      if (!AUTH_PARAM_START.test(rest.slice(i + 1).trimStart())) {
        return i
      }
    }
  }
  return rest.length
}

/**
 * Extracts the `Payment` scheme from a header value that may carry several
 * schemes comma-separated (RFC 9110 §11.6.1).
 *
 * The `Payment` scheme takes one of two shapes on our wire: a bare token68
 * credential (`Payment <base64url>`, which cannot itself contain a comma or
 * a quote) or a structured challenge (`Payment id="...", realm="...", ...`,
 * comma-separated `key="value"` auth-params, where a value MAY contain a
 * comma). Bounding the match at the next literal "Payment " occurrence — or
 * at end-of-string otherwise — corrupts the first shape whenever a
 * *different* trailing scheme follows: e.g. `Payment <token>, Bearer <jwt>`
 * used to extract the whole remainder including the trailing scheme.
 * Bounding a structured challenge with a naive, quote-unaware comma split
 * corrupts the second shape whenever a value contains a comma: it truncates
 * mid-quote and silently drops every param after it. Instead: a bare
 * token68 is bounded by its first top-level comma; a structured challenge is
 * bounded by {@link findStructuredChallengeEnd}'s quote-aware scan.
 */
export function extractPaymentScheme(headerValue: string): string | null {
  const schemeMatch = /Payment\s+/i.exec(headerValue)
  if (!schemeMatch || schemeMatch.index === undefined) return null

  const start = schemeMatch.index
  const contentStart = start + schemeMatch[0].length
  const rest = headerValue.slice(contentStart)

  if (!AUTH_PARAM_START.test(rest)) {
    // Bare token68 credential: bounded by its first top-level comma, since a
    // token68 cannot itself contain one (or a quote, so no quote-tracking
    // is needed here).
    const commaIndex = rest.indexOf(',')
    const end = commaIndex === -1 ? headerValue.length : contentStart + commaIndex
    return headerValue.slice(start, end).trim()
  }

  const end = contentStart + findStructuredChallengeEnd(rest)
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
