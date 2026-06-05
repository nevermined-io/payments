/**
 * Unit tests for the LangSmith span wiring inside the `requiresPayment`
 * decorator (`src/x402/langchain/decorator.ts`). Proves the decorator opens
 * `nvm:verify` / `nvm:settlement` child spans around the verify/settle calls,
 * redacts the full `payment_token` from the parent run tree, and no-ops cleanly
 * when no LangSmith run is active.
 *
 * Same caveat as `langsmith-spans.test.ts` (and the TS-0 langgraph tests,
 * #1717): `langsmith` is replaced with a faithful `RunTree` double via
 * `jest.mock`; the real SDK is not exercised. We assert OUR wiring, not
 * langsmith's transport.
 */

class FakeRunTree {
  name: string
  run_type: string
  inputs: Record<string, unknown>
  extra: { metadata?: Record<string, unknown> } & Record<string, unknown>
  children: FakeRunTree[] = []
  ended = false
  // Captures the error string passed to `end(outputs, error)` so the wiring
  // tests can assert the span was closed WITH the verify/settle failure reason
  // (the production `openNvmSpan.end()` calls `child.end(undefined, message)`).
  // Mirrors the `FakeRunTree` in `langsmith-spans.test.ts`.
  endError: string | undefined

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
  async postRun(): Promise<void> {}
}

// Mock the `langsmith/singletons/traceable` SUB-PATH — that is the specifier
// `loadLangsmith()` imports and where `getCurrentRunTree` lives. Mocking the
// `langsmith` root would no-op the wiring under test.
jest.mock('langsmith/singletons/traceable', () => {
  const state: { current: unknown } = { current: undefined }
  return {
    __esModule: true,
    RunTree: FakeRunTree,
    getCurrentRunTree: (_permitAbsent: boolean) => state.current,
    __setCurrentRunTree: (rt: unknown) => {
      state.current = rt
    },
  }
})

import * as langsmithMock from 'langsmith/singletons/traceable'
import { requiresPayment, lastSettlement } from '../../../src/x402/langchain/decorator.js'
import type {
  VerifyPermissionsResult,
  SettlePermissionsResult,
} from '../../../src/x402/facilitator-api.js'

function setActiveRun(rt: FakeRunTree | undefined): void {
  ;(langsmithMock as unknown as { __setCurrentRunTree: (rt: unknown) => void }).__setCurrentRunTree(
    rt,
  )
}

const VERIFY_OK: VerifyPermissionsResult = {
  isValid: true,
  payer: '0x1234567890abcdef',
  network: 'eip155:84532',
  agentRequestId: 'req-123',
}
const SETTLE_OK: SettlePermissionsResult = {
  success: true,
  payer: '0x1234567890abcdef',
  transaction: '0xabc123',
  network: 'eip155:84532',
  creditsRedeemed: '1',
  remainingBalance: '99',
}

function makeMockPayments() {
  return {
    facilitator: {
      verifyPermissions: jest.fn().mockResolvedValue({ ...VERIFY_OK }),
      settlePermissions: jest.fn().mockResolvedValue({ ...SETTLE_OK }),
    },
  }
}

function protectedFn(mockPayments: ReturnType<typeof makeMockPayments>) {
  return requiresPayment((args: { topic: string }) => `insight ${args.topic}`, {
    payments: mockPayments as never,
    planId: 'plan-123',
    credits: 1,
    agentId: 'agent-x',
  })
}

const LONG_TOKEN = 'j'.repeat(40)

beforeEach(() => {
  setActiveRun(undefined)
  jest.restoreAllMocks()
})

describe('requiresPayment LangSmith wiring', () => {
  it('emits nvm:verify and nvm:settlement child spans under an active run', async () => {
    const parent = new FakeRunTree({ name: 'tool' })
    setActiveRun(parent)
    const fn = protectedFn(makeMockPayments())

    await fn({ topic: 'evs' }, { configurable: { payment_token: LONG_TOKEN } })

    const names = parent.children.map((c) => c.name)
    expect(names).toEqual(['nvm:verify', 'nvm:settlement'])
    for (const child of parent.children) {
      expect(child.run_type).toBe('tool')
      expect(child.ended).toBe(true)
    }

    const verify = parent.children[0]
    expect(verify.metadata['nvm.plan_ids']).toEqual(['plan-123'])
    expect(verify.metadata['nvm.payer']).toBe('0x1234567890abcdef')
    expect(verify.metadata['nvm.agent_request_id']).toBe('req-123')
    // Abbreviated token only — never the raw credential.
    expect(verify.metadata['nvm.payment_token']).toBe(`${'j'.repeat(16)}…jjjj`)
    expect(JSON.stringify(verify.metadata)).not.toContain(LONG_TOKEN)

    const settle = parent.children[1]
    expect(settle.metadata['nvm.tx_hash']).toBe('0xabc123')
    expect(settle.metadata['nvm.credits_redeemed']).toBe('1')
    expect(settle.metadata['nvm.balance.after']).toBe('99')
  })

  it('strips the full payment_token from the parent run tree before verifying', async () => {
    const parent = new FakeRunTree({ name: 'tool' })
    // LangChain would have copied configurable.payment_token onto the parent.
    parent.metadata = { payment_token: LONG_TOKEN }
    setActiveRun(parent)
    const fn = protectedFn(makeMockPayments())

    await fn({ topic: 'x' }, { configurable: { payment_token: LONG_TOKEN } })

    expect('payment_token' in parent.metadata).toBe(false)
    // The parent still gets the abbreviated nvm.payment_token for correlation.
    expect(parent.metadata['nvm.payment_token']).toBe(`${'j'.repeat(16)}…jjjj`)
    expect(JSON.stringify(parent.metadata)).not.toContain(LONG_TOKEN)
  })

  it('opens a verify span even for an unpaid probe (no token)', async () => {
    const parent = new FakeRunTree({ name: 'tool' })
    setActiveRun(parent)
    const mockPayments = makeMockPayments()
    const fn = protectedFn(mockPayments)

    await expect(fn({ topic: 'x' }, { configurable: {} })).rejects.toThrow(/Payment required/)

    expect(parent.children.map((c) => c.name)).toEqual(['nvm:verify'])
    expect(parent.children[0].metadata['nvm.plan_ids']).toEqual(['plan-123'])
    expect(parent.children[0].ended).toBe(true)
    expect(mockPayments.facilitator.verifyPermissions).not.toHaveBeenCalled()
  })

  it('no-ops (and still settles) when no LangSmith run is active', async () => {
    setActiveRun(undefined)
    const mockPayments = makeMockPayments()
    const fn = protectedFn(mockPayments)

    const result = await fn({ topic: 'evs' }, { configurable: { payment_token: LONG_TOKEN } })

    expect(result).toBe('insight evs')
    expect(mockPayments.facilitator.verifyPermissions).toHaveBeenCalledTimes(1)
    expect(mockPayments.facilitator.settlePermissions).toHaveBeenCalledTimes(1)
  })

  it('warns once (not per build) for a misconfigured short token', async () => {
    // The decorator pre-abbreviates the token ONCE (mirrors Python's
    // attach_metadata_safely), so a short token warns a single time even though
    // the verify + settle builders both surface nvm.payment_token.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const parent = new FakeRunTree({ name: 'tool' })
    setActiveRun(parent)
    const fn = protectedFn(makeMockPayments())

    await fn({ topic: 'x' }, { configurable: { payment_token: 'short-token' } })

    const shortWarns = warn.mock.calls.filter((c) =>
      String(c[0]).includes('20 characters or fewer'),
    )
    expect(shortWarns).toHaveLength(1)
    // And the redacted form (never the raw value) reached the spans.
    expect(parent.children[0].metadata['nvm.payment_token']).toBe('shor…(short)')
    expect(JSON.stringify(parent.children[1].metadata)).not.toContain('short-token')
  })

  it('ends the verify span with invalidReason and skips settlement on isValid=false', async () => {
    const parent = new FakeRunTree({ name: 'tool' })
    setActiveRun(parent)
    const mockPayments = makeMockPayments()
    mockPayments.facilitator.verifyPermissions.mockResolvedValue({
      isValid: false,
      invalidReason: 'Insufficient credits',
    })
    const fn = protectedFn(mockPayments)

    await expect(
      fn({ topic: 'x' }, { configurable: { payment_token: LONG_TOKEN } }),
    ).rejects.toThrow(/Insufficient credits/)

    // Only the verify span opened; it closed WITH the invalid reason; no settle.
    expect(parent.children.map((c) => c.name)).toEqual(['nvm:verify'])
    expect(parent.children[0].ended).toBe(true)
    expect(parent.children[0].endError).toBe('Insufficient credits')
    expect(mockPayments.facilitator.settlePermissions).not.toHaveBeenCalled()
  })

  it('ends the verify span and skips settlement when verifyPermissions throws', async () => {
    const parent = new FakeRunTree({ name: 'tool' })
    setActiveRun(parent)
    const mockPayments = makeMockPayments()
    mockPayments.facilitator.verifyPermissions.mockRejectedValue(new Error('network timeout'))
    const fn = protectedFn(mockPayments)

    await expect(
      fn({ topic: 'x' }, { configurable: { payment_token: LONG_TOKEN } }),
    ).rejects.toThrow(/network timeout/)

    expect(parent.children.map((c) => c.name)).toEqual(['nvm:verify'])
    expect(parent.children[0].ended).toBe(true)
    expect(parent.children[0].endError).toBe('network timeout')
    expect(mockPayments.facilitator.settlePermissions).not.toHaveBeenCalled()
  })

  it('persists only the ABBREVIATED token in config.configurable.payment_context (never the raw credential)', async () => {
    const parent = new FakeRunTree({ name: 'tool' })
    setActiveRun(parent)
    // Hold a reference to the same configurable bag the decorator mutates, so we
    // can read payment_context back after invocation.
    const config: { configurable: Record<string, unknown> } = {
      configurable: { payment_token: LONG_TOKEN },
    }
    const fn = protectedFn(makeMockPayments())

    await fn({ topic: 'evs' }, config)

    const ctx = config.configurable.payment_context as { token: string }
    expect(ctx).toBeDefined()
    // The stored token is the abbreviated reference, not the raw credential —
    // so LangChain capturing config.configurable into a nested span can't leak
    // the full token (the gap aaitor flagged on the nested payment_context.token).
    expect(ctx.token).toBe(`${'j'.repeat(16)}…jjjj`)
    expect(JSON.stringify(config.configurable.payment_context)).not.toContain(LONG_TOKEN)
  })

  it('ends the settlement span WITH the error (and still returns) when settle throws', async () => {
    const parent = new FakeRunTree({ name: 'tool' })
    setActiveRun(parent)
    const mockPayments = makeMockPayments()
    mockPayments.facilitator.settlePermissions.mockRejectedValue(new Error('settle boom'))
    // settlement failure is swallowed — the tool result still comes back.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const fn = protectedFn(mockPayments)

    const result = await fn({ topic: 'evs' }, { configurable: { payment_token: LONG_TOKEN } })

    expect(result).toBe('insight evs')
    // Both spans opened; the settlement span closed WITH the settle error.
    expect(parent.children.map((c) => c.name)).toEqual(['nvm:verify', 'nvm:settlement'])
    expect(parent.children[1].ended).toBe(true)
    expect(parent.children[1].endError).toBe('settle boom')
    // And the stale-receipt guard holds: a failed settle leaves no receipt.
    expect(lastSettlement()).toBeUndefined()
    errSpy.mockRestore()
  })
})
