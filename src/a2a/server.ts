/**
 * PaymentsA2AServer sets up and starts the A2A server for payments agents.
 * Handles A2A protocol endpoints and allows optional custom endpoints.
 *
 * The server provides a complete A2A protocol implementation with:
 * - JSON-RPC endpoint for A2A messages
 * - Agent Card endpoint (.well-known/agent.json)
 * - Bearer token extraction and validation
 * - Credit validation and burning
 * - Task execution and streaming
 * - Customizable routes and handlers
 */
import express from 'express'
import http from 'http'
import { InMemoryTaskStore, JsonRpcTransportHandler, AgentExecutor } from '@a2a-js/sdk/server'
import type { AgentCard, HttpRequestContext } from './types.js'
import { PaymentsRequestHandler } from './paymentsRequestHandler.js'

/**
 * Checks if a value is an AsyncIterable (used to detect streaming responses)
 */
function isAsyncIterable<T>(value: any): value is AsyncIterable<T> {
  return value && typeof value[Symbol.asyncIterator] === 'function'
}

/**
 * Sends a JSON-RPC result. If it's an async iterator, streams as SSE; otherwise returns JSON.
 */
async function sendRpcResult(res: express.Response, result: any): Promise<void> {
  if (isAsyncIterable(result)) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    const anyRes = res as any
    if (typeof anyRes.flushHeaders === 'function') anyRes.flushHeaders()
    for await (const chunk of result as AsyncGenerator<any, void, undefined>) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }
    res.end()
    return
  }
  res.json(result)
}

/**
 * Options for starting the PaymentsA2AServer.
 * Provides comprehensive configuration for A2A server setup.
 */
export interface PaymentsA2AServerOptions {
  /** The agent card defining the agent's capabilities and metadata */
  agentCard: AgentCard
  /** User-implemented executor for handling A2A tasks */
  executor: AgentExecutor
  /** Payments service instance for credit validation and burning */
  paymentsService: any
  /** Port number to bind the server to */
  /** Port number to listen on. Use 0 for automatic port assignment. */
  port: number
  /** Custom task store implementation (defaults to InMemoryTaskStore) */
  taskStore?: any
  /** Base path for all A2A routes (defaults to '/') */
  basePath?: string
  /** Whether to expose the agent card at .well-known/agent.json */
  exposeAgentCard?: boolean
  /** Whether to expose default A2A JSON-RPC routes */
  exposeDefaultRoutes?: boolean
  /** Custom Express app instance (defaults to new express()) */
  expressApp?: express.Express
  /** Custom request handler to override JSON-RPC method handling */
  customRequestHandler?: any
  /** Options for configuring the PaymentsRequestHandler behavior */
  handlerOptions?: {
    asyncExecution?: boolean
    defaultBatch?: boolean
    defaultMarginPercent?: number
  }
  /** Hooks for intercepting requests before/after processing */
  hooks?: {
    /** Called before processing any JSON-RPC request */
    beforeRequest?: (method: string, params: any, req: express.Request) => Promise<void>
    /** Called after processing any JSON-RPC request */
    afterRequest?: (method: string, result: any, req: express.Request) => Promise<void>
    /** Called when a JSON-RPC request fails */
    onError?: (method: string, error: Error, req: express.Request) => Promise<void>
  }
}

/**
 * Result returned by the server start method.
 * Contains the Express app and HTTP server instances for further customization.
 */
export interface PaymentsA2AServerResult {
  /** The configured Express application */
  app: express.Express
  /** The HTTP server instance */
  server: http.Server
  /** The request handler instance for direct access if needed */
  handler: PaymentsRequestHandler
  /** The actual port the server is listening on */
  port: number
  /**
   * Closes the server and all active connections.
   * @returns Promise that resolves when the server is fully closed
   */
  close: () => Promise<void>
}

/**
 * Middleware to extract payment token from HTTP headers and store it in the global context.
 * This middleware is applied after A2A routes are set up and extracts authentication
 * information for credit validation.
 *
 * Per x402 HTTP transport spec v2, expects:
 * - PAYMENT-SIGNATURE: Base64-encoded PaymentPayload
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
async function bearerTokenMiddleware(
  handler: PaymentsRequestHandler,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  // Only process POST requests (A2A uses POST for all operations)
  if (req.method !== 'POST') {
    return next()
  }

  // x402 HTTP spec v2: client sends payment in PAYMENT-SIGNATURE header (base64-encoded)
  const paymentSignatureHeader = req.headers['payment-signature'] as string | undefined

  if (!paymentSignatureHeader) {
    res.status(401).json({
      error: {
        code: -32001,
        message: 'Missing PAYMENT-SIGNATURE header.',
      },
    })
    return
  }

  const bearerToken = paymentSignatureHeader

  // Transform relative URL to absolute URL
  const absoluteUrl = new URL(req.originalUrl, req.protocol + '://' + req.get('host')).toString()

  const agentCard = await handler.getAgentCard()
  const paymentExtension = agentCard.capabilities?.extensions?.find(
    (ext) => ext.uri === 'urn:nevermined:payment',
  )

  if (!paymentExtension?.params?.agentId) {
    res.status(402).json({
      error: {
        code: -32001,
        message: 'Agent ID not found in agent card payment extension.',
      },
    })
    return
  }

  let validation: any
  try {
    validation = await handler.validateRequest(
      bearerToken,
      absoluteUrl,
      req.method,
    )
    if (!validation?.balance?.isSubscriber) {
      res.status(402).json({
        error: {
          code: -32001,
          message: 'Insufficient credits or invalid request.',
        },
      })
      return
    }
  } catch (err) {
    res.status(402).json({
      error: {
        code: -32001,
        message: 'Payment validation failed: ' + (err instanceof Error ? err.message : String(err)),
      },
    })
    return
  }

  const context: HttpRequestContext = {
    bearerToken,
    urlRequested: absoluteUrl,
    httpMethodRequested: req.method,
    validation,
  }
  // Try to associate context with taskId or messageId
  const taskId = req.body?.taskId
  const messageId = req.body?.params?.message?.messageId

  if (taskId) {
    handler.setHttpRequestContextForTask(taskId, context)
  } else if (messageId) {
    handler.setHttpRequestContextForMessage(messageId, context)
  }

  next()
}

/**
 * PaymentsA2AServer sets up the A2A endpoints and starts the server.
 *
 * This class provides a complete A2A protocol implementation with payment integration.
 * It handles:
 * - JSON-RPC message routing
 * - Agent card exposure
 * - Bearer token extraction
 * - Credit validation and burning
 * - Task execution and streaming
 * - Customizable routes and handlers
 *
 * @example
 * ```typescript
 * const server = PaymentsA2AServer.start({
 *   agentCard: myAgentCard,
 *   executor: new MyExecutor(),
 *   paymentsService: payments,
 *   port: 41242,
 *   basePath: '/a2a/',
 *   hooks: {
 *     beforeRequest: async (method, params, req) => {
 *       console.log(`Processing ${method} request`)
 *     }
 *   }
 * })
 * ```
 */
export class PaymentsA2AServer {
  /**
   * Starts the A2A server with the given options.
   *
   * This method sets up the complete A2A server infrastructure including:
   * - Express app configuration
   * - A2A route setup
   * - Middleware for bearer token extraction
   * - Agent card endpoint
   * - HTTP server creation and binding
   *
   * @param options - Server configuration options
   * @returns Server result containing app, server, adapter, and handler instances
   *
   * @example
   * ```typescript
   * const result = PaymentsA2AServer.start({
   *   agentCard: buildPaymentAgentCard(baseCard, paymentMetadata),
   *   executor: new MyPaymentsExecutor(),
   *   paymentsService: payments,
   *   port: 41242,
   *   basePath: '/a2a/',
   *   exposeAgentCard: true,
   *   exposeDefaultRoutes: true
   * })
   *
   * // Access the Express app for additional routes
   * result.app.get('/health', (req, res) => res.json({ status: 'ok' }))
   * ```
   */
  static start(options: PaymentsA2AServerOptions): PaymentsA2AServerResult {
    const {
      agentCard,
      executor,
      paymentsService,
      port,
      taskStore,
      basePath = '/',
      exposeAgentCard = true,
      exposeDefaultRoutes = true,
      expressApp,
      customRequestHandler,
      handlerOptions,
      hooks,
    } = options

    // Initialize components
    const store = taskStore || new InMemoryTaskStore()
    const handler =
      customRequestHandler ||
      new PaymentsRequestHandler(
        agentCard,
        store,
        executor,
        paymentsService,
        undefined,
        handlerOptions,
      )
    const transport = new JsonRpcTransportHandler(handler)

    const app = expressApp || express()

    if (exposeAgentCard) {
      const agentCardPath =
        basePath === '/'
          ? '/.well-known/agent.json'
          : `${basePath.replace(/\/$/, '')}/.well-known/agent.json`
      app.get(agentCardPath, (req, res) => {
        res.json(agentCard)
      })
    }

    if (exposeDefaultRoutes) {
      // Apply bearer token middleware for all requests under basePath
      app.use(basePath, express.json(), bearerTokenMiddleware.bind(null, handler))

      // Apply hooks middleware after body parsing and validation
      if (hooks) {
        app.use(basePath, (req, res, next) => {
          if (req.method === 'POST' && req.body?.method) {
            const { method, params } = req.body

            // Apply beforeRequest hook
            if (hooks.beforeRequest) {
              hooks.beforeRequest(method, params, req).catch((err) => {
                console.error('[HOOKS] beforeRequest error:', err)
              })
            }

            // Apply afterRequest hook by intercepting res.json
            const originalJson = res.json
            res.json = function (data) {
              if (hooks.afterRequest) {
                hooks.afterRequest(method, data, req).catch((err) => {
                  console.error('[HOOKS] afterRequest error:', err)
                })
              }
              return originalJson.call(this, data)
            }

            // Apply onError hook by catching errors
            const originalSend = res.send
            res.send = function (data) {
              if (data?.error && hooks.onError) {
                hooks
                  .onError(method, new Error(data.error.message || 'Unknown error'), req)
                  .catch((err) => {
                    console.error('[HOOKS] onError error:', err)
                  })
              }
              return originalSend.call(this, data)
            }
          }
          next()
        })
      }

      app.post(basePath, async (req, res) => {
        try {
          const result = await transport.handle(req.body)
          await sendRpcResult(res, result)
        } catch (err: any) {
          res.status(500).json({
            error: { code: -32603, message: err?.message || 'Internal server error' },
          })
        }
      })
    }

    const server = http.createServer(app)

    // Add error handling for server startup
    server.on('error', (error: any) => {
      console.error(`[PaymentsA2A] Server error:`, error)
      if (error.code === 'EADDRINUSE') {
        console.error(`[PaymentsA2A] Port ${port} is already in use`)
      }
    })

    // If port is 0, the OS will assign a free port automatically
    let actualPort = port
    let isListening = false

    // Only start listening if port is not 0 (0 is used with supertest which doesn't need listening)
    if (port !== 0) {
      server.listen(port, () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          actualPort = address.port
        }
        isListening = true
      })
    }

    /**
     * Closes the server and all active connections.
     */
    const close = async (): Promise<void> => {
      if (!isListening && port === 0) {
        return
      }

      return new Promise<void>((resolve) => {
        // Close all active connections first
        if (server.listening) {
          server.closeAllConnections()
        }

        const timeout = setTimeout(() => {
          // Force close on timeout
          if (server.listening) {
            server.closeAllConnections()
          }
          server.close(() => {
            resolve()
          })
        }, 5000)

        if (server.listening) {
          server.close(() => {
            clearTimeout(timeout)
            // Give a moment for all connections to close
            setTimeout(resolve, 100)
          })
        } else {
          clearTimeout(timeout)
          resolve()
        }
      })
    }

    return { app, server, handler, port: actualPort, close }
  }
}
