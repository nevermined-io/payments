/**
 * End-to-end tests for Express payment middleware.
 *
 * This test suite validates the x402 Express middleware flow:
 * 1. Request without token -> 402 with payment-required header
 * 2. Generate x402 access token
 * 3. Request with token -> 200 with payment-response header
 */

import express from 'express'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import type {
  Address,
  AgentAPIAttributes,
  AgentMetadata,
  PlanMetadata,
} from '../../src/common/types.js'
import { ZeroAddress } from '../../src/environments.js'
import { Payments } from '../../src/payments.js'
import { getCryptoPriceConfig, getDynamicCreditsConfig } from '../../src/plans.js'
import { paymentMiddleware, X402_HEADERS } from '../../src/x402/express/index.js'
import { makeWaitForAgent, retryWithBackoff } from '../utils.js'
import { createPaymentsBuilder, createPaymentsSubscriber } from './fixtures.js'

// Test configuration
const TEST_TIMEOUT = 90_000

// Set global timeout for all tests in this file
jest.setTimeout(TEST_TIMEOUT)

describe('Express Payment Middleware E2E', () => {
  let paymentsSubscriber: Payments
  let paymentsAgent: Payments
  let agentAddress: Address
  let planId: string
  let agentId: string
  let x402AccessToken: string

  // Express server
  let app: express.Application
  let server: Server
  let serverUrl: string

  beforeAll(async () => {
    // Initialize Payments instances
    paymentsSubscriber = createPaymentsSubscriber()
    paymentsAgent = createPaymentsBuilder()
    agentAddress = paymentsAgent.getAccountAddress() as Address
  })

  afterAll(async () => {
    // Close the Express server
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      // Give time for connections to close
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })

  test('should create a credits plan for Express middleware testing', async () => {
    expect(agentAddress).not.toBeNull()

    const timestamp = new Date().toISOString()
    const planMetadata: PlanMetadata = {
      name: `E2E Express Middleware Plan ${timestamp}`,
      description: 'Test plan for Express payment middleware',
    }

    // Create a free crypto plan (amount = 0) for testing
    const priceConfig = getCryptoPriceConfig(0n, agentAddress, ZeroAddress)

    // Configure credits: 10 total credits, min=1, max=2 per burn
    const creditsConfig = getDynamicCreditsConfig(10n, 1n, 2n)

    const response = await retryWithBackoff(
      () => paymentsAgent.plans.registerCreditsPlan(planMetadata, priceConfig, creditsConfig),
      {
        label: 'Express Middleware Plan Registration',
        attempts: 6,
      },
    )

    expect(response).toBeDefined()
    planId = response.planId
    expect(planId).not.toBeNull()
    console.log(`Created Express Middleware Plan with ID: ${planId}`)
  })

  test('should create an agent associated with the plan', async () => {
    expect(planId).not.toBeNull()

    const timestamp = new Date().toISOString()
    const agentMetadata: AgentMetadata = {
      name: `E2E Express Agent ${timestamp}`,
      description: 'Test agent for Express payment middleware',
      tags: ['express', 'middleware', 'test'],
    }

    const agentApi: AgentAPIAttributes = {
      endpoints: [{ POST: 'http://localhost/ask' }],
      openEndpoints: [],
      agentDefinitionUrl: 'http://localhost/agent-definition',
      authType: 'bearer',
    }

    const result = await retryWithBackoff(
      () => paymentsAgent.agents.registerAgent(agentMetadata, agentApi, [planId]),
      {
        label: 'Express Agent Registration',
        attempts: 6,
      },
    )

    expect(result).toBeDefined()
    agentId = result.agentId
    expect(agentId).not.toBeNull()
    console.log(`Created Express Agent with ID: ${agentId}`)

    // Wait for agent to be available
    const waitForAgent = makeWaitForAgent((id) => paymentsAgent.agents.getAgent(id))
    await waitForAgent(agentId, 20_000, 1_000)
  })

  test('should start Express server with payment middleware', async () => {
    expect(planId).not.toBeNull()

    app = express()
    app.use(express.json())

    // Apply payment middleware
    app.use(
      paymentMiddleware(paymentsAgent, {
        'POST /ask': {
          planId,
          agentId,
          credits: 1,
        },
      }),
    )

    // Simple endpoint that returns a response
    app.post('/ask', (_req, res) => {
      res.json({ response: 'Hello from the protected endpoint!' })
    })

    // Start server on random port
    server = app.listen(0)
    const address = server.address() as AddressInfo
    serverUrl = `http://localhost:${address.port}`
    console.log(`Express server started on ${serverUrl}`)
  })

  test('should return 402 with payment-required header when no token provided', async () => {
    expect(serverUrl).not.toBeNull()

    const response = await fetch(`${serverUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    })

    expect(response.status).toBe(402)

    // Check payment-required header exists
    const paymentRequiredHeader = response.headers.get(X402_HEADERS.PAYMENT_REQUIRED)
    expect(paymentRequiredHeader).not.toBeNull()
    console.log(`Received payment-required header (length: ${paymentRequiredHeader?.length})`)

    // Decode and validate the payment-required header
    const paymentRequired = JSON.parse(
      Buffer.from(paymentRequiredHeader!, 'base64').toString('utf-8'),
    )
    expect(paymentRequired).toBeDefined()
    expect(paymentRequired.x402Version).toBe(2)
    expect(paymentRequired.accepts).toBeDefined()
    expect(paymentRequired.accepts[0].planId).toBe(planId)
    console.log('Payment required:', JSON.stringify(paymentRequired, null, 2))

    // Check response body
    const body = await response.json()
    expect(body.error).toBe('Payment Required')
  })

  test('should generate x402 access token', async () => {
    expect(planId).not.toBeNull()

    const response = await retryWithBackoff(
      () => paymentsSubscriber.x402.getX402AccessToken(planId, agentId),
      {
        label: 'X402 Access Token Generation',
        attempts: 3,
      },
    )

    expect(response).toBeDefined()
    x402AccessToken = response.accessToken
    expect(x402AccessToken).not.toBeNull()
    expect(x402AccessToken.length).toBeGreaterThan(0)
    console.log(`Generated x402 access token (length: ${x402AccessToken.length})`)
  })

  test('should return 200 with payment-response header when valid token provided', async () => {
    expect(serverUrl).not.toBeNull()
    expect(x402AccessToken).not.toBeNull()

    const response = await fetch(`${serverUrl}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [X402_HEADERS.PAYMENT_SIGNATURE]: x402AccessToken,
      },
      body: JSON.stringify({ query: 'test' }),
    })

    expect(response.status).toBe(200)

    // Check response body
    const body = await response.json()
    expect(body.response).toBe('Hello from the protected endpoint!')
    console.log('Response body:', body)

    // Check payment-response header exists (settlement receipt)
    const paymentResponseHeader = response.headers.get(X402_HEADERS.PAYMENT_RESPONSE)
    expect(paymentResponseHeader).not.toBeNull()
    console.log(`Received payment-response header (length: ${paymentResponseHeader?.length})`)

    // Decode and validate the settlement receipt
    const settlement = JSON.parse(
      Buffer.from(paymentResponseHeader!, 'base64').toString('utf-8'),
    )
    expect(settlement).toBeDefined()
    expect(settlement.success).toBe(true)
    expect(settlement.creditsRedeemed).toBeDefined()
    console.log('Settlement receipt:', JSON.stringify(settlement, null, 2))
  })

  test('should reject request with invalid token', async () => {
    expect(serverUrl).not.toBeNull()

    const response = await fetch(`${serverUrl}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [X402_HEADERS.PAYMENT_SIGNATURE]: 'invalid-token',
      },
      body: JSON.stringify({ query: 'test' }),
    })

    expect(response.status).toBe(402)

    // Check payment-required header exists
    const paymentRequiredHeader = response.headers.get(X402_HEADERS.PAYMENT_REQUIRED)
    expect(paymentRequiredHeader).not.toBeNull()

    const body = await response.json()
    expect(body.error).toBe('Payment Required')
    console.log('Invalid token response:', body.message)
  })

  test('should allow requests to unprotected routes', async () => {
    expect(serverUrl).not.toBeNull()

    // Add an unprotected route
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' })
    })

    const response = await fetch(`${serverUrl}/health`)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    console.log('Unprotected route works correctly')
  })

})
