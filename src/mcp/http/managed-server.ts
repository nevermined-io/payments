/**
 * Managed HTTP server for MCP with OAuth 2.1 support.
 * Provides a complete, ready-to-use HTTP server that handles
 * OAuth discovery, client registration, and MCP transport.
 */
import express, { type Application, type Request, type Response, type NextFunction } from 'express'
import type { Server } from 'http'
import type { Payments } from '../../payments.js'
import type { HttpServerConfig, HttpServerResult } from '../types/http.types.js'
import { createOAuthRouter, createCorsMiddleware, createJsonMiddleware } from './oauth-router.js'

/**
 * Configuration for the managed MCP server.
 */
export interface ManagedServerConfig extends HttpServerConfig {
  /** Payments instance for authentication */
  payments: Payments
  /** Server version */
  version?: string
  /** Server description */
  description?: string
  /** Callback when server starts */
  onStart?: (result: HttpServerResult) => void
  /** Callback for logging */
  onLog?: (message: string, level?: 'info' | 'warn' | 'error') => void
}

/**
 * Start a managed HTTP server with OAuth 2.1 support.
 * This creates a complete Express server with all OAuth endpoints,
 * CORS, JSON parsing, and authentication middleware pre-configured.
 *
 * @param config - Server configuration
 * @returns Server result with control methods
 *
 * @example
 * ```typescript
 * import { Payments } from '@nevermined-io/payments'
 *
 * const payments = Payments.getInstance({
 *   nvmApiKey: process.env.NVM_API_KEY!,
 *   environment: 'staging_sandbox'
 * })
 *
 * // Start a managed server
 * const { server, app, stop, baseUrl } = await startManagedServer({
 *   payments,
 *   port: 5001,
 *   baseUrl: 'http://localhost:5001',
 *   agentId: process.env.NVM_AGENT_ID!,
 *   environment: 'staging_sandbox',
 *   serverName: 'my-mcp-server',
 *   tools: ['hello_world', 'weather']
 * })
 *
 * console.log(`Server running at ${baseUrl}`)
 *
 * // Later: gracefully stop
 * await stop()
 * ```
 */
export async function startManagedServer(config: ManagedServerConfig): Promise<HttpServerResult> {
  const app: Application = express()

  const {
    payments,
    port,
    host = '0.0.0.0',
    baseUrl,
    agentId,
    environment,
    serverName = 'mcp-server',
    tools = [],
    scopes,
    oauthUrls,
    protocolVersion,
    enableOAuthDiscovery = true,
    enableClientRegistration = true,
    enableHealthCheck = true,
    enableServerInfo = true,
    corsOrigins = '*',
    version = '1.0.0',
    description,
    onLog,
  } = config

  // --- Apply global middleware ---

  // CORS
  app.use(createCorsMiddleware(corsOrigins))

  // JSON parsing
  app.use(createJsonMiddleware())

  // --- Mount OAuth router ---

  const oauthRouter = createOAuthRouter({
    payments,
    baseUrl,
    agentId,
    environment,
    serverName,
    tools,
    scopes,
    oauthUrls,
    protocolVersion,
    enableOAuthDiscovery,
    enableClientRegistration,
    enableHealthCheck,
    enableServerInfo,
    version,
    description,
  })

  app.use(oauthRouter)

  // --- Global error handler ---

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json')
      res.status(err.statusCode || 500).json({
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: {
          code: err.code || -32603,
          message: err.message || 'Internal server error',
        },
      })
    }
  })

  // --- 404 handler ---

  app.use((req: Request, res: Response) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json')
      res.status(404).json({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: `Method not found: ${req.method} ${req.path}`,
        },
        id: null,
      })
    }
  })

  // --- Start server ---

  return new Promise((resolve, reject) => {
    const server: Server = app.listen(port, host, () => {
      onLog?.(`MCP server started on ${host}:${port}`)
      onLog?.(`Base URL: ${baseUrl}`)

      if (enableHealthCheck) {
        onLog?.(`Health check: ${baseUrl}/health`)
      }

      if (enableOAuthDiscovery) {
        onLog?.(`OAuth discovery: ${baseUrl}/.well-known/oauth-authorization-server`)
      }

      if (enableClientRegistration) {
        onLog?.(`Client registration: ${baseUrl}/register`)
      }

      const result: HttpServerResult = {
        server,
        app,
        baseUrl,
        port,
        stop: async () => {
          return new Promise<void>((resolveStop, rejectStop) => {
            server.close((err) => {
              if (err) {
                rejectStop(err)
              } else {
                onLog?.('Server stopped')
                resolveStop()
              }
            })
          })
        },
      }

      if (config.onStart) {
        config.onStart(result)
      }

      resolve(result)
    })

    server.on('error', (error: Error) => {
      reject(error)
    })
  })
}

/**
 * Create an Express application pre-configured with OAuth support,
 * but without starting the server. This is useful when you want to
 * add additional routes or middleware before starting.
 *
 * @param config - Server configuration (without port/host)
 * @returns Configured Express application
 *
 * @example
 * ```typescript
 * const app = createMcpApp({
 *   payments,
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   environment: 'staging_sandbox'
 * })
 *
 * // Add custom routes
 * app.get('/custom', (req, res) => res.json({ custom: true }))
 *
 * // Add MCP handler - auth is handled by withPaywall() on each tool
 * app.post('/mcp', mcpHandler)
 *
 * // Start manually
 * app.listen(5001)
 * ```
 */
export function createMcpApp(
  config: Omit<ManagedServerConfig, 'port' | 'host' | 'onStart'>,
): Application {
  const app: Application = express()

  const {
    payments,
    baseUrl,
    agentId,
    environment,
    serverName = 'mcp-server',
    tools = [],
    scopes,
    oauthUrls,
    protocolVersion,
    enableOAuthDiscovery = true,
    enableClientRegistration = true,
    enableHealthCheck = true,
    enableServerInfo = true,
    corsOrigins = '*',
    version = '1.0.0',
    description,
  } = config

  // Apply middleware
  app.use(createCorsMiddleware(corsOrigins))
  app.use(createJsonMiddleware())

  // Mount OAuth router
  const oauthRouter = createOAuthRouter({
    payments,
    baseUrl,
    agentId,
    environment,
    serverName,
    tools,
    scopes,
    oauthUrls,
    protocolVersion,
    enableOAuthDiscovery,
    enableClientRegistration,
    enableHealthCheck,
    enableServerInfo,
    version,
    description,
  })

  app.use(oauthRouter)

  return app
}
