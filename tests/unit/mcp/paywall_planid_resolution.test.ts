/**
 * `McpConfig.planId` is OPTIONAL, because a planId only has to be resolvable by
 * the time a handler runs — and a per-tool `options.planId` satisfies that with
 * no server-level one.
 *
 * Three surfaces used to disagree about this. `PaywallDecorator.protect`
 * resolves `options?.planId ?? this.config.planId` and refuses only when BOTH
 * are absent; `withPaywall`'s own docblock documented the per-tool form. Only
 * the TYPE forbade it, which made `configure({ agentId })` a compile error for a
 * server that sets its plan per tool.
 *
 * ⚠️ These are RUNTIME tests on purpose. The type half cannot be asserted here:
 * jest in this repo does not typecheck (see #433/#437 — the test tree is
 * typechecked by nothing), so a `// @ts-expect-error` in this file would prove
 * nothing whether it held or not. `tsc` over `src/` is what pins the signature;
 * these pin the behaviour the signature was contradicting.
 */

import { PaywallDecorator } from '../../../src/mcp/core/paywall.js'
import { buildMcpIntegration } from '../../../src/mcp/index.js'

function makeDecorator() {
  const payments: any = {
    getEnvironmentName: () => 'staging_sandbox',
    facilitator: {
      settlePermissions: jest.fn(async () => ({ success: true, transaction: '', network: '' })),
    },
    agents: { getAgentPlans: jest.fn(async () => ({ plans: [] })) },
  }
  const authenticator: any = {
    authenticate: jest.fn(async () => ({
      token: 'tok-abc',
      agentId: 'agent-9',
      logicalUrl: 'mcp://srv/tools/premium',
      httpUrl: undefined,
      planId: 'plan-from-token',
      subscriberAddress: '0x123',
    })),
  }
  const creditsContext: any = { resolve: jest.fn(() => 5n) }
  return {
    decorator: new PaywallDecorator(payments, authenticator, creditsContext),
    payments,
    authenticator,
  }
}

const handler = async () => ({ content: [{ type: 'text', text: 'ok' }] })

/**
 * ⚠️ There are TWO planId guards, in two files, reading two DIFFERENT config
 * objects — so a test that exercises one proves nothing about the other:
 *
 *  - `withPaywall` (`mcp/index.ts`) fails fast at REGISTRATION time, off the
 *    module-level `extendedConfig` that `configure()` merges into.
 *  - `PaywallDecorator.createWrappedHandler` (`mcp/core/paywall.ts`) fails at
 *    CALL time, off the decorator's own `this.config`.
 *
 * Both are pinned below. The first draft of this file asserted a registration-
 * time throw against `decorator.protect`, which has only the second guard, and
 * failed for that reason rather than for a defect.
 */
describe('planId resolution — decorator (guard fires at CALL time)', () => {
  test('a per-tool planId is enough when no server-level one was ever set', async () => {
    const { decorator } = makeDecorator()
    // The configuration this change unblocks: no planId at all.
    decorator.configure({ agentId: 'agent-9', serverName: 'srv' })

    const wrapped = decorator.protect(handler, {
      kind: 'tool',
      name: 'premium',
      planId: 'plan-per-tool',
    })
    await expect(wrapped({}, {})).resolves.toBeDefined()
  })

  test('…and with NEITHER, the call is refused rather than served unpriced', async () => {
    const { decorator } = makeDecorator()
    decorator.configure({ agentId: 'agent-9', serverName: 'srv' })

    // The negative control. Without it the test above would pass equally well if
    // the guard had been deleted, which is the opposite of the point: making
    // planId optional must not make it skippable.
    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'free' })
    await expect(wrapped({}, {})).rejects.toMatchObject({ message: /missing planId/ })
  })

  test('a later partial configure() does not blank a planId already set', async () => {
    const { decorator } = makeDecorator()
    decorator.configure({ planId: 'plan-server', serverName: 'srv' })
    // `planId: options.planId || this.config.planId` — a configure() that only
    // renames the server must not erase the plan.
    decorator.configure({ serverName: 'renamed' })

    const wrapped = decorator.protect(handler, { kind: 'tool', name: 'premium' })
    await expect(wrapped({}, {})).resolves.toBeDefined()
  })
})

describe('planId resolution — withPaywall (guard fires at REGISTRATION time)', () => {
  function makeIntegration() {
    const payments: any = {
      getEnvironmentName: () => 'staging_sandbox',
      facilitator: { settlePermissions: jest.fn(async () => ({ success: true })) },
      agents: { getAgentPlans: jest.fn(async () => ({ plans: [] })) },
    }
    return buildMcpIntegration(payments)
  }

  test('configure() with NO planId is accepted, and a per-tool planId registers', () => {
    const mcp = makeIntegration()
    // Previously a compile error: McpConfig.planId was required.
    mcp.configure({ agentId: 'agent-9', serverName: 'srv' })

    expect(() =>
      mcp.withPaywall(handler, { kind: 'tool', name: 'premium', planId: 'plan-per-tool' } as any),
    ).not.toThrow()
  })

  test('…and with NEITHER, registration is refused', () => {
    const mcp = makeIntegration()
    mcp.configure({ agentId: 'agent-9', serverName: 'srv' })

    expect(() => mcp.withPaywall(handler, { kind: 'tool', name: 'free' } as any)).toThrow(
      /missing planId/,
    )
  })
})
