/**
 * Unit tests for build_payment_agent_card utility.
 */

import { buildPaymentAgentCard } from '../../../src/a2a/agent-card.js'
import type { AgentCard } from '@a2a-js/sdk'
import type { PaymentAgentCardMetadata } from '../../../src/a2a/agent-card.js'

describe('buildPaymentAgentCard', () => {
  test('should build payment agent card successfully', () => {
    const baseCard = { name: 'Agent', capabilities: {} } as any as AgentCard
    const metadata = {
      paymentType: 'fixed',
      credits: 5,
      agentId: 'agent-1',
      planId: 'plan-1',
      costDescription: '5 credits per call',
    } as any as PaymentAgentCardMetadata
    const card = buildPaymentAgentCard(baseCard, metadata)
    const ext = card.capabilities?.extensions?.[card.capabilities.extensions.length - 1]
    expect(ext?.uri).toBe('urn:nevermined:payment')
    expect(ext?.params?.agentId).toBe('agent-1')
  })

  test.each([
    [{ credits: 0, agentId: 'x' }, /paymentType/i],
    [{ paymentType: 'fixed', credits: -1, agentId: 'x' }, /credits cannot be negative/i],
    [{ paymentType: 'fixed', credits: 0, agentId: 'x' }, /credits must be a positive number/i],
    [{ paymentType: 'fixed', credits: 1 }, /agentId/i],
  ])('should throw validation error for invalid metadata: %s', (meta, expectedError) => {
    const baseCard = { capabilities: {} } as any as AgentCard
    expect(() => {
      buildPaymentAgentCard(baseCard, meta as any)
    }).toThrow(expectedError)
  })
})
