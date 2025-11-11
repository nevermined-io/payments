/**
 * Unit test for PaymentsRequestHandler streaming credit burn.
 */

import { PaymentsRequestHandler } from '../../../src/a2a/paymentsRequestHandler.js'
import type { Payments } from '../../../src/payments.js'
import type { HttpRequestContext } from '../../../src/a2a/types.js'
import type { AgentCard, Task } from '@a2a-js/sdk'

jest.mock('@a2a-js/sdk/server')

class DummyExecutor {
  async execute(...args: any[]): Promise<any> {
    // Dummy implementation
  }
}

describe('PaymentsRequestHandler streaming', () => {
  let mockPayments: any
  let mockTaskStore: any
  let mockAgentCard: AgentCard

  beforeEach(() => {
    jest.clearAllMocks()

    mockPayments = {
      requests: {
        redeemCreditsFromRequest: jest.fn().mockResolvedValue({}),
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
            },
          },
        ],
      },
    } as AgentCard
  })

  test('should burn credits when streaming final event with creditsUsed', async () => {
    const redeemMock = jest.fn().mockResolvedValue({})
    mockPayments.requests.redeemCreditsFromRequest = redeemMock

    // Mock task store to return a task
    const testTask: Task = {
      id: 'tid',
      contextId: 'ctx-123',
      status: { state: 'completed' },
    } as Task

    mockTaskStore.get = jest.fn().mockResolvedValue(testTask)

    // Fake stream event generator
    async function* fakeStream() {
      yield {
        kind: 'status-update',
        final: true,
        status: { state: 'completed' },
        metadata: { creditsUsed: 7 },
        taskId: 'tid',
      }
    }

    const handler = new PaymentsRequestHandler(
      mockAgentCard,
      mockTaskStore,
      new DummyExecutor(),
      mockPayments as any as Payments,
    )

    // Mock the parent class's onMessageSendStream method
    ;(handler as any).onMessageSendStream = jest.fn().mockImplementation(() => fakeStream())

    // Mock handleTaskFinalization to actually call redeem
    const originalHandleTaskFinalization = (handler as any).handleTaskFinalization
    ;(handler as any).handleTaskFinalization = jest
      .fn()
      .mockImplementation(
        async (resultManager: any, event: any, bearerToken: string, validation: any) => {
          if (event.metadata?.creditsUsed) {
            await mockPayments.requests.redeemCreditsFromRequest(
              validation.agentRequestId,
              bearerToken,
              BigInt(event.metadata.creditsUsed),
            )
          }
        },
      )

    const ctx: HttpRequestContext = {
      bearerToken: 'TOK',
      urlRequested: 'https://x',
      httpMethodRequested: 'POST',
      validation: { agentRequestId: 'agentReq' },
    }

    handler.setHttpRequestContextForTask('tid', ctx)

    // Mock processEvents to handle the streaming event
    const originalProcessEvents = (handler as any).processEvents
    ;(handler as any).processEvents = jest
      .fn()
      .mockImplementation(
        async (resultManager: any, events: any[], bearerToken: string, validation: any) => {
          for (const event of events) {
            if (event.final && event.metadata?.creditsUsed) {
              await (handler as any).handleTaskFinalization(
                resultManager,
                event,
                bearerToken,
                validation,
              )
            }
          }
        },
      )

    // Consume stream
    const events: any[] = []
    const stream = (handler as any).onMessageSendStream({
      message: { taskId: 'tid', messageId: 'mid' },
    })

    for await (const ev of stream) {
      events.push(ev)
      // Process the event if it's final
      if (ev.final && ev.metadata?.creditsUsed) {
        await (handler as any).handleTaskFinalization(null, ev, ctx.bearerToken, ctx.validation)
      }
    }

    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(redeemMock).toHaveBeenCalledTimes(1)
    expect(redeemMock).toHaveBeenCalledWith('agentReq', 'TOK', 7n)
  })
})
