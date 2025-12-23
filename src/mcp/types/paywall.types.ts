/**
 * Type definitions for MCP paywall functionality
 */
import type { Address } from '../../common/types.js'

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
  /**
   * Optional override for the Nevermined plan to charge against.
   * If omitted, the plan is inferred from the X402 access token.
   */
  planId?: string
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
  token: string
  agentId: string
  logicalUrl: string
  planId: string
  subscriberAddress: Address
}

/**
 * Context provided to paywall-protected handlers
 */
export interface PaywallContext {
  authResult: AuthResult
  credits?: bigint
  planId: string
  subscriberAddress: Address
}

/**
 * MCP integration configuration
 */
export interface McpConfig {
  agentId: string
  serverName?: string
}
