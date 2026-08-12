/**
 * Wire-format tests for the MPP codec.
 *
 * The fixtures below were generated from real `mppx@0.6.31` output. They are
 * the contract: the challenge id is an HMAC over `canonicalize(request)` and
 * `opaque`, so those two base64url strings must survive a parse/rebuild cycle
 * byte-for-byte or the backend rejects the credential.
 */
import {
  parseChallengeHeader,
  buildCredentialHeader,
  parseReceiptHeader,
  extractPaymentScheme,
} from '../../../src/mpp/codec.js'

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

  it('matches what mppx itself produced for the same inputs', () => {
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
    expect(ourDecoded).toEqual(mppxDecoded)
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
