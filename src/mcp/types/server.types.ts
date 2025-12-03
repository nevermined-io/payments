/**
 * Types for the simplified MCP server API.
 * These types define the high-level API that hides McpServer, Transport, and Express details.
 */

import type { EnvironmentName } from '../../environments.js'

/**
 * Configuration for a tool.
 */
export interface McpToolConfig {
  /** Human-readable title for the tool */
  title?: string
  /** Description of what the tool does */
  description: string
  /** JSON Schema for input arguments */
  inputSchema?: Record<string, any>
  /** JSON Schema for output (optional) */
  outputSchema?: Record<string, any>
}

/**
 * Configuration for a resource.
 */
export interface McpResourceConfig {
  /** Human-readable name for the resource */
  name: string
  /** Description of the resource */
  description?: string
  /** MIME type of the resource content */
  mimeType?: string
}

/**
 * Configuration for a prompt.
 */
export interface McpPromptConfig {
  /** Human-readable name for the prompt */
  name: string
  /** Description of the prompt */
  description?: string
  /** Arguments the prompt accepts */
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

/**
 * Options for tool/resource/prompt registration.
 */
export interface McpRegistrationOptions {
  /** Credits to charge per call (default: 1) */
  credits?: bigint | number
  /** What to do if credit redemption fails */
  onRedeemError?: 'ignore' | 'propagate'
}

/**
 * Handler function for a tool.
 */
export type ToolHandler<TArgs = any, TResult = any> = (
  args: TArgs,
  context?: ToolContext,
) => Promise<TResult> | TResult

/**
 * Handler function for a resource.
 */
export type ResourceHandler<TResult = any> = (
  uri: URL,
  variables: Record<string, string | string[]>,
  context?: ResourceContext,
) => Promise<TResult> | TResult

/**
 * Handler function for a prompt.
 */
export type PromptHandler<TResult = any> = (
  args: Record<string, string>,
  context?: PromptContext,
) => Promise<TResult> | TResult

/**
 * Context passed to tool handlers.
 */
export interface ToolContext {
  /** Request ID for tracking */
  requestId?: string
  /** Credits available/charged */
  credits?: bigint
  /** Raw MCP extra context */
  extra?: any
}

/**
 * Context passed to resource handlers.
 */
export interface ResourceContext {
  /** Request ID for tracking */
  requestId?: string
  /** Credits available/charged */
  credits?: bigint
  /** Raw MCP extra context */
  extra?: any
}

/**
 * Context passed to prompt handlers.
 */
export interface PromptContext {
  /** Request ID for tracking */
  requestId?: string
  /** Credits available/charged */
  credits?: bigint
  /** Raw MCP extra context */
  extra?: any
}

/**
 * Configuration for starting the MCP server.
 */
export interface McpServerConfig {
  /** Port to listen on */
  port: number
  /** Agent ID (DID) for Nevermined */
  agentId: string
  /** Human-readable server name */
  serverName: string
  /** Base URL of the server (default: http://localhost:{port}) */
  baseUrl?: string
  /** Host to bind to (default: 0.0.0.0) */
  host?: string
  /** Nevermined environment (default: from Payments instance) */
  environment?: EnvironmentName
  /** Server version (default: 1.0.0) */
  version?: string
  /** Server description */
  description?: string
  /** CORS origins (default: *) */
  corsOrigins?: string | string[]
  /** Enable OAuth discovery endpoints (default: true) */
  enableOAuthDiscovery?: boolean
  /** Enable client registration (default: true) */
  enableClientRegistration?: boolean
  /** Enable health check endpoint (default: true) */
  enableHealthCheck?: boolean
  /** Enable server info endpoint (default: true) */
  enableServerInfo?: boolean
  /** Callback when server starts */
  onStart?: (info: ServerInfo) => void
  /** Callback for logging */
  onLog?: (message: string, level?: 'info' | 'warn' | 'error') => void
}

/**
 * Information about a running server.
 */
export interface ServerInfo {
  /** Base URL of the server */
  baseUrl: string
  /** Port the server is listening on */
  port: number
  /** List of registered tools */
  tools: string[]
  /** List of registered resources */
  resources: string[]
  /** List of registered prompts */
  prompts: string[]
}

/**
 * Result of starting the server.
 */
export interface McpServerResult {
  /** Server info */
  info: ServerInfo
  /** Stop the server gracefully */
  stop: () => Promise<void>
}

/**
 * Internal registration entry for a tool.
 */
export interface ToolRegistration {
  name: string
  config: McpToolConfig
  handler: ToolHandler
  options: McpRegistrationOptions
}

/**
 * Internal registration entry for a resource.
 */
export interface ResourceRegistration {
  uri: string
  config: McpResourceConfig
  handler: ResourceHandler
  options: McpRegistrationOptions
}

/**
 * Internal registration entry for a prompt.
 */
export interface PromptRegistration {
  name: string
  config: McpPromptConfig
  handler: PromptHandler
  options: McpRegistrationOptions
}
