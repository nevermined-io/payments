/**
 * The MPP wire format, hand-written so the SDK takes no protocol dependency.
 *
 * The one rule that matters: the backend re-derives the challenge id as
 * `HMAC(secret, realm|method|intent|canonicalize(request)|expires|digest|opaque)`
 * from the fields carried inside the credential. `request` and `opaque` are
 * therefore passed through as the exact base64url strings received — this file
 * never re-encodes them.
 */

import { MppError } from './errors.js'
import type { MppChallenge, MppChallengeRequest, MppReceipt } from './types.js'

/** A bare token (RFC 9110 §5.6.2, used for auth-scheme names and auth-param keys). */
const TOKEN = "[!#$%&'*+\\-.^_`|~0-9A-Za-z]+"
/** Matches the start of a `key=` auth-param, i.e. a Payment challenge continuing. */
const AUTH_PARAM_START = new RegExp(`^${TOKEN}\\s*=`)

/**
 * Finds where a structured challenge's auth-param list ends within `rest`
 * (the content right after "Payment "), scanning quote- and escape-aware so
 * neither a comma nor a `\"` inside a `"…"` value is mistaken for a
 * boundary. mppx serializes quoted values with
 * `value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')` (`Challenge.ts:316-319`),
 * so a seller-supplied `description` like `5" screen replacement plan` wire-
 * encodes as `description="5\" screen replacement plan"`. A scanner that
 * toggles quote state on every literal `"` — escaped or not — desyncs on
 * that `\"`, stays stuck "inside" a quote for the rest of the header, and
 * swallows a genuine trailing scheme. This mirrors mppx's own reference
 * parser's `escaped` flag (`Challenge.ts:362-379`) rather than inventing new
 * semantics.
 *
 * A top-level (non-quoted, non-escaped) comma only ends the scheme if what
 * follows it does NOT itself look like a continuing `key=value` auth-param —
 * which is also how a following literal "Payment " (the merged-challenge
 * case) is recognized as a new scheme: "Payment" followed by whitespace
 * never matches `AUTH_PARAM_START`, since that requires "=" immediately
 * (modulo optional whitespace) after the leading token.
 *
 * An unterminated quote is not an error here: the loop simply runs out of
 * input without finding a boundary and falls back to treating the whole
 * remainder as this scheme — a safe, total (never-throwing) O(n) fallback.
 */
function findStructuredChallengeEnd(rest: string): number {
  let inQuotes = false
  let escaped = false
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    if (inQuotes) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inQuotes = false
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',' && !AUTH_PARAM_START.test(rest.slice(i + 1).trimStart())) {
      return i
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

/**
 * Reads a quoted-string value starting right after its opening `"`,
 * unescaping `\"` to a literal `"` and `\\` to a literal `\` (mirrors
 * mppx's `readQuotedAuthParamValue`, `Challenge.ts:461-465`).
 *
 * An unterminated quote is not an error here (unlike mppx's reference
 * parser, which throws): the loop runs out of input and returns whatever was
 * accumulated, matching {@link findStructuredChallengeEnd}'s equally
 * permissive fallback for the same input shape.
 */
function readQuotedValue(input: string, start: number): [value: string, nextIndex: number] {
  let i = start
  let value = ''
  let escaped = false
  while (i < input.length) {
    const ch = input[i]
    i++
    if (escaped) {
      value += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') return [value, i]
    value += ch
  }
  return [value, i]
}

/**
 * Splits `key="value", key2="value2"` into a map. Quoted values are read
 * escape-aware and unescaped ({@link readQuotedValue}), so a value may
 * itself contain a comma, a quote (`\"`) or a backslash (`\\`) without
 * corrupting the param that follows it. Unquoted values are tolerated too.
 */
function parseAuthParams(input: string): Record<string, string> {
  const params: Record<string, string> = {}
  let i = 0

  while (i < input.length) {
    while (i < input.length && /[\s,]/.test(input[i])) i++
    if (i >= input.length) break

    const keyStart = i
    while (i < input.length && /[a-zA-Z0-9_-]/.test(input[i])) i++
    const key = input.slice(keyStart, i)
    if (!key) break

    while (i < input.length && /\s/.test(input[i])) i++
    if (input[i] !== '=') break
    i++
    while (i < input.length && /\s/.test(input[i])) i++

    let value: string
    if (input[i] === '"') {
      const [decoded, nextIndex] = readQuotedValue(input, i + 1)
      value = decoded
      i = nextIndex
    } else {
      const valueStart = i
      while (i < input.length && input[i] !== ',') i++
      value = input.slice(valueStart, i).trim()
    }

    params[key] = value
  }

  return params
}

/**
 * Decodes a base64url string as JSON, raising a typed {@link MppError}
 * rather than a raw `SyntaxError` on malformed input.
 *
 * `Buffer.from(x, 'base64url')` never throws — it silently drops invalid
 * characters — so garbage would otherwise reach `JSON.parse` and escape as a
 * bare `SyntaxError` that names neither MPP nor payment, invisible to a
 * caller writing `catch (e) { if (e instanceof MppError) … }` exactly as our
 * own docs tell them to.
 */
function decodeBase64UrlJson<T>(encoded: string, context: string): T {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T
  } catch (error) {
    throw new MppError(
      `Could not decode the ${context}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Narrows a decoded `request` param to {@link MppChallengeRequest}'s shape.
 *
 * The raw decode only guarantees valid JSON, not the right shape: a remote
 * challenge's `request=` can decode to `null`, an array, `{}`, or
 * `{ credits: 2 }` (a number where a string is declared) and all of those
 * would otherwise sail through a bare type cast and reach `payments.mpp.fetch`
 * with an unusable or `undefined` `planId`.
 */
function isValidChallengeRequest(value: unknown): value is MppChallengeRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { planId, credits } = value as Record<string, unknown>
  return typeof planId === 'string' && planId !== '' && typeof credits === 'string'
}

/**
 * Parses a `WWW-Authenticate` header into a challenge.
 *
 * @returns `null` when the header carries no `Payment` scheme at all — which
 * is how a caller tells "not an MPP endpoint" apart from "malformed". A
 * `Payment` scheme that IS present but whose `request` param fails to decode,
 * or decodes to something that is not a `{ planId: string, credits: string }`
 * object, raises a typed {@link MppError} instead of returning `null` or
 * throwing a raw `SyntaxError`/`TypeError` — "structurally absent" and
 * "present but malformed" are different failures and must not collapse into
 * the same signal.
 */
export function parseChallengeHeader(headerValue: string): MppChallenge | null {
  const scheme = extractPaymentScheme(headerValue)
  if (!scheme) return null

  const params = parseAuthParams(scheme.replace(/^Payment\s+/i, ''))
  const { id, realm, method, intent, request, expires, digest, opaque, description } = params
  if (!id || !realm || !method || !intent || !request) return null

  const decodedRequest = decodeBase64UrlJson<unknown>(request, 'MPP challenge request parameter')
  if (!isValidChallengeRequest(decodedRequest)) {
    throw new MppError(
      'The MPP challenge names a request parameter that is not a valid ' +
        '{ planId: string, credits: string } object.',
    )
  }

  return {
    id,
    realm,
    method,
    intent,
    request: decodedRequest,
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

/**
 * Decodes a `Payment-Receipt` header value.
 *
 * Raises a typed {@link MppError} on malformed input rather than a raw
 * `SyntaxError` — this function does not decide whether that failure is
 * fatal for its caller (the receipt is "unsigned by design, and carries no
 * balance", so a caller may reasonably treat a decode failure as non-fatal
 * and simply omit the receipt); it only guarantees the failure is typed.
 */
export function parseReceiptHeader(headerValue: string): MppReceipt {
  return decodeBase64UrlJson<MppReceipt>(headerValue.trim(), 'MPP receipt')
}
