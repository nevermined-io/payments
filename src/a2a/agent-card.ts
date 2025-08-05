/**
 * Helper to build an AgentCard with payment/pricing metadata for A2A agents.
 *
 * This module provides utilities for creating A2A agent cards that include
 * payment and pricing information in a standardized way. The payment metadata
 * is embedded in the agent card's capabilities.extensions field following
 * the A2A standard for extensibility.
 *
 * The payment extension uses the URI 'urn:nevermined:payment' and includes
 * information about pricing, credits, and payment configuration.
 */

import type { AgentCard } from './types.js'

/**
 * Payment/pricing information to be included in the AgentCard extensions.
 *
 * This interface defines the structure for payment metadata that will be
 * embedded in the agent card. The metadata includes information about:
 * - Payment type (fixed or dynamic pricing)
 * - Credit requirements
 * - Plan identification
 * - Cost descriptions
 *
 * Must be compatible with `{[key: string]: unknown}` to comply with A2A standard.
 */
export interface PaymentAgentCardMetadata {
  /** Type of payment model - 'fixed' for set prices, 'dynamic' for variable pricing */
  paymentType: 'fixed' | 'dynamic'
  /** Number of credits required for this agent's services (0 for trial plans) */
  credits: number
  /** Optional plan ID associated with this agent */
  planId?: string
  /** The agent ID for payment validation and tracking */
  agentId: string
  /** Human-readable description of the cost */
  costDescription?: string
  /** Whether this is a trial plan (allows 0 credits) */
  isTrialPlan?: boolean
  /** Additional payment-related metadata */
  [key: string]: unknown // For compatibility with AgentExtension.params
}

/**
 * Builds an AgentCard with payment/pricing metadata in the capabilities.extensions field.
 *
 * This function takes a base agent card and payment metadata, then creates a new
 * agent card that includes the payment information in a standardized extension.
 * The payment extension follows the A2A standard for extensibility and uses the
 * URI 'urn:nevermined:payment' to identify payment-related capabilities.
 *
 * The resulting agent card can be used with the PaymentsA2AServer to provide
 * payment-enabled A2A agent functionality.
 *
 * @param baseCard - The base AgentCard (without payment info)
 * @param paymentMetadata - The payment/pricing metadata to include
 * @returns The AgentCard with payment info in capabilities.extensions
 *
 * @example
 * ```typescript
 * const baseCard: AgentCard = {
 *   name: 'My AI Assistant',
 *   description: 'An AI assistant that helps with various tasks',
 *   capabilities: {
 *     tools: ['text-generation', 'image-analysis'],
 *     extensions: []
 *   }
 * }
 *
 * const paymentMetadata: PaymentAgentCardMetadata = {
 *   paymentType: 'fixed',
 *   credits: 10,
 *   agentId: 'agent-123',
 *   planId: 'plan-456',
 *   costDescription: '10 credits per request'
 * }
 *
 * const paymentCard = buildPaymentAgentCard(baseCard, paymentMetadata)
 *
 * // Use with PaymentsA2AServer
 * PaymentsA2AServer.start({
 *   agentCard: paymentCard,
 *   executor: new MyExecutor(),
 *   paymentsService: payments,
 *   port: 41242
 * })
 * ```
 */
export function buildPaymentAgentCard(
  baseCard: AgentCard,
  paymentMetadata: PaymentAgentCardMetadata,
): AgentCard {
  // Validate required fields
  if (!paymentMetadata.paymentType) {
    throw new Error('paymentType is required')
  }

  // Validate credits - negative credits are never allowed
  if (paymentMetadata.credits < 0) {
    throw new Error('credits cannot be negative')
  }

  // Validate credits based on trial plan status
  if (paymentMetadata.isTrialPlan) {
    // Trial plans can have 0 credits (already validated not negative above)
  } else {
    // Non-trial plans must have positive credits
    if (!paymentMetadata.credits || paymentMetadata.credits <= 0) {
      throw new Error('credits must be a positive number for paid plans')
    }
  }

  if (!paymentMetadata.agentId) {
    throw new Error('agentId is required')
  }

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
