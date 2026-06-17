/**
 * Integration tests for the x402 v2 A2A in-band payment transport.
 *
 * Exercises the standards-compliant in-band flow (payment signalled through A2A
 * Task / Message `x402.payment.*` metadata) end-to-end over supertest, plus the
 * deprecated `payment-signature` header path as a regression.
 *
 * Mirrors the MCP in-band tests added in commit 3fca195 (PR #384).
 */

import type { Message, Task, TaskState, TaskStatus, TaskStatusUpdateEvent } from '@a2a-js/sdk'
import request from 'supertest'
import { PaymentsA2AServer } from '../../../src/a2a/server.js'
import { buildPaymentAgentCard } from '../../../src/a2a/agent-card.js'
import { X402A2AMetadata, PaymentStatus, x402A2AUtils } from '../../../src/a2a/x402-a2a.js'
import * as utils from '../../../src/utils.js'
import { encodeAccessToken } from '../../../src/utils.js'
import type { AgentCard, ExecutionEventBus, PaymentsAgentExecutor } from '../../../src/a2a/types.js'
import type { Payments } from '../../../src/payments.js'

/**
 * A spec-shaped x402 PaymentPayload object (the decoded form of an access
 * token). The server re-encodes it via encodeAccessToken and the facilitator
 * verify/settle path consumes the resulting base64 token.
 */
const PAYMENT_PAYLOAD = {
  x402Version: 2,
  accepted: {
    scheme: 'nvm:erc4337',
    network: 'eip155:84532',
    planId: 'test-plan',
    extra: { version: '1' },
  },
  payload: {
    signature: '0xsig',
    authorization: {
      from: '0xSubscriberInBand',
      sessionKeysProvider: 'zerodev',
      sessionKeys: [],
    },
  },
  extensions: {},
}

class MockFacilitatorAPI {
  verifyCallCount = 0
  settleCallCount = 0
  lastVerifyToken: string | null = null
  lastSettleToken: string | null = null
  shouldFailVerify = false
  shouldFailSettle = false

  async verifyPermissions(params: any): Promise<{ isValid: boolean; invalidReason?: string }> {
    this.verifyCallCount++
    this.lastVerifyToken = params.x402AccessToken
    if (this.shouldFailVerify) {
      return { isValid: false, invalidReason: 'Insufficient credits' }
    }
    return { isValid: true }
  }

  async settlePermissions(params: any): Promise<{
    success: boolean
    transaction: string
    network: string
    creditsRedeemed: string
  }> {
    this.settleCallCount++
    this.lastSettleToken = params.x402AccessToken
    if (this.shouldFailSettle) {
      throw new Error('Failed to settle credits')
    }
    return {
      success: true,
      transaction: '0xreceipt',
      network: 'eip155:84532',
      creditsRedeemed: String(params.maxAmount || 0),
    }
  }
}

class MockPaymentsService {
  facilitator: MockFacilitatorAPI
  agents: { getAgentPlans: () => Promise<{ plans: any[] }> }

  constructor() {
    this.facilitator = new MockFacilitatorAPI()
    this.agents = { getAgentPlans: async () => ({ plans: [] }) }
  }

  getEnvironmentName() {
    return 'sandbox'
  }
}

class DummyExecutor implements PaymentsAgentExecutor {
  creditsToUse: number
  emitArtifact: boolean

  constructor(creditsToUse = 3, emitArtifact = false) {
    this.creditsToUse = creditsToUse
    this.emitArtifact = emitArtifact
  }

  async execute(requestContext: any, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = requestContext.taskId || crypto.randomUUID()
    const contextId = requestContext.contextId || 'ctx'

    if (!requestContext.task) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId,
        status: {
          state: 'submitted' as TaskState,
          timestamp: new Date().toISOString(),
        } as TaskStatus,
        history: requestContext.userMessage ? [requestContext.userMessage] : [],
      }
      await eventBus.publish(initialTask)
    }

    // Optionally emit the paid result as an ARTIFACT (the x402 spec's own example
    // delivers a generated image this way) so settlement-failure suppression can
    // be exercised against artifacts, not just the status message.
    if (this.emitArtifact) {
      await eventBus.publish({
        kind: 'artifact-update',
        taskId,
        contextId,
        artifact: {
          artifactId: 'paid-artifact',
          parts: [{ kind: 'text', text: 'Here is your paid result!' }],
        },
      } as any)
    }

    const agentMessage: Message = {
      kind: 'message',
      messageId: crypto.randomUUID(),
      role: 'agent',
      parts: [{ kind: 'text', text: 'Here is your paid result!' }],
      taskId,
      contextId,
    }

    const finalStatusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'completed' as TaskState,
        message: agentMessage,
        timestamp: new Date().toISOString(),
      } as TaskStatus,
      metadata: { creditsUsed: this.creditsToUse },
      final: true,
    }
    await eventBus.publish(finalStatusUpdate)
    eventBus.finished()
  }

  async cancelTask(): Promise<void> {}
}

function buildCard(): AgentCard {
  // buildPaymentAgentCard declares BOTH the nvm extension and the official
  // a2a-x402 extension. The latter is what flips the middleware into the in-band
  // "return input-required instead of HTTP 402" behavior when no token arrives.
  return buildPaymentAgentCard(
    {
      name: 'InBandAgent',
      capabilities: {},
    } as unknown as AgentCard,
    {
      paymentType: 'fixed',
      credits: 10,
      agentId: 'test-agent-123',
      planId: 'test-plan',
      costDescription: '10 credits per call',
    },
  )
}

function createServer(
  executor: PaymentsAgentExecutor,
  agentCard: AgentCard,
  paymentsService: any,
): { client: ReturnType<typeof request>; close: () => Promise<void> } {
  const result = PaymentsA2AServer.start({
    agentCard,
    executor,
    paymentsService: paymentsService as any as Payments,
    port: 0,
    basePath: '/rpc',
    exposeDefaultRoutes: true,
  })
  return { client: request(result.app), close: result.close }
}

describe('x402 v2 A2A in-band transport', () => {
  let decodeSpy: jest.SpyInstance
  let servers: Array<{ close: () => Promise<void> }> = []

  beforeAll(() => {
    // The server re-encodes the in-band payload into a token (encodeAccessToken
    // stays REAL so we can assert the round-trip), then decodes that token in
    // validateRequest/executeRedemption. Force decode to the known payload so the
    // facilitator path reads subscriberAddress/scheme deterministically.
    decodeSpy = jest
      .spyOn(utils, 'decodeAccessToken')
      .mockImplementation(() => PAYMENT_PAYLOAD as any)
  })

  afterAll(() => {
    decodeSpy?.mockRestore()
  })

  afterEach(async () => {
    for (const s of servers) await s.close()
    servers = []
  })

  test('1. payment-gated message with no token returns input-required + payment-required metadata', async () => {
    const mockPayments = new MockPaymentsService()
    const { client, close } = createServer(new DummyExecutor(), buildCard(), mockPayments)
    servers.push({ close })

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: 'msg-no-token',
          contextId: 'ctx-1',
          role: 'user',
          parts: [{ kind: 'text', text: 'Generate an image' }],
        },
      },
    }

    // No payment-signature header and no in-band payload.
    const response = await client.post('/rpc').send(payload)

    expect(response.status).toBe(200)
    const task = response.body.result
    expect(task.kind).toBe('task')
    expect(task.status.state).toBe('input-required')

    const meta = task.status.message.metadata
    expect(meta[X402A2AMetadata.STATUS_KEY]).toBe(PaymentStatus.PAYMENT_REQUIRED)

    const required = meta[X402A2AMetadata.REQUIRED_KEY]
    expect(required).toBeDefined()
    expect(required.x402Version).toBe(2)
    expect(Array.isArray(required.accepts)).toBe(true)
    expect(required.accepts[0].planId).toBe('test-plan')

    // The agent must NOT have executed, and no settlement happened.
    expect(mockPayments.facilitator.verifyCallCount).toBe(0)
    expect(mockPayments.facilitator.settleCallCount).toBe(0)
  }, 15000)

  test('2. follow-up message with x402.payment.payload verifies, executes, settles, and stamps payment-completed + receipts', async () => {
    const mockPayments = new MockPaymentsService()
    const { client, close } = createServer(new DummyExecutor(4), buildCard(), mockPayments)
    servers.push({ close })

    // Step 1: provoke a payment-required task to get the correlation taskId.
    const first = await client.post('/rpc').send({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: 'msg-1',
          contextId: 'ctx-2',
          role: 'user',
          parts: [{ kind: 'text', text: 'Generate an image' }],
        },
      },
    })
    const taskId = first.body.result.id
    expect(first.body.result.status.state).toBe('input-required')

    // Step 2: submit the payment in band, correlated by taskId.
    const second = await client.post('/rpc').send({
      jsonrpc: '2.0',
      id: 2,
      method: 'message/send',
      params: {
        message: {
          taskId,
          messageId: 'msg-2',
          contextId: 'ctx-2',
          role: 'user',
          parts: [{ kind: 'text', text: 'Here is the payment authorization.' }],
          metadata: {
            [X402A2AMetadata.STATUS_KEY]: PaymentStatus.PAYMENT_SUBMITTED,
            [X402A2AMetadata.PAYLOAD_KEY]: PAYMENT_PAYLOAD,
          },
        },
      },
    })

    expect(second.status).toBe(200)
    const task = second.body.result
    expect(task.kind).toBe('task')
    expect(task.status.state).toBe('completed')
    expect(task.status.message.parts[0].text).toBe('Here is your paid result!')

    // In-band settlement metadata stamped on the final task.
    const meta = task.status.message.metadata
    expect(meta[X402A2AMetadata.STATUS_KEY]).toBe(PaymentStatus.PAYMENT_COMPLETED)
    const receipts = meta[X402A2AMetadata.RECEIPTS_KEY]
    expect(Array.isArray(receipts)).toBe(true)
    expect(receipts[0].success).toBe(true)
    expect(receipts[0].transaction).toBe('0xreceipt')

    // Verify + settle both ran, and on the re-encoded in-band token.
    expect(mockPayments.facilitator.verifyCallCount).toBe(1)
    expect(mockPayments.facilitator.settleCallCount).toBe(1)
    // The token the facilitator saw is exactly encodeAccessToken(PAYMENT_PAYLOAD).
    expect(mockPayments.facilitator.lastVerifyToken).toBe(encodeAccessToken(PAYMENT_PAYLOAD))
    expect(mockPayments.facilitator.lastSettleToken).toBe(encodeAccessToken(PAYMENT_PAYLOAD))
  }, 20000)

  test('3. settlement failure on the in-band path -> payment-failed + error, agent content suppressed', async () => {
    const mockPayments = new MockPaymentsService()
    mockPayments.facilitator.shouldFailSettle = true
    // Executor emits the paid result as an artifact too, so we prove suppression
    // covers artifacts (not only the status message).
    const { client, close } = createServer(new DummyExecutor(2, true), buildCard(), mockPayments)
    servers.push({ close })

    // Single-shot in-band payment (no prior taskId): the in-band payload alone
    // authorizes, the agent runs, then settlement fails.
    const response = await client.post('/rpc').send({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: 'msg-sf',
          contextId: 'ctx-3',
          role: 'user',
          parts: [{ kind: 'text', text: 'pay and run' }],
          metadata: {
            [X402A2AMetadata.STATUS_KEY]: PaymentStatus.PAYMENT_SUBMITTED,
            [X402A2AMetadata.PAYLOAD_KEY]: PAYMENT_PAYLOAD,
          },
        },
      },
    })

    expect(response.status).toBe(200)
    const task = response.body.result
    expect(task.kind).toBe('task')
    // Content suppressed: the task is failed, not the agent's "completed" result.
    expect(task.status.state).toBe('failed')
    expect(task.status.message.parts[0].text).not.toBe('Here is your paid result!')
    // ...and the paid content must not leak through artifacts (the executor emitted
    // the result as one) nor anywhere else in the returned task.
    expect(task.artifacts ?? []).toHaveLength(0)
    expect(JSON.stringify(task)).not.toContain('Here is your paid result!')

    const meta = task.status.message.metadata
    expect(meta[X402A2AMetadata.STATUS_KEY]).toBe(PaymentStatus.PAYMENT_FAILED)
    expect(meta[X402A2AMetadata.ERROR_KEY]).toBeDefined()
    const receipts = meta[X402A2AMetadata.RECEIPTS_KEY]
    expect(Array.isArray(receipts)).toBe(true)
    expect(receipts[0].success).toBe(false)

    // Verify passed; settle was attempted and failed.
    expect(mockPayments.facilitator.verifyCallCount).toBe(1)
    expect(mockPayments.facilitator.settleCallCount).toBe(1)
  }, 20000)

  test('3b. verification failure on the in-band path -> HTTP 402 (no execution)', async () => {
    const mockPayments = new MockPaymentsService()
    mockPayments.facilitator.shouldFailVerify = true
    const { client, close } = createServer(new DummyExecutor(), buildCard(), mockPayments)
    servers.push({ close })

    const response = await client.post('/rpc').send({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: 'msg-vf',
          contextId: 'ctx-3b',
          role: 'user',
          parts: [{ kind: 'text', text: 'bad payment' }],
          metadata: {
            [X402A2AMetadata.STATUS_KEY]: PaymentStatus.PAYMENT_SUBMITTED,
            [X402A2AMetadata.PAYLOAD_KEY]: PAYMENT_PAYLOAD,
          },
        },
      },
    })

    // Verification failure is surfaced by the middleware as a 402 before execution.
    expect(response.status).toBe(402)
    expect(mockPayments.facilitator.verifyCallCount).toBe(1)
    expect(mockPayments.facilitator.settleCallCount).toBe(0)
  }, 15000)

  test('4. legacy payment-signature header path still works (regression)', async () => {
    const mockPayments = new MockPaymentsService()
    const { client, close } = createServer(new DummyExecutor(5), buildCard(), mockPayments)
    servers.push({ close })

    const response = await client
      .post('/rpc')
      .set('payment-signature', 'LEGACY_TOKEN')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'msg-legacy',
            contextId: 'ctx-4',
            role: 'user',
            parts: [{ kind: 'text', text: 'legacy header pay' }],
          },
        },
      })

    expect(response.status).toBe(200)
    const task = response.body.result
    expect(task.kind).toBe('task')
    expect(task.status.state).toBe('completed')
    expect(task.status.message.parts[0].text).toBe('Here is your paid result!')

    // Header path: the facilitator saw the raw header token, not a re-encoding.
    expect(mockPayments.facilitator.lastVerifyToken).toBe('LEGACY_TOKEN')
    expect(mockPayments.facilitator.lastSettleToken).toBe('LEGACY_TOKEN')

    // Header path does NOT stamp the in-band x402.payment.* completion metadata.
    const meta = task.status.message.metadata || {}
    expect(meta[X402A2AMetadata.STATUS_KEY]).toBeUndefined()

    expect(mockPayments.facilitator.verifyCallCount).toBe(1)
    expect(mockPayments.facilitator.settleCallCount).toBe(1)
  }, 15000)

  test('5. streaming settlement failure -> persisted task is payment-failed, content suppressed', async () => {
    const mockPayments = new MockPaymentsService()
    mockPayments.facilitator.shouldFailSettle = true
    const card = buildCard()
    card.capabilities = { ...card.capabilities, streaming: true }
    // Executor streams its (paid) result, incl. an artifact, then settlement throws.
    const { client, close } = createServer(new DummyExecutor(3, true), card, mockPayments)
    servers.push({ close })

    const streamRes = await client.post('/rpc').send({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/stream',
      params: {
        message: {
          messageId: 'msg-stream-sf',
          contextId: 'ctx-5',
          role: 'user',
          parts: [{ kind: 'text', text: 'stream pay and fail' }],
          metadata: {
            [X402A2AMetadata.STATUS_KEY]: PaymentStatus.PAYMENT_SUBMITTED,
            [X402A2AMetadata.PAYLOAD_KEY]: PAYMENT_PAYLOAD,
          },
        },
      },
    })

    // The streamed event cannot be retracted; settlement was attempted and threw.
    expect(mockPayments.facilitator.settleCallCount).toBe(1)

    // Pull the generated taskId out of the SSE stream.
    const taskId = streamRes.text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => {
        try {
          return JSON.parse(l.slice(5).trim())
        } catch {
          return null
        }
      })
      .map((e) => e?.result?.id ?? e?.result?.taskId)
      .find((id) => typeof id === 'string')
    expect(taskId).toBeTruthy()

    // The PERSISTED task (tasks/get) must reflect the failure, not a paid result.
    const getRes = await client.post('/rpc').send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tasks/get',
      params: { id: taskId },
    })
    const task = getRes.body.result
    expect(task.status.state).toBe('failed')
    expect(task.status.message.metadata[X402A2AMetadata.STATUS_KEY]).toBe(
      PaymentStatus.PAYMENT_FAILED,
    )
    expect(task.artifacts ?? []).toHaveLength(0)
  }, 20000)

  test('x402A2AUtils helpers round-trip status/required/payload on a task', () => {
    const task: Task = {
      kind: 'task',
      id: 't1',
      contextId: 'c1',
      status: { state: 'submitted' },
    }
    const required = { x402Version: 2, resource: { url: '' }, accepts: [], extensions: {} } as any
    x402A2AUtils.createPaymentRequiredTask(task, required)
    expect(task.status.state).toBe('input-required')
    expect(x402A2AUtils.getPaymentStatus(task)).toBe(PaymentStatus.PAYMENT_REQUIRED)
    expect(x402A2AUtils.getPaymentRequirements(task)).toEqual(required)

    // Oversized payloads are rejected (defense-in-depth, parity with MCP).
    const big: Message = {
      kind: 'message',
      messageId: 'm',
      role: 'user',
      parts: [],
      metadata: { [X402A2AMetadata.PAYLOAD_KEY]: { blob: 'x'.repeat(70 * 1024) } },
    }
    expect(x402A2AUtils.getPaymentPayloadFromMessage(big)).toBeUndefined()

    // Arrays / null are rejected (mirrors isinstance(value, dict)).
    const arr: Message = {
      kind: 'message',
      messageId: 'm2',
      role: 'user',
      parts: [],
      metadata: { [X402A2AMetadata.PAYLOAD_KEY]: [1, 2, 3] as any },
    }
    expect(x402A2AUtils.getPaymentPayloadFromMessage(arr)).toBeUndefined()
  })
})
