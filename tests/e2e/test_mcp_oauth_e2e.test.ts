/**
 * @file End-to-end tests for MCP OAuth authentication
 * @description E2E tests for MCP server OAuth flow with real Nevermined backend
 */

import { z } from 'zod'
import type {
  Address,
  AgentAPIAttributes,
  AgentMetadata
} from '../../src/common/types.js'
import { Payments } from '../../src/payments.js'
import { retryWithBackoff } from '../utils.js'
import { createPaymentsBuilder, createPaymentsSubscriber, ERC20_ADDRESS } from './fixtures.js'

// Test configuration
const TEST_TIMEOUT = 30000
const MCP_SERVER_PORT = 8890

// Global variables to store test IDs
let creditsPlanId: string | null = null
let mcpAgentId: string | null = null
let mcpAgentDID: string | null = null
let builderAddress: Address | null = null
let subscriberAccessToken: string | null = null

// MCP server instance
let mcpServerStop: (() => Promise<void>) | null = null
let mcpServerInfo: any = null

describe('MCP OAuth E2E Tests', () => {
  let paymentsSubscriber: Payments
  let paymentsBuilder: Payments

  beforeAll(() => {
    paymentsSubscriber = createPaymentsSubscriber()
    paymentsBuilder = createPaymentsBuilder()
  }, TEST_TIMEOUT)

  afterAll(async () => {
    if (mcpServerStop) {
      console.log('[E2E] Stopping MCP server...')
      await mcpServerStop()
      // Give time for cleanup
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }, TEST_TIMEOUT)

  test('should initialize Payments instances', () => {
    expect(paymentsSubscriber).toBeDefined()
    expect(paymentsBuilder).toBeDefined()
    builderAddress = paymentsBuilder.getAccountAddress() as Address
    expect(builderAddress).toBeDefined()
    console.log('[E2E] Builder address:', builderAddress)
  })

  test(
    'should create a credits plan for MCP agent',
    async () => {
      if (!builderAddress) {
        builderAddress = paymentsBuilder.getAccountAddress() as Address
      }

      const priceConfig = paymentsBuilder.plans.getERC20PriceConfig(
        10n,
        ERC20_ADDRESS,
        builderAddress,
      )
      const creditsConfig = paymentsBuilder.plans.getFixedCreditsConfig(100n)

      const response = await retryWithBackoff(
        () =>
          paymentsBuilder.plans.registerCreditsPlan(
            { name: `E2E MCP OAuth Plan ${Date.now()}` },
            priceConfig,
            creditsConfig,
          ),
        { label: 'registerCreditsPlan for MCP' },
      )

      expect(response).toBeDefined()
      creditsPlanId = response.planId
      expect(creditsPlanId).toBeDefined()
      expect(BigInt(creditsPlanId) > 0n).toBeTruthy()
      console.log('[E2E] MCP Credits Plan ID:', creditsPlanId)

      // Wait a bit for the contract to sync after plan registration
      // This helps avoid "PlanNotFound" errors when registering the agent
      await new Promise((resolve) => setTimeout(resolve, 2000))
    },
    TEST_TIMEOUT * 2,
  )

  test(
    'should create MCP agent with logical URIs',
    async () => {
      expect(creditsPlanId).not.toBeNull()

      const serverName = 'test-mcp-server-e2e'
      const agentMetadata: AgentMetadata = {
        name: `E2E MCP OAuth Agent ${Date.now()}`,
        description: 'MCP server with OAuth authentication for E2E testing',
        tags: ['mcp', 'oauth', 'e2e'],
        dateCreated: new Date(),
      }

      // Register agent with MCP logical URIs
      const agentApi: AgentAPIAttributes = {
        endpoints: [
          // Logical URIs for MCP tools
          { POST: `mcp://${serverName}/tools/weather` },
          { POST: `mcp://${serverName}/tools/calculator` },
          // Wildcard for any tool
          { POST: `mcp://${serverName}/tools/*` },
          // Resources
          { GET: `mcp://${serverName}/resources/weather://today/{city}` },
          // Wildcard for any resource
          { GET: `mcp://${serverName}/resources/*` },
          // Prompts
          { GET: `mcp://${serverName}/prompts/weather.ask` },
          // Wildcard for any prompt
          { GET: `mcp://${serverName}/prompts/*` },
          // HTTP fallback
          { POST: `http://localhost:${MCP_SERVER_PORT}/mcp` },
        ],
        agentDefinitionUrl: `http://localhost:${MCP_SERVER_PORT}/.well-known/openid-configuration`,
      }

      const result = await retryWithBackoff<{ agentId: string }>(
        () => paymentsBuilder.agents.registerAgent(agentMetadata, agentApi, [creditsPlanId!]),
        {
          label: 'registerAgent for MCP',
          baseDelaySecs: 1.0, // Increase initial delay to allow contract sync
          attempts: 8, // Increase attempts to handle contract sync delays
        },
      )

      mcpAgentId = result.agentId
      expect(mcpAgentId).toBeDefined()
      console.log('[E2E] MCP Agent ID:', mcpAgentId)

      // Extract DID from agent ID
      mcpAgentDID = mcpAgentId
    },
    TEST_TIMEOUT * 2,
  )

  test(
    'should start MCP server with real payments.mcp.start()',
    async () => {
      expect(mcpAgentDID).not.toBeNull()

      // Configure MCP
      paymentsBuilder.mcp.configure({
        agentId: mcpAgentDID!,
        serverName: 'test-mcp-server-e2e',
      })

      // Register tools
      const weatherToolSchema = z.object({
        city: z.string().describe('City name'),
      })

      paymentsBuilder.mcp.registerTool(
        'weather',
        {
          title: 'Get Weather',
          description: 'Get current weather for a city',
          inputSchema: weatherToolSchema,
        },
        async (args: any) => {
          return {
            content: [
              {
                type: 'text',
                text: `Weather in ${args.city}: 22°C, sunny`,
              },
            ],
          }
        },
        { credits: 5n },
      )

      paymentsBuilder.mcp.registerTool(
        'calculator',
        {
          title: 'Calculator',
          description: 'Perform calculations',
          inputSchema: z.object({
            operation: z.string(),
          }),
        },
        async (args: any) => {
          return {
            content: [
              {
                type: 'text',
                text: `Calculator result: ${args.operation}`,
              },
            ],
          }
        },
        { credits: 3n },
      )

      // Register a resource with URI template
      paymentsBuilder.mcp.registerResource(
        "Today's Weather Resource",
        'weather://today/{city}',
        {
          title: "Today's Weather Resource",
          description: "JSON for today's weather by city",
          mimeType: 'application/json',
        },
        async (uri: URL, variables: Record<string, string | string[]>) => {
          console.log('[E2E] Resource handler called!')
          console.log('[E2E] URI:', uri.href)
          console.log('[E2E] Variables:', JSON.stringify(variables))

          const city =
            (Array.isArray(variables.city) ? variables.city[0] : variables.city) || 'Unknown'
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'application/json',
                text: JSON.stringify({
                  city,
                  temperature: 22,
                  conditions: 'sunny',
                  humidity: 65,
                }),
              },
            ],
          }
        },
        { credits: 2n },
      )

      // Register a prompt with input schema
      paymentsBuilder.mcp.registerPrompt(
        'weather.ask',
        {
          title: 'Ask for Weather',
          description: 'Prompt to ask for weather information',
          argsSchema: z.object({
            city: z.string().describe('City name'),
          }),
        },
        async function promptHandler(args: Record<string, string>, context?: any) {
          const city = args?.city || 'a city'
          console.log('[E2E] Prompt handler called with city:', city)

          return {
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `What is the weather like in ${city}?`,
                },
              },
            ],
          }
        },
        { credits: 1n },
      )

      // Start the server using the real API
      const { info, stop } = await paymentsBuilder.mcp.start({
        port: MCP_SERVER_PORT,
        agentId: mcpAgentDID!,
        serverName: 'test-mcp-server-e2e',
        version: '0.1.0',
        description: 'E2E test MCP server',
      })

      mcpServerStop = stop
      mcpServerInfo = info

      expect(info).toBeDefined()
      expect(info.baseUrl).toBeDefined()
      expect(info.tools).toContain('weather')
      expect(info.tools).toContain('calculator')
      expect(info.resources).toContain('weather://today/{city}')
      expect(info.prompts).toContain('weather.ask')

      console.log('[E2E] MCP Server started:', info.baseUrl)
      console.log('[E2E] Tools:', info.tools.join(', '))
      console.log('[E2E] Resources:', info.resources.join(', '))
      console.log('[E2E] Prompts:', info.prompts.join(', '))

      // Wait for server to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 500))
    },
    TEST_TIMEOUT,
  )

  test(
    'should have /.well-known/oauth-protected-resource with correct metadata',
    async () => {
      expect(mcpServerInfo).not.toBeNull()

      const serverUrl = mcpServerInfo.baseUrl
      const response = await fetch(`${serverUrl}/.well-known/oauth-protected-resource`)

      expect(response.ok).toBe(true)
      expect(response.headers.get('content-type')).toContain('application/json')

      const data = await response.json()

      // Required fields per RFC 8414
      expect(data.resource).toBe(serverUrl)
      expect(data.authorization_servers).toBeDefined()
      expect(Array.isArray(data.authorization_servers)).toBe(true)
      expect(data.authorization_servers.length).toBeGreaterThan(0)

      // MCP-specific scopes
      expect(data.scopes_supported).toBeDefined()
      expect(Array.isArray(data.scopes_supported)).toBe(true)
      expect(data.scopes_supported).toContain('mcp:tools')
      expect(data.scopes_supported).toContain('mcp:read')
      expect(data.scopes_supported).toContain('mcp:write')

      // Optional but recommended fields
      expect(data.bearer_methods_supported).toBeDefined()
      expect(data.bearer_methods_supported).toContain('header')

      console.log('[E2E] ✓ oauth-protected-resource metadata valid')
    },
    TEST_TIMEOUT,
  )

  test(
    'should have /.well-known/oauth-authorization-server with correct metadata',
    async () => {
      expect(mcpServerInfo).not.toBeNull()

      const serverUrl = mcpServerInfo.baseUrl
      const response = await fetch(`${serverUrl}/.well-known/oauth-authorization-server`)

      expect(response.ok).toBe(true)
      expect(response.headers.get('content-type')).toContain('application/json')

      const data = await response.json()

      // Required fields per RFC 8414
      expect(data.issuer).toBeDefined()
      expect(data.authorization_endpoint).toBeDefined()
      expect(data.token_endpoint).toBeDefined()

      // Response types and grant types
      expect(data.response_types_supported).toBeDefined()
      expect(Array.isArray(data.response_types_supported)).toBe(true)
      expect(data.response_types_supported).toContain('code')

      expect(data.grant_types_supported).toBeDefined()
      expect(Array.isArray(data.grant_types_supported)).toBe(true)
      expect(data.grant_types_supported).toContain('authorization_code')

      // PKCE support (recommended for security)
      expect(data.code_challenge_methods_supported).toBeDefined()
      expect(data.code_challenge_methods_supported).toContain('S256')

      // Scopes
      expect(data.scopes_supported).toBeDefined()
      expect(data.scopes_supported).toContain('mcp:tools')
      expect(data.scopes_supported).toContain('openid')
      expect(data.scopes_supported).toContain('profile')

      // Token endpoint auth methods
      expect(data.token_endpoint_auth_methods_supported).toBeDefined()
      expect(Array.isArray(data.token_endpoint_auth_methods_supported)).toBe(true)

      // Registration endpoint
      expect(data.registration_endpoint).toBeDefined()
      expect(data.registration_endpoint).toContain(serverUrl)

      // JWKS URI
      expect(data.jwks_uri).toBeDefined()

      console.log('[E2E] ✓ oauth-authorization-server metadata valid')
    },
    TEST_TIMEOUT,
  )

  test(
    'should have /.well-known/openid-configuration with correct OIDC metadata',
    async () => {
      expect(mcpServerInfo).not.toBeNull()

      const serverUrl = mcpServerInfo.baseUrl
      const response = await fetch(`${serverUrl}/.well-known/openid-configuration`)

      expect(response.ok).toBe(true)
      expect(response.headers.get('content-type')).toContain('application/json')

      const data = await response.json()

      // Required OIDC Discovery fields per OpenID Connect Discovery 1.0
      expect(data.issuer).toBeDefined()
      expect(data.authorization_endpoint).toBeDefined()
      expect(data.token_endpoint).toBeDefined()
      expect(data.jwks_uri).toBeDefined()
      expect(data.response_types_supported).toBeDefined()
      expect(data.subject_types_supported).toBeDefined()
      expect(data.id_token_signing_alg_values_supported).toBeDefined()

      // OIDC-specific endpoints
      expect(data.userinfo_endpoint).toBeDefined()

      // Scopes - must include 'openid'
      expect(data.scopes_supported).toBeDefined()
      expect(data.scopes_supported).toContain('openid')
      expect(data.scopes_supported).toContain('profile')
      expect(data.scopes_supported).toContain('mcp:tools')

      // Claims supported
      expect(data.claims_supported).toBeDefined()
      expect(Array.isArray(data.claims_supported)).toBe(true)
      expect(data.claims_supported).toContain('sub')
      expect(data.claims_supported).toContain('iss')

      // Token endpoint auth methods
      expect(data.token_endpoint_auth_methods_supported).toBeDefined()
      expect(data.token_endpoint_auth_methods_supported).toContain('none')

      // Grant types
      expect(data.grant_types_supported).toBeDefined()
      expect(data.grant_types_supported).toContain('authorization_code')

      // PKCE
      expect(data.code_challenge_methods_supported).toBeDefined()
      expect(data.code_challenge_methods_supported).toContain('S256')

      console.log('[E2E] ✓ openid-configuration metadata valid')
    },
    TEST_TIMEOUT,
  )

  test(
    'should have consistent issuer across all discovery endpoints',
    async () => {
      expect(mcpServerInfo).not.toBeNull()

      const serverUrl = mcpServerInfo.baseUrl

      // Fetch all three endpoints
      const [authServerRes, oidcRes] = await Promise.all([
        fetch(`${serverUrl}/.well-known/oauth-authorization-server`),
        fetch(`${serverUrl}/.well-known/openid-configuration`),
      ])

      const authServerData = await authServerRes.json()
      const oidcData = await oidcRes.json()

      // Issuer should be consistent across endpoints
      expect(authServerData.issuer).toBe(oidcData.issuer)

      // Endpoints should also be consistent
      expect(authServerData.authorization_endpoint).toBe(oidcData.authorization_endpoint)
      expect(authServerData.token_endpoint).toBe(oidcData.token_endpoint)
      expect(authServerData.jwks_uri).toBe(oidcData.jwks_uri)

      console.log('[E2E] ✓ Issuer and endpoints consistent across discovery documents')
    },
    TEST_TIMEOUT,
  )

  test(
    'should reject tool access without authentication',
    async () => {
      expect(mcpServerInfo).not.toBeNull()

      const response = await fetch(`${mcpServerInfo.baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'weather',
            arguments: { city: 'Madrid' },
          },
        }),
      })

      expect(response.ok).toBe(false)
      console.log('[E2E] Unauthenticated request status:', response.status)
    },
    TEST_TIMEOUT,
  )

  test(
    'should order plan and get access token',
    async () => {
      expect(creditsPlanId).not.toBeNull()
      expect(mcpAgentDID).not.toBeNull()

      // Order the plan as subscriber
      const orderResult = await retryWithBackoff(
        () => paymentsSubscriber.plans.orderPlan(creditsPlanId!),
        { label: 'orderPlan for MCP' },
      )

      expect(orderResult).toBeDefined()
      expect(orderResult.success).toBe(true)
      console.log('[E2E] Plan ordered successfully:', orderResult)

      // Get access token for the agent
      const accessParams = await retryWithBackoff(
        () => paymentsSubscriber.x402.getX402AccessToken(creditsPlanId!, mcpAgentDID!),
        { label: 'getX402AccessToken for MCP' },
      )

      expect(accessParams).toBeDefined()
      expect(accessParams.accessToken).toBeDefined()
      subscriberAccessToken = accessParams.accessToken
      console.log('[E2E] Access token obtained:', subscriberAccessToken?.substring(0, 40) + '...')
    },
    TEST_TIMEOUT * 3,
  )

  test(
    'should access MCP tool with valid token via JSON-RPC',
    async () => {
      expect(subscriberAccessToken).not.toBeNull()
      expect(mcpServerInfo).not.toBeNull()

      const response = await fetch(`${mcpServerInfo.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${subscriberAccessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'weather',
            arguments: { city: 'Madrid' },
          },
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()
      console.log('[E2E] Tool response:', JSON.stringify(data, null, 2))
      expect(data.result).toBeDefined()
      expect(data.result.content[0].text).toContain('Madrid')
      expect(data.result.content[0].text).toContain('sunny')
      console.log('[E2E] Tool call successful:', data.result.content[0].text)
    },
    TEST_TIMEOUT,
  )

  test(
    'should access different tools with same token',
    async () => {
      expect(subscriberAccessToken).not.toBeNull()
      expect(mcpServerInfo).not.toBeNull()

      const tools = ['weather', 'calculator']

      for (const tool of tools) {
        const response = await fetch(`${mcpServerInfo.baseUrl}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${subscriberAccessToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: tool,
              arguments: tool === 'weather' ? { city: 'Barcelona' } : { operation: '2+2' },
            },
          }),
        })

        expect(response.ok).toBe(true)
        const data = await response.json()
        expect(data.result.content).toBeDefined()
        console.log(`[E2E] Tool ${tool} accessed successfully`)
      }
    },
    TEST_TIMEOUT,
  )

  test(
    'should access MCP resource with valid token',
    async () => {
      expect(subscriberAccessToken).not.toBeNull()
      expect(mcpServerInfo).not.toBeNull()

      const response = await fetch(`${mcpServerInfo.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${subscriberAccessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/read',
          params: {
            uri: 'weather://today/Madrid',
          },
        }),
      })

      const data = await response.json()
      console.log('[E2E] Resource response:', JSON.stringify(data, null, 2))

      if (!response.ok || data.error) {
        console.error('[E2E] Resource request failed:', data.error || data)
        throw new Error(`Resource request failed: ${JSON.stringify(data.error || data)}`)
      }

      expect(data.result).toBeDefined()
      expect(data.result.contents).toBeDefined()
      expect(data.result.contents.length).toBeGreaterThan(0)

      const content = JSON.parse(data.result.contents[0].text)
      expect(content.city).toBe('Madrid')
      expect(content.temperature).toBe(22)
      expect(content.conditions).toBe('sunny')

      console.log('[E2E] Resource accessed successfully:', content)
    },
    TEST_TIMEOUT,
  )

  test(
    'should list tools via JSON-RPC',
    async () => {
      expect(subscriberAccessToken).not.toBeNull()
      expect(mcpServerInfo).not.toBeNull()

      const response = await fetch(`${mcpServerInfo.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${subscriberAccessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.result.tools).toBeDefined()
      expect(data.result.tools.length).toBeGreaterThan(0)

      const toolNames = data.result.tools.map((t: any) => t.name)
      expect(toolNames).toContain('weather')
      expect(toolNames).toContain('calculator')
      console.log('[E2E] Tools list:', toolNames.join(', '))
    },
    TEST_TIMEOUT,
  )

  test(
    'should list resource templates via JSON-RPC',
    async () => {
      expect(subscriberAccessToken).not.toBeNull()
      expect(mcpServerInfo).not.toBeNull()

      const response = await fetch(`${mcpServerInfo.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${subscriberAccessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/templates/list',
          params: {},
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.result.resourceTemplates).toBeDefined()
      expect(data.result.resourceTemplates.length).toBeGreaterThan(0)

      const templates = data.result.resourceTemplates.map((r: any) => r.uriTemplate)
      expect(templates).toContain('weather://today/{city}')
      console.log('[E2E] Resource templates:', templates.join(', '))
    },
    TEST_TIMEOUT,
  )

  test(
    'should list prompts via JSON-RPC',
    async () => {
      expect(subscriberAccessToken).not.toBeNull()
      expect(mcpServerInfo).not.toBeNull()

      const response = await fetch(`${mcpServerInfo.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${subscriberAccessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'prompts/list',
          params: {},
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.result.prompts).toBeDefined()
      expect(data.result.prompts.length).toBeGreaterThan(0)

      const promptNames = data.result.prompts.map((p: any) => p.name)
      expect(promptNames).toContain('weather.ask')
      console.log('[E2E] Prompts list:', promptNames.join(', '))
    },
    TEST_TIMEOUT,
  )

  test(
    'should get prompt with valid token',
    async () => {
      expect(subscriberAccessToken).not.toBeNull()
      expect(mcpServerInfo).not.toBeNull()

      const response = await fetch(`${mcpServerInfo.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${subscriberAccessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'prompts/get',
          params: {
            name: 'weather.ask',
            arguments: { city: 'Barcelona' },
          },
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('[E2E] Prompt request failed:', errorData)
        throw new Error(`Prompt request failed: ${JSON.stringify(errorData)}`)
      }

      const data = await response.json()
      console.log('[E2E] Prompt response:', JSON.stringify(data, null, 2))

      expect(data.result.messages).toBeDefined()
      expect(data.result.messages.length).toBeGreaterThan(0)

      const message = data.result.messages[0]
      expect(message.role).toBe('user')
      expect(message.content.text).toContain('Barcelona')

      console.log('[E2E] Prompt accessed successfully:', message.content.text)
    },
    TEST_TIMEOUT,
  )

  test(
    'should handle server info endpoint',
    async () => {
      expect(mcpServerInfo).not.toBeNull()

      const response = await fetch(`${mcpServerInfo.baseUrl}/`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.name).toBe('test-mcp-server-e2e')
      expect(data.version).toBe('0.1.0')
      expect(data.oauth).toBeDefined()
      expect(data.oauth.scopes).toContain('mcp:tools')
      console.log('[E2E] Server info:', data.name, data.version)
    },
    TEST_TIMEOUT,
  )
})
