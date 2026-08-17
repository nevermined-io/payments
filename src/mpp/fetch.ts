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
import { MppError, MppSpendOutcomeUnknownError, isRetryableMppCode, toMppError } from './errors.js'
import type { MppSpendReport } from './errors.js'
import type { MppChallenge, MppReceipt } from './types.js'

/**
 * Options for {@link mppFetch} / `MppAPI.fetch`.
 *
 * @experimental The MPP buyer surface may change in a minor release.
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
   * Budget for the WHOLE call, not for one challenge: the helper refuses to
   * mint whenever the credits named so far plus the credits this challenge
   * asks for would exceed it. A seller unilaterally names the price, and a
   * re-challenge names it again — a per-turn cap would therefore bound each
   * turn at `maxCredits` and the call at twice it, which is not what "cap"
   * reads as. `creditsPresented` on the result is the same running total, so
   * the two always speak about the same number.
   *
   * Must be a non-negative integer (a decimal string, a safe integer, or a
   * `bigint`); anything else is refused with a {@link PaymentsError} at entry,
   * before the first request, rather than mid-flight on the first 402.
   */
  maxCredits?: string | number | bigint
}

/**
 * What {@link mppFetch} / `MppAPI.fetch` resolves to.
 *
 * @experimental Fields may be added or change meaning in a minor release —
 * `settled` and `creditsPresented` both did during review.
 */
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
   * Whether the endpoint returned settlement evidence: a `Payment-Receipt` that
   * decoded cleanly and does not state failure outright. Never derived from the
   * HTTP status.
   *
   * `receipt.status` is read asymmetrically, on purpose. Success is NOT
   * recognized — `'success'` is the only value with agreement behind it, so
   * treating an unrecognized `'ok'`/`'completed'` as failure would report an
   * unpaid call that was in fact paid. An explicit negative (`'failed'`,
   * `'failure'`, `'declined'`, `'error'`) is a different thing from an unknown
   * vocabulary, and is excluded: `paid: true` on a receipt that says the
   * settlement failed is wrong in the one direction this field must never be
   * wrong. Anything else stays `settled: true` with `receipt` on the result, so
   * a caller paying third parties can judge the value itself.
   *
   * This SDK's own seller attaches a receipt only when settlement succeeded, so
   * the distinction is third-party exposure rather than in-ecosystem.
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
   * TOTAL credits named by every challenge a credential was minted against
   * during this call, as a decimal string — summed, not the last turn's
   * amount, since a re-challenge is free to name a different price and the
   * caller is accounting for the call. Present whenever
   * `credentialsPresented > 0`.
   *
   * It is an **upper bound** on what may have burned, never a lower one. A
   * seller that answers a retryable code while replaying the identical
   * challenge id gets a second credential minted against that same challenge
   * (a code decides alone — see {@link mppFetch}), and against a seller that
   * keys single-use on the challenge id, as this SDK's middleware does, that
   * second credential is refused as a replay and burns nothing. The count is
   * deliberately not lowered for it: this field answers "what could have left",
   * and guessing which of a remote's credentials it honoured would answer a
   * question the buyer cannot see.
   */
  creditsPresented?: string
  /**
   * Whether a credential was presented AND the final response looks
   * successful: `response.ok && settled`. A 2xx with no receipt (a
   * settlement that silently failed) and a non-2xx with a receipt (settle-
   * then-error) are both `paid: false` — check `settled` and
   * `credentialsPresented` for the honest picture in either case.
   *
   * `ok: true, paid: false, credentialsPresented: 1` is a ROUTINE outcome, not
   * an exotic one: a seller whose handler streams or flushes has already sent
   * its headers when settlement runs, so `Payment-Receipt` cannot be attached
   * to a response that is already on the wire (this SDK's own middleware says
   * so where it settles detached). The credits were burned. Never read this
   * combination as "the payment did not happen" and retry.
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

/**
 * Cap on how much of a 402's error body is buffered before parsing it.
 *
 * The body is seller-controlled and read purely to look for a `code`, so a
 * hostile or broken endpoint answering a 402 with an unbounded stream must not
 * be able to exhaust the buyer's memory.
 *
 * A truncated read of a body large enough to matter will usually not parse; if
 * it does, the prefix necessarily contains the complete `code` object — a
 * truncated prefix of one JSON object can only parse once its closing brace is
 * inside the cap — so the classification is unchanged either way. The branch
 * keys on `JSON.parse` succeeding, never on "truncated implies unparseable",
 * which is false: `<complete JSON><whitespace><garbage>` parses after
 * truncation and throws before it.
 */
const MAX_ERROR_BODY_BYTES = 64 * 1024

/**
 * Receipt `status` values that state failure outright, lower-cased.
 *
 * `MppReceipt.status` is a seller-set string and this SDK deliberately does not
 * try to recognize *success*: `'success'` is the only value with any agreement
 * behind it, so treating an unrecognized `'ok'`/`'completed'` as failure would
 * report an unpaid call that was in fact paid. The asymmetry is the point — an
 * explicit negative is not an unknown vocabulary, and reporting `paid: true`
 * for a receipt that says the settlement failed is wrong in the one direction
 * this field must never be wrong.
 *
 * Only unambiguous negatives belong here; anything genuinely ambiguous stays
 * unrecognized and is reported as settled, with `receipt` on the result for a
 * caller that wants to judge for itself.
 */
const EXPLICIT_FAILURE_RECEIPT_STATUSES: ReadonlySet<string> = new Set([
  'failed',
  'failure',
  'declined',
  'error',
])

/** Whether a decoded receipt states outright that the settlement did not happen. */
function statesFailure(receipt: MppReceipt | undefined): boolean {
  return (
    receipt !== undefined &&
    typeof receipt.status === 'string' &&
    EXPLICIT_FAILURE_RECEIPT_STATUSES.has(receipt.status.trim().toLowerCase())
  )
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
 * Refuses a challenge whose `credits` is not a decimal string before it is
 * ever minted against.
 *
 * `parseChallengeHeader` guarantees `credits` is a string OR a number and
 * coerces the number (`isValidChallengeRequestShape` / `toChallengeRequest` in
 * `codec.ts`), so what survives to here and still needs refusing is a string
 * that is not a non-negative integer — `'2.5'`, `'-1'`, `'1e3'`, `'abc'`. Each
 * of those would otherwise reach `BigInt()` in the cap comparison as a raw
 * `SyntaxError`, or the mint as a price nothing can account for.
 *
 * `planId` is NOT re-checked here: the codec already rejects a non-string or
 * empty `planId` outright, so a second guard for it was unreachable code that
 * read as coverage.
 */
function assertValidChallengeRequest(challenge: MppChallenge, input: string | URL): void {
  const credits: unknown = challenge.request?.credits
  if (typeof credits !== 'string' || !/^\d+$/.test(credits)) {
    throw new MppError(
      `The MPP challenge from ${originOf(input)} names a non-decimal-string credits value ` +
        `(${JSON.stringify(credits)}); refusing to mint.`,
    )
  }
}

/**
 * Validates `options.maxCredits` at entry and normalizes it to a `bigint`.
 *
 * At entry, not at the comparison: `maxCredits` is a caller argument, and a
 * caller mistake must surface before the first request rather than mid-flight
 * on whatever 402 happens to arrive — and as a {@link PaymentsError}, which is
 * what this module documents for bad arguments, rather than the raw
 * `SyntaxError`/`RangeError` that `BigInt('abc')` or `BigInt(1.5)` throws.
 */
function parseMaxCredits(value: string | number | bigint | undefined): bigint | undefined {
  if (value === undefined) return undefined
  const refuse = () =>
    PaymentsError.validation(
      `maxCredits must be a non-negative integer (decimal string, safe integer or bigint), ` +
        `got ${JSON.stringify(typeof value === 'bigint' ? String(value) : value)}`,
    )
  if (typeof value === 'bigint') {
    if (value < 0n) throw refuse()
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw refuse()
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim())
  throw refuse()
}

/**
 * Reads at most {@link MAX_ERROR_BODY_BYTES} of a response body as text.
 *
 * Streams the clone and stops at the cap instead of `text()`-ing it, so an
 * endpoint answering a 402 with an endless body cannot be used to exhaust the
 * buyer. A runtime whose `Response` exposes no readable `body` (or a test
 * double) falls back to `text()` with the same cap applied afterwards — the
 * bound is then advisory, which is why the streaming path is preferred.
 */
async function readBoundedText(response: Response): Promise<string> {
  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    return (await response.text()).slice(0, MAX_ERROR_BODY_BYTES)
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      // Truncate the chunk that crosses the cap rather than retaining it whole:
      // the transport chooses the chunk size, so "stop after the chunk that
      // crossed" would let one huge chunk defeat the bound entirely.
      const room = MAX_ERROR_BODY_BYTES - size
      if (value.byteLength >= room) {
        chunks.push(value.subarray(0, room))
        size = MAX_ERROR_BODY_BYTES
        break
      }
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    // NOT awaited, deliberately: this reader is one branch of the tee that
    // `clone()` creates, and awaiting its cancel deadlocks while the sibling
    // branch (the response the caller still holds) is unread — verified, it
    // hangs rather than resolving. Signalling the cancel is enough.
    reader.cancel().catch(() => undefined)
  }
  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

/**
 * Reads the error body of a challenged retry.
 *
 * A retry that comes back 402 is either "your credential was refused"
 * (terminal) or "here is a fresh challenge" (retryable once). An unreadable
 * or non-JSON body — an HTML WAF/CDN page, a truncated response, a
 * disturbed-body clone failure — is neither: it is treated as terminal by
 * the caller, since it is not evidence of anything retryable.
 *
 * A body that is EMPTY or whitespace-only is not in that class. It is an
 * ordinary HTTP shape — the one the opening 402 is free to use — and carries no
 * code, so it is reported as "no code" rather than as unreadable. Reported as
 * unreadable it would suppress the documented fresh-challenge retry against a
 * seller that did nothing wrong, and blame a WAF that is not there. Truncated
 * bodies are non-empty by construction, so this cannot loosen that path.
 */
async function readMppErrorCode(
  response: Response,
): Promise<{ code?: string; message: string; bodyUnreadable?: boolean }> {
  let raw: string
  try {
    raw = await readBoundedText(response.clone())
  } catch (err) {
    return {
      message: `MPP 402 body could not be read: ${err instanceof Error ? err.message : String(err)}`,
      bodyUnreadable: true,
    }
  }
  if (raw.trim() === '') return { message: 'MPP 402 carried no body' }
  try {
    const body = JSON.parse(raw)
    // A non-compliant seller can send a body shaped `{ error: { reason: '...' } }`
    // — no `message`, and `error` itself an object rather than a string.
    // Coerced to a string here, once, so every caller of this function (in
    // particular the terminal-throw's `message.slice(0, 200)`) can treat
    // `message` as always a string instead of risking a raw TypeError.
    const rawMessage = body?.message ?? body?.error
    const message = typeof rawMessage === 'string' ? rawMessage : 'MPP request failed'
    // `code` is only a code when it is a non-empty string. `{"code": null}` is
    // a routine way to serialize "no code", and taking it literally would both
    // store a `null` in a field typed `code?: string` and skip the
    // fresh-challenge fallback — which is gated on `code === undefined` — so a
    // legitimate re-challenge from such a seller would read as terminal.
    const code = typeof body?.code === 'string' && body.code !== '' ? body.code : undefined
    return { code, message }
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
 * The default on a retry-turn 402 is to STOP, not to pay again. **A code, when
 * present, decides alone**: one {@link isRetryableMppCode} accepts
 * (`BCK.MPP.0004` expired, `BCK.MPP.0005` body-digest mismatch) is retried,
 * every other code is terminal — including a non-`BCK.MPP.*` one, e.g. the
 * `network_error`/`http_500`-shaped code `MppAPI.post` can synthesize and this
 * repo's own seller forwards. The challenge id is not consulted on that path,
 * so a retryable code replaying the identical id does re-mint; `maxCredits`,
 * not id-freshness, is what bounds what that can cost.
 *
 * **With no code**, freshness is the whole signal: a challenge whose `id`
 * differs from the one just presented is a real re-challenge and is retried
 * once, while the identical id replayed, an unparseable challenge or an
 * unreadable body are terminal — a credential already proven invalid is never
 * paid for twice.
 *
 * ### What throws and what comes back as a 402
 *
 * Only a rejection the remote NAMED throws. Three dead ends RETURN the 402
 * instead, because the response is evidence the caller may need and throwing
 * would discard it:
 *
 * 1. A 402 with no USABLE `Payment` challenge (either turn): no
 *    `WWW-Authenticate`, another scheme, or a `Payment` challenge missing a
 *    required param — {@link parseChallengeHeader} yields nothing for all
 *    three, so a seller that announced `Payment` and then sent it malformed
 *    lands here too, not only one that does not speak MPP.
 *    `credentialsPresented: 0`.
 * 2. A retry-turn 402 that IS retryable but carries no challenge to retry
 *    against, so the next turn finds nothing to mint for.
 * 3. The one re-challenge cycle spent: two credentials presented and the
 *    seller still answering 402.
 *
 * In cases 2 and 3 a credential WAS presented and may have been burned, so the
 * result is `paid: false` with a non-zero `credentialsPresented` and the last
 * 402 as `response`. Checking `response.ok` is therefore not optional — a
 * resolved promise does not mean the request was paid for.
 *
 * Every throw raised after a credential was presented carries the same
 * accounting as {@link MppSpendReport}, readable with `mppSpendOf(error)`,
 * including a transport failure on the credential-bearing retry (wrapped as
 * {@link MppSpendOutcomeUnknownError} so `instanceof MppError` catches it).
 */
export async function mppFetch(
  mintToken: MppTokenMinter,
  input: string | URL,
  init: RequestInit | undefined,
  options: MppFetchOptions,
): Promise<MppFetchResult> {
  const maxCredits = parseMaxCredits(options.maxCredits)
  const maxChallenges = 2
  let response = await fetch(input, init)
  let credentialsPresented = 0
  let creditsPresentedTotal = 0n
  let lastChallengeId: string | undefined

  /** The accounting as it stands right now — reported identically on the return and the throw paths. */
  const spend = (): MppSpendReport => ({
    credentialsPresented,
    ...(credentialsPresented > 0 && { creditsPresented: creditsPresentedTotal.toString() }),
    ...(lastChallengeId !== undefined && { challengeId: lastChallengeId }),
  })

  for (let attempt = 0; attempt < maxChallenges; attempt++) {
    if (response.status !== 402) break

    const challengeHeader = response.headers.get('www-authenticate')
    if (!challengeHeader) break

    // Everything from here to the end of the turn can throw AFTER a credential
    // has been presented on an earlier turn — and, past the mint, after one has
    // been presented on this one. A single boundary attaches the accounting to
    // whatever comes out, so no exit from this function is silent about money.
    try {
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

      // The cap bounds the CALL: what this challenge asks for is added to what
      // earlier turns already committed. Bounding each turn separately would
      // let a seller collect `maxCredits` twice by re-challenging once.
      const credits = BigInt(challenge.request.credits)
      if (maxCredits !== undefined && creditsPresentedTotal + credits > maxCredits) {
        throw PaymentsError.validation(
          `MPP challenge asks for ${challenge.request.credits} credits, which would take this call to ` +
            `${creditsPresentedTotal + credits}, above the caller's cap of ${maxCredits}` +
            (credentialsPresented > 0
              ? ` (${creditsPresentedTotal} already presented on ${credentialsPresented} credential(s))`
              : ''),
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

      const { accessToken } = await mintToken(
        planId,
        options.agentId ?? challenge.request.agentId,
        { delegationConfig: options.delegationConfig },
      )

      const headers = new Headers(init?.headers ?? {})
      const existingAuth = headers.get('authorization')
      const credential = buildCredentialHeader(challenge, { accessToken })
      // Append, not replace: a caller authenticating to the resource server
      // with its own Authorization (the normal shape for a metered API) must
      // not have that credential stripped on the request that costs money.
      // Our own seller's extractPaymentScheme was hardened for exactly this
      // multi-scheme shape.
      headers.set('authorization', existingAuth ? `${credential}, ${existingAuth}` : credential)

      // Counted BEFORE the request, not after: the credential is on the wire as
      // soon as fetch() is called, so a rejection here (disconnect, DNS, the
      // caller's AbortSignal) must not report zero credentials presented. The
      // seller may already have verified and burned it.
      credentialsPresented += 1
      creditsPresentedTotal += credits
      lastChallengeId = challenge.id
      response = await fetch(input, { ...init, headers })

      if (response.status === 402) {
        const { code, message, bodyUnreadable } = await readMppErrorCode(response)

        let isFreshChallenge = false
        if (code === undefined && !bodyUnreadable) {
          const nextChallengeHeader = response.headers.get('www-authenticate')
          const nextChallenge = nextChallengeHeader ? tryParseChallenge(nextChallengeHeader) : null
          isFreshChallenge = !!nextChallenge && nextChallenge.id !== challenge.id
        }

        if (!isRetryableMppCode(code) && !isFreshChallenge) {
          throw toMppError(
            code,
            `${originOf(input)} rejected the credential: ${message.slice(0, 200)}`,
          )
        }
        // Otherwise the seller genuinely re-challenged (expired, a digest
        // mismatch, or — for a seller that sends no code, including THIS repo's
        // middleware when verification fails for infrastructure reasons — a
        // fresh id); the loop takes one more turn and mints a NEW credential
        // against the fresh challenge — the old one is not re-presented.
        continue
      }
    } catch (err) {
      throw asSpendAwareError(err, spend(), input)
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

    const settled = receipt !== undefined && !statesFailure(receipt)
    return {
      response,
      settled,
      paid: response.ok && settled,
      credentialsPresented,
      ...(credentialsPresented > 0 && { creditsPresented: creditsPresentedTotal.toString() }),
      ...(receipt && { receipt }),
    }
  }

  // Every dead end documented on this function lands here: no challenge to pay,
  // a retryable 402 with no challenge to retry against, or the re-challenge
  // budget spent. `spend()` is what tells those apart — the last two carry a
  // non-zero `credentialsPresented`.
  return {
    response,
    settled: false,
    paid: false,
    credentialsPresented,
    ...(credentialsPresented > 0 && { creditsPresented: creditsPresentedTotal.toString() }),
  }
}

/**
 * Attaches spend accounting to whatever is escaping, and wraps a raw
 * transport failure that happened with a credential already on the wire.
 *
 * **Nothing is attached when nothing was presented.** `{ credentialsPresented: 0 }`
 * is a truthy object, so annotating a first-turn argument failure would send a
 * caller following the documented `if (mppSpendOf(err))` pattern into the
 * "credits may already be burned, do not retry" branch on a plain validation
 * error — making the field useless for the one decision it exists to inform.
 *
 * With that, three cases:
 * - An {@link MppError} (or the {@link PaymentsError} a caller-constraint guard
 *   throws on the re-challenge turn) is annotated and rethrown AS-IS: the type
 *   a caller branches on must not change just because money is now reported.
 * - Anything else with a credential already presented becomes an
 *   {@link MppSpendOutcomeUnknownError}, so it reaches the `instanceof MppError`
 *   handler this module documents instead of escaping as a raw `TypeError`.
 * - Anything else with nothing presented is rethrown untouched — nothing was
 *   spent, and dressing up a plain network fault would only obscure it.
 */
function asSpendAwareError(err: unknown, spend: MppSpendReport, input: string | URL): unknown {
  if (spend.credentialsPresented === 0) return err
  if (err instanceof MppError || err instanceof PaymentsError) {
    try {
      const annotated = err as { spend?: MppSpendReport }
      annotated.spend = spend
      return err
    } catch {
      // A frozen or otherwise non-extensible error cannot carry the report, and
      // silently returning it would recreate exactly the invisible-spend failure
      // this boundary exists to close. Fall through to the wrapper below, which
      // holds the report in its own field.
    }
  }
  const detail = err instanceof Error ? err.message : String(err)
  return new MppSpendOutcomeUnknownError(
    err instanceof MppError || err instanceof PaymentsError
      ? `The MPP credential was sent to ${originOf(input)} and the call then failed with an error that ` +
          `could not carry its own spend report (${detail}), so ${spend.creditsPresented} credits may or ` +
          'may not have been burned. Do not blindly retry.'
      : `The MPP credential was sent to ${originOf(input)} but the request failed before any response ` +
          `was read (${detail}), so ${spend.creditsPresented} credits may or may not have been burned. ` +
          'Do not blindly retry.',
    err,
    spend,
  )
}
