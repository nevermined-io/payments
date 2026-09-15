/**
 * Public types for the Machine Payments Protocol (MPP) surface.
 *
 * MPP is a second payment framing over the unchanged plans/credits/delegations
 * core: the same plan, the same delegation and the same credit burn as x402,
 * negotiated with different HTTP headers.
 */

/** What the buyer is being asked to pay for. Sealed inside the challenge HMAC. */
export interface MppChallengeRequest {
  /** The Nevermined plan the credits are burned against. */
  planId: string
  /** Credits to redeem, as a decimal string. */
  credits: string
  /** Agent the request is addressed to. */
  agentId?: string
}

/**
 * A parsed `WWW-Authenticate: Payment …` challenge.
 *
 * `requestEncoded` and `opaque` are kept as the exact base64url strings the
 * server sent: the challenge id is an HMAC over them, so re-encoding either one
 * would invalidate the credential built from this challenge.
 */
export interface MppChallenge {
  id: string
  realm: string
  method: string
  intent: string
  request: MppChallengeRequest
  requestEncoded: string
  expires?: string
  digest?: string
  opaque?: string
  description?: string
}

/** A decoded `Payment-Receipt`. Unsigned by design, and carries no balance. */
export interface MppReceipt {
  method: string
  reference: string
  status: string
  timestamp: string
}
