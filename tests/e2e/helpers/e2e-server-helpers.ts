/**
 * @file E2E Server Helpers
 * @description Utilities for managing A2A test servers in E2E tests
 */

import http from 'http'
import net from 'net'
import { PaymentsA2AServer } from '../../../src/a2a/server.js'
import type { AgentCard, PaymentsAgentExecutor } from '../../../src/a2a/types.js'
import type { Payments } from '../../../src/payments.js'

/**
 * Configuration for E2E test servers
 */
export const E2E_SERVER_CONFIG = {
  PORT: 6782,
  BASE_PATH: '/a2a/',
  STARTUP_TIMEOUT: 10000,
  STARTUP_RETRIES: 20,
}

/**
 * Real A2A server for E2E testing with payments integration
 */
export class A2ATestServer {
  private port: number
  private server: http.Server | null = null
  private baseUrl: string | null = null
  private paymentsService: Payments | null = null
  private agentCard: AgentCard | null = null
  private executor: PaymentsAgentExecutor | null = null

  constructor(port: number = E2E_SERVER_CONFIG.PORT) {
    this.port = port
  }

  /**
   * Check if a port is available (not in use)
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const server = net.createServer()
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false)
        } else {
          resolve(false)
        }
      })
      server.once('listening', () => {
        server.once('close', () => resolve(true))
        server.close()
      })
      server.listen(port, '127.0.0.1')
    })
  }

  /**
   * Wait for port to become available
   */
  private async waitForPortAvailable(port: number, timeout: number = 5000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const available = await this.isPortAvailable(port)
      if (available) {
        // Give it a bit more time to ensure it's fully released
        await new Promise((resolve) => setTimeout(resolve, 100))
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Port ${port} did not become available within ${timeout}ms`)
  }

  /**
   * Start the A2A server and wait for it to be ready
   */
  async start(
    paymentsService: Payments,
    agentCard: AgentCard,
    executor: PaymentsAgentExecutor,
  ): Promise<string> {
    // Use fixed port if not specified (important for payments validation)
    if (this.port === 0) {
      this.port = E2E_SERVER_CONFIG.PORT
    }

    // Ensure port is available before starting
    console.log(`[A2A Server] Checking if port ${this.port} is available...`)
    await this.waitForPortAvailable(this.port, 10000)

    this.baseUrl = `http://localhost:${this.port}${E2E_SERVER_CONFIG.BASE_PATH}`
    console.log(`[A2A Server] Starting real A2A server at: ${this.baseUrl}`)

    // Store references
    this.paymentsService = paymentsService
    this.agentCard = agentCard
    this.executor = executor

    // Start server
    const result = PaymentsA2AServer.start({
      paymentsService: paymentsService,
      agentCard,
      executor: executor,
      port: this.port,
      basePath: E2E_SERVER_CONFIG.BASE_PATH,
      exposeDefaultRoutes: true,
    })

    this.server = result.server

    // Wait for server to start listening
    await this.waitForServerListening()

    // Wait for server to be ready by polling the agent card endpoint
    await this.waitForServerReady()

    return this.baseUrl
  }

  /**
   * Wait for server to start listening on the port
   */
  private async waitForServerListening(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server not initialized'))
        return
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Server listening timeout after ${E2E_SERVER_CONFIG.STARTUP_TIMEOUT}ms`))
      }, E2E_SERVER_CONFIG.STARTUP_TIMEOUT)

      this.server.on('listening', () => {
        clearTimeout(timeout)
        console.log(`[A2A Server] Server is listening on port ${this.port}`)
        resolve()
      })

      this.server.on('error', (err: any) => {
        clearTimeout(timeout)
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use`))
        } else {
          reject(err)
        }
      })
    })
  }

  /**
   * Wait for server to be ready by polling the agent card endpoint
   */
  private async waitForServerReady(): Promise<void> {
    const maxRetries = E2E_SERVER_CONFIG.STARTUP_RETRIES
    const pollInterval = 500 // 500ms between polls
    const agentCardUrl = `${this.baseUrl}.well-known/agent.json`

    for (let i = 0; i < maxRetries; i++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 2000)

        try {
          const response = await fetch(agentCardUrl, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          })

          clearTimeout(timeoutId)

          if (response.ok) {
            const agentCard = await response.json()
            if (agentCard && agentCard.name) {
              console.log(`[A2A Server] Server is ready at ${this.baseUrl}`)
              return
            }
          }
        } catch (fetchError: any) {
          clearTimeout(timeoutId)
          if (fetchError.name !== 'AbortError') {
            // Continue polling if it's not a timeout
          }
        }
      } catch (error) {
        // Continue polling
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    throw new Error(
      `Server on port ${this.port} did not become ready within ${maxRetries * pollInterval}ms`,
    )
  }

  /**
   * Stop the A2A server and wait for it to close completely
   */
  async stop(): Promise<void> {
    if (this.server) {
      const serverToClose = this.server
      this.server = null // Clear reference immediately to prevent reuse

      try {
        // Close all active connections first
        serverToClose.closeAllConnections()

        // Wait for server to close with a timeout
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            console.error(`[A2A Server] Server close timeout after 5s on port ${this.port}`)
            // Force close on timeout
            serverToClose.closeAllConnections()
            serverToClose.close(() => {
              resolve() // Resolve anyway to not block tests
            })
          }, 5000)

          serverToClose.close((error) => {
            clearTimeout(timeout)
            if (error) {
              console.error(`[A2A Server] Error closing server: ${error}`)
              // Still resolve to not block tests
              resolve()
            } else {
              console.log(`[A2A Server] Server stopped on port ${this.port}`)
              resolve()
            }
          })
        })

        // Wait a bit more to ensure port is fully released
        await new Promise((resolve) => setTimeout(resolve, 200))
      } catch (error) {
        console.error(`[A2A Server] Error stopping: ${error}`)
        // Force close if normal close fails
        try {
          serverToClose.closeAllConnections()
          serverToClose.close()
        } catch (closeError) {
          console.error(`[A2A Server] Error force closing: ${closeError}`)
        }
        // Wait a bit to ensure port is released
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
  }
}
