/**
 * PaymentsA2AServer sets up and starts the A2A server for payments agents.
 * Handles A2A protocol endpoints and allows optional custom endpoints.
 */
import express from 'express'
import http from 'http'
import { InMemoryTaskStore, DefaultRequestHandler, A2AExpressApp } from '@a2a-js/sdk'
import type { AgentCard } from './types'
import type { PaymentsAgentExecutor } from './executor'
import { PaymentsA2AAdapter, setRequestContext } from './adapter'

/**
 * Options for starting the PaymentsA2AServer.
 */
export interface PaymentsA2AServerOptions {
  agentCard: AgentCard
  executor: PaymentsAgentExecutor
  paymentsService: any
  port: number
  taskStore?: any
  basePath?: string
  exposeAgentCard?: boolean
  exposeDefaultRoutes?: boolean
  expressApp?: express.Express
}

/**
 * Middleware to extract bearer token from HTTP headers and store it in the global context.
 * This middleware is applied after A2A routes are set up.
 */
function bearerTokenMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  console.log(`[MIDDLEWARE] Processing ${req.method} ${req.url}`)

  // Only process POST requests (A2A uses POST for all operations)
  if (req.method !== 'POST') {
    console.log(`[MIDDLEWARE] Skipping non-POST request`)
    return next()
  }

  // Extract bearer token from Authorization header
  const authHeader = req.headers.authorization
  let bearerToken: string | undefined

  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.substring(7) // Remove 'Bearer ' prefix
    console.log(`[MIDDLEWARE] Extracted bearer token: ${bearerToken.substring(0, 20)}...`)
  } else {
    console.log(`[MIDDLEWARE] No bearer token found in headers`)
  }

  // Transform relative URL to absolute URL
  const absoluteUrl = new URL(req.url, req.protocol + '://' + req.get('host')).toString()

  // Store bearer token in global context for the adapter to access
  setRequestContext(bearerToken, absoluteUrl, req.method)
  console.log(`[MIDDLEWARE] Set request context - URL: ${absoluteUrl}, Method: ${req.method}`)

  next()
}

/**
 * PaymentsA2AServer sets up the A2A endpoints and starts the server.
 */
export class PaymentsA2AServer {
  /**
   * Starts the A2A server with the given options.
   * @param options - Server configuration options.
   */
  static start(options: PaymentsA2AServerOptions) {
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
    } = options

    const store = taskStore || new InMemoryTaskStore()
    const adapter = new PaymentsA2AAdapter(executor, paymentsService, agentCard)
    const handler = new DefaultRequestHandler(agentCard, store, adapter)
    const appBuilder = new A2AExpressApp(handler)

    const app = expressApp || express()

    if (exposeDefaultRoutes) {
      // Apply middleware BEFORE setting up routes
      app.use(bearerTokenMiddleware)

      appBuilder.setupRoutes(app, basePath)
    }

    if (exposeAgentCard) {
      app.get(`${basePath}.well-known/agent.json`, (req, res) => {
        res.json(agentCard)
      })
    }

    const server = http.createServer(app)
    server.listen(port, () => {
      console.log(`[PaymentsA2A] Server started on http://localhost:${port}${basePath}`)
      if (exposeAgentCard) {
        console.log(
          `[PaymentsA2A] Agent Card: http://localhost:${port}${basePath}.well-known/agent.json`,
        )
      }
    })

    return { app, server }
  }
}
