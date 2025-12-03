/**
 * Pure functions to generate OAuth 2.1 metadata responses.
 * These generators produce the JSON payloads for OAuth discovery endpoints
 * without any framework dependencies, making them reusable across different HTTP servers.
 */
import { Environments, type EnvironmentName } from '../../environments.js'
import type {
  OAuthUrls,
  OAuthConfig,
  ProtectedResourceMetadata,
  McpProtectedResourceMetadata,
  AuthorizationServerMetadata,
  OidcConfiguration,
} from '../types/http.types.js'

/**
 * Build OAuth URLs from frontend and backend URLs.
 * - issuer and authorizationUri use the frontend (user-facing)
 * - tokenUri, jwksUri, userinfoUri use the backend (API)
 *
 * @param frontendUrl - The frontend URL (e.g., https://nevermined.app)
 * @param backendUrl - The backend URL (e.g., https://api.sandbox.nevermined.app)
 * @returns OAuth URLs configuration
 */
function buildOAuthUrls(frontendUrl: string, backendUrl: string): OAuthUrls {
  // Remove trailing slashes
  const frontend = frontendUrl.replace(/\/$/, '')
  const backend = backendUrl.replace(/\/$/, '')

  return {
    issuer: frontend,
    authorizationUri: `${frontend}/oauth/authorize`,
    tokenUri: `${backend}/oauth/token`,
    jwksUri: `${backend}/.well-known/jwks.json`,
    userinfoUri: `${backend}/oauth/userinfo`,
  }
}

/**
 * Get OAuth URLs for an environment.
 * Uses frontend and backend URLs from Environments configuration.
 *
 * @param environment - The Nevermined environment name
 * @returns OAuth URLs configuration
 */
function getOAuthUrlsForEnvironment(environment: EnvironmentName): OAuthUrls {
  const envConfig = Environments[environment] || Environments.sandbox
  return buildOAuthUrls(envConfig.frontend, envConfig.backend)
}

/**
 * Default scopes supported by Nevermined MCP servers.
 */
const DEFAULT_SCOPES: readonly string[] = [
  'openid',
  'profile',
  'credits',
  'mcp:read',
  'mcp:write',
  'mcp:tools',
]

/**
 * Get OAuth URLs for a given environment with optional overrides.
 *
 * @param environment - The Nevermined environment name
 * @param overrides - Optional partial overrides for specific URLs
 * @returns Complete OAuth URLs configuration
 */
export function getOAuthUrls(
  environment: EnvironmentName,
  overrides?: Partial<OAuthUrls>,
): OAuthUrls {
  const baseUrls = getOAuthUrlsForEnvironment(environment)
  return { ...baseUrls, ...overrides }
}

/**
 * Build Protected Resource Metadata (RFC 9728).
 * This metadata tells OAuth clients about the protected resource.
 *
 * @param config - OAuth configuration
 * @returns Protected Resource Metadata response object
 *
 * @example
 * ```typescript
 * const metadata = buildProtectedResourceMetadata({
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   environment: 'staging_sandbox'
 * })
 * // Returns: { resource: 'http://localhost:5001', authorization_servers: [...], ... }
 * ```
 */
export function buildProtectedResourceMetadata(config: OAuthConfig): ProtectedResourceMetadata {
  const scopes = config.scopes || [...DEFAULT_SCOPES]
  // oauthUrls calculated but not used in this metadata (kept for future use)
  void getOAuthUrls(config.environment, config.oauthUrls)

  return {
    resource: config.baseUrl,
    authorization_servers: [config.baseUrl],
    scopes_supported: scopes,
    bearer_methods_supported: ['header'],
    resource_documentation: `${config.baseUrl}/`,
  }
}

/**
 * Build MCP-specific Protected Resource Metadata.
 * Extends the base metadata with MCP capabilities information.
 *
 * @param config - OAuth configuration
 * @returns MCP Protected Resource Metadata response object
 *
 * @example
 * ```typescript
 * const metadata = buildMcpProtectedResourceMetadata({
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   environment: 'staging_sandbox',
 *   tools: ['hello_world', 'weather']
 * })
 * ```
 */
export function buildMcpProtectedResourceMetadata(
  config: OAuthConfig,
): McpProtectedResourceMetadata {
  const scopes = config.scopes || [...DEFAULT_SCOPES]
  // oauthUrls calculated but not used in this metadata (kept for future use)
  void getOAuthUrls(config.environment, config.oauthUrls)

  return {
    resource: `${config.baseUrl}/mcp`,
    authorization_servers: [config.baseUrl],
    scopes_supported: scopes,
    scopes_required: scopes,
    bearer_methods_supported: ['header'],
    resource_documentation: `${config.baseUrl}/`,
    mcp_capabilities: {
      tools: config.tools || [],
      protocol_version: config.protocolVersion || '2024-11-05',
    },
  }
}

/**
 * Build OAuth Authorization Server Metadata (RFC 8414).
 * This metadata describes the OAuth authorization server configuration.
 *
 * @param config - OAuth configuration
 * @returns Authorization Server Metadata response object
 *
 * @example
 * ```typescript
 * const metadata = buildAuthorizationServerMetadata({
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   environment: 'staging_sandbox'
 * })
 * ```
 */
export function buildAuthorizationServerMetadata(config: OAuthConfig): AuthorizationServerMetadata {
  const oauthUrls = getOAuthUrls(config.environment, config.oauthUrls)
  const scopes = config.scopes || [...DEFAULT_SCOPES]

  return {
    issuer: oauthUrls.issuer,
    authorization_endpoint: oauthUrls.authorizationUri,
    token_endpoint: oauthUrls.tokenUri,
    registration_endpoint: `${config.baseUrl}/register`,
    jwks_uri: oauthUrls.jwksUri,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: scopes,
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    subject_types_supported: ['public'],
  }
}

/**
 * Build OpenID Connect Discovery Metadata.
 * Provides OIDC-compatible configuration for clients that expect OpenID Connect.
 *
 * @param config - OAuth configuration
 * @returns OIDC Configuration response object
 *
 * @example
 * ```typescript
 * const metadata = buildOidcConfiguration({
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   environment: 'staging_sandbox'
 * })
 * ```
 */
export function buildOidcConfiguration(config: OAuthConfig): OidcConfiguration {
  const oauthUrls = getOAuthUrls(config.environment, config.oauthUrls)
  const scopes = config.scopes || [...DEFAULT_SCOPES]
  const allScopes = scopes.includes('openid') ? scopes : ['openid', ...scopes]

  return {
    issuer: oauthUrls.issuer,
    authorization_endpoint: oauthUrls.authorizationUri,
    token_endpoint: oauthUrls.tokenUri,
    jwks_uri: oauthUrls.jwksUri,
    userinfo_endpoint: oauthUrls.userinfoUri,
    registration_endpoint: `${config.baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'HS256'],
    scopes_supported: allScopes,
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'name', 'email'],
  }
}

/**
 * Build server info response for the root endpoint.
 *
 * @param config - OAuth configuration
 * @param options - Additional options for the server info
 * @returns Server info response object
 */
export function buildServerInfoResponse(
  config: OAuthConfig,
  options?: {
    version?: string
    description?: string
  },
): {
  name: string
  version: string
  description: string
  endpoints: Record<string, string>
  oauth: Record<string, any>
  tools: string[]
} {
  const oauthUrls = getOAuthUrls(config.environment, config.oauthUrls)
  const scopes = config.scopes || [...DEFAULT_SCOPES]

  return {
    name: config.serverName || 'MCP Server',
    version: options?.version || '1.0.0',
    description:
      options?.description || 'MCP server with Nevermined OAuth integration via Streamable HTTP',
    endpoints: {
      mcp: `${config.baseUrl}/mcp`,
      health: `${config.baseUrl}/health`,
      register: `${config.baseUrl}/register`,
    },
    oauth: {
      authorization_server_metadata: `${config.baseUrl}/.well-known/oauth-authorization-server`,
      protected_resource_metadata: `${config.baseUrl}/.well-known/oauth-protected-resource`,
      openid_configuration: `${config.baseUrl}/.well-known/openid-configuration`,
      authorization_endpoint: oauthUrls.authorizationUri,
      token_endpoint: oauthUrls.tokenUri,
      jwks_uri: oauthUrls.jwksUri,
      registration_endpoint: `${config.baseUrl}/register`,
      client_id: config.agentId,
      scopes: scopes,
    },
    tools: config.tools || [],
  }
}
