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
})
