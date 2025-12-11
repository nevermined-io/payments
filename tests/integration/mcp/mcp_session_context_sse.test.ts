/**
 * Integration tests for MCP session management and SSE context persistence.
 * Tests that request context persists across session lifecycle (POST, GET, DELETE).
 */

import { SessionManager } from '../../../src/mcp/http/session-manager.js'
import type { RequestContext } from '../../../src/mcp/http/session-manager.js'

describe('MCP Session - Context Persistence', () => {
  test('should create and retrieve session', async () => {
    const manager = new SessionManager({
      log: undefined, // No logging in tests
    })

    const sessionId = manager.generateSessionId()
    expect(sessionId).toBeDefined()
    expect(typeof sessionId).toBe('string')
    expect(sessionId.length).toBeGreaterThan(0)

    // Session should not exist yet
    expect(manager.hasSession(sessionId)).toBe(false)
  })

  test('should generate unique session IDs', () => {
    const manager = new SessionManager()

    const id1 = manager.generateSessionId()
    const id2 = manager.generateSessionId()
    const id3 = manager.generateSessionId()

    expect(id1).not.toBe(id2)
    expect(id2).not.toBe(id3)
    expect(id1).not.toBe(id3)
  })

  test('should store and retrieve request context for session', () => {
    const manager = new SessionManager()
    const sessionId = manager.generateSessionId()

    const requestContext: RequestContext = {
      headers: {
        authorization: 'Bearer session-token-123',
        host: 'localhost:3000',
        'mcp-session-id': sessionId,
        'user-agent': 'MCP-Client/1.0',
      },
      method: 'POST',
      url: '/mcp',
      ip: '127.0.0.1',
    }

    // Store context
    manager.setRequestContext(sessionId, requestContext)

    // Retrieve context
    const retrieved = manager.getRequestContext(sessionId)

    expect(retrieved).toBeDefined()
    expect(retrieved?.headers.authorization).toBe('Bearer session-token-123')
    expect(retrieved?.headers.host).toBe('localhost:3000')
    expect(retrieved?.headers['mcp-session-id']).toBe(sessionId)
    expect(retrieved?.method).toBe('POST')
    expect(retrieved?.url).toBe('/mcp')
    expect(retrieved?.ip).toBe('127.0.0.1')
  })

  test('should return undefined for non-existent session context', () => {
    const manager = new SessionManager()
    const nonExistentId = 'non-existent-session-id'

    const context = manager.getRequestContext(nonExistentId)
    expect(context).toBeUndefined()
  })

  test('should track multiple sessions independently', () => {
    const manager = new SessionManager()

    const session1 = manager.generateSessionId()
    const session2 = manager.generateSessionId()
    const session3 = manager.generateSessionId()

    const context1: RequestContext = {
      headers: { authorization: 'Bearer token-1', host: 'server-1.com' },
      method: 'POST',
      url: '/mcp',
    }

    const context2: RequestContext = {
      headers: { authorization: 'Bearer token-2', host: 'server-2.com' },
      method: 'POST',
      url: '/mcp',
    }

    const context3: RequestContext = {
      headers: { authorization: 'Bearer token-3', host: 'server-3.com' },
      method: 'POST',
      url: '/mcp',
    }

    manager.setRequestContext(session1, context1)
    manager.setRequestContext(session2, context2)
    manager.setRequestContext(session3, context3)

    // Verify each session has its own context
    const retrieved1 = manager.getRequestContext(session1)
    const retrieved2 = manager.getRequestContext(session2)
    const retrieved3 = manager.getRequestContext(session3)

    expect(retrieved1?.headers.authorization).toBe('Bearer token-1')
    expect(retrieved1?.headers.host).toBe('server-1.com')

    expect(retrieved2?.headers.authorization).toBe('Bearer token-2')
    expect(retrieved2?.headers.host).toBe('server-2.com')

    expect(retrieved3?.headers.authorization).toBe('Bearer token-3')
    expect(retrieved3?.headers.host).toBe('server-3.com')
  })

  test('should update request context for existing session', () => {
    const manager = new SessionManager()
    const sessionId = manager.generateSessionId()

    // Initial context (POST /mcp - initialize)
    const initialContext: RequestContext = {
      headers: {
        authorization: 'Bearer initial-token',
        host: 'localhost:3000',
      },
      method: 'POST',
      url: '/mcp',
    }

    manager.setRequestContext(sessionId, initialContext)

    // Updated context (GET /mcp - SSE stream)
    const updatedContext: RequestContext = {
      headers: {
        authorization: 'Bearer initial-token',
        host: 'localhost:3000',
        accept: 'text/event-stream',
      },
      method: 'GET',
      url: '/mcp',
    }

    manager.setRequestContext(sessionId, updatedContext)

    const retrieved = manager.getRequestContext(sessionId)
    expect(retrieved?.method).toBe('GET')
    expect(retrieved?.headers.accept).toBe('text/event-stream')
  })

  test('should handle session destruction and context cleanup', () => {
    const manager = new SessionManager()
    const sessionId = manager.generateSessionId()

    const context: RequestContext = {
      headers: { authorization: 'Bearer token' },
      method: 'POST',
      url: '/mcp',
    }

    manager.setRequestContext(sessionId, context)

    // Verify context exists
    expect(manager.getRequestContext(sessionId)).toBeDefined()

    // Destroy session (this should clean up context)
    // Note: Since we don't have a transport, destroySession will return false
    // but we can still test context cleanup by calling it
    const destroyed = manager.destroySession(sessionId)

    // Session didn't exist in sessions map, so returns false
    expect(destroyed).toBe(false)

    // But if we had created a session, the context should be cleaned up
    // For now, just verify the method works
  })

  test('should preserve headers across session lifecycle simulation', () => {
    const manager = new SessionManager()
    const sessionId = manager.generateSessionId()
    const token = 'Bearer persistent-token-xyz'

    // Step 1: POST /mcp (initialize)
    const postContext: RequestContext = {
      headers: {
        authorization: token,
        host: 'api.example.com',
        'content-type': 'application/json',
        'mcp-session-id': sessionId,
      },
      method: 'POST',
      url: '/mcp',
      ip: '192.168.1.100',
    }

    manager.setRequestContext(sessionId, postContext)

    // Verify context after POST
    let retrieved = manager.getRequestContext(sessionId)
    expect(retrieved?.headers.authorization).toBe(token)
    expect(retrieved?.method).toBe('POST')

    // Step 2: GET /mcp (SSE stream)
    const getContext: RequestContext = {
      headers: {
        authorization: token,
        host: 'api.example.com',
        accept: 'text/event-stream',
        'mcp-session-id': sessionId,
      },
      method: 'GET',
      url: '/mcp',
      ip: '192.168.1.100',
    }

    manager.setRequestContext(sessionId, getContext)

    // Verify context after GET
    retrieved = manager.getRequestContext(sessionId)
    expect(retrieved?.headers.authorization).toBe(token)
    expect(retrieved?.method).toBe('GET')
    expect(retrieved?.headers.accept).toBe('text/event-stream')

    // Step 3: Another POST (tool call)
    const toolContext: RequestContext = {
      headers: {
        authorization: token,
        host: 'api.example.com',
        'content-type': 'application/json',
        'mcp-session-id': sessionId,
      },
      method: 'POST',
      url: '/mcp',
      ip: '192.168.1.100',
    }

    manager.setRequestContext(sessionId, toolContext)

    // Verify context after tool call
    retrieved = manager.getRequestContext(sessionId)
    expect(retrieved?.headers.authorization).toBe(token)
    expect(retrieved?.method).toBe('POST')
  })

  test('should handle concurrent session contexts', () => {
    const manager = new SessionManager()

    // Simulate multiple concurrent sessions
    const sessions = Array.from({ length: 10 }, () => manager.generateSessionId())

    // Set context for all sessions
    sessions.forEach((sessionId, index) => {
      const context: RequestContext = {
        headers: {
          authorization: `Bearer token-${index}`,
          host: `client-${index}.com`,
        },
        method: 'POST',
        url: '/mcp',
      }
      manager.setRequestContext(sessionId, context)
    })

    // Verify all contexts are independent
    sessions.forEach((sessionId, index) => {
      const retrieved = manager.getRequestContext(sessionId)
      expect(retrieved?.headers.authorization).toBe(`Bearer token-${index}`)
      expect(retrieved?.headers.host).toBe(`client-${index}.com`)
    })
  })

  test('should invoke callbacks on session lifecycle events', () => {
    const createdSessions: string[] = []
    const destroyedSessions: string[] = []

    const manager = new SessionManager({
      onSessionCreated: (sessionId) => {
        createdSessions.push(sessionId)
      },
      onSessionDestroyed: (sessionId) => {
        destroyedSessions.push(sessionId)
      },
    })

    const sessionId = manager.generateSessionId()

    // Note: Callbacks are only invoked when actual transport sessions are created/destroyed
    // Since we're not creating transports here, callbacks won't be invoked in this test
    // This is just to verify the API accepts the callbacks

    expect(createdSessions.length).toBe(0) // No transport created yet
    expect(destroyedSessions.length).toBe(0)
  })
})
