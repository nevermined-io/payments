/** Offline regression for #424: overlapping paid calls must own their transports. */
import express from 'express'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Payments } from '../../../src/payments.js'
import { McpServerManager } from '../../../src/mcp/core/server-manager.js'
import { getCurrentRequestContext } from '../../../src/mcp/http/mcp-handler.js'
import type {
  SettlePermissionsParams,
  SettlePermissionsResult,
  VerifyPermissionsResult,
} from '../../../src/x402/facilitator-api.js'
import { encodeAccessToken } from '../../../src/utils.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function payment(from: string) {
  return {
    x402Version: 2,
    accepted: { scheme: 'nvm:erc4337', network: 'eip155:84532', planId: 'offline-plan' },
    payload: { authorization: { from }, signature: 'offline-fixture' },
  }
}

describe('managed MCP transport isolation (#424, offline)', () => {
  let manager: McpServerManager
  let httpServer: Server
  let endpoint: string
  let releaseFirst: ReturnType<typeof deferred>
  let firstEntered: ReturnType<typeof deferred>
  let verify: jest.Mock
  let settle: jest.Mock
  let contexts: Array<string | string[] | undefined>
  let connect: jest.SpyInstance

  const firstPayment = payment('0x1111111111111111111111111111111111111111')
  const secondPayment = payment('0x2222222222222222222222222222222222222222')
  const firstToken = encodeAccessToken(firstPayment)
  const secondToken = encodeAccessToken(secondPayment)

  beforeEach(async () => {
    releaseFirst = deferred()
    firstEntered = deferred()
    contexts = []
    connect = jest.spyOn(McpServer.prototype, 'connect')
    verify = jest.fn(async (): Promise<VerifyPermissionsResult> => ({ isValid: true }))
    settle = jest.fn(
      async (params: SettlePermissionsParams): Promise<SettlePermissionsResult> => ({
        success: true,
        transaction: params.x402AccessToken === firstToken ? 'tx-first' : 'tx-second',
        network: 'eip155:84532',
        creditsRedeemed: '1',
      }),
    )
    manager = new McpServerManager({
      facilitator: { verifyPermissions: verify, settlePermissions: settle },
      getEnvironmentName: () => 'sandbox',
    } as unknown as Payments)

    manager.registerTool('gated', { description: 'Locally gated paid tool' }, async () => {
      const token = getCurrentRequestContext()?.headers.authorization
      contexts.push(token)
      if (token === `Bearer ${firstToken}`) {
        firstEntered.resolve()
        await releaseFirst.promise
        contexts.push(getCurrentRequestContext()?.headers.authorization)
      }
      return {
        content: [{ type: 'text', text: token === `Bearer ${firstToken}` ? 'first' : 'second' }],
      }
    })
    manager.registerResource('fixture', 'fixture://static', {}, async () => ({ contents: [] }))
    manager.registerResource('template', 'fixture://items/{id}', {}, async () => ({ contents: [] }))
    manager.registerPrompt('fixture', {}, async () => ({ messages: [] }))

    // The public config currently rejects port 0. Keep that unrelated API intact,
    // but bind the real Express server to an ephemeral loopback port in this test.
    const listen = express.application.listen
    const listenSpy = jest.spyOn(express.application, 'listen').mockImplementationOnce(function (
      this: express.Application,
      ...args: any[]
    ) {
      httpServer = listen.call(this, { port: 0, host: '127.0.0.1' }, args[args.length - 1])
      return httpServer
    } as typeof listen)
    try {
      await manager.start({
        port: 5001,
        host: '127.0.0.1',
        planId: 'offline-plan',
        serverName: 'offline',
      })
    } finally {
      listenSpy.mockRestore()
    }
    endpoint = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`
  })

  afterEach(async () => {
    releaseFirst.resolve()
    await manager.stop()
    connect.mockRestore()
  })

  test.each([undefined, 'echoed-session'])(
    'keeps two paid calls isolated (session: %s)',
    async (sessionId) => {
      const post = async (
        id: number,
        payload: ReturnType<typeof payment>,
        signal?: AbortSignal,
      ) => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${encodeAccessToken(payload)}`,
            ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: { name: 'gated', arguments: {}, _meta: { 'x402/payment': payload } },
          }),
          signal: signal ?? AbortSignal.timeout(5000),
        })
        return { status: response.status, body: await response.json() }
      }

      // Observe A inside its handler before B starts: no timing assumptions.
      const firstController = new AbortController()
      const first = post(1, firstPayment, firstController.signal).catch((error: Error) => ({
        error: error.message,
      }))
      try {
        await Promise.race([
          firstEntered.promise,
          first.then(() => {
            throw new Error('First request ended before entering its handler')
          }),
        ])
        const firstServer = connect.mock.contexts[0] as McpServer
        const second = await post(2, secondPayment)
        expect(firstServer.server.transport).toBeDefined()
        releaseFirst.resolve()
        const firstResult = await first

        expect(firstResult).toMatchObject({
          status: 200,
          body: {
            id: 1,
            result: {
              content: [{ type: 'text', text: 'first' }],
              _meta: { 'x402/payment-response': { transaction: 'tx-first' } },
            },
          },
        })
        expect(second).toMatchObject({
          status: 200,
          body: {
            id: 2,
            result: {
              content: [{ type: 'text', text: 'second' }],
              _meta: { 'x402/payment-response': { transaction: 'tx-second' } },
            },
          },
        })
        expect(contexts).toEqual([
          `Bearer ${firstToken}`,
          `Bearer ${secondToken}`,
          `Bearer ${firstToken}`,
        ])
        expect(verify).toHaveBeenCalledTimes(2)
        expect(settle).toHaveBeenCalledTimes(2)
        for (const token of [firstToken, secondToken]) {
          expect(
            settle.mock.calls.filter(([params]) => params.x402AccessToken === token),
          ).toHaveLength(1)
        }
      } finally {
        releaseFirst.resolve()
        firstController.abort()
        await first
      }
    },
  )

  test('registers tools, static/template resources and prompts on fresh request servers', async () => {
    for (const [method, key, name] of [
      ['tools/list', 'tools', 'gated'],
      ['resources/list', 'resources', 'fixture'],
      ['resources/templates/list', 'resourceTemplates', 'template'],
      ['prompts/list', 'prompts', 'fixture'],
    ]) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${firstToken}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params: {} }),
        signal: AbortSignal.timeout(5000),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.result[key]).toEqual(expect.arrayContaining([expect.objectContaining({ name })]))
    }
    expect(new Set(connect.mock.contexts).size).toBe(4)
    expect(settle).not.toHaveBeenCalled()
  })

  test('disconnect closes only that request connection and leaves the managed server usable', async () => {
    const controller = new AbortController()
    const first = fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${firstToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'gated', arguments: {} },
      }),
      signal: controller.signal,
    }).catch((error: Error) => error)
    try {
      await Promise.race([
        firstEntered.promise,
        first.then(() => {
          throw new Error('First request ended before entering its handler')
        }),
      ])
      const closed = deferred()
      const server = connect.mock.contexts[0] as McpServer
      server.server.onclose = closed.resolve
      controller.abort()
      await first
      await closed.promise
      expect(server.server.transport).toBeUndefined()

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${secondToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'gated', arguments: {} },
        }),
        signal: AbortSignal.timeout(5000),
      })
      expect(response.status).toBe(200)
      expect((await response.json()).result.content).toEqual([{ type: 'text', text: 'second' }])
    } finally {
      releaseFirst.resolve()
      controller.abort()
      await first
    }
  })
})
