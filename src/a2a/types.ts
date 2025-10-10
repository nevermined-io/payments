/**
 * Types and interfaces for the A2A payments integration.
 *
 * This module defines the core types and interfaces used throughout the A2A
 * payments integration. It provides:
 * - Task context structures for user executors
 * - Handler result definitions
 * - Payment metadata interfaces
 * - Re-exports of A2A SDK types for convenience
 *
 * These types ensure type safety and provide clear contracts between
 * the user's executor implementation and the payments system.
 */

import type {
  AgentCard,
  Task,
  Message,
  Artifact,
  TaskState,
  Part,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  PushNotificationConfig,
  MessageSendParams,
  SendMessageResponse,
  TaskQueryParams,
  GetTaskResponse,
  TaskPushNotificationConfig,
  SetTaskPushNotificationConfigResponse,
  TaskIdParams,
  GetTaskPushNotificationConfigResponse,
} from '@a2a-js/sdk'

import type { ExecutionEventBus, AgentExecutor, RequestContext } from '@a2a-js/sdk/server'
import type { StartAgentRequest } from '../common/types.ts'

/**
 * Union type for A2A streaming events
 *
 * This type represents all possible events that can be yielded by A2A streaming methods.
 * It includes messages, tasks, status updates, and artifact updates.
 */
export type A2AStreamEvent = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent

/**
 * Context provided to the user's task handler.
 *
 * This interface contains all the information available to the user's
 * executor when handling an A2A task. It includes:
 * - The original user message
 * - Any existing task state (for continuation)
 * - Authentication information
 * - Request metadata
 *
 * The context is created by the PaymentsA2AAdapter and passed to the
 * user's handleTask method.
 */
export interface TaskContext {
  /** The original message from the user containing the request */
  userMessage: Message
  /** Any existing task state (for task continuation scenarios) */
  existingTask?: Task
  /** Bearer token for authentication and payment validation */
  bearerToken?: string
  /** Additional metadata from the original request */
  requestMetadata?: Record<string, any>
  /**
   * Emit a streaming event to the client (SSE, WebSocket, etc.) during task execution.
   * This function allows the executor to send intermediate messages or progress updates.
   *
   * @param parts - Array of message parts (text, etc.) to send as a streaming event
   * @param metadata - Optional metadata to include with the event
   */
  emitStreamingEvent?: (parts: Part[], metadata?: Record<string, any>) => void
}

/**
 * Result returned by the user's task handler.
 *
 * This interface defines the structure that user executors must return
 * from their handleTask method. The result includes:
 * - Parts that will be converted to A2A Message or Artifact objects
 * - Optional metadata for payment tracking and other purposes
 * - Task state information
 *
 * The result is processed by the PaymentsA2AAdapter to create the
 * appropriate A2A protocol objects and handle payment operations.
 */
export interface TaskHandlerResult {
  /** Parts that will be converted to A2A Message or Artifact objects */
  parts: Part[]
  /** Optional metadata including payment information and custom data */
  metadata?: PaymentMetadata & Record<string, any>
  /** The final state of the task */
  state?: TaskState
}

/**
 * Metadata for payment/credits information to be included in A2A objects.
 *
 * This interface defines the payment-related metadata that can be included
 * in task handler results. This metadata is used for:
 * - Credit tracking and validation
 * - Payment processing
 * - Cost reporting
 * - Plan management
 *
 * The metadata is embedded in A2A Message objects and can be used by
 * clients to understand the cost of operations.
 */
export interface PaymentMetadata {
  /** Number of credits used for this operation */
  creditsUsed?: number
  /** ID of the payment plan associated with this operation */
  planId?: string
  /** Type of payment model used */
  paymentType?: 'fixed' | 'dynamic'
  /** Human-readable description of the cost */
  costDescription?: string
}

/**
 * Options required to register or retrieve a client in the registry.
 */
export interface ClientRegistryOptions {
  agentBaseUrl: string
  agentId: string
  planId: string
  agentCardPath?: string
}

/**
 * Options for agent interaction methods (used by PaymentsClient).
 */
export interface AgentOptions {
  agentId: string
  planId?: string
}

/**
 * HTTP context associated with a task or message (for internal request tracking).
 */
export type HttpRequestContext = {
  bearerToken?: string
  urlRequested?: string
  httpMethodRequested?: string
  validation: StartAgentRequest
}

/**
 * Authentication result for A2A requests (equivalent to MCP AuthResult)
 */
export interface A2AAuthResult {
  /** The agent request ID for tracking */
  requestId: string
  /** The bearer token for authentication */
  token: string
  /** The agent ID */
  agentId: string
  /** The agent request data */
  agentRequest: StartAgentRequest
}

/**
 * Agent request context provided to A2A AgentExecutors
 *
 * This context contains all the payment-related data that an AgentExecutor needs
 * to process requests with payment integration. The agent is responsible for
 * calculating and specifying credits in its final response.
 */
export interface AgentRequestContext {
  /** Authentication result with request metadata */
  authResult: A2AAuthResult
  /** The HTTP context with request details */
  httpContext: HttpRequestContext
}

/**
 * Extended RequestContext with agent request data injection
 *
 * This extends the standard A2A RequestContext to include agent request context
 * while maintaining compatibility with the A2A protocol.
 */
export interface PaymentsRequestContext extends RequestContext {
  /** Agent request context injection (following MCP pattern) */
  payments?: AgentRequestContext
}

// Re-export A2A SDK types for convenience
export type {
  AgentCard,
  Task,
  Message,
  Artifact,
  TaskState,
  Part,
  TaskStatusUpdateEvent,
  ExecutionEventBus,
  AgentExecutor,
  RequestContext,
  PushNotificationConfig,
  MessageSendParams,
  SendMessageResponse,
  TaskQueryParams,
  GetTaskResponse,
  TaskPushNotificationConfig,
  SetTaskPushNotificationConfigResponse,
  TaskIdParams,
  GetTaskPushNotificationConfigResponse,
}

// Re-export server options type for convenience
export type { PaymentsA2AServerOptions } from './server.ts'
