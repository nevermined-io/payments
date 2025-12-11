/**
 * Type definitions for MCP module.
 */

// Paywall types
export type {
  CreditsContext,
  CreditsOption,
  BasePaywallOptions,
  ToolOptions,
  ResourceOptions,
  PromptOptions,
  PaywallOptions,
  AuthResult,
  PaywallContext,
  McpConfig,
} from './paywall.types.js'

// HTTP/OAuth types
export type {
  OAuthUrls,
  OAuthScope,
  OAuthConfig,
  HttpRouterConfig,
  HttpServerConfig,
  HttpServerResult,
  ProtectedResourceMetadata,
  McpProtectedResourceMetadata,
  AuthorizationServerMetadata,
  OidcConfiguration,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
  ServerInfoResponse,
} from './http.types.js'

export { DEFAULT_OAUTH_SCOPES } from './http.types.js'

// Simplified server types
export type {
  McpToolConfig,
  McpResourceConfig,
  McpPromptConfig,
  McpRegistrationOptions,
  ToolHandler,
  ResourceHandler,
  PromptHandler,
  McpServerConfig,
  McpServerResult,
  ServerInfo,
  ToolContext,
  ResourceContext,
  PromptContext,
  ToolRegistration,
  ResourceRegistration,
  PromptRegistration,
} from './server.types.js'
