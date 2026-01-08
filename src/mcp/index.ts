/**
 * MCP (Model Context Protocol) integration module for Nevermined Payments.
 *
 * This module provides everything needed to build monetizable MCP servers:
 * - Paywall protection for tools, resources, and prompts
 * - OAuth 2.1 discovery and client registration endpoints
 * - Managed HTTP server or router for existing Express apps
 *
 * @example Basic usage with withPaywall
 * ```typescript
 * import { Payments } from '@nevermined-io/payments'
 *
 * const payments = Payments.getInstance({
 *   nvmApiKey: process.env.NVM_API_KEY!,
 *   environment: 'staging_sandbox'
 * })
 *
 * // Configure MCP integration
 * payments.mcp.configure({
 *   agentId: process.env.NVM_AGENT_ID!,
 *   serverName: 'my-mcp-server'
 * })
 *
 * // Protect a tool handler
 * const protectedHandler = payments.mcp.withPaywall(
 *   myToolHandler,
 *   { kind: 'tool', name: 'my_tool', credits: 1n }
 * )
 * ```
 *
 * @example Complete server with OAuth
 * ```typescript
 * // Start a managed server with all OAuth endpoints
 * const { baseUrl, stop } = await payments.mcp.startServer({
 *   port: 5001,
 *   agentId: process.env.NVM_AGENT_ID!,
 *   serverName: 'my-mcp-server',
 *   tools: ['hello_world']
 * })
 * ```
 *
 * @example Using router with existing Express app
 * ```typescript
 * import express from 'express'
 *
 * const app = express()
 *
 * // Create OAuth router
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
import type { Payments } from '../payments.js'
import type { EnvironmentName } from '../environments.js'
import { createOAuthRouter } from './http/oauth-router.js'
import { createMcpApp, startManagedServer } from './http/managed-server.js'
import { PaywallDecorator } from './core/paywall.js'
import { PaywallAuthenticator } from './core/auth.js'
import { CreditsContextProvider } from './core/credits-context.js'
import { McpServerManager, createServerManager } from './core/server-manager.js'
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
} from './types/server.types.js'
import type {
  PaywallOptions,
  ToolOptions,
  ResourceOptions,
  PromptOptions,
  PaywallContext,
  McpConfig,
} from './types/paywall.types.js'
import type { HttpServerResult } from './types/http.types.js'

// Re-export types
export type {
  CreditsContext,
  CreditsOption,
  PaywallOptions,
  McpConfig,
  PaywallContext,
  AuthResult,
} from './types/paywall.types.js'

export type {
  OAuthUrls,
  OAuthConfig,
  HttpRouterConfig,
  HttpServerConfig,
  HttpServerResult,
  ProtectedResourceMetadata,
  McpProtectedResourceMetadata,
  AuthorizationServerMetadata,
  OidcConfiguration,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
  ServerInfoResponse,
} from './types/http.types.js'

// Re-export utilities
export { buildExtraFromHttpHeaders, buildExtraFromHttpRequest } from './utils/extra.js'

// Re-export simplified API types
export type {
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
  ToolContext,
  ResourceContext,
  PromptContext,
} from './types/server.types.js'

// Re-export HTTP module components for advanced usage
export {
  getOAuthUrls,
  buildProtectedResourceMetadata,
  buildMcpProtectedResourceMetadata,
  buildAuthorizationServerMetadata,
  buildOidcConfiguration,
  buildServerInfoResponse,
  createOAuthRouter,
  createCorsMiddleware,
  createJsonMiddleware,
  createRequireAuthMiddleware,
  createHttpLoggingMiddleware,
  startManagedServer,
  createMcpApp,
  ClientRegistrationError,
} from './http/index.js'

/**
 * Extended MCP configuration including HTTP server options.
 */
export interface ExtendedMcpConfig extends McpConfig {
  /** Base URL for the server (required for HTTP features) */
  baseUrl?: string
  /** Nevermined environment */
  environment?: EnvironmentName
  /** Tools exposed by this server */
  tools?: string[]
  /** Custom OAuth scopes */
  scopes?: string[]
}

/**
 * Options for creating the OAuth router.
 */
export interface CreateRouterOptions {
  /** Base URL of the MCP server */
  baseUrl: string
  /** Agent ID (client_id) */
  agentId?: string
  /** Server name */
  serverName?: string
  /** Tools exposed by this server */
  tools?: string[]
  /** Enable OAuth discovery endpoints */
  enableOAuthDiscovery?: boolean
  /** Enable client registration */
  enableClientRegistration?: boolean
  /** Enable health check */
  enableHealthCheck?: boolean
  /** Enable server info */
  enableServerInfo?: boolean
  /** Server version */
  version?: string
  /** Server description */
  description?: string
}

/**
 * Options for starting the managed server.
 */
export interface StartServerOptions {
  /** Port to listen on */
  port: number
  /** Host to bind to */
  host?: string
  /** Base URL (defaults to http://localhost:\{port\}) */
  baseUrl?: string
  /** Agent ID (uses configured agentId if not provided) */
  agentId?: string
  /** Server name */
  serverName?: string
  /** Tools exposed by this server */
  tools?: string[]
  /** Enable OAuth discovery endpoints */
  enableOAuthDiscovery?: boolean
  /** Enable client registration */
  enableClientRegistration?: boolean
  /** Enable health check */
  enableHealthCheck?: boolean
  /** Enable server info */
  enableServerInfo?: boolean
  /** Server version */
  version?: string
  /** Server description */
  description?: string
  /** Callback when server starts */
  onStart?: (result: HttpServerResult) => void
  /** Logging callback */
  onLog?: (message: string, level?: 'info' | 'warn' | 'error') => void
}

/**
 * Build MCP integration with modular architecture.
 * This function creates the complete MCP API surface including
 * paywall protection, OAuth endpoints, and HTTP server management.
 *
 * @param paymentsService - The Payments instance
 * @returns MCP integration API
 */
export function buildMcpIntegration(paymentsService: Payments) {
  const authenticator = new PaywallAuthenticator(paymentsService)
  const creditsContext = new CreditsContextProvider()
  const paywallDecorator = new PaywallDecorator(paymentsService, authenticator, creditsContext)

  // Extended configuration storage
  let extendedConfig: ExtendedMcpConfig = {
    agentId: '',
    serverName: 'mcp-server',
  }

  /**
   * Configure the MCP integration.
   * This sets up the agent ID, server name, and optional HTTP settings.
   *
   * @param options - Configuration options
   *
   * @example
   * ```typescript
   * payments.mcp.configure({
   *   agentId: 'agent_123',
   *   serverName: 'my-mcp-server',
   *   baseUrl: 'http://localhost:5001',
   *   environment: 'staging_sandbox',
   *   tools: ['hello_world', 'weather']
   * })
   * ```
   */
  function configure(options: ExtendedMcpConfig): void {
    extendedConfig = {
      ...extendedConfig,
      ...options,
    }
    // Also configure the paywall decorator
    paywallDecorator.configure({
      agentId: options.agentId,
      serverName: options.serverName,
    })
  }

  /**
   * Wrap a handler with paywall protection.
   * The wrapped handler will validate authentication and burn credits.
   */
  function withPaywall<TArgs = any>(
    handler: (args: TArgs, extra?: any, context?: PaywallContext) => Promise<any> | any,
    options: ToolOptions | PromptOptions,
  ): (args: TArgs, extra?: any) => Promise<any>
  function withPaywall<TArgs = any>(
    handler: (args: TArgs, extra?: any, context?: PaywallContext) => Promise<any> | any,
  ): (args: TArgs, extra?: any) => Promise<any>
  function withPaywall(
    handler: (
      uri: URL,
      variables: Record<string, string | string[]>,
      extra?: any,
      context?: PaywallContext,
    ) => Promise<any> | any,
    options: ResourceOptions,
  ): (uri: URL, variables: Record<string, string | string[]>, extra?: any) => Promise<any>
  function withPaywall(handler: any, options?: ToolOptions | PromptOptions | ResourceOptions): any {
    const opts =
      (options as PaywallOptions | undefined) ?? ({ kind: 'tool', name: 'unnamed' } as any)
    return (paywallDecorator.protect as any)(handler, opts)
  }

  /**
   * Authenticate meta MCP operations (initialize, tools/list, etc.).
   *
   * @param extra - The extra parameter from MCP
   * @param method - The MCP method being called
   * @returns Authentication result
   */
  async function authenticateMeta(extra: any, options: {planId?: string} = {}, method: string) {
    const cfg = extendedConfig
    const agentId = cfg.agentId || ''
    const serverName = cfg.serverName || 'mcp-server'
    return authenticator.authenticateMeta(extra, { planId: options?.planId }, agentId, serverName, method)
  }

  /**
   * Attach paywall protection to an MCP server.
   * Returns a registrar with protected register methods.
   *
   * @param server - The MCP server instance
   * @returns Protected registrar
   */
  function attach(server: {
    registerTool: (name: string, config: any, handler: any) => void
    registerResource: (name: string, template: any, config: any, handler: any) => void
    registerPrompt: (name: string, config: any, handler: any) => void
  }) {
    return {
      registerTool<TArgs = any>(
        name: string,
        config: any,
        handler: (args: TArgs, extra?: any, context?: PaywallContext) => Promise<any> | any,
        options?: Omit<ToolOptions, 'kind' | 'name'>,
      ) {
        const protectedHandler = withPaywall(handler, { kind: 'tool', name, ...(options || {}) })
        server.registerTool(name, config, protectedHandler)
      },
      registerResource(
        name: string,
        template: any,
        config: any,
        handler: (
          uri: URL,
          variables: Record<string, string | string[]>,
          extra?: any,
          context?: PaywallContext,
        ) => Promise<any> | any,
        options?: Omit<ResourceOptions, 'kind' | 'name'>,
      ) {
        const protectedHandler = withPaywall(handler, {
          kind: 'resource',
          name,
          ...(options || {}),
        })
        server.registerResource(name, template, config, protectedHandler)
      },
      registerPrompt<TArgs = any>(
        name: string,
        config: any,
        handler: (args: TArgs, extra?: any, context?: PaywallContext) => Promise<any> | any,
        options?: Omit<PromptOptions, 'kind' | 'name'>,
      ) {
        const protectedHandler = withPaywall(handler, { kind: 'prompt', name, ...(options || {}) })
        server.registerPrompt(name, config, protectedHandler)
      },
    }
  }

  /**
   * Create an Express router with OAuth 2.1 endpoints.
   * Use this when you already have an Express app and want to add OAuth support.
   *
   * @param options - Router configuration
   * @returns Express Router
   *
   * @example
   * ```typescript
   * const router = payments.mcp.createRouter({
   *   baseUrl: 'http://localhost:5001',
   *   serverName: 'my-mcp-server',
   *   tools: ['hello_world']
   * })
   *
   * app.use(router)
   * ```
   */
  function createRouter(options: CreateRouterOptions) {
    const agentId = options.agentId || extendedConfig.agentId
    if (!agentId) {
      throw new Error('agentId is required. Either pass it in options or call configure() first.')
    }

    const environment =
      extendedConfig.environment || (paymentsService as any).environmentName || 'staging_sandbox'

    return createOAuthRouter({
      payments: paymentsService,
      baseUrl: options.baseUrl,
      agentId,
      environment,
      serverName: options.serverName || extendedConfig.serverName || 'mcp-server',
      tools: options.tools || extendedConfig.tools || [],
      scopes: extendedConfig.scopes,
      enableOAuthDiscovery: options.enableOAuthDiscovery ?? true,
      enableClientRegistration: options.enableClientRegistration ?? true,
      enableHealthCheck: options.enableHealthCheck ?? true,
      enableServerInfo: options.enableServerInfo ?? true,
      version: options.version,
      description: options.description,
    })
  }

  /**
   * Create an Express app pre-configured with OAuth discovery endpoints.
   * Use this when you want more control over the app before starting.
   *
   * Note: Authentication is handled by withPaywall() on each tool,
   * not by HTTP middleware.
   *
   * @param options - App configuration
   * @returns Configured Express app with OAuth endpoints
   *
   * @example
   * ```typescript
   * const app = payments.mcp.createApp({
   *   baseUrl: 'http://localhost:5001',
   *   serverName: 'my-mcp-server'
   * })
   *
   * // Add your MCP handler - auth via withPaywall() on each tool
   * app.post('/mcp', mcpHandler)
   *
   * app.listen(5001)
   * ```
   */
  function createApp(options: Omit<CreateRouterOptions, 'agentId'> & { agentId?: string }) {
    const agentId = options.agentId || extendedConfig.agentId
    if (!agentId) {
      throw new Error('agentId is required. Either pass it in options or call configure() first.')
    }

    const environment =
      extendedConfig.environment || (paymentsService as any).environmentName || 'staging_sandbox'

    return createMcpApp({
      payments: paymentsService,
      baseUrl: options.baseUrl,
      agentId,
      environment,
      serverName: options.serverName || extendedConfig.serverName || 'mcp-server',
      tools: options.tools || extendedConfig.tools || [],
      scopes: extendedConfig.scopes,
      enableOAuthDiscovery: options.enableOAuthDiscovery ?? true,
      enableClientRegistration: options.enableClientRegistration ?? true,
      enableHealthCheck: options.enableHealthCheck ?? true,
      enableServerInfo: options.enableServerInfo ?? true,
      version: options.version,
      description: options.description,
    })
  }

  /**
   * Start a managed HTTP server with OAuth 2.1 support.
   * This creates a complete Express server with all OAuth endpoints pre-configured.
   *
   * @param options - Server configuration
   * @returns Server result with control methods
   *
   * @example
   * ```typescript
   * const { baseUrl, stop } = await payments.mcp.startServer({
   *   port: 5001,
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
  async function startServer(options: StartServerOptions): Promise<HttpServerResult> {
    const agentId = options.agentId || extendedConfig.agentId
    if (!agentId) {
      throw new Error('agentId is required. Either pass it in options or call configure() first.')
    }

    const baseUrl = options.baseUrl || `http://localhost:${options.port}`
    const environment =
      extendedConfig.environment || (paymentsService as any).environmentName || 'staging_sandbox'

    return startManagedServer({
      payments: paymentsService,
      port: options.port,
      host: options.host,
      baseUrl,
      agentId,
      environment,
      serverName: options.serverName || extendedConfig.serverName || 'mcp-server',
      tools: options.tools || extendedConfig.tools || [],
      scopes: extendedConfig.scopes,
      enableOAuthDiscovery: options.enableOAuthDiscovery ?? true,
      enableClientRegistration: options.enableClientRegistration ?? true,
      enableHealthCheck: options.enableHealthCheck ?? true,
      enableServerInfo: options.enableServerInfo ?? true,
      version: options.version,
      description: options.description,
      onStart: options.onStart,
      onLog: options.onLog,
    })
  }

  /**
   * Get the current configuration.
   *
   * @returns Current MCP configuration
   */
  function getConfig(): ExtendedMcpConfig {
    return { ...extendedConfig }
  }

  // =============================================================================
  // SIMPLIFIED API - High-level API that hides McpServer, Transport, and Express
  // =============================================================================

  // Server manager for simplified API
  let serverManager: McpServerManager | null = null

  /**
   * Get or create the server manager.
   */
  function getServerManager(): McpServerManager {
    if (!serverManager) {
      serverManager = createServerManager(paymentsService)
    }
    return serverManager
  }

  /**
   * Register a tool with the simplified API.
   * Must be called before start().
   *
   * @param name - Tool name
   * @param config - Tool configuration
   * @param handler - Tool handler function
   * @param options - Registration options (credits, etc.)
   *
   * @example
   * ```typescript
   * payments.mcp.registerTool(
   *   'hello_world',
   *   {
   *     description: 'Returns a hello world message',
   *     inputSchema: { name: { type: 'string' } }
   *   },
   *   async (args) => ({
   *     content: [{ type: 'text', text: `Hello, ${args.name}!` }]
   *   }),
   *   { credits: 1 }
   * )
   * ```
   */
  function registerTool(
    name: string,
    config: McpToolConfig,
    handler: ToolHandler,
    options?: McpRegistrationOptions,
  ): void {
    getServerManager().registerTool(name, config, handler, options)
  }

  /**
   * Register a resource with the simplified API.
   * Must be called before start().
   *
   * @param uri - Resource URI pattern
   * @param config - Resource configuration
   * @param handler - Resource handler function
   * @param options - Registration options (credits, etc.)
   */
  function registerResource(
    uri: string,
    config: McpResourceConfig,
    handler: ResourceHandler,
    options?: McpRegistrationOptions,
  ): void {
    getServerManager().registerResource(uri, config, handler, options)
  }

  /**
   * Register a prompt with the simplified API.
   * Must be called before start().
   *
   * @param name - Prompt name
   * @param config - Prompt configuration
   * @param handler - Prompt handler function
   * @param options - Registration options (credits, etc.)
   */
  function registerPrompt(
    name: string,
    config: McpPromptConfig,
    handler: PromptHandler,
    options?: McpRegistrationOptions,
  ): void {
    getServerManager().registerPrompt(name, config, handler, options)
  }

  /**
   * Start the MCP server with the simplified API.
   * This creates and starts everything: McpServer, Express, OAuth endpoints, etc.
   *
   * @param config - Server configuration
   * @returns Server result with stop() method
   *
   * @example
   * ```typescript
   * // Register tools first
   * payments.mcp.registerTool('hello', { description: '...' }, handler)
   *
   * // Then start the server
   * const { info, stop } = await payments.mcp.start({
   *   port: 5001,
   *   agentId: 'did:nv:...',
   *   serverName: 'my-mcp-server'
   * })
   *
   * console.log(`Server running at ${info.baseUrl}`)
   *
   * // Later: stop gracefully
   * await stop()
   * ```
   */
  async function start(config: McpServerConfig): Promise<McpServerResult> {
    return getServerManager().start(config)
  }

  /**
   * Stop the MCP server.
   * This is a convenience method - you can also use the stop() from start()'s result.
   */
  async function stop(): Promise<void> {
    if (serverManager) {
      await serverManager.stop()
    }
  }

  return {
    // Core paywall functionality (advanced API)
    configure,
    withPaywall,
    attach,
    authenticateMeta,

    // HTTP/OAuth functionality (advanced API)
    createRouter,
    createApp,
    startServer,

    // Utilities
    getConfig,

    // Simplified API (recommended for most users)
    registerTool,
    registerResource,
    registerPrompt,
    start,
    stop,
  }
}
