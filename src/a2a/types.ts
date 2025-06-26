/**
 * @fileoverview Types and interfaces for the A2A payments integration.
 * Defines context, handler result, and payment metadata structures.
 */

import type { AgentCard, Task, Message, Artifact, TaskState, Part } from '@a2a-js/sdk'

/**
 * Context provided to the user's task handler.
 * Includes the user message, existing task, bearer token, and request metadata.
 */
export interface TaskContext {
  userMessage: Message
  existingTask?: Task
  bearerToken?: string
  requestMetadata?: Record<string, any>
}

/**
 * Result returned by the user's task handler.
 * Must be transformable to a valid A2A Message or Artifact.
 */
export interface TaskHandlerResult {
  parts: Part[]
  metadata?: PaymentMetadata & Record<string, any>
  state?: TaskState
}

/**
 * Metadata for payment/credits information to be included in A2A objects.
 */
export interface PaymentMetadata {
  creditsUsed?: number
  planId?: string
  paymentType?: 'fixed' | 'dynamic'
  costDescription?: string
}

export type { AgentCard, Task, Message, Artifact, TaskState, Part }

// Re-export server options type for convenience
export type { PaymentsA2AServerOptions } from './server'
