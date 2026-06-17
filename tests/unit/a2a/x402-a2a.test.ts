/**
 * Unit tests for the x402 v2 A2A in-band utilities (X402A2AUtils).
 *
 * Mirrors the MCP in-band helper unit tests (tests/unit/mcp/x402_inband.test.ts):
 * spec-key constants, status lifecycle, payload guards (array/null/oversized),
 * and the encode/decode token round-trip the in-band transport relies on.
 */

import type { Message, Task } from '@a2a-js/sdk'
import {
  PaymentStatus,
  X402A2AMetadata,
  X402A2AUtils,
  x402A2AUtils,
} from '../../../src/a2a/x402-a2a.js'
import { decodeAccessToken, encodeAccessToken } from '../../../src/utils.js'

function emptyTask(): Task {
  return { kind: 'task', id: 't-1', contextId: 'c-1', status: { state: 'submitted' } }
}

function messageWith(metadata: Record<string, unknown>): Message {
  return { kind: 'message', messageId: 'm-1', role: 'user', parts: [], metadata }
}

describe('X402A2AMetadata spec keys', () => {
  test('match the A2A x402 specification exactly', () => {
    expect(X402A2AMetadata.STATUS_KEY).toBe('x402.payment.status')
    expect(X402A2AMetadata.REQUIRED_KEY).toBe('x402.payment.required')
    expect(X402A2AMetadata.PAYLOAD_KEY).toBe('x402.payment.payload')
    expect(X402A2AMetadata.RECEIPTS_KEY).toBe('x402.payment.receipts')
    expect(X402A2AMetadata.ERROR_KEY).toBe('x402.payment.error')
  })

  test('PaymentStatus lifecycle values match the spec', () => {
    expect(PaymentStatus.PAYMENT_REQUIRED).toBe('payment-required')
    expect(PaymentStatus.PAYMENT_SUBMITTED).toBe('payment-submitted')
    expect(PaymentStatus.PAYMENT_VERIFIED).toBe('payment-verified')
    expect(PaymentStatus.PAYMENT_REJECTED).toBe('payment-rejected')
    expect(PaymentStatus.PAYMENT_COMPLETED).toBe('payment-completed')
    expect(PaymentStatus.PAYMENT_FAILED).toBe('payment-failed')
  })
})

describe('X402A2AUtils extraction', () => {
  const utils = new X402A2AUtils()

  test('getPaymentStatus / getPaymentRequirements / getPaymentPayload read task status metadata', () => {
    const required = { x402Version: 2, resource: { url: '' }, accepts: [], extensions: {} } as any
    const payload = { x402Version: 2, payload: { signature: '0x1' } }
    const task: Task = {
      kind: 'task',
      id: 't',
      contextId: 'c',
      status: {
        state: 'input-required',
        message: messageWith({
          [X402A2AMetadata.STATUS_KEY]: PaymentStatus.PAYMENT_REQUIRED,
          [X402A2AMetadata.REQUIRED_KEY]: required,
          [X402A2AMetadata.PAYLOAD_KEY]: payload,
        }),
      },
    }
    expect(utils.getPaymentStatus(task)).toBe(PaymentStatus.PAYMENT_REQUIRED)
    expect(utils.getPaymentRequirements(task)).toEqual(required)
    expect(utils.getPaymentPayload(task)).toEqual(payload)
  })

  test('returns undefined for missing/non-object metadata', () => {
    expect(utils.getPaymentStatus(emptyTask())).toBeUndefined()
    expect(utils.getPaymentStatus(null)).toBeUndefined()
    expect(utils.getPaymentPayloadFromMessage(messageWith({}))).toBeUndefined()
  })

  test('rejects array and null payloads (mirrors isinstance(value, dict))', () => {
    expect(
      utils.getPaymentPayloadFromMessage(messageWith({ [X402A2AMetadata.PAYLOAD_KEY]: [1, 2] as any })),
    ).toBeUndefined()
    expect(
      utils.getPaymentPayloadFromMessage(
        messageWith({ [X402A2AMetadata.PAYLOAD_KEY]: null as any }),
      ),
    ).toBeUndefined()
  })

  test('rejects oversized payloads (>64KB) as defense-in-depth', () => {
    const big = messageWith({ [X402A2AMetadata.PAYLOAD_KEY]: { blob: 'x'.repeat(70 * 1024) } })
    expect(utils.getPaymentPayloadFromMessage(big)).toBeUndefined()
  })
})

describe('X402A2AUtils stamping', () => {
  const utils = new X402A2AUtils()

  test('createPaymentRequiredTask sets input-required + required metadata', () => {
    const task = emptyTask()
    const required = { x402Version: 2, resource: { url: '/x' }, accepts: [], extensions: {} } as any
    utils.createPaymentRequiredTask(task, required)
    expect(task.status.state).toBe('input-required')
    expect(task.status.message?.metadata?.[X402A2AMetadata.STATUS_KEY]).toBe(
      PaymentStatus.PAYMENT_REQUIRED,
    )
    expect(task.status.message?.metadata?.[X402A2AMetadata.REQUIRED_KEY]).toEqual(required)
  })

  test('recordPaymentSuccess stamps payment-completed + receipts array', () => {
    const task = emptyTask()
    utils.recordPaymentSuccess(task, {
      success: true,
      transaction: '0xabc',
      network: 'eip155:84532',
    })
    const meta = task.status.message?.metadata as Record<string, any>
    expect(meta[X402A2AMetadata.STATUS_KEY]).toBe(PaymentStatus.PAYMENT_COMPLETED)
    expect(Array.isArray(meta[X402A2AMetadata.RECEIPTS_KEY])).toBe(true)
    expect(meta[X402A2AMetadata.RECEIPTS_KEY][0].transaction).toBe('0xabc')
  })

  test('recordPaymentFailure stamps payment-failed + error code + receipts', () => {
    const task = emptyTask()
    utils.recordPaymentFailure(task, 'EXPIRED_PAYMENT', {
      success: false,
      errorReason: 'expired',
      transaction: '',
      network: 'eip155:84532',
    })
    const meta = task.status.message?.metadata as Record<string, any>
    expect(meta[X402A2AMetadata.STATUS_KEY]).toBe(PaymentStatus.PAYMENT_FAILED)
    expect(meta[X402A2AMetadata.ERROR_KEY]).toBe('EXPIRED_PAYMENT')
    expect(meta[X402A2AMetadata.RECEIPTS_KEY][0].success).toBe(false)
  })

  test('recordPaymentVerified stamps payment-verified', () => {
    const task = emptyTask()
    utils.recordPaymentVerified(task)
    expect(task.status.message?.metadata?.[X402A2AMetadata.STATUS_KEY]).toBe(
      PaymentStatus.PAYMENT_VERIFIED,
    )
  })

  test('exports a shared singleton instance', () => {
    expect(x402A2AUtils).toBeInstanceOf(X402A2AUtils)
  })
})

describe('in-band token round-trip (encode/decode)', () => {
  test('a decoded PaymentPayload re-encodes to a token decodeAccessToken accepts', () => {
    const payload = {
      x402Version: 2,
      accepted: { scheme: 'nvm:erc4337', network: 'eip155:84532', planId: 'p', extra: {} },
      payload: {
        signature: '0xsig',
        authorization: { from: '0xFrom', sessionKeysProvider: 'zerodev', sessionKeys: [] },
      },
      extensions: {},
    }
    const token = encodeAccessToken(payload)
    expect(typeof token).toBe('string')
    // unpadded base64url
    expect(token).not.toContain('=')
    expect(decodeAccessToken(token)).toEqual(payload)
  })
})
