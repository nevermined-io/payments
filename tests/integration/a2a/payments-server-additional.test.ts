/**
 * Additional integration tests focusing on middleware responses.
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

describe('PaymentsA2AServer Middleware', () => {
  let agentCard: AgentCard
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
    } as unknown as AgentCard
  })

  afterEach(async () => {
    // Close all servers created during tests
    for (const server of servers) {
      await server.close()
    }
    servers = []
  })

  function createServer(verifyPermissions?: any): {
    app: any
    handler: any
    client: ReturnType<typeof request>
    paymentsStub: any
    close: () => Promise<void>
  } {
    const paymentsStub = {
      facilitator: {
        verifyPermissions:
          verifyPermissions ||
          jest.fn().mockResolvedValue({
            isValid: true,
            agentRequestId: 'REQ',
            payer: '0x1234567890abcdef',
          }),
        settlePermissions: jest.fn().mockResolvedValue({
          success: true,
          transaction: '0xabcdef1234567890',
          network: 'eip155:84532',
          creditsRedeemed: '1',
        }),
      },
    }

    const result = PaymentsA2AServer.start({
      agentCard,
      executor: createNoopExecutor(),
      paymentsService: paymentsStub as any as Payments,
      port: 0, // Not used when using supertest
      basePath: '/rpc',
      exposeDefaultRoutes: true,
    })

    const client = request(result.app)

    return { app: result.app, handler: result.handler, client, paymentsStub, close: result.close }
  }

  test('should return 401 when bearer token is missing', async () => {
    const { client, close } = createServer()
    servers.push({ close })
    const payload = { jsonrpc: '2.0', method: 'ping', id: 1 }

    const response = await client.post('/rpc').send(payload)

    expect(response.status).toBe(401)
  }, 15000)

  test('should return 402 when validation fails', async () => {
    const failValidation = jest.fn().mockResolvedValue({
      isValid: false,
      invalidReason: 'validation failed',
    })
    const { client, close } = createServer(failValidation)
    servers.push({ close })

    const payload = { jsonrpc: '2.0', method: 'ping', id: 1 }

    const response = await client.post('/rpc').set('Authorization', 'Bearer TOK').send(payload)

    expect(response.status).toBe(402)
    expect(response.body.error.message).toMatch(/Payment validation failed/i)
  }, 15000)
})
