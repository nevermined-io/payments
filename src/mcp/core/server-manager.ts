/**
 * Server manager for simplified MCP API.
 * Orchestrates McpServer, Express, Transport, and session management.
 */
import type { Server } from 'http'
import type { Application } from 'express'
import type { Payments } from '../../payments.js'
import type {
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
  ToolRegistration,
  ResourceRegistration,
  PromptRegistration,
} from '../types/server.types.js'
import { createSessionManager, SessionManager } from '../http/session-manager.js'
import { mountMcpHandlers } from '../http/mcp-handler.js'
import {
  createOAuthRouter,
  createCorsMiddleware,
  createJsonMiddleware,
} from '../http/oauth-router.js'

// Lazy imports for optional dependencies
let express: any = null
let McpServerClass: any = null

/**
 * Lazily load Express.
 */
async function getExpress(): Promise<any> {
  if (!express) {
    express = (await import('express')).default
  }
  return express
}

/**
 * Lazily load McpServer from the SDK.
 */
async function getMcpServerClass(): Promise<any> {
  if (!McpServerClass) {
    try {
      const module = await import('@modelcontextprotocol/sdk/server/mcp.js')
      McpServerClass = module.McpServer
    } catch (error) {
      throw new Error(
        'Failed to load @modelcontextprotocol/sdk. Make sure it is installed: npm install @modelcontextprotocol/sdk',
      )
    }
  }
  return McpServerClass
}

/**
 * Server manager state.
 */
export enum ServerState {
  Idle = 'idle',
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
}

/**
 * Manages the complete MCP server lifecycle.
 */
export class McpServerManager {
  private state: ServerState = ServerState.Idle
  private payments: Payments
  private tools: Map<string, ToolRegistration> = new Map()
  private resources: Map<string, ResourceRegistration> = new Map()
  private prompts: Map<string, PromptRegistration> = new Map()
  private mcpServer: any = null
  private expressApp: Application | null = null
  private httpServer: Server | null = null
  private sessionManager: SessionManager | null = null
  private config: McpServerConfig | null = null
  private log: ((message: string) => void) | undefined = undefined

  constructor(payments: Payments) {
    this.payments = payments
  }

  /**
   * Get current server state.
   */
  getState(): ServerState {
    return this.state
  }

  /**
   * Register a tool.
   * Must be called before start().
   */
  registerTool(
    name: string,
    config: McpToolConfig,
    handler: ToolHandler,
    options: McpRegistrationOptions = {},
  ): void {
    if (this.state !== ServerState.Idle) {
      throw new Error('Cannot register tools after server has started')
    }

    this.tools.set(name, {
      name,
      config,
      handler,
      options: {
        credits: options.credits ?? 1,
        onRedeemError: options.onRedeemError ?? 'ignore',
      },
    })

    this.log?.(`Registered tool: ${name}`)
  }

  /**
   * Register a resource.
   * Must be called before start().
   */
  registerResource(
    uri: string,
    config: McpResourceConfig,
    handler: ResourceHandler,
    options: McpRegistrationOptions = {},
  ): void {
    if (this.state !== ServerState.Idle) {
      throw new Error('Cannot register resources after server has started')
    }

    this.resources.set(uri, {
      uri,
      config,
      handler,
      options: {
        credits: options.credits ?? 1,
        onRedeemError: options.onRedeemError ?? 'ignore',
      },
    })

    this.log?.(`Registered resource: ${uri}`)
  }

  /**
   * Register a prompt.
   * Must be called before start().
   */
  registerPrompt(
    name: string,
    config: McpPromptConfig,
    handler: PromptHandler,
    options: McpRegistrationOptions = {},
  ): void {
    if (this.state !== ServerState.Idle) {
      throw new Error('Cannot register prompts after server has started')
    }

    this.prompts.set(name, {
      name,
      config,
      handler,
      options: {
        credits: options.credits ?? 1,
        onRedeemError: options.onRedeemError ?? 'ignore',
      },
    })

    this.log?.(`Registered prompt: ${name}`)
  }

  /**
   * Start the MCP server.
   */
  async start(config: McpServerConfig): Promise<McpServerResult> {
    if (this.state !== ServerState.Idle) {
      throw new Error(`Cannot start server in state: ${this.state}`)
    }

    this.state = ServerState.Starting
    this.config = config
    this.log = config.onLog

    try {
      // Validate configuration
      if (!config.agentId) {
        throw new Error('agentId is required')
      }
      if (!config.port) {
        throw new Error('port is required')
      }

      const baseUrl = config.baseUrl || `http://localhost:${config.port}`

      // Load dependencies
      const expressModule = await getExpress()
      const McpServer = await getMcpServerClass()

      // Create MCP server
      this.mcpServer = new McpServer({
        name: config.serverName,
        version: config.version || '1.0.0',
      })

      // Register tools with paywall protection
      await this.registerToolsWithPaywall()

      // Create Express app
      this.expressApp = expressModule()

      // Apply global middleware
      this.expressApp!.use(createCorsMiddleware(config.corsOrigins || '*'))
      this.expressApp!.use(createJsonMiddleware())

      // Mount OAuth router
      const environment =
        config.environment || (this.payments as any).environmentName || 'staging_sandbox'

      const oauthRouter = createOAuthRouter({
        payments: this.payments,
        baseUrl,
        agentId: config.agentId,
        environment,
        serverName: config.serverName,
        tools: Array.from(this.tools.keys()),
        enableOAuthDiscovery: config.enableOAuthDiscovery ?? true,
        enableClientRegistration: config.enableClientRegistration ?? true,
        enableHealthCheck: config.enableHealthCheck ?? true,
        enableServerInfo: config.enableServerInfo ?? true,
        version: config.version || '1.0.0',
        description: config.description,
      })

      this.expressApp!.use(oauthRouter)

      // Create session manager
      this.sessionManager = createSessionManager({
        log: this.log,
      })
      this.sessionManager.setMcpServer(this.mcpServer)

      // Mount MCP handlers
      mountMcpHandlers(this.expressApp! as any, {
        sessionManager: this.sessionManager,
        requireAuth: true,
        log: this.log,
      })

      // Add 404 fallback
      this.expressApp!.use((req: any, res: any) => {
        this.log?.(`404 - ${req.method} ${req.path}`)
        res.status(404).json({
          error: 'not_found',
          error_description: `Endpoint not found: ${req.method} ${req.path}`,
        })
      })

      // Start HTTP server
      await new Promise<void>((resolve, reject) => {
        const host = config.host || '0.0.0.0'
        this.httpServer = this.expressApp!.listen(config.port, host, () => {
          resolve()
        })
        this.httpServer.on('error', reject)
      })

      this.state = ServerState.Running

      const info: ServerInfo = {
        baseUrl,
        port: config.port,
        tools: Array.from(this.tools.keys()),
        resources: Array.from(this.resources.keys()),
        prompts: Array.from(this.prompts.keys()),
      }

      // Log startup message
      this.logStartupMessage(info, config)

      // Call onStart callback
      config.onStart?.(info)

      return {
        info,
        stop: () => this.stop(),
      }
    } catch (error) {
      this.state = ServerState.Idle
      throw error
    }
  }

  /**
   * Stop the server gracefully.
   */
  async stop(): Promise<void> {
    if (this.state !== ServerState.Running) {
      return
    }

    this.state = ServerState.Stopping

    // Destroy all sessions
    this.sessionManager?.destroyAllSessions()

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve())
      })
    }

    // Reset state
    this.mcpServer = null
    this.expressApp = null
    this.httpServer = null
    this.sessionManager = null
    this.state = ServerState.Idle

    this.log?.('Server stopped')
  }

  /**
   * Register all tools with paywall protection.
   */
  private async registerToolsWithPaywall(): Promise<void> {
    // Configure MCP integration
    const config = this.config!
    ;(this.payments.mcp as any).configure({
      agentId: config.agentId,
      serverName: config.serverName,
    })

    // Get the withPaywall function
    const withPaywall = (this.payments.mcp as any).withPaywall

    for (const [name, registration] of this.tools) {
      const { config: toolConfig, handler, options } = registration

      // Wrap handler with paywall
      const protectedHandler = withPaywall(
        async (args: any, extra?: any) => {
          // Call the user's handler
          const result = await handler(args, { extra })
          return result
        },
        {
          name,
          kind: 'tool',
          credits: BigInt(options.credits || 1),
          onRedeemError: options.onRedeemError,
        },
      )

      // Register with MCP server
      this.mcpServer.tool(
        name,
        {
          title: toolConfig.title,
          description: toolConfig.description,
          inputSchema: toolConfig.inputSchema || {},
        },
        protectedHandler,
      )
    }

    // TODO: Register resources and prompts similarly
  }

  /**
   * Log startup message (only if onLog callback provided).
   */
  private logStartupMessage(info: ServerInfo, config: McpServerConfig): void {
    if (!this.log) return

    const toolsList = info.tools.length > 0 ? info.tools.join(', ') : 'none'

    this.log(`MCP Server Started!
  MCP Endpoint: ${info.baseUrl}/mcp
  Health Check: ${info.baseUrl}/health
  Server Info:  ${info.baseUrl}/
  OAuth Discovery: ${info.baseUrl}/.well-known/oauth-authorization-server
  Tools: ${toolsList}
  Agent ID: ${config.agentId}`)
  }
}

/**
 * Create a new server manager.
 */
export function createServerManager(payments: Payments): McpServerManager {
  return new McpServerManager(payments)
}
