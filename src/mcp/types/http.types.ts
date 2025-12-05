/**
 * Type definitions for MCP HTTP server and OAuth 2.1 integration.
 * These types configure the automatic OAuth endpoints and HTTP server functionality.
 */
import type { EnvironmentName } from '../../environments.js'

/**
 * OAuth URLs configuration for Nevermined authorization server.
 * These URLs are used to build the OAuth discovery metadata.
 */
export interface OAuthUrls {
  /** The issuer identifier (e.g., https://nevermined.app) */
  issuer: string
  /** OAuth authorization endpoint URL */
  authorizationUri: string
  /** OAuth token endpoint URL */
  tokenUri: string
  /** JSON Web Key Set endpoint URL */
  jwksUri: string
  /** OpenID Connect userinfo endpoint URL */
  userinfoUri: string
}

/**
 * Scopes supported by the MCP OAuth integration.
 */
export const DEFAULT_OAUTH_SCOPES = [
  'openid',
  'profile',
  'credits',
  'mcp:read',
  'mcp:write',
  'mcp:tools',
] as const

export type OAuthScope = (typeof DEFAULT_OAUTH_SCOPES)[number]

/**
 * Configuration for OAuth endpoints and metadata.
 */
export interface OAuthConfig {
  /** Base URL of the MCP server (e.g., http://localhost:5001) */
  baseUrl: string
  /** Agent ID (client_id) for OAuth flows */
  agentId: string
  /** Nevermined environment to derive OAuth URLs */
  environment: EnvironmentName
  /** Custom OAuth URLs (overrides environment defaults) */
  oauthUrls?: Partial<OAuthUrls>
  /** Scopes supported by this server */
  scopes?: string[]
  /** Server name for MCP protocol */
  serverName?: string
  /** List of tool names exposed by this server */
  tools?: string[]
  /** List of resource names exposed by this server */
  resources?: string[]
  /** List of prompt names exposed by this server */
  prompts?: string[]
  /** MCP protocol version */
  protocolVersion?: string
}

/**
 * Configuration for the HTTP router.
 */
export interface HttpRouterConfig extends OAuthConfig {
  /** Enable OAuth discovery endpoints (/.well-known/*) */
  enableOAuthDiscovery?: boolean
  /** Enable dynamic client registration (/register) */
  enableClientRegistration?: boolean
  /** Enable health check endpoint (/health) */
  enableHealthCheck?: boolean
  /** Enable server info endpoint (/) */
  enableServerInfo?: boolean
  /** Custom CORS origins (default: '*') */
  corsOrigins?: string | string[]
}

/**
 * Configuration for the managed HTTP server.
 */
export interface HttpServerConfig extends HttpRouterConfig {
  /** Port to listen on */
  port: number
  /** Host to bind to (default: '0.0.0.0') */
  host?: string
}

/**
 * Result returned when starting the managed HTTP server.
 */
export interface HttpServerResult {
  /** The underlying HTTP server instance */
  server: import('http').Server
  /** The Express application instance */
  app: import('express').Application
  /** Stop the server gracefully */
  stop: () => Promise<void>
  /** The base URL of the running server */
  baseUrl: string
  /** The port the server is listening on */
  port: number
}

/**
 * OAuth Protected Resource Metadata response (RFC 9728).
 */
export interface ProtectedResourceMetadata {
  resource: string
  authorization_servers: string[]
  scopes_supported: string[]
  bearer_methods_supported: string[]
  resource_documentation?: string
}

/**
 * MCP-specific Protected Resource Metadata.
 */
export interface McpProtectedResourceMetadata extends ProtectedResourceMetadata {
  scopes_required?: string[]
  mcp_capabilities?: {
    tools?: string[]
    protocol_version?: string
  }
}

/**
 * OAuth Authorization Server Metadata response (RFC 8414).
 */
export interface AuthorizationServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  jwks_uri: string
  response_types_supported: string[]
  grant_types_supported: string[]
  code_challenge_methods_supported: string[]
  scopes_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  subject_types_supported: string[]
}

/**
 * OpenID Connect Discovery Metadata.
 */
export interface OidcConfiguration extends AuthorizationServerMetadata {
  userinfo_endpoint?: string
  id_token_signing_alg_values_supported?: string[]
  claims_supported?: string[]
}

/**
 * OAuth Dynamic Client Registration request (RFC 7591).
 */
export interface ClientRegistrationRequest {
  redirect_uris: string[]
  client_name?: string
  client_uri?: string
  logo_uri?: string
  scope?: string
  grant_types?: string[]
  response_types?: string[]
  token_endpoint_auth_method?: string
  contacts?: string[]
}

/**
 * OAuth Dynamic Client Registration response (RFC 7591).
 */
export interface ClientRegistrationResponse {
  client_id: string
  client_id_issued_at: number
  client_name?: string
  redirect_uris: string[]
  scope?: string
  grant_types?: string[]
  response_types?: string[]
  token_endpoint_auth_method?: string
  client_secret?: string
  client_secret_expires_at?: number
  client_uri?: string
  logo_uri?: string
  contacts?: string[]
}

/**
 * Server info response for the root endpoint.
 */
export interface ServerInfoResponse {
  name: string
  version: string
  description?: string
  endpoints: {
    mcp: string
    health?: string
    register?: string
  }
  oauth?: {
    authorization_server_metadata: string
    protected_resource_metadata: string
    openid_configuration: string
    authorization_endpoint: string
    token_endpoint: string
    jwks_uri: string
    registration_endpoint?: string
    client_id: string
    scopes: string[]
  }
  tools?: string[]
  resources?: string[]
  prompts?: string[]
}
