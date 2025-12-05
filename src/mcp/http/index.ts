/**
 * HTTP module for MCP OAuth 2.1 integration.
 *
 * This module provides all the building blocks for adding OAuth 2.1 support
 * to MCP servers, from low-level metadata generators to high-level managed servers.
 *
 * @example Quick start with managed server
 * ```typescript
 * import { Payments } from '@nevermined-io/payments'
 *
 * const payments = Payments.getInstance({
 *   nvmApiKey: process.env.NVM_API_KEY!,
 *   environment: 'staging_sandbox'
 * })
 *
 * // Start a complete MCP server with OAuth
 * const { baseUrl, stop } = await payments.mcp.startServer({
 *   port: 5001,
 *   agentId: process.env.NVM_AGENT_ID!,
 *   serverName: 'my-mcp-server',
 *   tools: ['hello_world']
 * })
 * ```
 *
 * @example Using the router with existing Express app
 * ```typescript
 * import express from 'express'
 *
 * const app = express()
 *
 * // Mount OAuth router on existing app
 * const router = payments.mcp.createRouter({
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   serverName: 'my-mcp-server'
 * })
 *
 * app.use(router)
 * app.listen(5001)
 * ```
 */

// OAuth metadata generators (pure functions)
export {
  getOAuthUrls,
  buildProtectedResourceMetadata,
  buildMcpProtectedResourceMetadata,
  buildAuthorizationServerMetadata,
  buildOidcConfiguration,
  buildServerInfoResponse,
} from './oauth-metadata.js'

// Client registration
export {
  isClientRegistrationRequest,
  validateClientRegistrationRequest,
  processClientRegistration,
  ClientRegistrationError,
} from './client-registration.js'

// OAuth router and middleware
export {
  createOAuthRouter,
  createCorsMiddleware,
  createJsonMiddleware,
  createRequireAuthMiddleware,
  createHttpLoggingMiddleware,
  type OAuthRouterOptions,
} from './oauth-router.js'

// Managed server
export { startManagedServer, createMcpApp, type ManagedServerConfig } from './managed-server.js'

// Session management
export {
  SessionManager,
  createSessionManager,
  type SessionManagerConfig,
} from './session-manager.js'

// MCP handlers
export {
  createPostMcpHandler,
  createGetMcpHandler,
  createDeleteMcpHandler,
  mountMcpHandlers,
  getCurrentRequestContext,
  requestContextStorage,
  type McpHandlerConfig,
} from './mcp-handler.js'
