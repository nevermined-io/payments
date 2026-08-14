/**
 * Typed errors for the MPP surface.
 *
 * The backend deliberately collapses every rejection reason into one code so
 * the endpoint cannot be used as a forgery oracle. The SDK mirrors that: it
 * does not try to reconstruct why a credential was refused.
 */

export class MppError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'MppError'
  }
}

/** `BCK.MPP.0002` — the deployment has no MPP secret, so MPP routes are off. */
export class MppNotConfiguredError extends MppError {
  constructor(message = 'MPP is not configured on this environment') {
    super(message, 'BCK.MPP.0002')
    this.name = 'MppNotConfiguredError'
  }
}

/** `BCK.MPP.0003` — the credential was refused (replay, forgery, plan, balance). */
export class MppCredentialRejectedError extends MppError {
  constructor(message = 'MPP credential rejected') {
    super(message, 'BCK.MPP.0003')
    this.name = 'MppCredentialRejectedError'
  }
}

/** `BCK.MPP.0004` — the challenge expired. Fetch a fresh one; do not retry blindly. */
export class MppChallengeExpiredError extends MppError {
  constructor(message = 'MPP challenge expired') {
    super(message, 'BCK.MPP.0004')
    this.name = 'MppChallengeExpiredError'
  }
}

/** `BCK.MPP.0005` — the body sent does not match the digest sealed in the challenge. */
export class MppBodyDigestMismatchError extends MppError {
  constructor(message = 'MPP body digest mismatch') {
    super(message, 'BCK.MPP.0005')
    this.name = 'MppBodyDigestMismatchError'
  }
}

/**
 * Stable `code` on {@link MppSettlementOutcomeUnknownError}. Not a backend
 * code — no `BCK.MPP.*` prefix, so it can never collide with one.
 */
export const MPP_SETTLEMENT_OUTCOME_UNKNOWN_CODE = 'settlement_outcome_unknown'

/**
 * Raised when settlement's outcome cannot be determined: `settleCredential`'s
 * own outbound deadline firing before any response, or a 2xx whose body could
 * not be read. Settlement is the one MPP call that burns, so in both cases the
 * burn may have already happened even though the caller received nothing
 * usable. Collapsing that into the same `network_error` `MppError` used for
 * "nothing happened" failures (connection refused, DNS failure, a hung
 * challenge/verify call) would let a real burn get logged and treated exactly
 * like one that never occurred — silently corrupting the seller's own
 * accounting on the call that is not safe to shrug off.
 */
export class MppSettlementOutcomeUnknownError extends MppError {
  constructor(
    message = 'MPP settlement outcome unknown: the request timed out before the backend responded, so the credits may or may not have been burned',
  ) {
    // No backend issues this code — the condition is detected here — but it
    // still carries one, following the same convention as the other
    // SDK-invented codes (`network_error`, `http_${status}`). `code` is the
    // only DATA-level discriminant on this hierarchy, and this is the branch
    // whose whole point is that misclassifying it corrupts the seller's
    // accounting. Two copies of this package in one dependency tree make
    // `instanceof` false for a genuinely-MPP error, and the check would
    // degrade silently to the "nothing happened" path — which the
    // integration guide tells sellers to rely on. Same across a process or
    // serialization boundary.
    super(message, MPP_SETTLEMENT_OUTCOME_UNKNOWN_CODE)
    this.name = 'MppSettlementOutcomeUnknownError'
  }
}

/**
 * What `paymentMiddleware`'s `onAfterSettle` hook receives as its third
 * argument when settlement raised {@link MppSettlementOutcomeUnknownError}.
 * That parameter's declared type is `unknown` (shared with the x402 hook of
 * the same name — out of scope to narrow here), so nothing stops a consumer
 * from casting straight to `MppSettleResult` and silently reading
 * `undefined` for `creditsRedeemed` on this branch. Exporting this shape
 * gives a consumer something concrete to check for instead — e.g.
 * `if ((result as MppSettlementOutcomeUnknown).outcome === 'unknown')` —
 * and documents, at the type level, that the branch exists at all.
 */
export interface MppSettlementOutcomeUnknown {
  outcome: 'unknown'
  reason: string
}

/**
 * `BCK.MPP.*` codes a buyer can retry by minting a fresh credential against
 * the NEW challenge the same 402 carries alongside them — as opposed to
 * `BCK.MPP.0003`, which means the credential itself was refused and paying
 * again cannot help.
 *
 * `0004` (expired) is obviously retryable: fetch a fresh challenge, pay it.
 * `0005` (body digest mismatch) is less obvious but equally retryable: the
 * fresh challenge is sealed to the digest of the request that just arrived,
 * so a credential minted against it — presented with the SAME body — would
 * succeed. A buyer gate that only excepts `0004` from a bare
 * `code.startsWith('BCK.MPP.')` check wrongly treats `0005` as terminal and
 * gives up on a request that would have worked on the next attempt.
 *
 * Grouped here, once, so a buyer checks {@link isRetryableMppCode} instead of
 * hardcoding the exception list — and so a future retryable code only needs
 * to be added to this one set.
 */
const RETRYABLE_BCK_MPP_CODES: ReadonlySet<string> = new Set(['BCK.MPP.0004', 'BCK.MPP.0005'])

/** Whether a `BCK.MPP.*` code means "mint a fresh credential and try again"
 *  rather than "this credential was refused; a new one changes nothing". */
export function isRetryableMppCode(code: string | undefined): boolean {
  return code !== undefined && RETRYABLE_BCK_MPP_CODES.has(code)
}

/** Maps a backend error payload onto the typed error hierarchy. */
export function toMppError(code: string | undefined, message: string): MppError {
  switch (code) {
    case 'BCK.MPP.0002':
      return new MppNotConfiguredError(message)
    case 'BCK.MPP.0003':
      return new MppCredentialRejectedError(message)
    case 'BCK.MPP.0004':
      return new MppChallengeExpiredError(message)
    case 'BCK.MPP.0005':
      return new MppBodyDigestMismatchError(message)
    default:
      return new MppError(message, code)
  }
}
