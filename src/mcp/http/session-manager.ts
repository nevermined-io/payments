/**
 * Session manager for MCP transports.
 * Handles creation, retrieval, and cleanup of StreamableHTTPServerTransport instances.
 * Also stores request context (headers) per session for authentication.
 */
import { randomUUID } from 'crypto'

// We'll dynamically import the SDK to avoid hard dependency issues
let StreamableHTTPServerTransport: any = null

/**
 * Request context stored per session.
 * Contains HTTP headers and other request info needed for authentication.
 */
export interface RequestContext {
  headers: Record<string, string | string[] | undefined>
  method?: string
  url?: string
  ip?: string
}

/**
 * Lazily load the MCP SDK transport.
 */
async function getTransportClass(): Promise<any> {
  if (!StreamableHTTPServerTransport) {
    try {
      const module = await import('@modelcontextprotocol/sdk/server/streamableHttp.js')
      StreamableHTTPServerTransport = module.StreamableHTTPServerTransport
    } catch (error) {
      throw new Error(
        'Failed to load @modelcontextprotocol/sdk. Make sure it is installed: npm install @modelcontextprotocol/sdk',
      )
    }
  }
  return StreamableHTTPServerTransport
}

/**
 * Configuration for session manager.
 */
export interface SessionManagerConfig {
  /** Callback when a session is created */
  onSessionCreated?: (sessionId: string) => void
  /** Callback when a session is destroyed */
  onSessionDestroyed?: (sessionId: string) => void
  /** Logger function */
  log?: (message: string) => void
}

interface RequestContextOwner {
  context?: RequestContext
}

interface TransportSession {
  server: any
  transport: any
  contextOwner: RequestContextOwner
  closing?: Promise<void>
}

/**
 * Manages MCP transport sessions.
 */
export class SessionManager {
  private sessions: Map<string, Set<TransportSession>> = new Map()
  private requestContexts: Map<string, RequestContext> = new Map()
  // Arrival order includes requests still awaiting their factory or connect().
  private contextOwners: Map<string, Set<RequestContextOwner>> = new Map()
  private mcpServer: any = null
  private mcpServerFactory: (() => any | Promise<any>) | null = null
  private closing: Set<Promise<void>> = new Set()
  private generation = 0
  private config: SessionManagerConfig

  constructor(config: SessionManagerConfig = {}) {
    this.config = config
  }

  /**
   * Set a single MCP server for sequential requests (legacy integration).
   * Use setMcpServerFactory for overlapping requests: a Protocol instance can
   * own only one transport at a time.
   */
  setMcpServer(server: any): void {
    this.mcpServer = server
    this.mcpServerFactory = null
  }

  /** Supply a fresh, fully registered MCP server for each POST request. */
  setMcpServerFactory(factory: () => any | Promise<any>): void {
    this.mcpServerFactory = factory
    this.mcpServer = null
  }

  /**
   * Generate a new session ID.
   */
  generateSessionId(): string {
    return randomUUID()
  }

  /**
   * Check if a session exists.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * Get an existing session's transport.
   */
  getSession(sessionId: string): any | undefined {
    const sessions = this.sessions.get(sessionId)
    return sessions ? Array.from(sessions).pop()?.transport : undefined
  }

  /**
   * Store request context (headers, etc.) for a session.
   * This is called when an HTTP request arrives, before dispatching to MCP.
   */
  setRequestContext(sessionId: string, context: RequestContext): void {
    this.requestContexts.set(sessionId, context)
  }

  /**
   * Get the stored request context for a session.
   * Returns undefined if no context is stored.
   */
  getRequestContext(sessionId: string): RequestContext | undefined {
    return this.requestContexts.get(sessionId)
  }

  /**
   * Get or create a transport for a session.
   *
   * Always builds a FRESH transport, even when a transport is already cached for
   * this session id. The transports are created in stateless mode
   * (`sessionIdGenerator: undefined`), and the SDK's stateless transport is
   * single-request by design — reusing a cached one yields an empty-body HTTP 500
   * on the second request. Spec-compliant clients (Claude, Cursor, the official
   * SDK) echo the `Mcp-Session-Id` we return on `initialize` back on every
   * subsequent request, which used to route them straight into that broken reuse
   * path. Rebuilding per request keeps the echoed-id path working exactly like the
   * no-header path.
   *
   * The session map tracks every active request, including requests echoing the
   * same id, so DELETE and shutdown can close all of them. This managed
   * server runs in stateless JSON-response mode (`enableJsonResponse: true`) and
   * does NOT support standalone GET/SSE streams — the stateless transport rejects
   * them — so there is no long-lived stream for a later POST to disrupt.
   *
   * Managed servers use a factory: each request owns both its McpServer and its
   * transport. Closing one connection cannot abort another request (#424).
   */
  async getOrCreateSession(sessionId: string): Promise<any> {
    if (!this.mcpServerFactory && !this.mcpServer) {
      throw new Error('MCP server not set. Call setMcpServerFactory() or setMcpServer() first.')
    }

    const generation = this.generation
    const contextOwner = { context: this.requestContexts.get(sessionId) }
    const owners = this.contextOwners.get(sessionId) ?? new Set<RequestContextOwner>()
    owners.add(contextOwner)
    this.contextOwners.set(sessionId, owners)
    let server: any
    let session: TransportSession | undefined
    try {
      server = this.mcpServerFactory ? await this.mcpServerFactory() : this.mcpServer
      if (!this.mcpServerFactory) {
        // Preserve the legacy single-server setup for sequential callers.
        await server.close()
      }
      const TransportClass = await getTransportClass()

      // Use stateless mode (sessionIdGenerator: undefined) to avoid requiring
      // Mcp-Session-Id header on every request. This allows clients to make
      // direct JSON-RPC calls without the full MCP initialization handshake.
      const transport = new TransportClass({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      session = { server, transport, contextOwner }
      const currentSession = session

      // Set onclose BEFORE connect() so the SDK chains it with its own handler.
      // When the transport closes, both our cleanup and the SDK's cleanup run.
      let closed = false
      transport.onclose = () => {
        closed = true
        this.removeTransport(sessionId, currentSession)
      }

      await server.connect(transport)
      if (closed) throw new Error('MCP transport closed while connecting.')
      if (generation !== this.generation) {
        throw new Error('MCP sessions were destroyed while the transport was being created.')
      }

      // Force _initialized to true to allow requests without requiring initialize first.
      // This maintains backward compatibility with clients that don't send initialize.
      // The SDK sets _initialized = true only after processing an initialize request,
      // but we want to accept tool/resource/prompt calls directly.
      if (transport._initialized === false) {
        transport._initialized = true
      }

      const sessions = this.sessions.get(sessionId) ?? new Set<TransportSession>()
      sessions.add(session)
      this.sessions.set(sessionId, sessions)

      this.log?.(`Created new transport for session ${sessionId}`)
      this.config.onSessionCreated?.(sessionId)

      return transport
    } catch (error) {
      try {
        await server?.close()
      } catch (closeError) {
        this.log?.(`Failed to close MCP transport after setup failed: ${String(closeError)}`)
      }
      if (session) this.removeTransport(sessionId, session)
      this.releaseRequestContext(sessionId, contextOwner)
      throw error
    }
  }

  /** Remove only the connection that closed, preserving overlapping requests. */
  private removeTransport(sessionId: string, session: TransportSession): void {
    const sessions = this.sessions.get(sessionId)
    if (!sessions?.delete(session)) return
    if (sessions.size === 0) {
      this.sessions.delete(sessionId)
    }
    this.releaseRequestContext(sessionId, session.contextOwner)
    this.config.onSessionDestroyed?.(sessionId)
    this.log?.(`Transport closed for session ${sessionId}`)
  }

  /** Restore the newest remaining owner, whether connected or still connecting. */
  private releaseRequestContext(sessionId: string, owner: RequestContextOwner): void {
    const owners = this.contextOwners.get(sessionId)
    if (!owners?.delete(owner)) return
    if (owners.size === 0) this.contextOwners.delete(sessionId)
    // A later setRequestContext() may belong to a request not yet in this registry.
    if (this.requestContexts.get(sessionId) !== owner.context) return
    const latest = Array.from(owners).pop()
    if (latest?.context) this.requestContexts.set(sessionId, latest.context)
    else this.requestContexts.delete(sessionId)
  }

  /** Close the server/transport owned by one completed or disconnected POST. */
  async closeTransport(sessionId: string, transport: any): Promise<void> {
    const session = Array.from(this.sessions.get(sessionId) ?? []).find(
      (candidate) => candidate.transport === transport,
    )
    if (!session) return
    if (session.closing) return session.closing
    const closing = (async () => {
      try {
        await session.server.close()
      } finally {
        this.removeTransport(sessionId, session)
      }
    })()
    session.closing = closing
    this.closing.add(closing)
    try {
      await closing
    } finally {
      this.closing.delete(closing)
    }
  }

  /**
   * Destroy a session.
   */
  destroySession(sessionId: string): boolean {
    const sessions = this.sessions.get(sessionId)
    if (!sessions) return false
    for (const { transport } of Array.from(sessions)) {
      void this.closeTransport(sessionId, transport).catch((error: unknown) => {
        this.log?.(`Failed to close MCP transport: ${String(error)}`)
      })
    }
    return true
  }

  /**
   * Get all active session IDs.
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  /**
   * Get the number of active sessions.
   */
  getSessionCount(): number {
    return this.sessions.size
  }

  /**
   * Destroy all sessions.
   */
  async destroyAllSessions(): Promise<void> {
    this.generation++
    const sessionIds = this.getActiveSessions()
    for (const sessionId of sessionIds) {
      this.destroySession(sessionId)
    }
    this.requestContexts.clear()
    this.contextOwners.clear()
    // destroySession reports close failures through the logger. Still await the
    // remaining connections so a failed close cannot strand HTTP shutdown.
    await Promise.allSettled(Array.from(this.closing))
    this.log?.(`Destroyed all ${sessionIds.length} sessions`)
  }

  /**
   * Internal logging helper (no-op if log not provided).
   */
  private log(message: string): void {
    this.config.log?.(message)
  }
}

/**
 * Create a new session manager.
 */
export function createSessionManager(config: SessionManagerConfig = {}): SessionManager {
  return new SessionManager(config)
}
