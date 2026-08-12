/**
 * Seller-edge helpers for MPP.
 *
 * The edge is a thin, secret-free shim: it never mints a challenge itself, never
 * holds the MPP signing secret and never inspects a credential. It renames
 * headers and forwards opaque strings to the backend.
 */

import type { Request } from 'express'
import { extractPaymentScheme } from '../../mpp/codec.js'

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
