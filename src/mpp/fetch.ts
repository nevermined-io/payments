/**
 * The buyer half of MPP: pay a challenged endpoint with an existing Nevermined
 * delegation.
 *
 * The buyer learns nothing about MPP beyond calling this instead of `fetch`.
 * The plan comes out of the challenge, the credential is built from the
 * challenge plus an MPP-domain access token, and the request is retried once.
 */

import type { DelegationConfig, X402TokenOptions } from '../common/types.js'
import { buildCredentialHeader, parseChallengeHeader, parseReceiptHeader } from './codec.js'
import { MppError, toMppError } from './errors.js'
import type { MppReceipt } from './types.js'

/**
 * Options for {@link mppFetch} / `MppAPI.fetch`.
 *
 * The request's `init.body`, if any, must be replayable **if the endpoint may
 * challenge the request**: a `ReadableStream` body throws a typed
 * {@link MppError} once a 402 challenge actually requires a retry, since the
 * stream cannot be resent. A request that is never challenged sends a stream
 * body exactly once, exactly like plain `fetch`.
 */
export interface MppFetchOptions {
  /** The delegation that backs the payment — the same one x402 uses. */
  delegationConfig: DelegationConfig
  agentId?: string
  /** Optional guard: fail if the challenge names a different plan. */
  planId?: string
}

export interface MppFetchResult {
  /** The final response — the paid one when a payment happened. */
  response: Response
  /** The decoded `Payment-Receipt`, when the server returned one. */
  receipt?: MppReceipt
  /** Whether a credential was presented and accepted. */
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
 * throws an opaque runtime `TypeError` rather than a typed MPP error. Every
 * other `BodyInit` — `string`, `Buffer`/`ArrayBuffer`/typed arrays,
 * `URLSearchParams`, `FormData`, `Blob`, or no body at all — can be read more
 * than once, so a retry is safe.
 */
function isNonReplayableBody(body: BodyInit | null | undefined): boolean {
  return typeof ReadableStream !== 'undefined' && body instanceof ReadableStream
}

/**
 * Reads the error body of a challenged retry.
 *
 * A retry that comes back 402 is either "your credential was refused" (a coded
 * MPP error, which the caller must see) or "here is a fresh challenge" (the
 * seller re-challenging, which is retryable once).
 */
async function readMppErrorCode(response: Response): Promise<{ code?: string; message: string }> {
  try {
    const clone = response.clone()
    const body = await clone.json()
    return { code: body?.code, message: body?.message ?? 'MPP request failed' }
  } catch {
    return { message: 'MPP request failed' }
  }
}

/**
 * Performs the request, paying an MPP challenge if one comes back.
 *
 * At most one re-challenge cycle is followed: a seller that keeps challenging a
 * freshly paid credential is not going to be satisfied by looping, and a loop
 * would burn a credential per turn.
 *
 * `init.body`, when set, must be replayable **if the endpoint may challenge
 * the request**: a `ReadableStream` is rejected with a typed {@link MppError}
 * only once a 402 challenge actually requires a retry — a request that is
 * never challenged sends the stream exactly once, exactly like plain `fetch`.
 */
export async function mppFetch(
  mintToken: MppTokenMinter,
  input: string | URL,
  init: RequestInit | undefined,
  options: MppFetchOptions,
): Promise<MppFetchResult> {
  const maxChallenges = 2
  let response = await fetch(input, init)

  for (let attempt = 0; attempt < maxChallenges; attempt++) {
    if (response.status !== 402) break

    const challengeHeader = response.headers.get('www-authenticate')
    if (!challengeHeader) break

    const challenge = parseChallengeHeader(challengeHeader)
    if (!challenge) break

    const planId = challenge.request.planId
    if (options.planId && options.planId !== planId) {
      throw new MppError(
        `MPP challenge names plan ${planId}, but plan ${options.planId} was pinned by the caller`,
      )
    }

    // A retry resends init.body verbatim. A ReadableStream is single-read —
    // the first fetch() above already consumed it once — so replaying it now
    // would throw an opaque runtime TypeError. Checked here, at the point a
    // retry is actually about to happen, not before the (harmless) first
    // attempt: whether this endpoint ever challenges is not known ahead of
    // time, and a stream body against a non-challenging endpoint is fine.
    if (isNonReplayableBody(init?.body)) {
      throw new MppError(
        'payments.mpp.fetch cannot retry a ReadableStream request body: streams are single-read, ' +
          'so the 402 challenge from this endpoint cannot be replayed. Pass a replayable body ' +
          'instead — a string, Buffer/ArrayBuffer/typed array, URLSearchParams, FormData or Blob.',
      )
    }

    const { accessToken } = await mintToken(planId, options.agentId ?? challenge.request.agentId, {
      delegationConfig: options.delegationConfig,
    })

    const headers = new Headers(init?.headers ?? {})
    headers.set('authorization', buildCredentialHeader(challenge, { accessToken }))
    response = await fetch(input, { ...init, headers })

    if (response.status === 402) {
      const { code, message } = await readMppErrorCode(response)
      // A coded rejection is terminal: the credential was refused, and paying
      // again with the same one cannot help.
      if (code?.startsWith('BCK.MPP.') && code !== 'BCK.MPP.0004') {
        throw toMppError(code, message)
      }
      // Otherwise the seller re-challenged (typically an expired challenge);
      // the loop takes one more turn with the fresh one.
      continue
    }

    const receiptHeader = response.headers.get('payment-receipt')
    return {
      response,
      paid: response.ok,
      ...(receiptHeader && { receipt: parseReceiptHeader(receiptHeader) }),
    }
  }

  return { response, paid: false }
}
