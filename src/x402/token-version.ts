/**
 * Detecting the EIP-712 version of a minted x402 access token.
 *
 * The version is a property of the token you were handed, never of the one you
 * asked for. The backend's `ValidationPipe` runs with `whitelist: true` and
 * without `forbidNonWhitelisted`, so a `tokenVersion: 3` sent to a deployment
 * that predates the v3 struct is dropped **without an error** and a v2 token
 * comes back. Branching on the requested version would then silently treat a
 * reusable v2 token as single-use (harmless) or — far worse, once the default
 * flips — a single-use v3 token as reusable, replaying a spent nonce on every
 * call after the first.
 *
 * The discriminator is `payload.authorization.nonce`: v3 is the first version
 * to carry one, and it is exactly what makes the token single-use.
 */

import { decodeAccessToken } from '../utils.js'
import type { X402TokenVersion } from '../common/types.js'

/**
 * Read the `authorization` object out of a base64 x402 access token.
 *
 * Returns `undefined` for anything that is not a decodable token with that
 * shape, so callers can treat "not a Nevermined token" and "no nonce" the same
 * way: as not-v3.
 */
function readAuthorization(accessToken: string): Record<string, any> | undefined {
  if (typeof accessToken !== 'string' || accessToken.length === 0) return undefined
  const decoded = decodeAccessToken(accessToken)
  const authorization = decoded?.payload?.authorization
  return typeof authorization === 'object' && authorization !== null ? authorization : undefined
}

/**
 * The EIP-712 version the given access token was actually signed under.
 *
 * `3` when `payload.authorization.nonce` is a non-empty string, `2` otherwise.
 *
 * A token that cannot be decoded also reads as `2`. That is the conservative
 * answer for a *version* question — v2 is what every pre-v3 token and every
 * non-Nevermined blob already is — but note it is the permissive answer for the
 * *reuse* question a caller asks next: `2` means "safe to cache and replay".
 * The gap is unreachable today, since an undecodable token is unusable anyway
 * (the backend rejects it on the first presentation, so there is nothing to
 * replay), but a future change to the envelope format would turn every v3 token
 * into a cached one here. Any such change must revisit this function first.
 *
 * Note this is deliberately NOT the same as trusting the token: nothing here
 * is verified. It answers "which settle semantics does this token have", which
 * only the backend's signature check ultimately enforces.
 *
 * @param accessToken - The base64-encoded x402 access token
 * @returns `3` for a single-use, seller/resource-bound token, else `2`
 *
 * @example
 * ```typescript
 * const { accessToken } = await payments.x402.getX402AccessToken(planId, agentId, {
 *   delegationConfig: { delegationId },
 *   // The string the seller advertises, not the URL you fetch.
 *   resource: { url: '/api/v1/tasks' },
 *   httpVerb: 'POST',
 *   tokenVersion: 3,
 * })
 * if (detectAccessTokenVersion(accessToken) === 3) {
 *   // Single-use: mint a new one for the next paid request.
 * }
 * ```
 */
export function detectAccessTokenVersion(accessToken: string): X402TokenVersion {
  const nonce = readAuthorization(accessToken)?.nonce
  // The string check mirrors the backend's own discriminator verbatim
  // (`AgentX402AccessToken.ts`: `typeof authorization?.nonce === 'string' &&
  // authorization.nonce.trim() !== ''`), and `generateTokenNonce()` emits 32
  // bytes of CSPRNG output hex-encoded — a string on the wire, always.
  // Accepting a non-string nonce as v3 would make this SDK disagree with the
  // server about what a v3 token is, which is worse than either error it could
  // prevent.
  return typeof nonce === 'string' && nonce.trim() !== '' ? 3 : 2
}

/**
 * Whether the token is consumed by its first successful settlement.
 *
 * True exactly for v3 tokens. A caller that caches an access token must test
 * this before reusing one: settling a spent v3 token fails with
 * `BCK.X402.0059` (see {@link isAccessTokenAlreadyUsed}).
 *
 * @param accessToken - The base64-encoded x402 access token
 */
export function isSingleUseAccessToken(accessToken: string): boolean {
  return detectAccessTokenVersion(accessToken) === 3
}

/**
 * Backend code for "this access token was already used".
 *
 * Returned by `POST /x402/settle` when a v3 token is settled a second time.
 * Deliberately not forgery-gated on the backend: it says plainly that the
 * token was spent, so a client can tell a **spent** token apart from a
 * declined one (insufficient credits, wrong plan) and from a **forged** one
 * (`BCK.X402.0005`, an envelope edited to disagree with the signature).
 */
export const X402_TOKEN_ALREADY_USED_CODE = 'BCK.X402.0059'

/**
 * Whether an error is the backend refusing a second settlement of the same
 * single-use token.
 *
 * The one correct response is to **mint a new token** — a retry that replays
 * the same token fails identically forever. Never treat this as a transient
 * settlement failure.
 *
 * @param error - Any thrown value; typically a `PaymentsError` from
 *   `payments.facilitator.settlePermissions`
 *
 * @example
 * ```typescript
 * try {
 *   await payments.facilitator.settlePermissions({ paymentRequired, x402AccessToken })
 * } catch (error) {
 *   if (isAccessTokenAlreadyUsed(error)) {
 *     // Re-mint, do not replay.
 *   }
 *   throw error
 * }
 * ```
 */
export function isAccessTokenAlreadyUsed(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return (error as { code?: unknown }).code === X402_TOKEN_ALREADY_USED_CODE
}
