/**
 * Type definitions for MCP paywall functionality
 */

/**
 * Context provided to dynamic credits functions
 */
/**
 * Context provided to dynamic credits functions.
 */
export interface CreditsContext {
  args: unknown
  result: any
  request: {
    authHeader: string
    logicalUrl: string
    toolName: string
  }
}

/**
 * Credits calculation option - can be fixed amount or dynamic function
 */
/**
 * Credits option: fixed bigint or a function receiving {@link CreditsContext}.
 */
export type CreditsOption = bigint | ((ctx: CreditsContext) => bigint)

/**
 * Configuration options for paywall protection
 */
/**
 * Unified paywall options for tools, resources and prompts.
 */
export interface BasePaywallOptions {
  name: string
  credits?: CreditsOption
  onRedeemError?: 'ignore' | 'propagate'
}

export interface ToolOptions extends BasePaywallOptions {
  kind: 'tool'
}

export interface ResourceOptions extends BasePaywallOptions {
  kind: 'resource'
}

export interface PromptOptions extends BasePaywallOptions {
  kind: 'prompt'
}

export type PaywallOptions = ToolOptions | ResourceOptions | PromptOptions

/**
 * Options for decorating tools with paywall protection
 */
// decorate* helpers removed

/**
 * Authentication result from paywall validation
 */
export interface AuthResult {
  requestId: string
  token: string
  agentId: string
  logicalUrl: string
}

/**
 * MCP integration configuration
 */
export interface McpConfig {
  agentId: string
  serverName?: string
}
