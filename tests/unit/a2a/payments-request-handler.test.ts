/**
 * Unit tests for PaymentsRequestHandler.
 */

import type { AgentCard, TaskStatusUpdateEvent } from '@a2a-js/sdk'
import { PaymentsRequestHandler } from '../../../src/a2a/paymentsRequestHandler.js'
import type { HttpRequestContext } from '../../../src/a2a/types.js'
import type { Payments } from '../../../src/payments.js'

jest.mock('@a2a-js/sdk/server')

jest.mock('../../../src/utils.js', () => ({
  decodeAccessToken: jest.fn(() => ({
    x402Version: 2,
    accepted: {
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      planId: 'plan-1',
      extra: { version: '1' },
    },
    payload: {
      signature: '0x123',
      authorization: {
        from: '0xsub',
        sessionKeysProvider: 'zerodev',
        sessionKeys: [],
      },
    },
    extensions: {},
  })),
}))

class DummyExecutor {
  async execute(...args: any[]): Promise<any> {
    // Dummy implementation
  }

  async cancelTask(...args: any[]): Promise<void> {
    // Dummy implementation
  }
}

describe('PaymentsRequestHandler', () => {
  let mockPayments: any
  let mockTaskStore: any
  let mockAgentCard: AgentCard

  beforeEach(() => {
    jest.clearAllMocks()

    mockPayments = {
      getEnvironmentName: jest.fn().mockReturnValue('sandbox'),
      facilitator: {
        settlePermissions: jest
          .fn()
          .mockResolvedValue({ success: true, transaction: '0xabc', network: 'eip155:84532' }),
      },
    }

    mockTaskStore = {
      save: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(undefined),
    }

    mockAgentCard = {
      capabilities: {
        extensions: [
          {
            uri: 'urn:nevermined:payment',
            params: {
              agentId: 'test-agent',
              planId: 'plan-1',
            },
          },
        ],
      },
    } as any as AgentCard
  })

  describe('handleTaskFinalization', () => {
    test('should burn credits when event has creditsUsed', async () => {
      // The settle response as the facilitator really returns it: the transaction
      // id is `transaction`, and there is no `txHash` or `amountOfCredits` on the
      // wire (#438). `creditsRedeemed` is deliberately 3 against a requested burn
      // of 5 so the `creditsCharged` assertion below distinguishes the credits
      // this request ASKED to burn from the credits the settle actually redeemed.
      const settleMock = jest.fn().mockResolvedValue({
        success: true,
        transaction: '0xabc',
        network: 'eip155:84532',
        billingModel: 'credits',
        creditsRedeemed: '3',
      })
      mockPayments.facilitator.settlePermissions = settleMock

      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

        ; (handler as any).getAgentCard = jest.fn().mockResolvedValue(mockAgentCard)

        // Mock getRedemptionConfig to return non-batch config
        ; (handler as any).getRedemptionConfig = jest.fn().mockResolvedValue({
          useBatch: false,
          useMargin: false,
        })

      // Mock resultManager
      const taskRef = { id: 'tid', metadata: {} as any }
      const mockResultManager = {
        getCurrentTask: jest.fn().mockReturnValue(taskRef),
        processEvent: jest.fn().mockResolvedValue(undefined),
      }

      const event: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 'tid',
        contextId: 'ctx-123',
        status: { state: 'completed' },
        final: true,
        metadata: { creditsUsed: 5 },
      } as TaskStatusUpdateEvent

      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      await handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN')

      expect(settleMock).toHaveBeenCalledTimes(1)
      expect(settleMock).toHaveBeenCalledWith({
        paymentRequired: {
          x402Version: 2,
          resource: { url: '' },
          accepts: [{
            scheme: 'nvm:erc4337',
            network: 'eip155:84532',
            planId: 'plan-1',
            extra: { version: '1', agentId: 'test-agent' },
          }],
          extensions: {},
        },
        x402AccessToken: 'BEARER_TOKEN',
        maxAmount: 5n,
      })
      // `txHash` is the A2A metadata key, sourced from the wire's `transaction`;
      // `creditsCharged` reports what was REDEEMED (3), not what was requested (5).
      expect(event.metadata?.txHash).toBe('0xabc')
      expect(event.metadata?.creditsCharged).toBe(3)
      expect(taskRef.metadata?.txHash).toBe('0xabc')
      expect(taskRef.metadata?.creditsCharged).toBe(3)
      expect(mockResultManager.processEvent).toHaveBeenCalledWith(taskRef)
    })

    test('should not burn credits when event has no creditsUsed', async () => {
      const settleMock = jest
        .fn()
        .mockResolvedValue({ success: true, transaction: '0xabc', network: 'eip155:84532' })
      mockPayments.facilitator.settlePermissions = settleMock

      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      const mockResultManager = {
        getCurrentTask: jest.fn().mockReturnValue({ id: 'tid', metadata: {} }),
        processEvent: jest.fn().mockResolvedValue(undefined),
      }

      const event: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 'tid',
        contextId: 'ctx-123',
        status: { state: 'completed' },
        final: true,
        metadata: {}, // No creditsUsed
      } as TaskStatusUpdateEvent

      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      await handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN')

      expect(settleMock).not.toHaveBeenCalled()
    })

    test('should not burn credits when event has no metadata', async () => {
      const settleMock = jest
        .fn()
        .mockResolvedValue({ success: true, transaction: '0xabc', network: 'eip155:84532' })
      mockPayments.facilitator.settlePermissions = settleMock

      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      const mockResultManager = {
        getCurrentTask: jest.fn().mockReturnValue({ id: 'tid', metadata: {} }),
        processEvent: jest.fn().mockResolvedValue(undefined),
      }

      const event: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 'tid',
        contextId: 'ctx-123',
        status: { state: 'completed' },
        final: true,
        metadata: {}, // No metadata
      } as TaskStatusUpdateEvent

      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      await handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN')

      expect(settleMock).not.toHaveBeenCalled()
    })

    test('should swallow errors when redemption fails', async () => {
      const settleMock = jest.fn().mockRejectedValue(new Error('Redeem failed'))
      mockPayments.facilitator.settlePermissions = settleMock

      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

        ; (handler as any).getAgentCard = jest.fn().mockResolvedValue(mockAgentCard)

        // Mock getRedemptionConfig to return non-batch config
        ; (handler as any).getRedemptionConfig = jest.fn().mockResolvedValue({
          useBatch: false,
          useMargin: false,
        })

      const mockResultManager = {
        getCurrentTask: jest.fn().mockReturnValue({ id: 'tid', metadata: {} }),
        processEvent: jest.fn().mockResolvedValue(undefined),
      }

      const event: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 'tid',
        contextId: 'ctx-123',
        status: { state: 'completed' },
        final: true,
        metadata: { creditsUsed: 5 },
      } as TaskStatusUpdateEvent

      const handleTaskFinalization = (handler as any).handleTaskFinalization.bind(handler)
      // Should not throw
      await expect(
        handleTaskFinalization(mockResultManager, event, 'BEARER_TOKEN'),
      ).resolves.not.toThrow()

      expect(settleMock).toHaveBeenCalledTimes(1)
      expect(settleMock).toHaveBeenCalledWith({
        paymentRequired: {
          x402Version: 2,
          resource: { url: '' },
          accepts: [{
            scheme: 'nvm:erc4337',
            network: 'eip155:84532',
            planId: 'plan-1',
            extra: { version: '1', agentId: 'test-agent' },
          }],
          extensions: {},
        },
        x402AccessToken: 'BEARER_TOKEN',
        maxAmount: 5n,
      })
    })
  })

  describe('HTTP context management', () => {
    test('should set and get HTTP context for task', () => {
      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      const ctx: HttpRequestContext = {
        bearerToken: 'BEARER',
        urlRequested: 'https://x',
        httpMethodRequested: 'POST',
        validation: { agentRequestId: 'agentReq' } as any,
      }

      handler.setHttpRequestContextForTask('tid', ctx)
      const retrieved = (handler as any).getHttpRequestContextForTask('tid')
      expect(retrieved).toBe(ctx)
    })

    test('should set and get HTTP context for message', () => {
      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      const ctx: HttpRequestContext = {
        bearerToken: 'BEARER',
        urlRequested: 'https://x',
        httpMethodRequested: 'POST',
        validation: { agentRequestId: 'agentReq' } as any,
      }

      handler.setHttpRequestContextForMessage('mid', ctx)
      const retrieved = (handler as any).getHttpRequestContextForMessage('mid')
      expect(retrieved).toBe(ctx)
    })

    test('should delete HTTP context for task', () => {
      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

      const ctx: HttpRequestContext = {
        bearerToken: 'BEARER',
        urlRequested: 'https://x',
        httpMethodRequested: 'POST',
        validation: { agentRequestId: 'agentReq' } as any,
      }

      handler.setHttpRequestContextForTask('tid', ctx)
      handler.deleteHttpRequestContextForTask('tid')
      const retrieved = (handler as any).getHttpRequestContextForTask('tid')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('agent card validation', () => {
    test('should return default config when payment extension is missing', async () => {
      const agentCardWithoutPayment: AgentCard = {
        capabilities: {
          extensions: [],
        },
      } as any as AgentCard

      const handler = new PaymentsRequestHandler(
        agentCardWithoutPayment,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )

        // Mock getAgentCard to return card without payment extension
        ; (handler as any).getAgentCard = jest.fn().mockResolvedValue(agentCardWithoutPayment)

      // Try to get redemption config - should return default config
      const config = await (handler as any).getRedemptionConfig()
      expect(config).toEqual({
        useBatch: false,
        useMargin: false,
        marginPercent: undefined,
      })
    })
  })
  /**
   * `creditsCharged` reports the credits the settle ACTUALLY REDEEMED, read per
   * billing model (#438, contract published in #432).
   *
   * The three cases below are the three readings of `creditsRedeemed` and they
   * are not interchangeable. On `pay-as-you-go` the field is the string '0' even
   * on a settle that charged the buyer, so reporting it flat would tell a buyer
   * they paid nothing for a payment that really happened — and '0' is truthy
   * while Number('0') > 0 is false, so a truthiness guard and a numeric one
   * disagree on exactly that value.
   *
   * Both call sites implement this rule (handleTaskFinalization for a plain
   * response, processStreamingEventsWithFinalization for a stream), so both are
   * driven here — a rule proven on one copy proves nothing about the other.
   */
  describe('creditsCharged per billing model (#438)', () => {
    /** A settle response in the shape the facilitator really returns. */
    const settleResponse = (extra: Record<string, unknown>) => ({
      success: true,
      transaction: '0xabc',
      network: 'eip155:84532',
      ...extra,
    })

    /** Builds a handler whose settle returns `settleValue`, plus its fixtures. */
    const buildHandler = (settleValue: Record<string, unknown>) => {
      mockPayments.facilitator.settlePermissions = jest.fn().mockResolvedValue(settleValue)
      const handler = new PaymentsRequestHandler(
        mockAgentCard,
        mockTaskStore,
        new DummyExecutor(),
        mockPayments as any as Payments,
      )
      ;(handler as any).getAgentCard = jest.fn().mockResolvedValue(mockAgentCard)
      ;(handler as any).getRedemptionConfig = jest
        .fn()
        .mockResolvedValue({ useBatch: false, useMargin: false })
      ;(handler as any).getTaskPushNotificationConfig = jest.fn().mockResolvedValue(undefined)

      const taskRef = { id: 'tid', metadata: {} as any }
      const resultManager = {
        getCurrentTask: jest.fn().mockReturnValue(taskRef),
        processEvent: jest.fn().mockResolvedValue(undefined),
      }
      // A requested burn of 5, so any assertion of 5 would be reading the
      // REQUESTED figure rather than the settled one.
      const event = {
        kind: 'status-update',
        taskId: 'tid',
        contextId: 'ctx-123',
        status: { state: 'completed' },
        final: true,
        metadata: { creditsUsed: 5 },
      } as TaskStatusUpdateEvent

      return { handler, taskRef, resultManager, event }
    }

    /** Drives the non-streaming call site. */
    const finalize = async (settleValue: Record<string, unknown>) => {
      const { handler, taskRef, resultManager, event } = buildHandler(settleValue)
      await (handler as any).handleTaskFinalization(resultManager, event, 'BEARER_TOKEN')
      return { event, taskRef }
    }

    /**
     * Drives the streaming call site by feeding the generator one final event.
     * Covered from this file rather than payments-request-handler-stream.test.ts
     * to stay clear of PR #437, which is editing that file.
     */
    const finalizeStreaming = async (settleValue: Record<string, unknown>) => {
      const { handler, taskRef, resultManager, event } = buildHandler(settleValue)
      const eventQueue = {
        events: async function* () {
          yield event
        },
      }
      const stream = (handler as any).processStreamingEventsWithFinalization(
        'tid',
        resultManager,
        eventQueue,
        'BEARER_TOKEN',
      )
      for await (const _ of stream) {
        // drain
      }
      return { event, taskRef }
    }

    /**
     * #439 review — the guard used to be a DENYLIST (`=== 'pay-as-you-go'`), so
     * every other value fell into the credits branch and published a `0`
     * meaning "you were charged nothing". The response is an unchecked
     * `as SettlePermissionsResult` over `response.json()`, so the union type
     * gives no runtime protection and each of these is reachable on the wire.
     *
     * `undefined` is deliberately NOT in this list — a missing discriminator
     * still means `credits`, which is the documented ruling and is pinned by
     * its own test below.
     */
    test.each([
      ['null', null],
      ['empty string', ''],
      ['wrong case', 'PAY-AS-YOU-GO'],
      ['camelCase', 'payAsYouGo'],
      ['padded', ' pay-as-you-go '],
      ['a third billing model', 'subscription'],
      ['a non-string', 0],
    ])(
      'a billingModel that is present but not `credits` (%s) omits rather than publishing 0',
      async (_label, billingModel) => {
        const { event, taskRef } = await finalize(
          settleResponse({ billingModel, creditsRedeemed: '0', orderTx: 'pi_x' }),
        )
        expect(event.metadata).not.toHaveProperty('creditsCharged')
        expect(taskRef.metadata).not.toHaveProperty('creditsCharged')
      },
    )

    /**
     * #439 review — `Number()` maps the empty-ish family to **0**, not `NaN`,
     * so `Number.isFinite` waves them through. Each of these used to publish
     * `creditsCharged: 0` on a credits plan. `'-5'`, `'0x10'` and `'1e3'` are
     * the same class: accepted by `Number()`, forbidden by the decimal-string
     * contract the wire actually promises.
     */
    test.each([
      ['empty string', ''],
      ['whitespace', '   '],
      ['null', null],
      ['an array', []],
      ['false', false],
      ['true', true],
      ['a negative', '-5'],
      ['hex', '0x10'],
      ['exponent', '1e3'],
      ['a fraction', '1.5'],
    ])('an unusable creditsRedeemed (%s) omits rather than coercing', async (_label, redeemed) => {
      const { event, taskRef } = await finalize(
        settleResponse({ billingModel: 'credits', creditsRedeemed: redeemed }),
      )
      expect(event.metadata).not.toHaveProperty('creditsCharged')
      expect(taskRef.metadata).not.toHaveProperty('creditsCharged')
    })

    /**
     * #439 review — the wire carries this as a string precisely because it can
     * exceed what a JS number represents. `Number('9007199254740993')` is
     * 9007199254740992: silently off by one. A wrong number is worse than none,
     * and the exact value survives verbatim in the `x402.payment.receipts`
     * entry, so omitting loses nothing.
     */
    test('a creditsRedeemed above MAX_SAFE_INTEGER omits rather than publishing a rounded figure', async () => {
      const { event } = await finalize(
        settleResponse({ billingModel: 'credits', creditsRedeemed: '9007199254740993' }),
      )
      expect(event.metadata).not.toHaveProperty('creditsCharged')
    })

    /**
     * The negative control for all three groups above. Making the guard stricter
     * must not make it refuse the ordinary case — without this, deleting the
     * whole helper body and returning `undefined` would pass every test here.
     */
    /**
     * #439 review — `resolveCreditsCharged` read only `billingModel` and
     * `creditsRedeemed`, never `success`. `settlePermissions` does NOT throw on
     * a settle the backend accepted but could not complete — it returns 200 with
     * `success: false` verbatim — so a FAILED settle published `creditsCharged`
     * as though it were a measured redemption. With `creditsRedeemed: '7'` it
     * reported 7 credits charged for a settle that charged nothing.
     *
     * That is a lie rather than noise, because the published contract defines
     * `0` as "a real figure, not an absence": any number here asserts the settle
     * completed.
     */
    test.each([
      ['a failed settle reporting 0', '0'],
      ['a failed settle reporting a non-zero figure', '7'],
    ])('%s publishes nothing', async (_label, redeemed) => {
      const { event, taskRef } = await finalize(
        settleResponse({ success: false, billingModel: 'credits', creditsRedeemed: redeemed }),
      )
      expect(event.metadata).not.toHaveProperty('creditsCharged')
      expect(taskRef.metadata).not.toHaveProperty('creditsCharged')
    })

    /**
     * `!== true`, not `=== false`. An absent `billingModel` is a documented
     * legacy shape read as `credits`; an absent `success` is not — the field has
     * always been there and is declared non-optional, so its absence means a
     * malformed response, which is exactly when not to publish a figure.
     */
    test('a settle with no success field at all publishes nothing', async () => {
      const { event } = await finalize({
        transaction: '0xabc',
        network: 'eip155:84532',
        billingModel: 'credits',
        creditsRedeemed: '7',
      } as any)
      expect(event.metadata).not.toHaveProperty('creditsCharged')
    })

    test('an ordinary decimal string is still published', async () => {
      const { event } = await finalize(
        settleResponse({ billingModel: 'credits', creditsRedeemed: '42' }),
      )
      expect(event.metadata?.creditsCharged).toBe(42)
    })

    test('credits plan reports what was redeemed, not what was requested', async () => {
      const { event, taskRef } = await finalize(
        settleResponse({ billingModel: 'credits', creditsRedeemed: '3' }),
      )
      expect(event.metadata?.creditsCharged).toBe(3)
      expect(taskRef.metadata?.creditsCharged).toBe(3)
      // The requested burn is not lost — it stays on the event as `creditsUsed`.
      expect(event.metadata?.creditsUsed).toBe(5)
    })

    test('credits plan, streaming path, reports the redeemed figure too', async () => {
      const { event } = await finalizeStreaming(
        settleResponse({ billingModel: 'credits', creditsRedeemed: '3' }),
      )
      expect(event.metadata?.creditsCharged).toBe(3)
      expect(event.metadata?.txHash).toBe('0xabc')
    })

    test('pay-as-you-go omits creditsCharged on a SUCCESSFUL charge', async () => {
      // No credit balance exists, so `creditsRedeemed` is '0' even though the
      // buyer WAS charged — the charge is referenced by `orderTx`.
      const { event, taskRef } = await finalize(
        settleResponse({
          billingModel: 'pay-as-you-go',
          creditsRedeemed: '0',
          orderTx: 'pi_3TUrvfBYvSRKcV420xCBjHb1',
        }),
      )
      expect(event.metadata).not.toHaveProperty('creditsCharged')
      expect(taskRef.metadata).not.toHaveProperty('creditsCharged')
      // Specifically NOT the meaningless 0, and specifically NOT the requested
      // burn dressed up as a settled figure.
      expect(event.metadata?.creditsCharged).toBeUndefined()
      expect(event.metadata?.creditsUsed).toBe(5)
      // The settle still succeeded and is still referenced.
      expect(event.metadata?.txHash).toBe('0xabc')
    })

    test('pay-as-you-go omits creditsCharged on the streaming path too', async () => {
      const { event } = await finalizeStreaming(
        settleResponse({
          billingModel: 'pay-as-you-go',
          creditsRedeemed: '0',
          orderTx: 'pi_3TUrvfBYvSRKcV420xCBjHb1',
        }),
      )
      expect(event.metadata).not.toHaveProperty('creditsCharged')
      expect(event.metadata?.txHash).toBe('0xabc')
    })

    test('an absent billingModel is read as credits, never as pay-as-you-go', async () => {
      // A Nevermined API older than the discriminator: `creditsRedeemed` has been
      // on the settle response since 2026-03-25, `billingModel` only since
      // 2026-08-06. Reading the missing discriminator as pay-as-you-go would drop
      // a figure that is present and correct.
      const { event } = await finalize(settleResponse({ creditsRedeemed: '3' }))
      expect(event.metadata?.creditsCharged).toBe(3)
    })

    test('a credits plan that redeemed nothing reports 0, not "not applicable"', async () => {
      // Zero redemption on a credits plan is a FIGURE, not an absence: "zero
      // credits came out of your balance" is a different claim from a
      // pay-as-you-go plan's "credits do not apply here". Only the billing model
      // decides which one is reported — never the value — so a `redeemed > 0`
      // style check (the shape SettlePermissionsResult uses to answer the
      // different question "was this settled?") must not creep in here.
      const { event } = await finalize(
        settleResponse({ billingModel: 'credits', creditsRedeemed: '0' }),
      )
      expect(event.metadata).toHaveProperty('creditsCharged')
      expect(event.metadata?.creditsCharged).toBe(0)
    })

    test('an unparseable creditsRedeemed is omitted, never published as NaN', async () => {
      // NaN would survive into A2A metadata and JSON.stringify to `null`, which
      // is a claim about the charge rather than an admission of not knowing.
      const { event } = await finalize(
        settleResponse({ billingModel: 'credits', creditsRedeemed: 'not-a-number' }),
      )
      expect(event.metadata).not.toHaveProperty('creditsCharged')
    })

    test('reports nothing when the backend reports no usable figure', async () => {
      // Older still: no `creditsRedeemed` at all. Nothing is known about what was
      // redeemed, so nothing is claimed — the requested burn is not a substitute.
      const { event } = await finalize(settleResponse({}))
      expect(event.metadata).not.toHaveProperty('creditsCharged')
      expect(event.metadata?.creditsUsed).toBe(5)
    })
  })
})
