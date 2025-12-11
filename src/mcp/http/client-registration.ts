/**
 * OAuth Dynamic Client Registration handler (RFC 7591).
 * Handles client registration requests for MCP OAuth flows.
 */
import { randomBytes } from 'crypto'
import type {
  OAuthConfig,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
} from '../types/http.types.js'

/**
 * Default scopes for client registration.
 */
const DEFAULT_SCOPES = ['openid', 'profile', 'credits', 'mcp:read', 'mcp:write', 'mcp:tools']

/**
 * Validation error for client registration.
 */
export class ClientRegistrationError extends Error {
  public readonly errorCode: string
  public readonly statusCode: number

  constructor(errorCode: string, message: string, statusCode = 400) {
    super(message)
    this.name = 'ClientRegistrationError'
    this.errorCode = errorCode
    this.statusCode = statusCode
  }

  /**
   * Get the error response body.
   */
  toJSON(): { error: string; error_description: string } {
    return {
      error: this.errorCode,
      error_description: this.message,
    }
  }
}

/**
 * Check if a request body is an OAuth Dynamic Client Registration request.
 *
 * @param body - The request body to check
 * @returns True if the body looks like a client registration request
 */
export function isClientRegistrationRequest(body: unknown): body is ClientRegistrationRequest {
  if (!body || typeof body !== 'object') return false

  const obj = body as Record<string, unknown>
  return !!(
    obj.redirect_uris ||
    obj.grant_types ||
    obj.token_endpoint_auth_method ||
    obj.response_types ||
    obj.client_name
  )
}

/**
 * Validate a client registration request.
 *
 * @param request - The client registration request
 * @throws ClientRegistrationError if validation fails
 */
export function validateClientRegistrationRequest(request: ClientRegistrationRequest): void {
  // redirect_uris is required and must be a non-empty array
  if (
    !request.redirect_uris ||
    !Array.isArray(request.redirect_uris) ||
    request.redirect_uris.length === 0
  ) {
    throw new ClientRegistrationError(
      'invalid_request',
      'redirect_uris is required and must be a non-empty array',
    )
  }

  // Validate each redirect_uri is a valid URL
  for (const uri of request.redirect_uris) {
    try {
      new URL(uri)
    } catch {
      throw new ClientRegistrationError('invalid_redirect_uri', `Invalid redirect_uri: ${uri}`)
    }
  }

  // Validate grant_types if provided
  const validGrantTypes = ['authorization_code', 'refresh_token', 'client_credentials']
  if (request.grant_types) {
    for (const grantType of request.grant_types) {
      if (!validGrantTypes.includes(grantType)) {
        throw new ClientRegistrationError(
          'invalid_client_metadata',
          `Unsupported grant_type: ${grantType}`,
        )
      }
    }
  }

  // Validate response_types if provided
  const validResponseTypes = ['code', 'token']
  if (request.response_types) {
    for (const responseType of request.response_types) {
      if (!validResponseTypes.includes(responseType)) {
        throw new ClientRegistrationError(
          'invalid_client_metadata',
          `Unsupported response_type: ${responseType}`,
        )
      }
    }
  }

  // Validate token_endpoint_auth_method if provided
  const validAuthMethods = ['none', 'client_secret_basic', 'client_secret_post']
  if (
    request.token_endpoint_auth_method &&
    !validAuthMethods.includes(request.token_endpoint_auth_method)
  ) {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      `Unsupported token_endpoint_auth_method: ${request.token_endpoint_auth_method}`,
    )
  }
}

/**
 * Generate a cryptographically secure client secret.
 *
 * @returns A base64url-encoded random string
 */
function generateClientSecret(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Process a client registration request and generate a response.
 *
 * @param request - The validated client registration request
 * @param config - OAuth configuration
 * @returns Client registration response
 *
 * @example
 * ```typescript
 * const response = await processClientRegistration(
 *   { redirect_uris: ['http://localhost:3000/callback'], client_name: 'My App' },
 *   { agentId: 'agent_123', baseUrl: 'http://localhost:5001', environment: 'staging_sandbox' }
 * )
 * ```
 */
export async function processClientRegistration(
  request: ClientRegistrationRequest,
  config: OAuthConfig,
): Promise<ClientRegistrationResponse> {
  // Validate the request
  validateClientRegistrationRequest(request)

  // Use agentId as client_id (consistent for this MCP server)
  const clientId = config.agentId
  const issuedAt = Math.floor(Date.now() / 1000)

  // Determine auth method and if secret is needed
  const authMethod = request.token_endpoint_auth_method || 'none'
  const needsSecret = authMethod === 'client_secret_basic' || authMethod === 'client_secret_post'

  // Build response
  const response: ClientRegistrationResponse = {
    client_id: clientId,
    client_id_issued_at: issuedAt,
    client_name: request.client_name || 'MCP Client',
    redirect_uris: request.redirect_uris,
    scope: request.scope || (config.scopes || DEFAULT_SCOPES).join(' '),
    grant_types: request.grant_types || ['authorization_code'],
    response_types: request.response_types || ['code'],
    token_endpoint_auth_method: authMethod,
  }

  // Generate client_secret if needed
  if (needsSecret) {
    response.client_secret = generateClientSecret()
    response.client_secret_expires_at = 0 // 0 means never expires
  }

  // Add optional fields if provided
  if (request.client_uri) response.client_uri = request.client_uri
  if (request.logo_uri) response.logo_uri = request.logo_uri
  if (request.contacts) response.contacts = request.contacts

  return response
}
