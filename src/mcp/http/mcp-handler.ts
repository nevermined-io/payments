/**
 * HTTP handlers for MCP endpoints.
 * Provides POST, GET, and DELETE handlers for the /mcp endpoint.
 */
import { AsyncLocalStorage } from 'async_hooks'
import type { Request, Response, Router } from 'express'
import type { SessionManager, RequestContext } from './session-manager.js'
import { createRequireAuthMiddleware } from './oauth-router.js'

/**
 * AsyncLocalStorage to store request context within the async flow.
 * This allows handlers deep in the call stack to access HTTP headers.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>()

/**
 * Get the current request context from AsyncLocalStorage.
 * Returns undefined if not in a request context.
 */
export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore()
}

/**
 * Configuration for MCP handlers.
 */
export interface McpHandlerConfig {
  /** Session manager instance */
  sessionManager: SessionManager
  /** Whether to require authentication (default: true) */
  requireAuth?: boolean
  /** Logger function */
  log?: (message: string) => void
}

/**
 * Extract session ID from request headers.
 */
function extractSessionId(req: Request): string | undefined {
  const headerVal = req.headers['mcp-session-id']
  return Array.isArray(headerVal) ? headerVal[0] : (headerVal as string | undefined)
}

/**
 * Check if request is an initialize request.
 */
function isInitializeRequest(body: any): boolean {
  return body && typeof body === 'object' && body.method === 'initialize'
}

/**
 * Ensure Accept header includes required MIME types.
 */
function ensureAcceptHeader(req: Request): void {
  if (!req.headers.accept) {
    req.headers.accept = 'application/json, text/event-stream'
  } else if (
    !req.headers.accept.includes('application/json') ||
    !req.headers.accept.includes('text/event-stream')
  ) {
    const accept = req.headers.accept.split(',').map((s: string) => s.trim())
    if (!accept.includes('application/json')) {
      accept.push('application/json')
    }
    if (!accept.includes('text/event-stream')) {
      accept.push('text/event-stream')
    }
    req.headers.accept = accept.join(', ')
  }
}

/**
 * Create the POST /mcp handler.
 */
export function createPostMcpHandler(config: McpHandlerConfig) {
  const { sessionManager, log } = config

  return async function postMcpHandler(req: Request, res: Response): Promise<void> {
    try {
      log?.(`POST /mcp`)

      if (!req.body || typeof req.body !== 'object') {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error: Invalid JSON-RPC request',
          },
          id: null,
        })
        return
      }

      const clientSessionId = extractSessionId(req)
      const isInit = isInitializeRequest(req.body)

      let sessionId = clientSessionId
      if (isInit || !sessionId) {
        sessionId = sessionManager.generateSessionId()
        log?.(`Created new session: ${sessionId}`)
      }

      res.setHeader('Mcp-Session-Id', sessionId)
      ensureAcceptHeader(req)

      // Create request context with HTTP headers
      const requestContext: RequestContext = {
        headers: req.headers as Record<string, string | string[] | undefined>,
        method: req.method,
        url: req.url,
        ip: req.ip,
      }

      // Store in session manager for later access
      sessionManager.setRequestContext(sessionId, requestContext)

      const transport = await sessionManager.getOrCreateSession(sessionId)

      // Run transport handling within AsyncLocalStorage context
      // This makes headers available to tool handlers via getCurrentRequestContext()
      await requestContextStorage.run(requestContext, async () => {
        await transport.handleRequest(req, res, req.body)
      })
    } catch (error: unknown) {
      // Silently handle errors - library should not log
      if (!res.headersSent) {
        const errorMessage = error instanceof Error ? error.message : 'Internal server error'
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: errorMessage,
          },
          id: (req.body as any)?.id || null,
        })
      }
    }
  }
}

/**
 * Create the GET /mcp handler (SSE stream).
 */
export function createGetMcpHandler(config: McpHandlerConfig) {
  const { sessionManager, log } = config

  return async function getMcpHandler(req: Request, res: Response): Promise<void> {
    log?.(`GET /mcp (SSE)`)

    const sessionId = extractSessionId(req)

    if (!sessionId || !sessionManager.hasSession(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    log?.(`Establishing SSE stream for session ${sessionId}`)
    const transport = sessionManager.getSession(sessionId)
    if (!transport) {
      res.status(400).json({ error: 'Session transport not found' })
      return
    }
    await transport.handleRequest(req, res)
  }
}

/**
 * Create the DELETE /mcp handler (session termination).
 */
export function createDeleteMcpHandler(config: McpHandlerConfig) {
  const { sessionManager, log } = config

  return async function deleteMcpHandler(req: Request, res: Response): Promise<void> {
    log?.(`DELETE /mcp`)

    const sessionId = extractSessionId(req)

    if (sessionId && sessionManager.destroySession(sessionId)) {
      log?.(`Destroyed session: ${sessionId}`)
      res.status(204).end()
    } else {
      res.status(404).json({ error: 'Session not found' })
    }
  }
}

/**
 * Mount all MCP handlers on an Express router.
 */
export function mountMcpHandlers(router: Router, config: McpHandlerConfig): void {
  const { requireAuth = true } = config

  const postHandler = createPostMcpHandler(config)
  const getHandler = createGetMcpHandler(config)
  const deleteHandler = createDeleteMcpHandler(config)

  if (requireAuth) {
    const authMiddleware = createRequireAuthMiddleware()
    router.post('/mcp', authMiddleware, postHandler as any)
    router.get('/mcp', authMiddleware, getHandler as any)
    router.delete('/mcp', authMiddleware, deleteHandler as any)
  } else {
    router.post('/mcp', postHandler as any)
    router.get('/mcp', getHandler as any)
    router.delete('/mcp', deleteHandler as any)
  }
}
