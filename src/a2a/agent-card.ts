/**
 * @fileoverview Helper to build an AgentCard with payment/pricing metadata for A2A agents.
 */
import type { AgentCard } from './types'

/**
 * Payment/pricing information to be included in the AgentCard extensions.
 * Must be compatible with {[key: string]: unknown} to comply with A2A standard.
 */
export interface PaymentAgentCardMetadata {
  paymentType: 'fixed' | 'dynamic'
  credits: number
  planId?: string
  agentId: string
  costDescription?: string
  [key: string]: unknown // For compatibility with AgentExtension.params
}

/**
 * Builds an AgentCard with payment/pricing metadata in the capabilities.extensions field.
 * This follows the A2A standard for extensibility.
 * @param baseCard - The base AgentCard (without payment info).
 * @param paymentMetadata - The payment/pricing metadata to include.
 * @returns The AgentCard with payment info in capabilities.extensions.
 */
export function buildPaymentAgentCard(
  baseCard: AgentCard,
  paymentMetadata: PaymentAgentCardMetadata,
): AgentCard {
  return {
    ...baseCard,
    capabilities: {
      ...baseCard.capabilities,
      extensions: [
        ...(baseCard.capabilities?.extensions || []),
        {
          uri: 'urn:nevermined:payment',
          description: paymentMetadata.costDescription,
          required: false,
          // explicit type assertion to satisfy {[key: string]: unknown}
          params: paymentMetadata as { [key: string]: unknown },
        },
      ],
    },
  }
}
