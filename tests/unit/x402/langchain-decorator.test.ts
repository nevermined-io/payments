/**
 * Unit tests for the LangChain x402 payment wrapper and helpers.
 *
 * Mirrors the Python suite `tests/unit/x402/test_langchain_decorator.py`
 * (the three core test classes: requiresPayment, lastSettlement,
 * createPaidReactAgent). The LangSmith-span tests from the Python suite are
 * intentionally out of scope here — TS observability spans land with TS-1
 * (nevermined-io/nvm-monorepo#1709).
 *
 * `lastSettlement()` reads a module-level slot, so each test re-imports the
 * langchain module via `jest.resetModules()` + dynamic `import()` to get a
 * fresh holder (the Jest equivalent of the Python autouse reset fixture).
 *
 * `@langchain/langgraph/prebuilt` is mocked with faithful doubles of `ToolNode`
 * and `createReactAgent`: the real LangGraph runtime is an ESM-only dependency
 * tree that Jest cannot load through the helper's dynamic `import()`, and these
 * unit tests assert OUR wiring (that `createPaidReactAgent` builds a `ToolNode`
 * with `handleToolErrors: false` and forwards it as `createReactAgent`'s
 * `tools`), not LangGraph's internals. The real API contract these doubles
 * mirror is exercised against the published package at build time via
 * `agent.ts`'s `typeof import(...)` type references.
 */

// Captures the args createPaidReactAgent passes through to the real LangGraph
// surface so each test can introspect them.
class FakeToolNode {
  tools: readonly unknown[]
  handleToolErrors: boolean
  constructor(tools: readonly unknown[], options?: { handleToolErrors?: boolean }) {
    this.tools = tools
    // Default mirrors LangGraph's real default (true) so the test proves
    // createPaidReactAgent explicitly overrides it to false.
    this.handleToolErrors = options?.handleToolErrors ?? true
  }
}

jest.mock('@langchain/langgraph/prebuilt', () => ({
  ToolNode: FakeToolNode,
  createReactAgent: (params: { llm: unknown; tools: unknown }) => ({
    __params: params,
    invoke: () => undefined,
    // Mirrors the real compiled graph shape: the 'tools' node wraps the
    // ToolNode instance under `.data`.
    getGraph: () => ({ nodes: { tools: { data: params.tools } } }),
  }),
}))

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type {
  SettlePermissionsResult,
  VerifyPermissionsResult,
} from '../../../src/x402/facilitator-api.js'
import type {
  requiresPayment as RequiresPayment,
  lastSettlement as LastSettlement,
  PaymentRequiredError as PaymentRequiredErrorClass,
  createPaidReactAgent as CreatePaidReactAgent,
} from '../../../src/x402/langchain/index.js'

type LangchainModule = {
  requiresPayment: typeof RequiresPayment
  lastSettlement: typeof LastSettlement
  PaymentRequiredError: typeof PaymentRequiredErrorClass
  createPaidReactAgent: typeof CreatePaidReactAgent
}

const VERIFY_OK: VerifyPermissionsResult = {
  isValid: true,
  payer: '0x1234567890abcdef',
  agentRequestId: 'test-request-id-123',
}

const SETTLE_OK: SettlePermissionsResult = {
  success: true,
  payer: '0x1234567890abcdef',
  transaction: '0xabc123',
  network: 'eip155:84532',
  creditsRedeemed: '1',
  remainingBalance: '99',
}

interface MockFacilitator {
  verifyPermissions: jest.Mock
  settlePermissions: jest.Mock
}

/** A Payments-like mock with verify + settle stubbed. */
function makeMockPayments(): { facilitator: MockFacilitator } {
  return {
    facilitator: {
      verifyPermissions: jest.fn().mockResolvedValue({ ...VERIFY_OK }),
      settlePermissions: jest.fn().mockResolvedValue({ ...SETTLE_OK }),
    },
  }
}

/**
 * Re-import the langchain module so each test sees a fresh module-level
 * `lastSettlement` slot. `jest.resetModules()` clears the ESM module cache.
 */
async function freshLangchain(): Promise<LangchainModule> {
  jest.resetModules()
  return (await import('../../../src/x402/langchain/index.js')) as LangchainModule
}

/** Build a minimal `tool` wrapped with `requiresPayment`. */
function makeProtectedTool(
  mod: LangchainModule,
  mockPayments: { facilitator: MockFacilitator },
  credits: number | ((ctx: { args: Record<string, unknown>; result: unknown }) => number) = 1,
) {
  return tool(
    mod.requiresPayment(
      (args: { topic: string }) => `insight for ${args.topic}`,
      // The mock stands in for a real Payments instance.
      { payments: mockPayments as never, planId: 'plan-123', credits },
    ),
    {
      name: 'my_tool',
      description: 'Return a canned string.',
      schema: z.object({ topic: z.string() }),
    },
  )
}

describe('requiresPayment', () => {
  it('throws PaymentRequiredError when no token is provided', async () => {
    const mod = await freshLangchain()
    const mockPayments = makeMockPayments()
    const myTool = makeProtectedTool(mod, mockPayments)

    await expect(
      myTool.invoke({ topic: 'x' }, { configurable: {} }),
    ).rejects.toBeInstanceOf(mod.PaymentRequiredError)

    // Re-invoke to inspect the payload (rejects matcher consumed the first).
    let captured: InstanceType<typeof PaymentRequiredErrorClass> | undefined
    try {
      await myTool.invoke({ topic: 'x' }, { configurable: {} })
    } catch (err) {
      captured = err as InstanceType<typeof PaymentRequiredErrorClass>
    }
    expect(captured?.paymentRequired).toBeDefined()
    expect(captured?.paymentRequired?.accepts).toHaveLength(1)
    expect(captured?.paymentRequired?.accepts[0].planId).toBe('plan-123')

    // We short-circuited before verify/settle.
    expect(mockPayments.facilitator.verifyPermissions).not.toHaveBeenCalled()
    expect(mockPayments.facilitator.settlePermissions).not.toHaveBeenCalled()
  })

  it('verifies and settles on success', async () => {
    const mod = await freshLangchain()
    const mockPayments = makeMockPayments()
    const myTool = makeProtectedTool(mod, mockPayments)

    const result = await myTool.invoke(
      { topic: 'evs' },
      { configurable: { payment_token: 'tok-abc' } },
    )

    expect(result).toBe('insight for evs')
    expect(mockPayments.facilitator.verifyPermissions).toHaveBeenCalledTimes(1)
    expect(mockPayments.facilitator.settlePermissions).toHaveBeenCalledTimes(1)
  })

  it('does not break the result when settlement fails', async () => {
    const mod = await freshLangchain()
    const mockPayments = makeMockPayments()
    mockPayments.facilitator.settlePermissions.mockRejectedValue(new Error('boom'))
    const myTool = makeProtectedTool(mod, mockPayments)

    const result = await myTool.invoke(
      { topic: 'x' },
      { configurable: { payment_token: 'tok' } },
    )

    expect(result).toBe('insight for x')
  })
})

describe('lastSettlement', () => {
  it('returns undefined before any settlement', async () => {
    const mod = await freshLangchain()
    expect(mod.lastSettlement()).toBeUndefined()
  })

  it('returns the latest settlement receipt after a settle', async () => {
    const mod = await freshLangchain()
    const mockPayments = makeMockPayments()
    const myTool = makeProtectedTool(mod, mockPayments)

    await myTool.invoke({ topic: 'x' }, { configurable: { payment_token: 'tok' } })

    const receipt = mod.lastSettlement()
    expect(receipt).toBeDefined()
    expect(receipt?.creditsRedeemed).toBe('1')
    expect(receipt?.remainingBalance).toBe('99')
    expect(receipt?.transaction).toBe('0xabc123')
  })

  it('is overwritten by a subsequent settlement (last-writer-wins)', async () => {
    const mod = await freshLangchain()
    const mockPayments = makeMockPayments()
    const myTool = makeProtectedTool(mod, mockPayments)

    await myTool.invoke({ topic: 'a' }, { configurable: { payment_token: 'tok' } })
    expect(mod.lastSettlement()?.creditsRedeemed).toBe('1')

    mockPayments.facilitator.settlePermissions.mockResolvedValue({
      success: true,
      payer: '0x1234567890abcdef',
      transaction: '0xdef456',
      network: 'eip155:84532',
      creditsRedeemed: '2',
      remainingBalance: '97',
    } satisfies SettlePermissionsResult)

    await myTool.invoke({ topic: 'b' }, { configurable: { payment_token: 'tok' } })

    const second = mod.lastSettlement()
    expect(second?.creditsRedeemed).toBe('2')
    expect(second?.transaction).toBe('0xdef456')
  })

  it('stays undefined when no token is provided', async () => {
    const mod = await freshLangchain()
    const mockPayments = makeMockPayments()
    const myTool = makeProtectedTool(mod, mockPayments)

    await expect(
      myTool.invoke({ topic: 'x' }, { configurable: {} }),
    ).rejects.toBeInstanceOf(mod.PaymentRequiredError)

    expect(mod.lastSettlement()).toBeUndefined()
  })
})

describe('createPaidReactAgent', () => {
  /** A stub chat model that satisfies createReactAgent without being invoked. */
  function stubModel() {
    const model = {
      bindTools() {
        return this
      },
      lc_namespace: ['test'],
    }
    return model
  }

  it('returns an invokable graph', async () => {
    const mod = await freshLangchain()
    const mockPayments = makeMockPayments()
    const myTool = makeProtectedTool(mod, mockPayments)

    const agent = (await mod.createPaidReactAgent(stubModel(), [myTool])) as {
      invoke: unknown
    }

    expect(typeof agent.invoke).toBe('function')
  })

  it('builds the ToolNode with handleToolErrors disabled', async () => {
    const mod = await freshLangchain()
    const mockPayments = makeMockPayments()
    const myTool = makeProtectedTool(mod, mockPayments)
    const model = stubModel()

    const agent = (await mod.createPaidReactAgent(model, [myTool])) as {
      __params: { llm: unknown; tools: unknown }
      getGraph: () => { nodes: Record<string, { data?: unknown }> }
    }

    // The model is forwarded as createReactAgent's `llm` argument (the JS API
    // is keyword-based; the helper maps the positional `model` to `llm`).
    expect(agent.__params.llm).toBe(model)

    // The compiled graph exposes its inner nodes; the 'tools' node wraps the
    // ToolNode under `.data`. The helper must build it with handleToolErrors
    // disabled so PaymentRequiredError propagates with its payload intact.
    const toolsNode = agent.getGraph().nodes['tools']
    const underlying = (toolsNode?.data ?? toolsNode) as { handleToolErrors?: boolean }
    expect(underlying.handleToolErrors).toBe(false)
  })
})
