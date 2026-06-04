/**
 * Unit tests for the LangSmith span helpers (`src/x402/langsmith/spans.ts`),
 * the TS parity port of `payments_py/langsmith/spans.py`.
 *
 * These tests assert OUR wiring: the `nvm.*` attribute set + types per the
 * observability-spans-v1 contract, the redact-and-warn token defense (#1747),
 * the parent-metadata redaction, and that `nvm:verify` / `nvm:settlement` child
 * spans are opened with `run_type: "tool"`.
 *
 * Caveat (mirrors the TS-0 langgraph approach, see #1717): the real `langsmith`
 * JS SDK is replaced with a faithful `RunTree` double via `jest.mock` (the
 * repo's ts-jest config transpiles to CommonJS, so `jest.mock(...)` with a
 * factory + regular `import` is the working pattern — the same one TS-0's
 * `langchain-decorator.test.ts` uses). The project's Jest setup does not
 * transform `node_modules` (langsmith pulls in ESM-only deps such as `uuid@14`)
 * and `tsc` excludes `tests/`, so these unit tests do NOT validate against the
 * real langsmith runtime. The double's shape was taken from `langsmith@0.7.4`'s
 * `RunTree` (`createChild`/`end`/`postRun`, the merging `metadata` setter that
 * writes `extra.metadata`, and `getCurrentRunTree`). A real-SDK integration test
 * is deferred to the follow-up tutorial work (out of scope here).
 */

/** Minimal stand-in mirroring the langsmith@0.7.4 RunTree surface we use. */
class FakeRunTree {
  name: string
  run_type: string
  inputs: Record<string, unknown>
  extra: { metadata?: Record<string, unknown> } & Record<string, unknown>
  children: FakeRunTree[] = []
  ended = false
  endError: string | undefined
  posted = false

  constructor(config: {
    name?: string
    run_type?: string
    inputs?: Record<string, unknown>
    extra?: Record<string, unknown>
  }) {
    this.name = config.name ?? ''
    this.run_type = config.run_type ?? 'chain'
    this.inputs = config.inputs ?? {}
    this.extra = (config.extra as FakeRunTree['extra']) ?? {}
  }

  // The real setter merges into extra.metadata ({ ...existing, ...new }).
  set metadata(metadata: Record<string, unknown>) {
    this.extra = {
      ...this.extra,
      metadata: { ...this.extra?.metadata, ...metadata },
    }
  }
  get metadata(): Record<string, unknown> {
    return this.extra?.metadata ?? {}
  }

  createChild(config: {
    name: string
    run_type?: string
    inputs?: Record<string, unknown>
  }): FakeRunTree {
    const child = new FakeRunTree(config)
    this.children.push(child)
    return child
  }

  async end(_outputs?: unknown, error?: string): Promise<void> {
    this.ended = true
    this.endError = error
  }

  async postRun(): Promise<void> {
    this.posted = true
  }
}

// `jest.mock` factories are hoisted above imports and may not close over
// outer `let`/`const`, so the mutable "active run" handle lives on the mock
// module itself and is read back via the imported mock in each test.
jest.mock('langsmith', () => {
  const state: { current: unknown } = { current: undefined }
  return {
    __esModule: true,
    RunTree: FakeRunTree,
    getCurrentRunTree: (_permitAbsent: boolean) => state.current,
    // test-only handle to set the active run tree
    __setCurrentRunTree: (rt: unknown) => {
      state.current = rt
    },
  }
})

import * as langsmithMock from 'langsmith'
import {
  abbreviateToken,
  activeRunTree,
  addMetadata,
  buildSettleMetadata,
  buildVerifyMetadata,
  redactMetadataKeys,
  settlementSpan,
  verifySpan,
} from '../../../src/x402/langsmith/spans.js'
import type {
  VerifyPermissionsResult,
  SettlePermissionsResult,
} from '../../../src/x402/facilitator-api.js'

function setActiveRun(rt: FakeRunTree | undefined): void {
  ;(langsmithMock as unknown as { __setCurrentRunTree: (rt: unknown) => void }).__setCurrentRunTree(
    rt,
  )
}

beforeEach(() => {
  setActiveRun(undefined)
  jest.restoreAllMocks()
})

// ---- abbreviateToken (redact + warn, #1747 / payments-py#217) -------------

describe('abbreviateToken', () => {
  it('abbreviates a long JWT-like token to <first16>…<last4>', () => {
    const token = 'a'.repeat(40)
    expect(abbreviateToken(token)).toBe(`${token.slice(0, 16)}…${token.slice(-4)}`)
  })

  it('returns undefined (silently) for empty/undefined input', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(abbreviateToken(undefined)).toBeUndefined()
    expect(abbreviateToken(null)).toBeUndefined()
    expect(abbreviateToken('')).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('redacts a <=20-char token to <first4>…(short) AND warns', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const short = 'not-a-real-jwt' // 14 chars
    const result = abbreviateToken(short)
    expect(result).toBe('not-…(short)')
    // Full short value never leaves the helper.
    expect(result).not.toContain(short)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('treats exactly 20 chars as short (inclusive upper bound)', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(abbreviateToken('a'.repeat(20))).toBe('aaaa…(short)')
  })

  it('is idempotent on an already-redacted value and stays silent', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const redacted = 'aaaa…(short)'
    expect(abbreviateToken(redacted)).toBe(redacted)
    expect(warn).not.toHaveBeenCalled()
  })
})

// ---- buildVerifyMetadata --------------------------------------------------

describe('buildVerifyMetadata', () => {
  it('always includes nvm.plan_ids and drops absent optionals', () => {
    const md = buildVerifyMetadata({ planIds: ['plan-1'] })
    expect(md).toEqual({ 'nvm.plan_ids': ['plan-1'] })
  })

  it('includes static fields, rounds duration, abbreviates token', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const md = buildVerifyMetadata({
      planIds: ['plan-1', 'plan-2'],
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      agentId: 'agent-x',
      durationMs: 12.3456,
      token: 'j'.repeat(40),
    })
    expect(md['nvm.scheme']).toBe('nvm:erc4337')
    expect(md['nvm.network']).toBe('eip155:84532')
    expect(md['nvm.agent_id']).toBe('agent-x')
    expect(md['nvm.verify.duration_ms']).toBe(12.35)
    expect(md['nvm.payment_token']).toBe(`${'j'.repeat(16)}…jjjj`)
  })

  it('extracts payer/agent_request_id and network-fallback from verification', () => {
    const verification: VerifyPermissionsResult = {
      isValid: true,
      payer: '0xabc',
      network: 'eip155:84532',
      agentRequestId: 'req-9',
    }
    const md = buildVerifyMetadata({ planIds: ['p'], verification })
    expect(md['nvm.payer']).toBe('0xabc')
    expect(md['nvm.agent_request_id']).toBe('req-9')
    expect(md['nvm.network']).toBe('eip155:84532')
  })

  it('lets an explicit network win over the verification network', () => {
    const verification: VerifyPermissionsResult = {
      isValid: true,
      network: 'eip155:1',
    }
    const md = buildVerifyMetadata({
      planIds: ['p'],
      network: 'eip155:84532',
      verification,
    })
    expect(md['nvm.network']).toBe('eip155:84532')
  })

  it('omits nvm.payment_token when no token supplied', () => {
    const md = buildVerifyMetadata({ planIds: ['p'] })
    expect('nvm.payment_token' in md).toBe(false)
  })
})

// ---- buildSettleMetadata --------------------------------------------------

describe('buildSettleMetadata', () => {
  const SETTLE_OK: SettlePermissionsResult = {
    success: true,
    payer: '0xabc',
    transaction: '0xdeadbeef',
    network: 'eip155:84532',
    creditsRedeemed: '5',
    remainingBalance: '95',
  }

  it('maps fields per spec and keeps credit/balance as STRINGS', () => {
    const md = buildSettleMetadata({
      settlement: SETTLE_OK,
      planIds: ['plan-1'],
      agentId: 'agent-x',
      durationMs: 8.0,
    })
    expect(md['nvm.plan_ids']).toEqual(['plan-1'])
    expect(md['nvm.agent_id']).toBe('agent-x')
    expect(md['nvm.settle.duration_ms']).toBe(8)
    expect(md['nvm.tx_hash']).toBe('0xdeadbeef')
    expect(md['nvm.network']).toBe('eip155:84532')
    expect(md['nvm.payer']).toBe('0xabc')
    // Types preserved exactly — strings, not numbers.
    expect(md['nvm.credits_redeemed']).toBe('5')
    expect(typeof md['nvm.credits_redeemed']).toBe('string')
    expect(md['nvm.balance.after']).toBe('95')
    expect(typeof md['nvm.balance.after']).toBe('string')
  })

  it('omits empty transaction and network', () => {
    const md = buildSettleMetadata({
      settlement: { success: false, transaction: '', network: '' },
      planIds: ['p'],
    })
    expect('nvm.tx_hash' in md).toBe(false)
    expect('nvm.network' in md).toBe(false)
  })

  it('omits credits/balance when undefined', () => {
    const md = buildSettleMetadata({
      settlement: { success: true, transaction: '0x1', network: 'eip155:1' },
      planIds: ['p'],
    })
    expect('nvm.credits_redeemed' in md).toBe(false)
    expect('nvm.balance.after' in md).toBe(false)
  })
})

// ---- activeRunTree / addMetadata / redactMetadataKeys ---------------------

describe('activeRunTree', () => {
  it('returns the current run tree when one is active', async () => {
    const rt = new FakeRunTree({ name: 'parent' })
    setActiveRun(rt)
    expect(await activeRunTree()).toBe(rt as never)
  })

  it('returns undefined when no run is active', async () => {
    setActiveRun(undefined)
    expect(await activeRunTree()).toBeUndefined()
  })
})

describe('addMetadata', () => {
  it('merges metadata into the run tree', () => {
    const rt = new FakeRunTree({ name: 'p' })
    addMetadata(rt as never, { 'nvm.plan_ids': ['a'] })
    addMetadata(rt as never, { 'nvm.payer': '0x1' })
    expect(rt.metadata).toEqual({ 'nvm.plan_ids': ['a'], 'nvm.payer': '0x1' })
  })

  it('is a no-op for an undefined run tree or empty metadata', () => {
    expect(() => addMetadata(undefined, { a: 1 })).not.toThrow()
    const rt = new FakeRunTree({ name: 'p' })
    addMetadata(rt as never, {})
    expect(rt.metadata).toEqual({})
  })
})

describe('redactMetadataKeys', () => {
  it('removes the given keys from the run tree metadata in place', () => {
    const rt = new FakeRunTree({ name: 'p' })
    rt.metadata = { payment_token: 'SECRET', keep: 'me' }
    redactMetadataKeys(rt as never, 'payment_token')
    expect('payment_token' in rt.metadata).toBe(false)
    expect(rt.metadata.keep).toBe('me')
  })

  it('is a no-op when run tree is undefined or no keys given', () => {
    expect(() => redactMetadataKeys(undefined, 'x')).not.toThrow()
    const rt = new FakeRunTree({ name: 'p' })
    rt.metadata = { a: 1 }
    redactMetadataKeys(rt as never)
    expect(rt.metadata).toEqual({ a: 1 })
  })
})

// ---- verifySpan / settlementSpan ------------------------------------------

describe('verifySpan / settlementSpan', () => {
  it('opens an nvm:verify child span with run_type tool when traced', async () => {
    const parent = new FakeRunTree({ name: 'tool' })
    setActiveRun(parent)
    const span = await verifySpan({
      planIds: ['plan-1'],
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      agentId: 'agent-x',
    })
    expect(span.runTree).toBeDefined()
    const child = parent.children[0]
    expect(child.name).toBe('nvm:verify')
    expect(child.run_type).toBe('tool')
    expect(child.inputs).toEqual({
      plan_ids: ['plan-1'],
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      agent_id: 'agent-x',
    })
    span.addMetadata({ 'nvm.plan_ids': ['plan-1'] })
    expect(child.metadata['nvm.plan_ids']).toEqual(['plan-1'])
    await span.end()
    expect(child.ended).toBe(true)
    expect(child.posted).toBe(true)
  })

  it('opens an nvm:settlement child span (plan_ids + agent_id only)', async () => {
    const parent = new FakeRunTree({ name: 'tool' })
    setActiveRun(parent)
    const span = await settlementSpan({ planIds: ['p'], agentId: 'a' })
    const child = parent.children[0]
    expect(child.name).toBe('nvm:settlement')
    expect(child.run_type).toBe('tool')
    expect(child.inputs).toEqual({ plan_ids: ['p'], agent_id: 'a' })
    await span.end(new Error('boom'))
    expect(child.endError).toBe('boom')
  })

  it('returns an inactive no-op span when no run is active', async () => {
    setActiveRun(undefined)
    const span = await verifySpan({ planIds: ['p'] })
    expect(span.runTree).toBeUndefined()
    // No-op methods must not throw.
    span.addMetadata({ x: 1 })
    await expect(span.end()).resolves.toBeUndefined()
  })
})
