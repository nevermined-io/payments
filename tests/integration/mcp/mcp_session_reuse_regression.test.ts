/**
 * Regression test for the "empty 500 after initialize when the client echoes
 * Mcp-Session-Id" bug (gist mqklin/8e2d10156f94bee42f6b226d7beb099c).
 *
 * A spec-compliant MCP client echoes the `Mcp-Session-Id` returned on
 * `initialize` back on every subsequent request. The managed server used to
 * return a cached single-use stateless transport for that echoed id, which the
 * SDK answers with an empty-body HTTP 500. This test drives the real
 * mcp-handler + session-manager over HTTP and asserts the echoed-id path works.
 */
import express from 'express'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SessionManager } from '../../../src/mcp/http/session-manager.js'
import { mountMcpHandlers } from '../../../src/mcp/http/mcp-handler.js'

describe('MCP Session - transport reuse regression', () => {
  let server: Server
  let mcpServer: McpServer
  let baseUrl: string

  beforeAll(async () => {
    mcpServer = new McpServer({ name: 'repro', version: '1.0.0' })
    mcpServer.registerTool('ping', { description: 'ping' }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }))

    const sessionManager = new SessionManager()
    sessionManager.setMcpServer(mcpServer)

    const app = express()
    app.use(express.json())
    mountMcpHandlers(app as any, { sessionManager, requireAuth: false })

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve())
    })
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
  })

  afterAll(async () => {
    await mcpServer?.close().catch(() => {})
    await new Promise<void>((resolve) => server?.close(() => resolve()))
  })

  const post = (body: object, sessionId?: string) =>
    fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(body),
    })

  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'r', version: '0' },
    },
  }
  const toolsList = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }

  test('tools/list succeeds when the client echoes the Mcp-Session-Id (compliant client)', async () => {
    const initRes = await post(initialize)
    expect(initRes.status).toBe(200)
    const sessionId = initRes.headers.get('mcp-session-id')
    expect(sessionId).toBeTruthy()

    // Compliant clients echo the session id back — this used to yield an empty 500.
    const listRes = await post(toolsList, sessionId!)
    expect(listRes.status).toBe(200)
    const body = await listRes.json()
    expect(body.result.tools.map((t: any) => t.name)).toContain('ping')
  })

  test('tools/list still succeeds without the session header (non-compliant path)', async () => {
    const listRes = await post(toolsList)
    expect(listRes.status).toBe(200)
    const body = await listRes.json()
    expect(body.result.tools.map((t: any) => t.name)).toContain('ping')
  })

  test('standalone GET/SSE is unsupported in stateless mode, so a later POST tears down nothing', async () => {
    // Review question on #423: does rebuilding a transport on POST close a live
    // GET/SSE stream on the same session? In this stateless config
    // (sessionIdGenerator: undefined, enableJsonResponse) the SDK rejects the
    // standalone SSE stream outright — it never establishes, so there is no
    // long-lived stream for the subsequent POST to disrupt.
    const initRes = await post(initialize)
    const sessionId = initRes.headers.get('mcp-session-id')!

    const sse = await fetch(baseUrl, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', 'mcp-session-id': sessionId },
    })
    expect(sse.status).not.toBe(200)
    await sse.body?.cancel()

    // The session id is still usable for JSON-RPC POSTs afterwards.
    const listRes = await post(toolsList, sessionId)
    expect(listRes.status).toBe(200)
  })
})
