/**
 * Express Router for OAuth 2.1 endpoints.
 * Provides a pre-configured router with all OAuth discovery and registration endpoints
 * that can be mounted on any Express application.
 */
import express, { type Router, type Request, type Response, type NextFunction } from 'express'
import type { Payments } from '../../payments.js'
import type { HttpRouterConfig } from '../types/http.types.js'
import {
  buildProtectedResourceMetadata,
  buildMcpProtectedResourceMetadata,
  buildAuthorizationServerMetadata,
  buildOidcConfiguration,
  buildServerInfoResponse,
} from './oauth-metadata.js'
import {
  isClientRegistrationRequest,
  processClientRegistration,
  ClientRegistrationError,
} from './client-registration.js'

/**
 * Options for creating the OAuth router.
 */
export interface OAuthRouterOptions extends HttpRouterConfig {
  /** Payments instance for authentication */
  payments: Payments
  /** Server version for info endpoint */
  version?: string
  /** Server description for info endpoint */
  description?: string
  /** Optional logging callback (no logs by default) */
  onLog?: (message: string) => void
}

/**
 * Create an Express router with OAuth 2.1 discovery and registration endpoints.
 * This router can be mounted on any Express application to add OAuth support.
 *
 * @param options - Router configuration options
 * @returns Express Router with OAuth endpoints
 *
 * @example
 * ```typescript
 * import express from 'express'
 * import { Payments } from '@nevermined-io/payments'
 *
 * const app = express()
 * const payments = Payments.getInstance({ nvmApiKey: '...', environment: 'staging_sandbox' })
 *
 * // Create and mount the OAuth router
 * const oauthRouter = createOAuthRouter({
 *   payments,
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   environment: 'staging_sandbox',
 *   serverName: 'my-mcp-server',
 *   tools: ['hello_world']
 * })
 *
 * app.use(oauthRouter)
 * app.listen(5001)
 * ```
 */
export function createOAuthRouter(options: OAuthRouterOptions): Router {
  const router: Router = express.Router()

  const {
    baseUrl,
    agentId,
    environment,
    serverName = 'mcp-server',
    tools = [],
    resources = [],
    prompts = [],
    scopes,
    oauthUrls,
    protocolVersion,
    enableOAuthDiscovery = true,
    enableClientRegistration = true,
    enableHealthCheck = true,
    enableServerInfo = true,
    version = '1.0.0',
    description,
    onLog,
  } = options

  // Optional logging helper (no-op if onLog not provided)
  const log =
    onLog ||
    (() => {
      // Intentionally empty - no logging when onLog not provided
    })

  // Build config object for metadata generators
  const config = {
    baseUrl,
    agentId,
    environment,
    serverName,
    tools,
    resources,
    prompts,
    scopes,
    oauthUrls,
    protocolVersion,
  }

  // --- OAuth Discovery Endpoints ---

  if (enableOAuthDiscovery) {
    /**
     * Protected Resource Metadata (RFC 9728)
     * GET /.well-known/oauth-protected-resource
     */
    router.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
      log(`GET /.well-known/oauth-protected-resource`)
      const metadata = buildProtectedResourceMetadata(config)
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.json(metadata)
    })

    /**
     * MCP-specific Protected Resource Metadata
     * GET /.well-known/oauth-protected-resource/mcp
     */
    router.get('/.well-known/oauth-protected-resource/mcp', (req: Request, res: Response) => {
      log(`GET /.well-known/oauth-protected-resource/mcp`)
      const metadata = buildMcpProtectedResourceMetadata(config)
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.json(metadata)
    })

    /**
     * OAuth Authorization Server Metadata (RFC 8414)
     * GET /.well-known/oauth-authorization-server
     */
    router.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
      log(`GET /.well-known/oauth-authorization-server`)
      const metadata = buildAuthorizationServerMetadata(config)
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.json(metadata)
    })

    /**
     * OpenID Connect Discovery (for OIDC compatibility)
     * GET /.well-known/openid-configuration
     */
    router.get('/.well-known/openid-configuration', (req: Request, res: Response) => {
      log(`GET /.well-known/openid-configuration`)
      const metadata = buildOidcConfiguration(config)
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.json(metadata)
    })
  }

  // --- Dynamic Client Registration ---

  if (enableClientRegistration) {
    /**
     * OAuth Dynamic Client Registration (RFC 7591)
     * POST /register
     */
    router.post('/register', async (req: Request, res: Response) => {
      log(`POST /register`)
      try {
        // Check if this is an OAuth registration request
        if (!isClientRegistrationRequest(req.body)) {
          log(`Invalid registration request`)
          // Not a registration request - return error
          res.status(400).json({
            error: 'invalid_request',
            error_description: 'Request body is not a valid client registration request',
          })
          return
        }

        // Process registration
        const response = await processClientRegistration(req.body, config)
        log(`Client registered: ${response.client_id}`)

        // Return successful registration (201 Created)
        res.status(201).json(response)
      } catch (error: any) {
        log(`Registration error: ${error?.message || error}`)
        if (error instanceof ClientRegistrationError) {
          res.status(error.statusCode).json(error.toJSON())
          return
        }

        // Unexpected error
        res.status(500).json({
          error: 'server_error',
          error_description: error?.message || 'Internal server error during client registration',
        })
      }
    })
  }

  // --- Health Check ---

  if (enableHealthCheck) {
    /**
     * Health check endpoint
     * GET /health
     */
    router.get('/health', (req: Request, res: Response) => {
      log(`GET /health`)
      res.json({
        status: 'ok',
        service: serverName,
        timestamp: new Date().toISOString(),
      })
    })
  }

  // --- Server Info ---

  if (enableServerInfo) {
    /**
     * Server info endpoint
     * GET /
     */
    router.get('/', (req: Request, res: Response) => {
      log(`GET /`)
      const info = buildServerInfoResponse(config, { version, description })
      res.json(info)
    })
  }

  return router
}

/**
 * Apply CORS headers to an Express application.
 * This is a utility function for setting up CORS in MCP servers.
 *
 * @param origins - Allowed origins (default: '*')
 * @returns Express middleware for CORS
 */
export function createCorsMiddleware(origins: string | string[] = '*') {
  return function corsMiddleware(req: Request, res: Response, next: NextFunction) {
    const origin = Array.isArray(origins) ? origins.join(', ') : origins

    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version',
    )
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')

    if (req.method === 'OPTIONS') {
      res.status(200).end()
      return
    }

    next()
  }
}

/**
 * Create a JSON body parser middleware that ensures JSON responses.
 * This wraps express.json() and adds response formatting.
 *
 * @returns Express middleware for JSON parsing
 */
export function createJsonMiddleware() {
  return function jsonMiddleware(req: Request, res: Response, next: NextFunction) {
    // Ensure JSON content type on responses
    const originalJson = res.json.bind(res)
    res.json = function (body: any) {
      res.setHeader('Content-Type', 'application/json')
      return originalJson(body)
    }

    // Parse JSON body
    express.json()(req, res, (err: any) => {
      if (err) {
        res.status(400).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error: Invalid JSON',
          },
        })
        return
      }
      next()
    })
  }
}

/**
 * Create a middleware that requires a Bearer token in the Authorization header.
 * Returns HTTP 401 if the token is missing or malformed.
 *
 * This is a lightweight check that only verifies presence of a token.
 * Full validation (is the token valid? does the user have access?) is handled
 * by withPaywall() when a tool is actually called.
 *
 * @returns Express middleware for token requirement
 *
 * @example
 * ```typescript
 * const requireAuth = createRequireAuthMiddleware()
 *
 * // Protect MCP endpoints
 * app.post('/mcp', requireAuth, mcpHandler)
 * app.get('/mcp', requireAuth, sseHandler)
 * ```
 */
export function createRequireAuthMiddleware() {
  return function requireAuthMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization

    if (!authHeader) {
      res.status(401).json({
        error: 'unauthorized',
        error_description: 'Authorization header required',
      })
      return
    }

    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'unauthorized',
        error_description: 'Bearer token required',
      })
      return
    }

    const token = authHeader.slice(7).trim()
    if (!token) {
      res.status(401).json({
        error: 'unauthorized',
        error_description: 'Bearer token cannot be empty',
      })
      return
    }

    // Token present and well-formed, continue
    // Full validation happens in withPaywall() when tools are called
    next()
  }
}

/**
 * Create a middleware that logs all HTTP requests to endpoints.
 * Logs method, URL, IP address, and relevant headers.
 *
 * @param onLog - Optional logging callback. If not provided, does nothing.
 * @returns Express middleware for HTTP request logging
 *
 * @example
 * ```typescript
 * const logMiddleware = createHttpLoggingMiddleware((msg) => console.log(msg))
 * app.use(logMiddleware)
 * ```
 */
export function createHttpLoggingMiddleware(onLog?: (message: string) => void) {
  const log =
    onLog ||
    ((message: string) => {
      // Intentionally empty - no logging when onLog not provided
    })

  return function httpLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
    const method = req.method
    const url = req.originalUrl || req.url
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const timestamp = new Date().toISOString()

    // Extract relevant headers
    const authHeader = req.headers.authorization
    const sessionId = req.headers['mcp-session-id']
    const protocolVersion = req.headers['mcp-protocol-version']
    const userAgent = req.headers['user-agent']

    // Build log message
    const logParts: string[] = [`[${timestamp}]`, `${method}`, url, `IP: ${ip}`]

    if (authHeader) {
      const tokenPreview = authHeader.startsWith('Bearer ')
        ? `Bearer ${authHeader.slice(7, 20)}...`
        : 'Bearer [present]'
      logParts.push(`Auth: ${tokenPreview}`)
    }

    if (sessionId) {
      const sessionValue = Array.isArray(sessionId) ? sessionId[0] : sessionId
      logParts.push(`Session: ${sessionValue}`)
    }

    if (protocolVersion) {
      const versionValue = Array.isArray(protocolVersion) ? protocolVersion[0] : protocolVersion
      logParts.push(`MCP-Version: ${versionValue}`)
    }

    if (userAgent) {
      const uaValue = Array.isArray(userAgent) ? userAgent[0] : userAgent
      logParts.push(`User-Agent: ${uaValue}`)
    }

    log(`HTTP Request: ${logParts.join(' | ')}`)

    next()
  }
}
