/**
 * Wire-format tests for the MPP codec.
 *
 * `CHALLENGE_HEADER`, `CHALLENGE_HEADER_WITH_COMMA_DESCRIPTION` and
 * `MPPX_CREDENTIAL` below are hand-maintained fixtures modelled on real
 * `mppx@0.6.31` output — inline string literals, not a vendored or
 * regenerable artifact, so treat them as illustrative of the wire shape
 * rather than as a pinned, reproducible capture. What IS pinned exactly,
 * byte-for-byte, is the property that actually matters: the challenge id is
 * an HMAC over `canonicalize(request)` and `opaque`, and
 * `challenge.requestEncoded` / `challenge.opaque` are asserted with `toBe`
 * against these exact strings below — a silent re-encode of either one,
 * which is what would actually break settlement, is what these fixtures
 * exist to catch. This PR takes no `mppx` dependency, so these fixtures are
 * the compatibility contract in lieu of one.
 */
import {
  parseChallengeHeader,
  buildCredentialHeader,
  parseReceiptHeader,
  extractPaymentScheme,
} from '../../../src/mpp/codec.js'
import { MppError } from '../../../src/mpp/errors.js'

const CHALLENGE_HEADER =
  'Payment id="CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og", realm="api.nevermined.app", ' +
  'method="nevermined", intent="charge", ' +
  'request="eyJjcmVkaXRzIjoiMiIsInBsYW5JZCI6IjQ0NzQyNzYzMDc2MDQ3NDk3NjQwMDgwMjMwMjM2NzgxNDc0MTI5OTcwOTkyNzI3ODk2NTkzODYxOTk3MzQ3MTM1NjEzMTM1NTcxMDcifQ", ' +
  'expires="2026-08-12T10:05:00.000Z", ' +
  'opaque="eyJfbXBweF9zY29wZSI6IlBPU1QgL2FzayIsIm5vbmNlIjoiMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1In0"'

const REQUEST_ENCODED =
  'eyJjcmVkaXRzIjoiMiIsInBsYW5JZCI6IjQ0NzQyNzYzMDc2MDQ3NDk3NjQwMDgwMjMwMjM2NzgxNDc0MTI5OTcwOTkyNzI3ODk2NTkzODYxOTk3MzQ3MTM1NjEzMTM1NTcxMDcifQ'
const OPAQUE_ENCODED =
  'eyJfbXBweF9zY29wZSI6IlBPU1QgL2FzayIsIm5vbmNlIjoiMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1In0'

const RECEIPT_HEADER =
  'eyJtZXRob2QiOiJuZXZlcm1pbmVkIiwicmVmZXJlbmNlIjoiQ1Fzek9uZ2Z2VDFSSUdTYWppcFpKdmctbEJDRUR1Z1dMREY3U0RfdzFvZyIsInN0YXR1cyI6InN1Y2Nlc3MiLCJ0aW1lc3RhbXAiOiIyMDI2LTA4LTEyVDEwOjAwOjMwLjAwMFoifQ'

// A structured challenge with a comma inside a quoted auth-param value
// (`description`), placed BEFORE `opaque` so a naive comma split truncates
// the scheme mid-quote and silently drops `opaque` — exactly the regression
// reported in fix round 2.
const CHALLENGE_HEADER_WITH_COMMA_DESCRIPTION =
  'Payment id="CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og", realm="api.nevermined.app", ' +
  'method="nevermined", intent="charge", ' +
  'request="eyJjcmVkaXRzIjoiMiIsInBsYW5JZCI6IjQ0NzQyNzYzMDc2MDQ3NDk3NjQwMDgwMjMwMjM2NzgxNDc0MTI5OTcwOTkyNzI3ODk2NTkzODYxOTk3MzQ3MTM1NjEzMTM1NTcxMDcifQ", ' +
  'expires="2026-08-12T10:05:00.000Z", ' +
  'description="Standard, non-refundable request", ' +
  'opaque="eyJfbXBweF9zY29wZSI6IlBPU1QgL2FzayIsIm5vbmNlIjoiMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1In0"'

/**
 * Mirrors mppx's own `authParam` serializer (`Challenge.ts:316-319`):
 * `value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')`. Fixtures built with this
 * are escaped the way the real backend actually emits them, not hand-waved.
 */
function mppxAuthParam(name: string, value: string): string {
  return `${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Builds a full structured challenge (sans "Payment " prefix) with a given `description`. */
function buildChallengeParams(description: string): string {
  return [
    mppxAuthParam('id', 'CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og'),
    mppxAuthParam('realm', 'api.nevermined.app'),
    mppxAuthParam('method', 'nevermined'),
    mppxAuthParam('intent', 'charge'),
    mppxAuthParam('request', REQUEST_ENCODED),
    mppxAuthParam('description', description),
    mppxAuthParam('opaque', OPAQUE_ENCODED),
  ].join(', ')
}

describe('parseChallengeHeader', () => {
  it('parses every auth-param and decodes the sealed request', () => {
    const challenge = parseChallengeHeader(CHALLENGE_HEADER)!
    expect(challenge.id).toBe('CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og')
    expect(challenge.realm).toBe('api.nevermined.app')
    expect(challenge.method).toBe('nevermined')
    expect(challenge.intent).toBe('charge')
    expect(challenge.expires).toBe('2026-08-12T10:05:00.000Z')
    expect(challenge.request).toEqual({
      credits: '2',
      planId:
        '4474276307604749764008023023678147412997099272789659386199734713561313557107',
    })
  })

  it('keeps request and opaque as the exact base64url strings received', () => {
    const challenge = parseChallengeHeader(CHALLENGE_HEADER)!
    expect(challenge.requestEncoded).toBe(REQUEST_ENCODED)
    expect(challenge.opaque).toBe(OPAQUE_ENCODED)
  })

  it('returns null when the header carries no Payment scheme', () => {
    expect(parseChallengeHeader('Bearer abc')).toBeNull()
  })

  it('picks the Payment scheme out of a merged header', () => {
    expect(parseChallengeHeader(`Bearer abc, ${CHALLENGE_HEADER}`)).not.toBeNull()
  })

  it('decodes every param when a comma sits inside a quoted description value', () => {
    // The comma inside "Standard, non-refundable request" must not truncate
    // the scheme, and `opaque` -- ordered AFTER the comma-bearing
    // `description` -- must still be decoded, or the HMAC re-derivation at
    // the backend fails and the credential is rejected.
    const challenge = parseChallengeHeader(CHALLENGE_HEADER_WITH_COMMA_DESCRIPTION)!
    expect(challenge).not.toBeNull()
    expect(challenge.description).toBe('Standard, non-refundable request')
    expect(challenge.opaque).toBe(OPAQUE_ENCODED)
    expect(challenge.id).toBe('CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og')
    expect(challenge.realm).toBe('api.nevermined.app')
    expect(challenge.method).toBe('nevermined')
    expect(challenge.intent).toBe('charge')
    expect(challenge.requestEncoded).toBe(REQUEST_ENCODED)
  })
})

describe('buildCredentialHeader', () => {
  it('round-trips through the wire with request and opaque intact', () => {
    const challenge = parseChallengeHeader(CHALLENGE_HEADER)!
    const header = buildCredentialHeader(challenge, { accessToken: 'BASE64_MPP_TOKEN' })

    expect(header.startsWith('Payment ')).toBe(true)
    const decoded = JSON.parse(
      Buffer.from(header.slice('Payment '.length), 'base64url').toString('utf8'),
    )
    expect(decoded.challenge.request).toBe(REQUEST_ENCODED)
    expect(decoded.challenge.opaque).toBe(OPAQUE_ENCODED)
    expect(decoded.challenge.id).toBe('CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og')
    expect(decoded.challenge.expires).toBe('2026-08-12T10:05:00.000Z')
    expect(decoded.payload).toEqual({ accessToken: 'BASE64_MPP_TOKEN' })
    expect(decoded.challenge.meta).toBeUndefined()
  })

  it('emits base64url without padding', () => {
    const challenge = parseChallengeHeader(CHALLENGE_HEADER)!
    const encoded = buildCredentialHeader(challenge, { accessToken: 'x' }).slice('Payment '.length)
    expect(encoded).not.toMatch(/[+/=]/)
  })

  it('decodes to the same fields as the mppx-modelled credential for the same inputs', () => {
    // NOTE: this does not assert byte-equality with mppx's own output -- the
    // two `Payment …` values differ (mppx orders challenge keys expires,
    // id, intent, method, realm, opaque, request; buildCredentialHeader
    // orders id, realm, method, intent, expires, ..., opaque, request), and
    // that is fine: codec.ts's own docs argue key order is irrelevant
    // because the server JSON.parses it. toEqual compares parsed objects,
    // order-insensitive, which is the right assertion for that claim. The
    // property that WOULD break settlement -- a silent re-encode of
    // request/opaque -- is pinned byte-exactly by `toBe` assertions
    // elsewhere in this file (requestEncoded/opaque above, the padding/
    // alphabet checks below), not by this test.
    const MPPX_CREDENTIAL =
      'Payment eyJjaGFsbGVuZ2UiOnsiZXhwaXJlcyI6IjIwMjYtMDgtMTJUMTA6MDU6MDAuMDAwWiIsImlkIjoiQ1Fzek9uZ2Z2VDFSSUdTYWppcFpKdmctbEJDRUR1Z1dMREY3U0RfdzFvZyIsImludGVudCI6ImNoYXJnZSIsIm1ldGhvZCI6Im5ldmVybWluZWQiLCJyZWFsbSI6ImFwaS5uZXZlcm1pbmVkLmFwcCIsIm9wYXF1ZSI6ImV5SmZiWEJ3ZUY5elkyOXdaU0k2SWxCUFUxUWdMMkZ6YXlJc0ltNXZibU5sSWpvaU1URXhNVEV4TVRFdE1qSXlNaTB6TXpNekxUUTBORFF0TlRVMU5UVTFOVFUxTlRVMUluMCIsInJlcXVlc3QiOiJleUpqY21Wa2FYUnpJam9pTWlJc0luQnNZVzVKWkNJNklqUTBOelF5TnpZek1EYzJNRFEzTkRrM05qUXdNRGd3TWpNd01qTTJOemd4TkRjME1USTVPVGN3T1RreU56STNPRGsyTlRrek9EWXhPVGszTXpRM01UTTFOakV6TVRNMU5UY3hNRGNpZlEifSwicGF5bG9hZCI6eyJhY2Nlc3NUb2tlbiI6IkJBU0U2NF9NUFBfVE9LRU4ifX0'
    const mppxDecoded = JSON.parse(
      Buffer.from(MPPX_CREDENTIAL.slice('Payment '.length), 'base64url').toString('utf8'),
    )
    const challenge = parseChallengeHeader(CHALLENGE_HEADER)!
    const ourDecoded = JSON.parse(
      Buffer.from(
        buildCredentialHeader(challenge, { accessToken: 'BASE64_MPP_TOKEN' }).slice(
          'Payment '.length,
        ),
        'base64url',
      ).toString('utf8'),
    )
    expect(ourDecoded).toStrictEqual(mppxDecoded)
  })
})

describe('parseReceiptHeader', () => {
  it('decodes the receipt', () => {
    expect(parseReceiptHeader(RECEIPT_HEADER)).toEqual({
      method: 'nevermined',
      reference: 'CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og',
      status: 'success',
      timestamp: '2026-08-12T10:00:30.000Z',
    })
  })
})

describe('extractPaymentScheme', () => {
  it('finds the Payment scheme among several', () => {
    expect(extractPaymentScheme('Bearer xyz, Payment abc')).toBe('Payment abc')
  })

  it('returns null when absent', () => {
    expect(extractPaymentScheme('Bearer xyz')).toBeNull()
  })

  it('stops at a trailing scheme when Payment is a bare credential token', () => {
    // A credential is a token68 (no internal structure), so it can never
    // legitimately contain a comma. A following ", Bearer some-app-jwt" must
    // not be folded into the extracted scheme.
    expect(extractPaymentScheme('Payment abc, Bearer xyz')).toBe('Payment abc')
  })

  it('does not corrupt the credential when Authorization carries an app JWT alongside it', () => {
    expect(extractPaymentScheme('Payment eyJhYmMifQ, Bearer some-app-jwt')).toBe(
      'Payment eyJhYmMifQ',
    )
  })

  it('does not match "Payment" mid-token', () => {
    // /Payment\s+/i used to be unanchored, so it matched inside a longer
    // token: "XPayment abc" or "NotPayment abc" were read as Payment
    // credentials.
    expect(extractPaymentScheme('XPayment abc')).toBeNull()
    expect(extractPaymentScheme('NotPayment abc')).toBeNull()
  })

  it('does not divert an unrelated Authorization value containing "payment" onto the MPP path', () => {
    // The live regression: extractCredential feeds the MPP-vs-x402 routing
    // predicate, so an x402 buyer whose Authorization happens to contain
    // "payment" followed by whitespace -- with no comma boundary in front of
    // it -- must not be read as presenting an MPP credential.
    expect(extractPaymentScheme('Bearer prepayment xyz')).toBeNull()
  })

  it('does not match "Payment" text embedded inside a different, preceding scheme\'s quoted value', () => {
    expect(
      extractPaymentScheme('Digest username="my payment plan", Payment abc'),
    ).toBe('Payment abc')
  })

  it('does not truncate a structured challenge at a comma inside a quoted value', () => {
    expect(extractPaymentScheme(CHALLENGE_HEADER_WITH_COMMA_DESCRIPTION)).toBe(
      CHALLENGE_HEADER_WITH_COMMA_DESCRIPTION,
    )
  })

  it('still stops at a genuine trailing scheme after a comma-bearing quoted value', () => {
    expect(
      extractPaymentScheme(`${CHALLENGE_HEADER_WITH_COMMA_DESCRIPTION}, Bearer some-app-jwt`),
    ).toBe(CHALLENGE_HEADER_WITH_COMMA_DESCRIPTION)
  })

  it('is not confused by the literal text "Payment " inside a quoted value', () => {
    const header =
      'Payment id="c1", realm="api.nevermined.app", method="nevermined", intent="charge", ' +
      'request="req", description="Ask about the Payment plan, then retry", opaque="op"'
    expect(extractPaymentScheme(header)).toBe(header)
    expect(extractPaymentScheme(`${header}, Bearer some-app-jwt`)).toBe(header)
  })
})

describe('escaped quoted-string values (mppx wire format)', () => {
  it('does not swallow a genuine trailing scheme when description has an odd number of literal quotes', () => {
    // '5" screen replacement plan' has one literal quote (odd count). mppx
    // serializes it as description="5\" screen replacement plan" -- a
    // quote-only (not escape-aware) scanner flips inQuotes an odd number of
    // times on the escaped quote and never recovers, swallowing everything
    // after it, including a genuinely different trailing scheme.
    const description = '5" screen replacement plan'
    const header = `Payment ${buildChallengeParams(description)}`
    const merged = `${header}, Bearer some-app-jwt`

    expect(extractPaymentScheme(merged)).toBe(header)

    const challenge = parseChallengeHeader(header)!
    expect(challenge).not.toBeNull()
    expect(challenge.description).toBe(description)
    expect(challenge.opaque).toBe(OPAQUE_ENCODED)
    expect(challenge.id).toBe('CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og')
    expect(challenge.requestEncoded).toBe(REQUEST_ENCODED)
  })

  it('decodes the full unescaped value when description has an even number of literal quotes', () => {
    const description = 'Access to the "Pro" tier'
    const header = `Payment ${buildChallengeParams(description)}`

    const challenge = parseChallengeHeader(header)!
    expect(challenge.description).toBe(description)
  })

  it('decodes a value containing a literal backslash', () => {
    const description = 'back\\slash' // actual value: back\slash (one literal backslash)
    const header = `Payment ${buildChallengeParams(description)}`

    const challenge = parseChallengeHeader(header)!
    expect(challenge.description).toBe(description)
  })

  it('keeps request and opaque verbatim (base64url, never quoted/escaped) alongside an escaped description', () => {
    const description = 'Contains "quotes" and a back\\slash, and a comma'
    const header = `Payment ${buildChallengeParams(description)}`

    const challenge = parseChallengeHeader(header)!
    expect(challenge.requestEncoded).toBe(REQUEST_ENCODED)
    expect(challenge.opaque).toBe(OPAQUE_ENCODED)
  })

  it('returns the whole remainder as a safe fallback for an unterminated quote, without hanging', () => {
    const header =
      'Payment id="CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og", realm="api.nevermined.app", ' +
      'method="nevermined", intent="charge", ' +
      `request="${REQUEST_ENCODED}", description="unterminated`
    expect(extractPaymentScheme(header)).toBe(header)
  })
})

/** Builds a `request=` param value: base64url-encoded JSON, matching real challenge wire shape. */
function encodeRequestParam(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** A structurally complete challenge header carrying a caller-chosen `request=` value. */
function buildChallengeWithRequest(requestEncoded: string): string {
  return (
    'Payment id="CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og", realm="api.nevermined.app", ' +
    'method="nevermined", intent="charge", ' +
    `request="${requestEncoded}", ` +
    'expires="2026-08-12T10:05:00.000Z", ' +
    `opaque="${OPAQUE_ENCODED}"`
  )
}

describe('parseChallengeHeader — malformed request parameter', () => {
  it('raises a typed MppError, not a raw SyntaxError, when request= is not valid base64url JSON', () => {
    // Buffer.from(x, 'base64url') never throws -- it silently drops invalid
    // characters -- so garbage reaches JSON.parse and used to escape as a
    // bare SyntaxError mentioning neither MPP nor payment.
    const header = buildChallengeWithRequest('zzz')
    expect(() => parseChallengeHeader(header)).toThrow(MppError)
    expect(() => parseChallengeHeader(header)).not.toThrow(SyntaxError)
  })

  it('rejects a request= that decodes to null', () => {
    const header = buildChallengeWithRequest(encodeRequestParam(null))
    expect(() => parseChallengeHeader(header)).toThrow(MppError)
  })

  it('rejects a request= that decodes to an array', () => {
    const header = buildChallengeWithRequest(encodeRequestParam(['a']))
    expect(() => parseChallengeHeader(header)).toThrow(MppError)
  })

  it('coerces a request= whose credits is a JSON number to a string, rather than rejecting a valid third-party seller', () => {
    // credits is not what anything spends: the amount the backend
    // re-derives comes from requestEncoded, forwarded byte-verbatim. A
    // third-party seller encoding credits as a JSON number is a perfectly
    // reasonable reading of "credits" and must not become wholly unpayable
    // over a field this SDK does not itself act on.
    const header = buildChallengeWithRequest(encodeRequestParam({ planId: '123', credits: 2 }))
    const challenge = parseChallengeHeader(header)!
    expect(challenge.request).toEqual({ planId: '123', credits: '2' })
  })

  it('rejects a request= whose agentId is not a string', () => {
    // Unlike credits, agentId IS load-bearing: the buyer helper forwards
    // challenge.request.agentId straight into the token mint
    // (options.agentId ?? challenge.request.agentId), so a malformed value
    // here reaches the spend path, not just a decorative field.
    const header = buildChallengeWithRequest(
      encodeRequestParam({ planId: '123', credits: '2', agentId: 42 }),
    )
    expect(() => parseChallengeHeader(header)).toThrow(MppError)
  })

  it('accepts a well-formed agentId and passes it through', () => {
    const header = buildChallengeWithRequest(
      encodeRequestParam({ planId: '123', credits: '2', agentId: 'agent-1' }),
    )
    const challenge = parseChallengeHeader(header)!
    expect(challenge.request).toEqual({ planId: '123', credits: '2', agentId: 'agent-1' })
  })

  it('rejects a request= with a missing planId rather than minting with planId: undefined', () => {
    const header = buildChallengeWithRequest(encodeRequestParam({ credits: '2' }))
    expect(() => parseChallengeHeader(header)).toThrow(MppError)
  })

  it('rejects a request= with a non-string planId', () => {
    const header = buildChallengeWithRequest(encodeRequestParam({ planId: 42, credits: '2' }))
    expect(() => parseChallengeHeader(header)).toThrow(MppError)
  })

  it('rejects a request= with an empty-string planId', () => {
    const header = buildChallengeWithRequest(encodeRequestParam({ planId: '', credits: '2' }))
    expect(() => parseChallengeHeader(header)).toThrow(MppError)
  })

  it('still returns null (not an error) for a header that carries no Payment scheme at all', () => {
    // Structurally absent stays null -- that is how a caller tells "not an
    // MPP endpoint" from "malformed". Only a PRESENT-but-undecodable
    // challenge raises.
    expect(parseChallengeHeader('Bearer abc')).toBeNull()
  })

  it('still parses a well-formed request= correctly (no false positives)', () => {
    const header = buildChallengeWithRequest(encodeRequestParam({ planId: '123', credits: '2' }))
    const challenge = parseChallengeHeader(header)!
    expect(challenge.request).toEqual({ planId: '123', credits: '2' })
  })
})

describe('parseReceiptHeader — malformed input', () => {
  it('raises a typed MppError, not a raw SyntaxError, on undecodable base64url JSON', () => {
    expect(() => parseReceiptHeader('zzz')).toThrow(MppError)
    expect(() => parseReceiptHeader('zzz')).not.toThrow(SyntaxError)
  })

  it('raises a typed MppError, not an untyped receipt, when the decoded value is null', () => {
    // A malformed Payment-Receipt arrives on a successful, already-paid 200.
    // Returning `null` typed as MppReceipt used to let a caller's field
    // access (receipt.status) crash later with an untyped TypeError that
    // points nowhere back at the header that caused it.
    const header = Buffer.from(JSON.stringify(null)).toString('base64url')
    expect(() => parseReceiptHeader(header)).toThrow(MppError)
  })

  it('raises a typed MppError when the decoded value is an array', () => {
    const header = Buffer.from(JSON.stringify(['a'])).toString('base64url')
    expect(() => parseReceiptHeader(header)).toThrow(MppError)
  })

  it('raises a typed MppError when a required field is missing', () => {
    const header = Buffer.from(JSON.stringify({ method: 'nevermined' })).toString('base64url')
    expect(() => parseReceiptHeader(header)).toThrow(MppError)
  })

  it('raises a typed MppError when a required field has the wrong type', () => {
    const header = Buffer.from(
      JSON.stringify({ method: 'nevermined', reference: 'c1', status: 'success', timestamp: 42 }),
    ).toString('base64url')
    expect(() => parseReceiptHeader(header)).toThrow(MppError)
  })

  it('still decodes a well-formed receipt (no false positives)', () => {
    expect(parseReceiptHeader(RECEIPT_HEADER)).toEqual({
      method: 'nevermined',
      reference: 'CQszOngfvT1RIGSajipZJvg-lBCEDugWLDF7SD_w1og',
      status: 'success',
      timestamp: '2026-08-12T10:00:30.000Z',
    })
  })
})
