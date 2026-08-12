/**
 * The Machine Payments Protocol (MPP) API.
 *
 * MPP is a second payment framing over the unchanged Nevermined core: the same
 * plan, the same delegation and the same credit burn as x402, negotiated with
 * MPP headers. Sellers issue a challenge and redeem a credential; buyers mint
 * an MPP-domain access token and present it as a credential.
 */

import { BasePaymentsAPI } from '../api/base-payments.js'
import { API_URL_MPP_CHALLENGE, API_URL_MPP_SETTLE, API_URL_MPP_VERIFY } from '../api/nvm-api.js'
import type { PaymentOptions } from '../common/types.js'
import type { SettlePermissionsResult, VerifyPermissionsResult } from '../x402/facilitator-api.js'
import { MppError, MppSettlementOutcomeUnknownError, toMppError } from './errors.js'

/** Only whole, non-negative decimal digits — no sign, no leading/trailing
 *  whitespace, no hex/octal/binary prefix, no fractional part. `BigInt(x)`
 *  silently accepts all of those for a string input (`BigInt('0x10')` is 16,
 *  `BigInt('')` is 0n, `BigInt(' 5 ')` is 5n), which a decimal-string
 *  contract must reject rather than accept quietly. */
const DECIMAL_INTEGER_STRING = /^\d+$/

/**
 * Normalizes `credits` to the exact decimal-string amount that gets sealed
 * into the challenge and burned. A bare `.toString()` on a JS `number` can
 * emit scientific notation (`1e+21`), `"NaN"` or `"Infinity"` — all
 * forwarded unvalidated into an amount this PR's own docs describe as
 * having "no post-hoc re-pricing as there is with x402": a corrupted amount
 * here is not correctable downstream, it IS the amount.
 *
 * `BigInt(x)` renders an integer-valued number exactly (no scientific
 * notation) and throws `RangeError` on a non-integer, `NaN` or `Infinity`
 * instead of silently stringifying them — which is why non-string inputs go
 * through it. The `string` arm gets its own check instead of relying on
 * `BigInt`'s string parsing, which is far more permissive than a decimal
 * string contract should be.
 */
export function normalizeCredits(credits: string | number | bigint): string {
  if (typeof credits === 'string') {
    if (!DECIMAL_INTEGER_STRING.test(credits)) {
      throw new MppError(
        `credits must be a non-negative integer decimal string, got ${JSON.stringify(credits)}`,
      )
    }
    return credits
  }

  let normalized: string
  try {
    normalized = BigInt(credits).toString()
  } catch (error) {
    throw new MppError(
      `credits must be a non-negative integer, got ${credits}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (normalized.startsWith('-')) {
    throw new MppError(`credits must be a non-negative integer, got ${credits}`)
  }
  return normalized
}

/** Deadline on an outbound MPP request so a hung backend cannot hold the
 *  caller's connection open indefinitely — `middleware.ts` defers the
 *  buyer's own response until settlement resolves. */
const REQUEST_TIMEOUT_MS = 30_000

export interface IssueMppChallengeParams {
  /** The Nevermined plan the credits are burned against. */
  planId: string
  /** Credits the buyer is asked to redeem. Sent as a decimal string. */
  credits: string | number | bigint
  agentId?: string
  /** The protected resource. Sealed into the challenge and re-asserted at redeem. */
  resource: string
  /** HTTP verb of that resource. Part of the same binding. */
  httpVerb: string
  /** `sha-256=<base64>` digest binding the challenge to one request body. */
  digest?: string
  description?: string
}

export interface RedeemMppParams {
  /** The `Authorization: Payment …` value presented by the buyer. */
  credential: string
  /** Must equal the resource the challenge was issued for. */
  resource: string
  /** Must equal the verb the challenge was issued for. */
  httpVerb: string
  /** Digest of the body actually received, when the challenge bound one. */
  bodyDigest?: string
}

/**
 * A discriminated union rather than a flat `paymentReceipt: string`: a
 * settlement can fail, and `SettlePermissionsResult.success` already says
 * so, but the flat shape let `{ success: false }` with no receipt typecheck
 * — a state the seller middleware then had no way to reject at compile time
 * even though it could not safely attach a receipt header for it.
 */
export type MppSettleResult =
  | (SettlePermissionsResult & { success: true; paymentReceipt: string })
  | (SettlePermissionsResult & { success: false; paymentReceipt?: string })

export class MppAPI extends BasePaymentsAPI {
  static getInstance(options: PaymentOptions): MppAPI {
    return new MppAPI(options)
  }

  /**
   * Mints the challenge a plan-protected endpoint returns with its 402.
   *
   * Each call returns a distinct challenge even for identical inputs — the id
   * doubles as the burn idempotency key, so two requests sharing one would
   * settle as a single burn.
   */
  async issueChallenge(
    params: IssueMppChallengeParams,
  ): Promise<{ challenge: string; id: string }> {
    const { planId, credits, agentId, resource, httpVerb, digest, description } = params
    return this.post<{ challenge: string; id: string }>(API_URL_MPP_CHALLENGE, {
      planId,
      credits: normalizeCredits(credits),
      resource,
      httpVerb,
      ...(agentId && { agentId }),
      ...(digest && { digest }),
      ...(description && { description }),
    })
  }

  /** Runs the full credential and plan checks without burning anything. */
  async verifyCredential(params: RedeemMppParams): Promise<VerifyPermissionsResult> {
    return this.post<VerifyPermissionsResult>(API_URL_MPP_VERIFY, this.redeemBody(params))
  }

  /**
   * Verifies and burns through the same chokepoint an x402 settlement uses, so
   * the credits charged are identical on both protocols. Settling the same
   * credential twice burns once.
   */
  async settleCredential(params: RedeemMppParams): Promise<MppSettleResult> {
    return this.post<MppSettleResult>(API_URL_MPP_SETTLE, this.redeemBody(params), {
      burns: true,
    })
  }

  private redeemBody(params: RedeemMppParams): Record<string, unknown> {
    const { credential, resource, httpVerb, bodyDigest } = params
    return {
      credential,
      resource,
      httpVerb,
      ...(bodyDigest && { bodyDigest }),
    }
  }

  /**
   * One place for the POST + error translation both surfaces share.
   *
   * `burns` marks a call where "no answer" is not the same as "did not
   * happen" — currently only `settleCredential`. For that call alone, a
   * fetch rejection caused by OUR OWN `AbortSignal.timeout()` firing (not
   * some other network failure) is raised as {@link MppSettlementOutcomeUnknownError}
   * instead of the generic `network_error` `MppError` used everywhere else,
   * so a caller can tell "definitely nothing happened" apart from "the
   * backend may have already burned the credits; we just didn't hear back".
   * `error.name === 'TimeoutError'` combined with `instanceof DOMException`
   * is the documented, empirically-confirmed shape Node's `fetch` throws
   * when an `AbortSignal.timeout()` deadline fires — as opposed to, say,
   * connection-refused, which surfaces as a plain `TypeError`.
   */
  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    options: { burns?: boolean } = {},
  ): Promise<T> {
    const url = new URL(path, this.environment.backend)
    const requestOptions = {
      ...this.getBackendHTTPOptions('POST', body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }

    let response: Response
    try {
      response = await fetch(url, requestOptions)
    } catch (error) {
      if (options.burns && error instanceof DOMException && error.name === 'TimeoutError') {
        throw new MppSettlementOutcomeUnknownError()
      }
      throw toMppError(
        'network_error',
        `Network error during MPP request: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (!response.ok) {
      let message = `MPP request to ${path} failed`
      let code: string | undefined = `http_${response.status}`
      try {
        const errorData = await response.json()
        if (errorData.message) message = errorData.message
        if (errorData.code) code = errorData.code
        if (errorData.hint) message = `${message} — ${errorData.hint}`
      } catch {
        // Keep the default message.
      }
      throw toMppError(code, message)
    }

    // The success path is not exempt from a malformed body: a WAF
    // interstitial, a gateway HTML page, or a truncated 2xx response would
    // otherwise raise a raw SyntaxError here — the one call site in this
    // method that was NOT already wrapped and converted to a typed error.
    try {
      return (await response.json()) as T
    } catch (error) {
      throw toMppError(
        `http_${response.status}`,
        `MPP response from ${path} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
