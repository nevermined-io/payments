/**
 * LangSmith span helpers for Nevermined payment events (TypeScript).
 *
 * TS parity port of `payments_py/langsmith/spans.py`. Emits the cross-SDK
 * `nvm:verify` / `nvm:settlement` spans defined by the
 * **observability-spans-v1** contract
 * (`docs/specs/observability-spans-v1.md` in nvm-monorepo), so a single
 * LangSmith trace can be correlated across the TypeScript and Python SDKs
 * (e.g. filtered on `nvm.tx_hash`).
 *
 * All helpers in this module silently no-op when:
 *   - the optional `langsmith` JS SDK is not installed; or
 *   - no LangSmith run tree is active in the current context (e.g.
 *     `LANGSMITH_TRACING` is unset, or the call is not inside a traced run).
 *
 * Failures inside this module never propagate out — observability is
 * best-effort and must not interfere with the payment flow.
 *
 * `langsmith` is imported **lazily** (dynamic `import()`), so users who only
 * use the `requiresPayment` wrapper without tracing are not forced to install
 * it. Install it yourself (`pnpm add langsmith`) and set `LANGSMITH_TRACING=true`
 * to surface these spans.
 */

import type { RunTree } from 'langsmith'
import type { VerifyPermissionsResult, SettlePermissionsResult } from '../facilitator-api.js'

/** Plain JSON-ish metadata bag attached to a span / run tree. */
export type SpanMetadata = Record<string, unknown>

/** Span names — must match observability-spans-v1 exactly (case-sensitive). */
export const NVM_VERIFY_SPAN = 'nvm:verify'
export const NVM_SETTLEMENT_SPAN = 'nvm:settlement'

/**
 * Marker appended to a redacted short token. The joining character is the
 * single Unicode ellipsis `…` (U+2026), matching the Python implementation
 * and the spec, NOT three ASCII dots.
 */
const SHORT_TOKEN_MARKER = '…(short)'

/**
 * Cached result of the lazy `langsmith` import.
 *
 * `undefined` = not yet attempted; `null` = attempted and unavailable (so we
 * never retry the dynamic import on every call); otherwise the resolved module
 * surface we use (`getCurrentRunTree`).
 */
type LangsmithModule = {
  getCurrentRunTree: (permitAbsentRunTree: boolean) => RunTree | undefined
}
let cachedLangsmith: LangsmithModule | null | undefined

async function loadLangsmith(): Promise<LangsmithModule | null> {
  if (cachedLangsmith !== undefined) return cachedLangsmith
  try {
    const mod = (await import('langsmith')) as unknown as LangsmithModule
    cachedLangsmith = typeof mod?.getCurrentRunTree === 'function' ? mod : null
  } catch {
    cachedLangsmith = null
  }
  return cachedLangsmith
}

/**
 * Return the current LangSmith `RunTree`, or `undefined` if none is active or
 * `langsmith` is not installed. Safe to call unconditionally.
 */
export async function activeRunTree(): Promise<RunTree | undefined> {
  const ls = await loadLangsmith()
  if (ls === null) return undefined
  try {
    // `permitAbsentRunTree: true` returns undefined instead of throwing when
    // there is no active run, mirroring Python's `get_current_run_tree()` used
    // behind a try/except.
    return ls.getCurrentRunTree(true)
  } catch {
    return undefined
  }
}

/**
 * Merge `metadata` into `runTree`, swallowing any error. No-op if `runTree` is
 * absent or `metadata` is empty.
 *
 * The langsmith `RunTree` `metadata` setter merges into `extra.metadata`
 * (`{ ...existing, ...new }`), so this matches Python's `run_tree.add_metadata`.
 */
export function addMetadata(runTree: RunTree | undefined, metadata: SpanMetadata): void {
  if (!runTree || !metadata || Object.keys(metadata).length === 0) return
  try {
    runTree.metadata = metadata
  } catch {
    // observability hygiene must never disrupt the payment flow
  }
}

/**
 * Remove `keys` from `runTree`'s metadata in place.
 *
 * LangSmith inherits a parent run's metadata into child runs created via
 * `createChild`, so call this on the PARENT run BEFORE opening any child span
 * whose metadata should not carry the keys. The most common use is stripping
 * the full `payment_token` from the parent tool span's metadata, since the raw
 * access token grants access to the protected tool until it expires.
 *
 * No-op when `runTree` is absent or no keys are provided. All errors are
 * swallowed.
 */
export function redactMetadataKeys(runTree: RunTree | undefined, ...keys: string[]): void {
  if (!runTree || keys.length === 0) return
  try {
    const extra = (runTree as unknown as { extra?: Record<string, unknown> }).extra
    const metadata = extra?.metadata as Record<string, unknown> | undefined
    if (metadata && typeof metadata === 'object') {
      for (const key of keys) delete metadata[key]
    }
  } catch {
    // best-effort
  }
}

/**
 * Return a short, non-functional reference to a payment token for span
 * metadata. Mirrors `payments_py/langsmith/spans.py::abbreviate_token` incl.
 * the redact-and-warn behavior finalized in nvm-monorepo#1747
 * (payments-py PR #217).
 *
 * - `undefined`/empty input → `undefined` (and silent — no token at all is not
 *   a "wrong token" mistake).
 * - Already-redacted input (ends with the `…(short)` marker) → returned
 *   unchanged and silent, so the helper stays idempotent (the decorator path
 *   abbreviates the same token more than once).
 * - A token of length ≤ 20 is almost always a misconfiguration (a plan id, an
 *   opaque handle, etc. passed where the JWT was expected). Because this helper
 *   exists to keep credentials out of a durable trace store, such tokens are
 *   **redacted, not exported**: only `<first 4>…(short)` is returned and a
 *   warning is emitted. The full short value never leaves this function.
 * - Otherwise (a normal JWT, more than 20 chars) → `<first 16>…<last 4>`.
 */
export function abbreviateToken(token: string | undefined | null): string | undefined {
  if (!token) return undefined
  if (token.endsWith(SHORT_TOKEN_MARKER)) {
    // Already redacted (re-applied on the decorator path); re-slicing would let
    // the marker drift, so return unchanged and stay silent — the original
    // short value already triggered the warning.
    return token
  }
  if (token.length <= 20) {
    console.warn(
      'abbreviateToken: token is 20 characters or fewer — was the right x402 ' +
        'access token passed? Short/non-JWT tokens are almost always a ' +
        'misconfiguration and are redacted (not exported).',
    )
    return `${token.slice(0, 4)}${SHORT_TOKEN_MARKER}`
  }
  return `${token.slice(0, 16)}…${token.slice(-4)}`
}

/** Inputs accepted by {@link buildVerifyMetadata}. */
export interface VerifyMetadataInput {
  planIds: string[]
  scheme?: string
  network?: string
  agentId?: string
  verification?: VerifyPermissionsResult
  durationMs?: number
  token?: string
}

/**
 * Build the `nvm.*` metadata for a verify span. Drops absent values (a key is
 * omitted, never set to null/undefined). Matches observability-spans-v1 §2.
 *
 * `token` is abbreviated/redacted via {@link abbreviateToken} before being
 * surfaced as `nvm.payment_token` so the full credential never lands in
 * metadata we control.
 */
export function buildVerifyMetadata(input: VerifyMetadataInput): SpanMetadata {
  const { planIds, scheme, network, agentId, verification, durationMs, token } = input
  const md: SpanMetadata = { 'nvm.plan_ids': [...planIds] }
  if (scheme) md['nvm.scheme'] = scheme
  if (network) md['nvm.network'] = network
  if (agentId) md['nvm.agent_id'] = agentId
  if (durationMs !== undefined) md['nvm.verify.duration_ms'] = round2(durationMs)
  const abbreviated = abbreviateToken(token)
  if (abbreviated) md['nvm.payment_token'] = abbreviated
  if (verification) {
    if (verification.payer) md['nvm.payer'] = verification.payer
    if (verification.network && !('nvm.network' in md)) md['nvm.network'] = verification.network
    if (verification.agentRequestId) md['nvm.agent_request_id'] = verification.agentRequestId
  }
  return md
}

/** Inputs accepted by {@link buildSettleMetadata}. */
export interface SettleMetadataInput {
  settlement: SettlePermissionsResult
  planIds: string[]
  agentId?: string
  durationMs?: number
  token?: string
}

/**
 * Build the `nvm.*` metadata for a settlement span. Drops absent values.
 * Matches observability-spans-v1 §3.
 *
 * Note the types preserved exactly per the spec: `nvm.credits_redeemed`
 * (←`creditsRedeemed`) and `nvm.balance.after` (←`remainingBalance`) are
 * STRINGS — they are not coerced to numbers. `nvm.tx_hash` ← `transaction`.
 */
export function buildSettleMetadata(input: SettleMetadataInput): SpanMetadata {
  const { settlement, planIds, agentId, durationMs, token } = input
  const md: SpanMetadata = { 'nvm.plan_ids': [...planIds] }
  if (agentId) md['nvm.agent_id'] = agentId
  if (durationMs !== undefined) md['nvm.settle.duration_ms'] = round2(durationMs)
  const abbreviated = abbreviateToken(token)
  if (abbreviated) md['nvm.payment_token'] = abbreviated
  if (settlement.creditsRedeemed != null) md['nvm.credits_redeemed'] = settlement.creditsRedeemed
  if (settlement.remainingBalance != null) md['nvm.balance.after'] = settlement.remainingBalance
  if (settlement.transaction) md['nvm.tx_hash'] = settlement.transaction
  if (settlement.network) md['nvm.network'] = settlement.network
  if (settlement.payer) md['nvm.payer'] = settlement.payer
  return md
}

/** Round to 2 decimals, matching Python's `round(value, 2)`. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * An opened Nevermined span. `end()` records `outputs`/`error` and flushes the
 * child run to LangSmith. Always safe to call (no-op when `runTree` is absent).
 */
export interface NvmSpan {
  /** The underlying child `RunTree`, or `undefined` when tracing is inactive. */
  readonly runTree: RunTree | undefined
  /** Attach `nvm.*` metadata to this span. */
  addMetadata(metadata: SpanMetadata): void
  /** Close the span, flushing it to LangSmith. Optionally record an error. */
  end(error?: unknown): Promise<void>
}

async function openNvmSpan(name: string, inputs: SpanMetadata): Promise<NvmSpan> {
  const parent = await activeRunTree()
  if (!parent) return inactiveSpan()
  let child: RunTree
  try {
    child = parent.createChild({ name, run_type: 'tool', inputs })
  } catch {
    // span setup is pure observability — never let it disrupt the payment flow
    return inactiveSpan()
  }
  return {
    runTree: child,
    addMetadata(metadata: SpanMetadata) {
      addMetadata(child, metadata)
    },
    async end(error?: unknown) {
      try {
        await child.end(
          undefined,
          error === undefined ? undefined : error instanceof Error ? error.message : String(error),
        )
        await child.postRun()
      } catch {
        // best-effort flush
      }
    },
  }
}

function inactiveSpan(): NvmSpan {
  return {
    runTree: undefined,
    addMetadata() {
      /* no-op */
    },
    async end() {
      /* no-op */
    },
  }
}

/** Inputs accepted by {@link verifySpan}. */
export interface VerifySpanInput {
  planIds: string[]
  scheme?: string
  network?: string
  agentId?: string
}

/**
 * Open an `nvm:verify` child span around a verify call. Returns an
 * {@link NvmSpan} whose `end()` must be called once the verify completes (or
 * throws). Always safe — a no-op span is returned when tracing is inactive or
 * `langsmith` is not installed.
 */
export async function verifySpan(input: VerifySpanInput): Promise<NvmSpan> {
  const { planIds, scheme, network, agentId } = input
  const inputs: SpanMetadata = { plan_ids: [...planIds] }
  if (scheme) inputs.scheme = scheme
  if (network) inputs.network = network
  if (agentId) inputs.agent_id = agentId
  return openNvmSpan(NVM_VERIFY_SPAN, inputs)
}

/** Inputs accepted by {@link settlementSpan}. */
export interface SettlementSpanInput {
  planIds: string[]
  agentId?: string
}

/**
 * Open an `nvm:settlement` child span around a settle call. Same semantics as
 * {@link verifySpan}.
 */
export async function settlementSpan(input: SettlementSpanInput): Promise<NvmSpan> {
  const { planIds, agentId } = input
  const inputs: SpanMetadata = { plan_ids: [...planIds] }
  if (agentId) inputs.agent_id = agentId
  return openNvmSpan(NVM_SETTLEMENT_SPAN, inputs)
}
