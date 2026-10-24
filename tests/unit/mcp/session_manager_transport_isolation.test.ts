import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SessionManager } from '../../../src/mcp/http/session-manager.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('MCP request transport lifecycle', () => {
  let manager: SessionManager
  let servers: McpServer[]

  beforeEach(() => {
    manager = new SessionManager()
    servers = []
    manager.setMcpServerFactory(() => {
      const server = new McpServer({ name: 'offline', version: '1.0.0' })
      servers.push(server)
      return server
    })
  })

  afterEach(async () => {
    await manager.destroyAllSessions()
  })

  test('closing an older request preserves the newer echoed-session transport and context', async () => {
    const firstContext = { headers: { authorization: 'Bearer first' } }
    const secondContext = { headers: { authorization: 'Bearer second' } }
    manager.setRequestContext('same', firstContext)
    const first = await manager.getOrCreateSession('same')
    manager.setRequestContext('same', secondContext)
    const second = await manager.getOrCreateSession('same')

    await manager.closeTransport('same', first)
    expect(manager.getSession('same')).toBe(second)
    expect(manager.getRequestContext('same')).toBe(secondContext)
    expect(servers[1].server.transport).toBe(second)
    await manager.closeTransport('same', second)
    expect(manager.getSessionCount()).toBe(0)
    expect(manager.getRequestContext('same')).toBeUndefined()
  })

  test('closing the newer request restores the still-running older request', async () => {
    const firstContext = { headers: { authorization: 'Bearer first' } }
    manager.setRequestContext('same', firstContext)
    const first = await manager.getOrCreateSession('same')
    manager.setRequestContext('same', { headers: { authorization: 'Bearer second' } })
    const second = await manager.getOrCreateSession('same')
    await manager.closeTransport('same', second)

    expect(manager.getSession('same')).toBe(first)
    expect(manager.getRequestContext('same')).toBe(firstContext)
    expect(servers[0].server.transport).toBe(first)
  })

  test('DELETE closes every request with the same echoed id without closing another session', async () => {
    await manager.getOrCreateSession('same')
    await manager.getOrCreateSession('same')
    const other = await manager.getOrCreateSession('other')
    expect(manager.destroySession('same')).toBe(true)
    // close() removes its own Protocol transport synchronously.
    expect(servers[0].server.transport).toBeUndefined()
    expect(servers[1].server.transport).toBeUndefined()
    expect(servers[2].server.transport).toBe(other)
    expect(manager.getActiveSessions()).toEqual(['other'])
  })

  test('shutdown closes all connections, including overlapping requests sharing an id', async () => {
    await manager.getOrCreateSession('same')
    await manager.getOrCreateSession('same')
    await manager.getOrCreateSession('other')
    await manager.destroyAllSessions()
    expect(servers.every((server) => server.server.transport === undefined)).toBe(true)
    expect(manager.getSessionCount()).toBe(0)
  })

  test('a connection that finishes being created after shutdown is closed instead of registered', async () => {
    let release!: (server: McpServer) => void
    const pendingServer = new Promise<McpServer>((resolve) => {
      release = resolve
    })
    manager.setMcpServerFactory(() => pendingServer)
    const pending = manager.getOrCreateSession('late')
    await manager.destroyAllSessions()
    const server = new McpServer({ name: 'late', version: '1.0.0' })
    release(server)
    await expect(pending).rejects.toThrow('destroyed')
    expect(server.server.transport).toBeUndefined()
    expect(manager.getSessionCount()).toBe(0)
  })

  test('an older request closing while its successor is being created preserves the successor context', async () => {
    manager.setRequestContext('same', { headers: { authorization: 'Bearer first' } })
    const first = await manager.getOrCreateSession('same')
    let release!: (server: McpServer) => void
    manager.setMcpServerFactory(
      () =>
        new Promise<McpServer>((resolve) => {
          release = resolve
        }),
    )
    const nextContext = { headers: { authorization: 'Bearer next' } }
    manager.setRequestContext('same', nextContext)
    const next = manager.getOrCreateSession('same')
    await manager.closeTransport('same', first)
    expect(manager.getRequestContext('same')).toBe(nextContext)
    release(new McpServer({ name: 'next', version: '1.0.0' }))
    await next
    expect(manager.getRequestContext('same')).toBe(nextContext)
  })

  test.each(['factory', 'connect'])(
    'closing the newer request restores an older context still awaiting %s',
    async (stage) => {
      const entered = deferred()
      const release = deferred()
      const firstServer = new McpServer({ name: 'pending', version: '1.0.0' })
      if (stage === 'connect') {
        const connect = firstServer.connect.bind(firstServer)
        jest.spyOn(firstServer, 'connect').mockImplementation(async (transport) => {
          await connect(transport)
          entered.resolve()
          await release.promise
        })
      }
      let calls = 0
      manager.setMcpServerFactory(async () => {
        if (calls++ > 0) return new McpServer({ name: 'newer', version: '1.0.0' })
        if (stage === 'factory') {
          entered.resolve()
          await release.promise
        }
        return firstServer
      })
      const firstContext = { headers: { authorization: 'Bearer pending' } }
      manager.setRequestContext('same', firstContext)
      const pending = manager.getOrCreateSession('same')
      try {
        await entered.promise
        manager.setRequestContext('same', { headers: { authorization: 'Bearer newer' } })
        const newer = await manager.getOrCreateSession('same')
        await manager.closeTransport('same', newer)
        expect(manager.getRequestContext('same')).toBe(firstContext)
        release.resolve()
        const first = await pending
        expect(manager.getSession('same')).toBe(first)
        expect(manager.getRequestContext('same')).toBe(firstContext)
        await manager.closeTransport('same', first)
        expect(manager.getRequestContext('same')).toBeUndefined()
      } finally {
        release.resolve()
        await pending
      }
    },
  )

  test('an older request finishing setup does not overwrite a newer request context', async () => {
    const entered = deferred()
    const release = deferred()
    let calls = 0
    manager.setMcpServerFactory(async () => {
      if (calls++ === 0) {
        entered.resolve()
        await release.promise
      }
      return new McpServer({ name: 'overlap', version: '1.0.0' })
    })
    manager.setRequestContext('same', { headers: { authorization: 'Bearer older' } })
    const pending = manager.getOrCreateSession('same')
    try {
      await entered.promise
      const newerContext = { headers: { authorization: 'Bearer newer' } }
      manager.setRequestContext('same', newerContext)
      const newer = await manager.getOrCreateSession('same')
      release.resolve()
      const older = await pending
      expect(manager.getRequestContext('same')).toBe(newerContext)
      await manager.closeTransport('same', older)
      expect(manager.getRequestContext('same')).toBe(newerContext)
      await manager.closeTransport('same', newer)
      expect(manager.getRequestContext('same')).toBeUndefined()
    } finally {
      release.resolve()
      await pending
    }
  })

  test('a failed factory restores the still-running request context', async () => {
    const firstContext = { headers: { authorization: 'Bearer first' } }
    manager.setRequestContext('same', firstContext)
    const first = await manager.getOrCreateSession('same')
    manager.setRequestContext('same', { headers: { authorization: 'Bearer failed' } })
    manager.setMcpServerFactory(async () => {
      throw new Error('registration failed')
    })
    await expect(manager.getOrCreateSession('same')).rejects.toThrow('registration failed')
    expect(manager.getSession('same')).toBe(first)
    expect(manager.getRequestContext('same')).toBe(firstContext)
  })

  test('a failed connect closes its server and preserves the setup error if cleanup also fails', async () => {
    const server = {
      connect: async () => {
        throw new Error('connect failed')
      },
      close: jest.fn(async () => {
        throw new Error('close failed')
      }),
    }
    manager.setMcpServerFactory(() => server)
    manager.setRequestContext('failed', { headers: {} })
    await expect(manager.getOrCreateSession('failed')).rejects.toThrow('connect failed')
    expect(server.close).toHaveBeenCalledTimes(1)
    expect(manager.getSessionCount()).toBe(0)
    expect(manager.getRequestContext('failed')).toBeUndefined()
  })

  test('response close and DELETE share one pending cleanup', async () => {
    let finishClose!: () => void
    const server = new McpServer({ name: 'closing', version: '1.0.0' })
    manager.setMcpServerFactory(() => server)
    const transport = await manager.getOrCreateSession('same')
    const close = jest.spyOn(server, 'close').mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finishClose = resolve
      })
      await transport.close()
    })
    const pending = manager.closeTransport('same', transport)
    manager.destroySession('same')
    expect(close).toHaveBeenCalledTimes(1)
    finishClose()
    await pending
    expect(manager.getSessionCount()).toBe(0)
  })

  test('a transport closing during connect is not registered as an active request', async () => {
    const server = new McpServer({ name: 'closed', version: '1.0.0' })
    const connect = server.connect.bind(server)
    jest.spyOn(server, 'connect').mockImplementation(async (transport) => {
      await connect(transport)
      await transport.close()
    })
    manager.setMcpServerFactory(() => server)
    await expect(manager.getOrCreateSession('closed')).rejects.toThrow('closed while connecting')
    expect(manager.getSessionCount()).toBe(0)
  })

  test('shutdown attempts every close even when one rejects', async () => {
    const log = jest.fn()
    manager = new SessionManager({ log })
    manager.setMcpServerFactory(() => {
      const server = new McpServer({ name: 'shutdown', version: '1.0.0' })
      servers.push(server)
      return server
    })
    await manager.getOrCreateSession('first')
    await manager.getOrCreateSession('second')
    const close = servers[0].close.bind(servers[0])
    jest.spyOn(servers[0], 'close').mockImplementation(async () => {
      await close()
      throw new Error('cleanup failed')
    })
    await expect(manager.destroyAllSessions()).resolves.toBeUndefined()
    expect(servers.every((server) => server.server.transport === undefined)).toBe(true)
    expect(manager.getSessionCount()).toBe(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('cleanup failed'))
  })
})
