/**
 * Server manager for simplified MCP API.
 * Orchestrates McpServer, Express, Transport, and session management.
 */
import type { Server } from 'http'
import express, { type Application } from 'express'
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
  createHttpLoggingMiddleware,
} from '../http/oauth-router.js'
import { PaywallDecorator } from './paywall.js'
import { PaywallAuthenticator } from './auth.js'
import { CreditsContextProvider } from './credits-context.js'

let McpServerClass: any = null
let ResourceTemplateClass: any = null

/**
 * Lazily load McpServer and ResourceTemplate from the SDK.
 */
async function getMcpServerClass(): Promise<any> {
  if (!McpServerClass) {
    try {
      const module = await import('@modelcontextprotocol/sdk/server/mcp.js')
      McpServerClass = module.McpServer
      ResourceTemplateClass = module.ResourceTemplate
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
  private paywallDecorator: PaywallDecorator

  constructor(payments: Payments) {
    this.payments = payments
    // Initialize paywall decorator
    const authenticator = new PaywallAuthenticator(payments)
    const creditsContext = new CreditsContextProvider()
    this.paywallDecorator = new PaywallDecorator(payments, authenticator, creditsContext)
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
        credits: options.credits,
        onRedeemError: options.onRedeemError ?? 'ignore',
      },
    })

    this.log?.(`Registered tool: ${name}`)
  }

  /**
   * Register a resource.
   * Must be called before start().
   * Matches the signature of MCP SDK registerResource.
   */
  registerResource(
    name: string,
    uriOrTemplate: string,
    config: McpResourceConfig,
    handler: ResourceHandler,
    options: McpRegistrationOptions = {},
  ): void {
    if (this.state !== ServerState.Idle) {
      throw new Error('Cannot register resources after server has started')
    }

    this.resources.set(uriOrTemplate, {
      name,
      uriOrTemplate,
      config,
      handler,
      options: {
        credits: options.credits,
        onRedeemError: options.onRedeemError ?? 'ignore',
      },
    })

    this.log?.(`Registered resource: ${name} at ${uriOrTemplate}`)
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
        credits: options.credits,
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

      const McpServer = await getMcpServerClass()

      // Create MCP server
      this.mcpServer = new McpServer({
        name: config.serverName,
        version: config.version || '1.0.0',
      })

      // Register tools, resources, and prompts with paywall protection
      await this.registerHandlersWithPaywall()

      this.expressApp = express()

      // Apply global middleware
      if (this.expressApp) {
        // HTTP request logging (must be first to log all requests)
        this.expressApp.use(createHttpLoggingMiddleware(this.log))
        this.expressApp.use(createCorsMiddleware(config.corsOrigins || '*'))
        this.expressApp.use(createJsonMiddleware())
      }

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
        resources: Array.from(this.resources.keys()),
        prompts: Array.from(this.prompts.keys()),
        enableOAuthDiscovery: config.enableOAuthDiscovery ?? true,
        enableClientRegistration: config.enableClientRegistration ?? true,
        enableHealthCheck: config.enableHealthCheck ?? true,
        enableServerInfo: config.enableServerInfo ?? true,
        version: config.version || '1.0.0',
        description: config.description,
      })

      if (this.expressApp) {
        this.expressApp.use(oauthRouter)
      }

      // Create session manager
      this.sessionManager = createSessionManager({
        log: this.log,
      })
      this.sessionManager.setMcpServer(this.mcpServer)

      // Mount MCP handlers
      if (this.expressApp && this.sessionManager) {
        mountMcpHandlers(this.expressApp as any, {
          sessionManager: this.sessionManager,
          requireAuth: true,
          log: this.log,
        })

        // Add 404 fallback
        this.expressApp.use((req: any, res: any) => {
          this.log?.(`404 - ${req.method} ${req.path}`)
          res.status(404).json({
            error: 'not_found',
            error_description: `Endpoint not found: ${req.method} ${req.path}`,
          })
        })
      }

      // Start HTTP server
      if (!this.expressApp) {
        throw new Error('Express app not initialized')
      }
      const expressApp = this.expressApp
      await new Promise<void>((resolve, reject) => {
        const host = config.host || '0.0.0.0'
        const server = expressApp.listen(config.port, host, () => {
          resolve()
        })
        this.httpServer = server
        server.on('error', reject)
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
    const server = this.httpServer
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
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
   * Register all tools, resources, and prompts with paywall protection.
   */
  private async registerHandlersWithPaywall(): Promise<void> {
    // Configure paywall with agent and server info
    if (!this.config) {
      throw new Error('Server config not set')
    }
    this.paywallDecorator.configure({
      agentId: this.config.agentId,
      serverName: this.config.serverName,
    })

    // Register tools
    for (const [name, registration] of this.tools) {
      const { config: toolConfig, handler, options } = registration

      // Wrap handler with paywall
      // Convert number to bigint if needed, but preserve functions and undefined
      const creditsOption: any =
        typeof options.credits === 'function'
          ? options.credits
          : typeof options.credits === 'number'
            ? BigInt(options.credits)
            : options.credits

      const protectedHandler = this.paywallDecorator.protect(
        async (args: any, extra?: any, paywallContext?: any) => {
          // Convert PaywallContext to ToolContext format
          // Put authResult and credits inside extra (consistent format)
          const toolContext = paywallContext
            ? {
                extra: {
                  ...extra,
                  agentRequest: paywallContext.agentRequest,
                },
              }
            : { extra }
          // Call the user's handler with the converted context
          const result = await handler(args, toolContext)
          return result
        },
        {
          name,
          kind: 'tool',
          credits: creditsOption,
          onRedeemError: options.onRedeemError,
        },
      )

      // Register with MCP server
      this.mcpServer.registerTool(name, toolConfig, protectedHandler)
    }

    // Register resources
    for (const [uriOrTemplate, registration] of this.resources) {
      const { name, config: resourceConfig, handler, options } = registration

      // Wrap handler with paywall
      // Convert number to bigint if needed, but preserve functions and undefined
      const creditsOption: any =
        typeof options.credits === 'function'
          ? options.credits
          : typeof options.credits === 'number'
            ? BigInt(options.credits)
            : options.credits

      const protectedHandler = this.paywallDecorator.protect(
        async (uri: URL, extra?: any, paywallContext?: any) => {
          // Convert PaywallContext - pass extra directly to handler
          // The handler signature matches MCP SDK: (uri: URL, extra?: any)
          const handlerExtra = paywallContext
            ? {
                ...extra,
                authResult: paywallContext.authResult,
                credits: paywallContext.credits,
                agentRequest: paywallContext.agentRequest,
              }
            : extra
          // Call the user's handler with the converted context
          const result = await handler(uri, handlerExtra)
          return result
        },
        {
          name,
          kind: 'resource',
          credits: creditsOption,
          onRedeemError: options.onRedeemError,
        },
      )

      // Register with MCP server
      const hasTemplateVariables = /\{[^}]+\}/.test(uriOrTemplate)

      if (hasTemplateVariables) {
        const templateInstance = new ResourceTemplateClass(uriOrTemplate, {
          list: async () => ({ resources: [] }),
        })
        this.mcpServer.registerResource(name, templateInstance, resourceConfig, protectedHandler)
      } else {
        // For static resources: registerResource(name, uriString, config, handler)
        this.mcpServer.registerResource(name, uriOrTemplate, resourceConfig, protectedHandler)
      }
    }

    // Register prompts
    for (const [name, registration] of this.prompts) {
      const { config: promptConfig, handler, options } = registration

      // Wrap handler with paywall
      // Convert number to bigint if needed, but preserve functions and undefined
      const creditsOption: any =
        typeof options.credits === 'function'
          ? options.credits
          : typeof options.credits === 'number'
            ? BigInt(options.credits)
            : options.credits

      const protectedHandler = this.paywallDecorator.protect(
        async (args: any, extra?: any, paywallContext?: any) => {
          // Convert PaywallContext to PromptContext format
          // PromptContext has: { requestId?, credits?, extra? }
          const promptContext = paywallContext
            ? {
                requestId: paywallContext.agentRequest?.agentRequestId,
                credits: paywallContext.credits,
                extra: {
                  ...extra,
                  authResult: paywallContext.authResult,
                  credits: paywallContext.credits,
                  agentRequest: paywallContext.agentRequest,
                },
              }
            : extra
              ? {
                  requestId: extra?.agentRequest?.agentRequestId,
                  credits: extra?.credits,
                  extra,
                }
              : undefined

          // Call the user's handler with the converted context
          const result = await handler(args, promptContext)
          return result
        },
        {
          name,
          kind: 'prompt',
          credits: creditsOption,
          onRedeemError: options.onRedeemError,
        },
      )

      // Register with MCP server
      const sdkPromptConfig: any = {
        title: promptConfig.title,
        description: promptConfig.description,
      }

      if (promptConfig.argsSchema) {
        const schema = promptConfig.argsSchema as any
        if (schema && typeof schema === 'object' && 'shape' in schema) {
          sdkPromptConfig.argsSchema = schema.shape
        } else {
          sdkPromptConfig.argsSchema = promptConfig.argsSchema
        }
      }

      this.mcpServer.registerPrompt(name, sdkPromptConfig, protectedHandler)
    }
  }

  /**
   * Log startup message (only if onLog callback provided).
   */
  private logStartupMessage(info: ServerInfo, config: McpServerConfig): void {
    if (!this.log) return

    const toolsList = info.tools.length > 0 ? info.tools.join(', ') : 'none'
    const resourcesList = info.resources.length > 0 ? info.resources.join(', ') : 'none'
    const promptsList = info.prompts.length > 0 ? info.prompts.join(', ') : 'none'

    this.log(`MCP Server Started!
  MCP Endpoint: ${info.baseUrl}/mcp
  Health Check: ${info.baseUrl}/health
  Server Info:  ${info.baseUrl}/
  OAuth Discovery: ${info.baseUrl}/.well-known/oauth-authorization-server
  Tools: ${toolsList}
  Resources: ${resourcesList}
  Prompts: ${promptsList}
  Agent ID: ${config.agentId}`)
  }
}

/**
 * Create a new server manager.
 */
export function createServerManager(payments: Payments): McpServerManager {
  return new McpServerManager(payments)
}
