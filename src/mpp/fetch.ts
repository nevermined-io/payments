/**
 * The buyer half of MPP: pay a challenged endpoint with an existing Nevermined
 * delegation.
 *
 * The buyer learns nothing about MPP beyond calling this instead of `fetch`.
 * The plan comes out of the challenge, the credential is built from the
 * challenge plus an MPP-domain access token, and the request is retried once.
 *
 * Two error families are used deliberately:
 * - {@link PaymentsError} (`code: 'validation'`) for guards this call refuses
 *   to even attempt — a bad argument, a challenge that violates a
 *   caller-supplied constraint (`planId`, `maxCredits`), or a body that
 *   cannot be replayed. None of these mean a payment failed; nothing was ever
 *   attempted.
 * - {@link MppError} (and its typed subclasses) for what the wire actually
 *   said: a rejected credential, a malformed challenge, an MPP-disabled
 *   environment. A caller branching on `instanceof MppError` to mean
 *   "the payment failed" gets exactly that, and no more.
 */

import { PaymentsError } from '../common/payments.error.js'
import type { DelegationConfig, X402TokenOptions } from '../common/types.js'
import { buildCredentialHeader, parseChallengeHeader, parseReceiptHeader } from './codec.js'
import { MppError, toMppError } from './errors.js'
import type { MppChallenge, MppReceipt } from './types.js'

/**
 * Options for {@link mppFetch} / `MppAPI.fetch`.
 *
 * The request's `init.body`, if any, must be replayable **if the endpoint may
 * challenge the request**: a `ReadableStream` body throws a typed
 * {@link PaymentsError} once a 402 challenge actually requires a retry, since
 * the stream cannot be resent. A request that is never challenged sends a
 * stream body exactly once, exactly like plain `fetch`.
 *
 * This helper mints `nvm:erc4337` access tokens only in this release — a
 * buyer holding an `nvm:card-delegation` delegation cannot use it yet.
 */
export interface MppFetchOptions {
  /** The delegation that backs the payment — the same one x402 uses. */
  delegationConfig: DelegationConfig
  /**
   * Overrides the agent id the seller's challenge names — the minted token is
   * addressed to this agent id instead of whatever the challenge carries.
   * Unlike `planId`, this is not a guard: a mismatch is not checked or
   * refused, it simply replaces what the seller asked for. Leave unset to
   * honor the challenge as issued.
   */
  agentId?: string
  /** Fail before minting if the challenge names a different plan than this. */
  planId?: string
  /**
   * Fail before minting if the challenge asks for more credits than this. A
   * seller unilaterally names the price in the challenge; without a cap this
   * helper mints against whatever it asks, on every re-challenge turn too.
   */
  maxCredits?: string | number | bigint
}

export interface MppFetchResult {
  /** The final response — the paid one when a payment happened. */
  response: Response
  /**
   * The decoded `Payment-Receipt`, when the server returned one and it
   * decoded cleanly. A malformed receipt never throws — it leaves this
   * absent (with a console warning) rather than destroying a response the
   * caller already paid for.
   */
  receipt?: MppReceipt
  /**
   * Whether the settlement succeeded, derived from the receipt — the only
   * settlement evidence on the wire — not from the HTTP status. `settled`
   * implies `receipt` is present; the reverse is not required.
   */
  settled: boolean
  /**
   * How many credentials were minted and presented to the endpoint during
   * this call (0, 1 or 2). This is NOT the same as `settled`:
   * `credentialsPresented > 0` with `settled: false` means the seller may
   * already have burned credits for a credential whose fate is unknown to
   * the caller — treat that as "do not blindly retry", not as "nothing
   * happened".
   */
  credentialsPresented: number
  /**
   * Credits named by the last challenge a credential was minted and
   * presented for, as a decimal string. Present whenever
   * `credentialsPresented > 0`, so a caller can account for what may have
   * been spent even when `settled` is false.
   */
  creditsPresented?: string
  /**
   * Whether a credential was presented AND the final response looks
   * successful: `response.ok && settled`. A 2xx with no receipt (a
   * settlement that silently failed) and a non-2xx with a receipt (settle-
   * then-error) are both `paid: false` — check `settled` and
   * `credentialsPresented` for the honest picture in either case.
   */
  paid: boolean
}

/** Mints an MPP access token for a plan. Supplied by `MppAPI`. */
export type MppTokenMinter = (
  planId: string,
  agentId?: string,
  tokenOptions?: X402TokenOptions,
) => Promise<{ accessToken: string }>

/**
 * Whether `body` is a `ReadableStream`.
 *
 * A stream is single-read: once a `fetch()` starts consuming it, the stream
 * is locked/disturbed, and a *second* `fetch()` with the same `init.body`
 * throws an opaque runtime `TypeError` rather than a typed error. Every other
 * `BodyInit` — `string`, `Buffer`/`ArrayBuffer`/typed arrays,
 * `URLSearchParams`, `FormData`, `Blob`, or no body at all — can be read more
 * than once, so a retry is safe.
 */
function isNonReplayableBody(body: BodyInit | null | undefined): boolean {
  return typeof ReadableStream !== 'undefined' && body instanceof ReadableStream
}

/** The origin of `input`, or the raw value when it does not parse as a URL — used only to label a remote error. */
function originOf(input: string | URL): string {
  try {
    return new URL(String(input)).origin
  } catch {
    return String(input)
  }
}

/**
 * Parses a challenge header, swallowing any decode failure into `null`.
 *
 * Used only to peek at a re-challenge's freshness inside the retry gate — a
 * garbled re-challenge is simply "not a fresh challenge", which the gate
 * already treats as terminal. The FIRST challenge of a 402 is never parsed
 * this leniently: see the `try`/`catch` around {@link parseChallengeHeader}
 * in {@link mppFetch}, which throws a typed error instead, since minting
 * against a challenge this function could not even parse would be worse.
 */
function tryParseChallenge(headerValue: string): MppChallenge | null {
  try {
    return parseChallengeHeader(headerValue)
  } catch {
    return null
  }
}

/**
 * Validates the decoded challenge request shape before it is ever minted
 * against. `parseChallengeHeader` decodes seller-supplied base64url JSON with
 * no shape guarantees at the type level — a malformed or malicious challenge
 * must be refused with a typed error, not surface as a raw `TypeError` off
 * `challenge.request.planId` or a confusing downstream backend 4xx.
 */
function assertValidChallengeRequest(challenge: MppChallenge, input: string | URL): void {
  const request: any = challenge.request
  const planId = request?.planId
  if (typeof planId !== 'string' || !planId) {
    throw new MppError(`The MPP challenge from ${originOf(input)} names no planId; refusing to mint.`)
  }
  const credits = request?.credits
  if (typeof credits !== 'string' || !/^\d+$/.test(credits)) {
    throw new MppError(
      `The MPP challenge from ${originOf(input)} names a non-decimal-string credits value ` +
        `(${JSON.stringify(credits)}); refusing to mint.`,
    )
  }
}

/**
 * Reads the error body of a challenged retry.
 *
 * A retry that comes back 402 is either "your credential was refused"
 * (terminal) or "here is a fresh challenge" (retryable once). An unreadable
 * or non-JSON body — an HTML WAF/CDN page, a truncated response, a
 * disturbed-body clone failure — is neither: it is treated as terminal by
 * the caller, since it is not evidence of anything retryable.
 */
async function readMppErrorCode(
  response: Response,
): Promise<{ code?: string; message: string; bodyUnreadable?: boolean }> {
  let raw: string
  try {
    raw = await response.clone().text()
  } catch (err) {
    return {
      message: `MPP 402 body could not be read: ${err instanceof Error ? err.message : String(err)}`,
      bodyUnreadable: true,
    }
  }
  try {
    const body = JSON.parse(raw)
    // A non-compliant seller can send a body shaped `{ error: { reason: '...' } }`
    // — no `message`, and `error` itself an object rather than a string.
    // Coerced to a string here, once, so every caller of this function (in
    // particular the terminal-throw's `message.slice(0, 200)`) can treat
    // `message` as always a string instead of risking a raw TypeError.
    const rawMessage = body?.message ?? body?.error
    const message = typeof rawMessage === 'string' ? rawMessage : 'MPP request failed'
    return { code: body?.code, message }
  } catch {
    return {
      message: `MPP 402 was not JSON (likely a proxy or WAF page): ${raw.slice(0, 200)}`,
      bodyUnreadable: true,
    }
  }
}

/**
 * Performs the request, paying an MPP challenge if one comes back.
 *
 * At most one re-challenge cycle is followed: a seller that keeps challenging
 * a freshly paid credential is not going to be satisfied by looping, and a
 * loop would burn a credential per turn.
 *
 * The default on a retry-turn 402 is to STOP, not to pay again: a genuinely
 * fresh challenge (a different `id` from the one just presented) or an
 * explicit `BCK.MPP.0004` (expired) code is retryable; a coded rejection, an
 * unreadable body, or the seller replaying the identical challenge id are all
 * terminal. A credential already proven invalid is never paid for twice.
 */
export async function mppFetch(
  mintToken: MppTokenMinter,
  input: string | URL,
  init: RequestInit | undefined,
  options: MppFetchOptions,
): Promise<MppFetchResult> {
  const maxChallenges = 2
  let response = await fetch(input, init)
  let credentialsPresented = 0
  let creditsPresented: string | undefined

  for (let attempt = 0; attempt < maxChallenges; attempt++) {
    if (response.status !== 402) break

    const challengeHeader = response.headers.get('www-authenticate')
    if (!challengeHeader) break

    let challenge: MppChallenge | null
    try {
      challenge = parseChallengeHeader(challengeHeader)
    } catch (err) {
      throw new MppError(
        `The 402 from ${originOf(input)} carried a malformed MPP challenge ` +
          `(${err instanceof Error ? err.message : String(err)}). No payment was attempted.`,
      )
    }
    if (!challenge) break
    assertValidChallengeRequest(challenge, input)

    const planId = challenge.request.planId
    if (options.planId && options.planId !== planId) {
      throw PaymentsError.validation(
        `MPP challenge names plan ${planId}, but plan ${options.planId} was pinned by the caller`,
      )
    }

    if (
      options.maxCredits !== undefined &&
      BigInt(challenge.request.credits) > BigInt(options.maxCredits)
    ) {
      throw PaymentsError.validation(
        `MPP challenge asks for ${challenge.request.credits} credits, above the caller's cap of ` +
          `${options.maxCredits}`,
      )
    }

    // A retry resends init.body verbatim. A ReadableStream is single-read —
    // the first fetch() above already consumed it once — so replaying it now
    // would throw an opaque runtime TypeError. Checked here, at the point a
    // retry is actually about to happen, not before the (harmless) first
    // attempt: whether this endpoint ever challenges is not known ahead of
    // time, and a stream body against a non-challenging endpoint is fine.
    if (isNonReplayableBody(init?.body)) {
      throw PaymentsError.validation(
        'payments.mpp.fetch cannot retry a ReadableStream request body: streams are single-read, ' +
          'so the 402 challenge from this endpoint cannot be replayed. Pass a replayable body ' +
          'instead — a string, Buffer/ArrayBuffer/typed array, URLSearchParams, FormData or Blob.',
      )
    }

    const { accessToken } = await mintToken(planId, options.agentId ?? challenge.request.agentId, {
      delegationConfig: options.delegationConfig,
    })

    const headers = new Headers(init?.headers ?? {})
    const existingAuth = headers.get('authorization')
    const credential = buildCredentialHeader(challenge, { accessToken })
    // Append, not replace: a caller authenticating to the resource server
    // with its own Authorization (the normal shape for a metered API) must
    // not have that credential stripped on the request that costs money.
    // Our own seller's extractPaymentScheme was hardened for exactly this
    // multi-scheme shape.
    headers.set('authorization', existingAuth ? `${credential}, ${existingAuth}` : credential)

    response = await fetch(input, { ...init, headers })
    credentialsPresented += 1
    creditsPresented = challenge.request.credits

    if (response.status === 402) {
      const { code, message, bodyUnreadable } = await readMppErrorCode(response)

      let isFreshChallenge = false
      if (code === undefined && !bodyUnreadable) {
        const nextChallengeHeader = response.headers.get('www-authenticate')
        const nextChallenge = nextChallengeHeader ? tryParseChallenge(nextChallengeHeader) : null
        isFreshChallenge = !!nextChallenge && nextChallenge.id !== challenge.id
      }

      const isRetryable = code === 'BCK.MPP.0004' || isFreshChallenge
      if (!isRetryable) {
        throw toMppError(code, `${originOf(input)} rejected the credential: ${message.slice(0, 200)}`)
      }
      // Otherwise the seller genuinely re-challenged (typically an expired
      // challenge); the loop takes one more turn and mints a NEW credential
      // against the fresh challenge — the old one is not re-presented.
      continue
    }

    const receiptHeader = response.headers.get('payment-receipt')
    let receipt: MppReceipt | undefined
    if (receiptHeader) {
      try {
        receipt = parseReceiptHeader(receiptHeader)
      } catch (err) {
        // The receipt is decorative ("unsigned by design, and carries no
        // balance" — see MppReceipt) and receipt? is optional precisely so
        // it can be absent. A failed decode must not destroy the response
        // the caller already paid for.
        console.warn(
          '[payments.mpp.fetch] payment may have succeeded but the Payment-Receipt could not be ' +
            `decoded: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    return {
      response,
      settled: receipt !== undefined,
      paid: response.ok && receipt !== undefined,
      credentialsPresented,
      ...(creditsPresented !== undefined && { creditsPresented }),
      ...(receipt && { receipt }),
    }
  }

  return {
    response,
    settled: false,
    paid: false,
    credentialsPresented,
    ...(creditsPresented !== undefined && { creditsPresented }),
  }
}
