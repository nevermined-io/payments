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

/**
 * Manages MCP transport sessions.
 */
export class SessionManager {
  private sessions: Map<string, any> = new Map()
  private requestContexts: Map<string, RequestContext> = new Map()
  private mcpServer: any = null
  private config: SessionManagerConfig

  constructor(config: SessionManagerConfig = {}) {
    this.config = config
  }

  /**
   * Set the MCP server that transports will connect to.
   */
  setMcpServer(server: any): void {
    this.mcpServer = server
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
    return this.sessions.get(sessionId)
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
   */
  async getOrCreateSession(sessionId: string): Promise<any> {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!
    }

    if (!this.mcpServer) {
      throw new Error('MCP server not set. Call setMcpServer() first.')
    }

    const TransportClass = await getTransportClass()

    const transport = new TransportClass({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    transport.sessionId = sessionId
    transport.onclose = () => {
      this.log?.(`Transport closed for session ${sessionId}`)
      this.sessions.delete(sessionId)
      this.config.onSessionDestroyed?.(sessionId)
    }

    await this.mcpServer.connect(transport)
    this.sessions.set(sessionId, transport)

    this.log?.(`Created new transport for session ${sessionId}`)
    this.config.onSessionCreated?.(sessionId)

    return transport
  }

  /**
   * Destroy a session.
   */
  destroySession(sessionId: string): boolean {
    if (this.sessions.has(sessionId)) {
      const transport = this.sessions.get(sessionId)
      this.sessions.delete(sessionId)
      this.requestContexts.delete(sessionId) // Clean up request context
      this.log?.(`Destroyed session ${sessionId}`)
      this.config.onSessionDestroyed?.(sessionId)

      // Try to close the transport if it has a close method
      if (transport && typeof transport.close === 'function') {
        try {
          transport.close()
        } catch {
          // Ignore close errors
        }
      }

      return true
    }
    return false
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
  destroyAllSessions(): void {
    const sessionIds = this.getActiveSessions()
    for (const sessionId of sessionIds) {
      this.destroySession(sessionId)
    }
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
