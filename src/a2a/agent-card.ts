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
 * Canonical A2A agent-card discovery path (A2A 0.3+ and `@a2a-js/sdk`'s own
 * default, per RFC 8615). Served by Nevermined A2A agents and used as the
 * default when fetching a remote agent's card.
 */
export const AGENT_CARD_WELL_KNOWN_PATH = '.well-known/agent-card.json'

/**
 * Legacy pre-0.3 discovery path. Still served as a backward-compat alias and
 * tried as a fetch fallback, so newly-updated clients keep working against
 * Nevermined agents that have not adopted the canonical path yet.
 * ponytail: drop the alias + fallback one release after agents are updated.
 */
export const LEGACY_AGENT_CARD_WELL_KNOWN_PATH = '.well-known/agent.json'

/**
 * Nevermined's own payment extension URI. Carries the agent/plan params the
 * Nevermined paywall reads (agentId, planId, redemptionConfig, …). Kept for one
 * release alongside the official a2a-x402 extension below for backward compat.
 */
export const NVM_PAYMENT_EXTENSION_URI = 'urn:nevermined:payment'

/**
 * Official a2a-x402 extension URI (x402 v2 A2A transport). Declaring it tells
 * generic A2A clients this agent speaks the standards-compliant in-band x402
 * flow (payment signalled through Task / Message `x402.payment.*` metadata).
 * @see https://github.com/google-agentic-commerce/a2a-x402
 */
export const A2A_X402_EXTENSION_URI =
  'https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2'

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
          uri: NVM_PAYMENT_EXTENSION_URI,
          description: paymentMetadata.costDescription,
          required: false,
          // explicit type assertion to satisfy {[key: string]: unknown}
          params: paymentMetadata as { [key: string]: unknown },
        },
        // Official a2a-x402 extension: signals to generic A2A clients that this
        // agent supports the standards-compliant in-band x402 v2 payment flow.
        // Kept additive alongside the Nevermined extension for one release.
        {
          uri: A2A_X402_EXTENSION_URI,
          description:
            paymentMetadata.costDescription ||
            'Supports payments using the x402 protocol for on-chain settlement.',
          required: false,
        },
      ],
    },
  }
}
