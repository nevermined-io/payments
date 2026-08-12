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
