/**
 * Seller-edge helpers for MPP.
 *
 * The edge is a thin, secret-free shim: it never mints a challenge itself and
 * never holds the MPP signing secret. It renames headers and forwards opaque
 * strings to the backend.
 *
 * It does read exactly one field out of a credential — `challenge.id`, via
 * {@link mppCredentialId}. That is a deliberate, bounded exception to
 * "forwards opaque strings", and it is forced: enforcing single-use requires a
 * stable identity for a credential, and the header bytes are not one (see
 * {@link extractCredentialChallengeId}). The id is public, unsigned and
 * already the backend's own burn key, so reading it grants the edge nothing
 * it could not already observe; nothing here validates, trusts or acts on any
 * other field, and the credential itself is still forwarded verbatim.
 */

import type { Request } from 'express'
import { extractCredentialChallengeId, extractPaymentScheme } from '../../mpp/codec.js'

/** MPP HTTP header names, lowercased for `req.headers` lookups. */
export const MPP_HEADERS = {
  /** Server sends the challenge here on the 402. */
  CHALLENGE: 'www-authenticate',
  /** Client sends the credential here. */
  CREDENTIAL: 'authorization',
  /** Server sends the settlement receipt here on success. */
  RECEIPT: 'payment-receipt',
} as const

/** Per-route MPP opt-in. `true` is shorthand for `{ bindBody: false }`. */
export type MppRouteOption = boolean | { bindBody?: boolean }

export interface ResolvedMppOption {
  enabled: boolean
  bindBody: boolean
}

export function resolveMppOption(option: MppRouteOption | undefined): ResolvedMppOption {
  if (option === undefined || option === false) return { enabled: false, bindBody: false }
  if (option === true) return { enabled: true, bindBody: false }
  return { enabled: true, bindBody: option.bindBody === true }
}

/**
 * The resource the challenge is bound to.
 *
 * Identical to the endpoint value the x402 path already uses, so the scope
 * includes the query string — the buyer reproduces it by retrying the same
 * request.
 */
export function mppResource(req: Request): string {
  return req.originalUrl || req.url
}

export function mppVerb(req: Request): string {
  return req.method.toUpperCase()
}

/**
 * Pulls the `Payment` credential out of `Authorization`, tolerating a header
 * that carries other schemes alongside it (RFC 9110 §11.6.1).
 */
export function extractCredential(req: Request): string | null {
  const header = req.headers[MPP_HEADERS.CREDENTIAL]
  if (!header || typeof header !== 'string') return null
  return extractPaymentScheme(header)
}

/**
 * The key the middleware's single-use and in-flight sets are keyed on: the
 * credential's challenge id, never the header bytes.
 *
 * `null` means the credential carries no usable id, which the middleware
 * treats as a rejection — see {@link extractCredentialChallengeId}.
 */
export function mppCredentialId(credential: string): string | null {
  return extractCredentialChallengeId(credential)
}
