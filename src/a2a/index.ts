/**
 * Public API for the payments A2A integration module.
 *
 * This module provides a complete A2A (Agent-to-Agent) protocol implementation
 * with integrated payment functionality. It allows users to create payment-enabled
 * A2A agents without dealing directly with the underlying A2A SDK.
 */

/**
 * Main server class for starting A2A agents with payment integration.
 * Provides complete A2A protocol implementation with credit validation and burning.
 */
export { PaymentsA2AServer } from './server.js'

/**
 * Helper function for creating payment-enabled agent cards.
 * Embeds payment metadata in agent cards following A2A standards.
 */
export { buildPaymentAgentCard } from './agent-card.js'

/**
 * Core types and interfaces for the A2A payments integration.
 * Includes TaskContext, TaskHandlerResult, PaymentMetadata, and A2A SDK types.
 */
export * from './types.js'
