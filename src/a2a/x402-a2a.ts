/**
 * x402 + A2A in-band integration utilities (x402 v2 A2A transport).
 *
 * Port of the Python SDK's `payments_py/x402/a2a.py` `X402A2AUtils`. These
 * helpers bridge the x402 payment protocol with the A2A (Agent-to-Agent)
 * protocol, signalling payment state *in band* through A2A Task / Message
 * metadata instead of HTTP status codes and headers.
 *
 * The A2A transport equivalent of the MCP transport's `_meta["x402/payment"]`
 * keys is the A2A **task / message metadata** under the spec-defined
 * `x402.payment.*` keys (see {@link X402A2AMetadata}). The wire shapes are
 * defined by:
 *   - Coinbase x402 v2 A2A transport: specs/transports-v2/a2a.md
 *   - A2A x402 extension: https://github.com/google-agentic-commerce/a2a-x402
 *
 * These constants/keys are part of the specification and MUST NOT be changed.
 */

import type { Message, Task, TaskStatus } from '@a2a-js/sdk'
import type { SettlePermissionsResult, X402PaymentRequired } from '../x402/facilitator-api.js'

/**
 * Protocol-defined payment states for the A2A x402 flow.
 *
 * Tracked in the `x402.payment.status` metadata field. Values are part of the
 * A2A x402 specification (Section 6: State Management) and must not be changed.
 */
export enum PaymentStatus {
  /** Payment requirements sent to client (task state `input-required`). */
  PAYMENT_REQUIRED = 'payment-required',
  /** Payment payload received by server. */
  PAYMENT_SUBMITTED = 'payment-submitted',
  /** Payment payload verified by the facilitator. */
  PAYMENT_VERIFIED = 'payment-verified',
  /** Payment requirements rejected by the client. */
  PAYMENT_REJECTED = 'payment-rejected',
  /** Payment settled on-chain successfully (task state `completed`). */
  PAYMENT_COMPLETED = 'payment-completed',
  /** Payment verification or settlement failed (task state `failed`). */
  PAYMENT_FAILED = 'payment-failed',
}

/**
 * Spec-defined A2A task / message metadata keys for the x402 protocol.
 *
 * As defined in the A2A x402 specification (Section 6: State Management). These
 * keys are part of the specification and must not be changed. Note these are
 * NOT the MCP `_meta["x402/payment"]` keys — A2A signals payment state through
 * Task / Message `metadata` instead.
 */
export const X402A2AMetadata = {
  /** Current payment flow stage. */
  STATUS_KEY: 'x402.payment.status',
  /** X402PaymentRequired object. */
  REQUIRED_KEY: 'x402.payment.required',
  /** PaymentPayload object (client → server). */
  PAYLOAD_KEY: 'x402.payment.payload',
  /** Array of SettleResponse receipts (server → client). */
  RECEIPTS_KEY: 'x402.payment.receipts',
  /** Error code on failure. */
  ERROR_KEY: 'x402.payment.error',
} as const

/**
 * Nevermined-specific (non-core-spec) marker set alongside `payment-verified`
 * when on-chain settlement is **deferred** to a batch process this handler does
 * not confirm. Lets a client distinguish "verified, will be charged out-of-band"
 * from a plain verify; spec-only clients ignore the unknown key. Value: `'deferred'`.
 */
export const X402_SETTLEMENT_DEFERRED_KEY = 'x402.payment.settlement'

/**
 * Upper bound on the serialized size of an in-band payment payload. The payload
 * is untrusted client input that gets re-encoded into a token, so cap it as
 * defense-in-depth (parity with the MCP `readPaymentPayload` and the Python
 * sibling's `len(json.dumps(value))` guard).
 */
const MAX_INBAND_PAYMENT_PAYLOAD_LEN = 64 * 1024

/** Type guard: a plain (non-null, non-array) object, mirroring `isinstance(value, dict)`. */
function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read x402 payment metadata from a Message's `metadata`, ignoring non-object values.
 */
function metaOf(message?: Message | null): Record<string, any> | undefined {
  const metadata = message?.metadata
  return isPlainObject(metadata) ? metadata : undefined
}

/**
 * Ensure a Task has a status with a status message carrying a `metadata` object,
 * returning that metadata object for mutation by the record* helpers.
 *
 * The task is mutated in place (the A2A SDK's ResultManager / event flow operate
 * on task objects by reference), mirroring the Python `X402A2AUtils` behavior.
 */
function ensureStatusMetadata(task: Task, defaultText: string): Record<string, any> {
  if (!task.status) {
    task.status = { state: 'working' } as TaskStatus
  }
  if (!task.status.message) {
    task.status.message = {
      kind: 'message',
      messageId: `${task.id}-status`,
      role: 'agent',
      parts: [{ kind: 'text', text: defaultText }],
      metadata: {},
    }
  }
  if (!isPlainObject(task.status.message.metadata)) {
    task.status.message.metadata = {}
  }
  return task.status.message.metadata as Record<string, any>
}

/**
 * Utilities for managing x402 payment state in A2A messages and tasks.
 *
 * Provides methods to extract payment status / requirements / payload from
 * incoming A2A messages and tasks, and to stamp payment-required, verified,
 * completed and failed state onto outgoing tasks — all via the spec-defined
 * `x402.payment.*` metadata keys.
 */
export class X402A2AUtils {
  static readonly STATUS_KEY = X402A2AMetadata.STATUS_KEY
  static readonly REQUIRED_KEY = X402A2AMetadata.REQUIRED_KEY
  static readonly PAYLOAD_KEY = X402A2AMetadata.PAYLOAD_KEY
  static readonly RECEIPTS_KEY = X402A2AMetadata.RECEIPTS_KEY
  static readonly ERROR_KEY = X402A2AMetadata.ERROR_KEY

  // ---- Extraction (client/server reads) ------------------------------------

  /** Extract the payment status from a Message's metadata, or `undefined`. */
  getPaymentStatusFromMessage(message?: Message | null): string | undefined {
    const meta = metaOf(message)
    const value = meta?.[X402A2AUtils.STATUS_KEY]
    return typeof value === 'string' ? value : undefined
  }

  /** Extract the payment status from a Task's status message metadata, or `undefined`. */
  getPaymentStatus(task?: Task | null): string | undefined {
    return this.getPaymentStatusFromMessage(task?.status?.message)
  }

  /**
   * Extract the X402PaymentRequired object from a Message's metadata.
   *
   * Returns the raw object (already spec-shaped JSON). Returns `undefined` when
   * absent or not a plain object.
   */
  getPaymentRequirementsFromMessage(message?: Message | null): X402PaymentRequired | undefined {
    const meta = metaOf(message)
    const value = meta?.[X402A2AUtils.REQUIRED_KEY]
    // Structural guard before asserting the typed shape: a valid
    // X402PaymentRequired is a plain object carrying a numeric `x402Version` and
    // an `accepts` array. Anything else is treated as absent (never assert the
    // rich interface over arbitrary, unvalidated metadata).
    if (
      !isPlainObject(value) ||
      typeof (value as Record<string, unknown>).x402Version !== 'number' ||
      !Array.isArray((value as Record<string, unknown>).accepts)
    ) {
      return undefined
    }
    return value as unknown as X402PaymentRequired
  }

  /** Extract the X402PaymentRequired object from a Task's status message metadata. */
  getPaymentRequirements(task?: Task | null): X402PaymentRequired | undefined {
    return this.getPaymentRequirementsFromMessage(task?.status?.message)
  }

  /**
   * Extract the in-band PaymentPayload object from a Message's metadata.
   *
   * The payload is untrusted client input that the server re-encodes into an
   * access token, so this rejects null, arrays and oversized payloads
   * (defense-in-depth, parity with the MCP `readPaymentPayload`).
   *
   * @returns The PaymentPayload object, or `undefined` when absent/invalid.
   */
  getPaymentPayloadFromMessage(message?: Message | null): Record<string, any> | undefined {
    const meta = metaOf(message)
    const value = meta?.[X402A2AUtils.PAYLOAD_KEY]
    if (!isPlainObject(value)) {
      return undefined
    }
    if (JSON.stringify(value).length > MAX_INBAND_PAYMENT_PAYLOAD_LEN) {
      return undefined
    }
    return value
  }

  /** Extract the in-band PaymentPayload object from a Task's status message metadata. */
  getPaymentPayload(task?: Task | null): Record<string, any> | undefined {
    return this.getPaymentPayloadFromMessage(task?.status?.message)
  }

  // ---- Stamping (server writes) --------------------------------------------

  /**
   * Set a Task to the payment-required state (`input-required`) with the
   * X402PaymentRequired object in `x402.payment.required` metadata.
   *
   * Mutates and returns `task` (in place), per the x402 v2 A2A transport.
   */
  createPaymentRequiredTask(task: Task, paymentRequired: X402PaymentRequired): Task {
    if (!task.status) {
      task.status = { state: 'input-required' } as TaskStatus
    } else {
      task.status.state = 'input-required'
    }
    const meta = ensureStatusMetadata(task, 'Payment is required for this service.')
    meta[X402A2AUtils.STATUS_KEY] = PaymentStatus.PAYMENT_REQUIRED
    meta[X402A2AUtils.REQUIRED_KEY] = paymentRequired
    return task
  }

  /**
   * Record payment verification on a Task: sets the `x402.payment.status`
   * metadata to `payment-verified`. Task state is left to the caller (the spec
   * keeps it `working`).
   */
  recordPaymentVerified(task: Task): Task {
    const meta = ensureStatusMetadata(task, 'Payment verification recorded.')
    meta[X402A2AUtils.STATUS_KEY] = PaymentStatus.PAYMENT_VERIFIED
    return task
  }

  /**
   * Record a deferred (batch) settlement on a Task: the payload was verified but
   * on-chain settlement is deferred out-of-band (the handler never confirms it).
   * Sets `payment-verified` PLUS the Nevermined `x402.payment.settlement: 'deferred'`
   * marker, so a client can tell it will be charged out-of-band — distinct from a
   * plain verify where nothing is owed.
   */
  recordPaymentDeferred(task: Task): Task {
    const meta = ensureStatusMetadata(task, 'Payment verified; settlement deferred.')
    meta[X402A2AUtils.STATUS_KEY] = PaymentStatus.PAYMENT_VERIFIED
    meta[X402_SETTLEMENT_DEFERRED_KEY] = 'deferred'
    return task
  }

  /**
   * Record a successful settlement on a Task: sets the `x402.payment.status`
   * metadata to `payment-completed` and stores the SettleResponse receipt under
   * `x402.payment.receipts` (an array, per the spec).
   */
  recordPaymentSuccess(task: Task, settleResponse?: SettlePermissionsResult): Task {
    const meta = ensureStatusMetadata(task, 'Payment completed successfully.')
    meta[X402A2AUtils.STATUS_KEY] = PaymentStatus.PAYMENT_COMPLETED
    if (settleResponse) {
      meta[X402A2AUtils.RECEIPTS_KEY] = [settleResponse]
    }
    return task
  }

  /**
   * Record a payment failure on a Task: `x402.payment.status = payment-failed`,
   * the error code under `x402.payment.error`, and (when available) the failed
   * SettleResponse under `x402.payment.receipts`.
   */
  recordPaymentFailure(
    task: Task,
    errorCode: string,
    errorResponse?: SettlePermissionsResult,
  ): Task {
    const meta = ensureStatusMetadata(task, 'Payment failed.')
    meta[X402A2AUtils.STATUS_KEY] = PaymentStatus.PAYMENT_FAILED
    meta[X402A2AUtils.ERROR_KEY] = errorCode
    if (errorResponse) {
      meta[X402A2AUtils.RECEIPTS_KEY] = [errorResponse]
    }
    return task
  }
}

/** Shared singleton, matching the Python `X402A2AUtils()` usage pattern. */
export const x402A2AUtils = new X402A2AUtils()
