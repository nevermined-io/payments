/**
 * Integration tests for PaymentsA2AServer (Express app).
 */

import request from 'supertest'
import { PaymentsA2AServer } from '../../../src/a2a/server.js'
import type { AgentCard } from '../../../src/a2a/types.js'
import type { Payments } from '../../../src/payments.js'
import type { AgentExecutor } from '../../../src/a2a/types.js'

function createNoopExecutor(): AgentExecutor {
  return {
    execute: async (_requestContext, eventBus) => {
      eventBus.finished()
    },
    cancelTask: async () => {},
  }
}

describe('PaymentsA2AServer', () => {
  let agentCard: AgentCard
  let dummyPayments: any
  let servers: Array<{ close: () => Promise<void> }> = []

  beforeEach(() => {
    agentCard = {
      name: 'PyAgent',
      capabilities: {
        extensions: [
          {
            uri: 'urn:nevermined:payment',
            params: {
              agentId: 'agent-1',
              paymentType: 'fixed',
              credits: 1,
            },
          },
        ],
      },
    } as AgentCard

    dummyPayments = {
      requests: {
        startProcessingRequest: jest.fn().mockResolvedValue({
          agentRequestId: 'REQ',
          balance: {
            isSubscriber: true,
            balance: 100,
            creditsContract: '0x1234567890abcdef',
            pricePerCredit: 0.01,
          },
        }),
        redeemCreditsFromRequest: jest.fn().mockResolvedValue({}),
      },
    }
  })

  afterEach(async () => {
    // Close all servers created during tests
    for (const server of servers) {
      await server.close()
    }
    servers = []
  })

  test.each(['/', '/a2a'])(
    'should expose agent card endpoint at base path: %s',
    async (basePath) => {
      const result = PaymentsA2AServer.start({
        agentCard,
        executor: createNoopExecutor(),
        paymentsService: dummyPayments as any as Payments,
        port: 0, // Not used when using supertest
        basePath,
        exposeAgentCard: true,
        exposeDefaultRoutes: false,
      })

      servers.push({ close: result.close })
      const client = request(result.app)
      const url =
        basePath !== '/' ? `${basePath}/.well-known/agent.json` : '/.well-known/agent.json'

      const response = await client.get(url)

      expect(response.status).toBe(200)
      expect(response.body.name).toBe('PyAgent')
    },
    15000,
  )

  test('should invoke hooks when processing requests', async () => {
    const flag = { before: false, after: false, error: false }

    const hooks = {
      beforeRequest: jest.fn().mockImplementation(async () => {
        flag.before = true
      }),
      afterRequest: jest.fn().mockImplementation(async () => {
        flag.after = true
      }),
      onError: jest.fn().mockImplementation(async () => {
        flag.error = true
      }),
    }

    const result = PaymentsA2AServer.start({
      agentCard,
      executor: createNoopExecutor(),
      paymentsService: dummyPayments as any as Payments,
      port: 0, // Not used when using supertest
      basePath: '/rpc',
      hooks,
      exposeDefaultRoutes: true,
    })

    servers.push({ close: result.close })
    const client = request(result.app)
    const payload = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-msg-123',
          contextId: 'test-ctx-123',
          role: 'user',
          parts: [{ kind: 'text', text: 'Hello' }],
        },
      },
      id: 1,
    }

    const response = await client.post('/rpc').set('Authorization', 'Bearer TOKEN').send(payload)

    // At least one hook should have been triggered
    expect(flag.before || flag.after || flag.error).toBe(true)
  }, 15000)
})
