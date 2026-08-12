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
import { toMppError } from './errors.js'

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
      credits: credits.toString(),
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
    return this.post<MppSettleResult>(API_URL_MPP_SETTLE, this.redeemBody(params))
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

  /** One place for the POST + error translation both surfaces share. */
  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = new URL(path, this.environment.backend)
    const options = this.getBackendHTTPOptions('POST', body)

    let response: Response
    try {
      response = await fetch(url, options)
    } catch (error) {
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

    return (await response.json()) as T
  }
}
