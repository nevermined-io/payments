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
export { PaymentsA2AServer } from './server'

/**
 * Helper function for creating payment-enabled agent cards.
 * Embeds payment metadata in agent cards following A2A standards.
 */
export { buildPaymentAgentCard } from './agent-card'

/**
 * Core types and interfaces for the A2A payments integration.
 * Includes TaskContext, TaskHandlerResult, PaymentMetadata, and A2A SDK types.
 */
export * from './types'

/**
 * A2A server and client registry functionality is now available via the Payments.a2a property.
 * Use payments.a2a.start(...) to start the server, and payments.a2a.getClient(...) to get or create a client for an agent.
 * The client registry is lazy-initialized and not created unless getClient is called.
 */
