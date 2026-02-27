import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import neverminedPlugin, { validateConfig } from '../src/index.js'
import { looksLikeApiKey } from '../src/auth.js'
import { mockWeatherHandler } from '../src/paid-endpoint.js'
import type { OpenClawPluginAPI, CommandContext, HttpRouteHandler } from '../src/index.js'
import type { NeverminedPluginConfig } from '../src/config.js'
import type { Payments } from '@nevermined-io/payments'

// --- Mock Payments instance ---

function createMockPayments() {
  return {
    plans: {
      getPlanBalance: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        planId: 'plan-123',
        planName: 'Test Plan',
        planType: 'credits',
        holderAddress: '0x1234',
        balance: 100n,
        creditsContract: '0xabcd',
        isSubscriber: true,
        pricePerCredit: 1,
      }),
      orderPlan: jest.fn<() => Promise<unknown>>().mockResolvedValue({ txHash: '0xdeadbeef', success: true }),
      getPlans: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ planId: 'plan-1' }, { planId: 'plan-2' }]),
      registerPlan: jest.fn<() => Promise<unknown>>().mockResolvedValue({ planId: 'plan-new' }),
      orderFiatPlan: jest.fn<() => Promise<unknown>>().mockResolvedValue({ result: { checkoutUrl: 'https://checkout.stripe.com/test_session' } }),
    },
    x402: {
      getX402AccessToken: jest.fn<() => Promise<unknown>>().mockResolvedValue({ accessToken: 'tok_test_123' }),
    },
    agents: {
      registerAgentAndPlan: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        agentId: 'agent-123',
        planId: 'plan-456',
        txHash: '0xabc',
      }),
    },
    facilitator: {
      verifyPermissions: jest.fn<() => Promise<unknown>>().mockResolvedValue({ isValid: true }),
      settlePermissions: jest.fn<() => Promise<unknown>>().mockResolvedValue({ txHash: '0xsettle', success: true }),
    },
    delegation: {
      listPaymentMethods: jest.fn<() => Promise<unknown>>().mockResolvedValue([
        { id: 'pm_test_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2027 },
      ]),
    },
  } as unknown as Payments
}

const validConfig: NeverminedPluginConfig = {
  nvmApiKey: 'sandbox:test-key',
  environment: 'sandbox',
  planId: 'plan-default',
  agentId: 'agent-default',
  creditsPerRequest: 1,
  enablePaidEndpoint: false,
  agentEndpointPath: '/nevermined/agent',
}

interface ToolObject {
  name: string
  label: string
  description: string
  execute: (_id: string, params: Record<string, unknown>) => Promise<unknown>
}

function createMockAPI(config: Partial<NeverminedPluginConfig> = validConfig) {
  const mockPayments = createMockPayments()
  const tools = new Map<string, ToolObject>()
  let toolFactory: ((ctx: unknown) => ToolObject[]) | null = null
  const commands = new Map<string, { description: string; handler: (ctx: CommandContext) => Promise<{ text: string }> }>()
  const httpRoutes = new Map<string, HttpRouteHandler>()
  const hooks = new Map<string, ((...args: unknown[]) => unknown)[]>()

  const api: OpenClawPluginAPI = {
    id: 'nevermined',
    pluginConfig: config as Record<string, unknown>,
    config: {},
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    registerTool: jest.fn((factoryOrTool: unknown) => {
      if (typeof factoryOrTool === 'function') {
        toolFactory = factoryOrTool as (ctx: unknown) => ToolObject[]
        // Invoke the factory to get tools for testing
        const created = toolFactory({})
        for (const tool of created) {
          tools.set(tool.name, tool)
        }
      } else {
        const tool = factoryOrTool as ToolObject
        tools.set(tool.name, tool)
      }
    }),
    registerCommand: jest.fn((cmd: { name: string; description: string; handler: (ctx: CommandContext) => Promise<{ text: string }> }) => {
      commands.set(cmd.name, { description: cmd.description, handler: cmd.handler })
    }),
    registerGatewayMethod: jest.fn(),
    registerHttpRoute: jest.fn((route: { path: string; handler: HttpRouteHandler }) => {
      httpRoutes.set(route.path, route.handler)
    }),
    on: jest.fn((hookName: string, handler: (...args: unknown[]) => unknown) => {
      const existing = hooks.get(hookName) ?? []
      existing.push(handler)
      hooks.set(hookName, existing)
    }),
  }

  return { api, tools, commands, mockPayments, httpRoutes, hooks, getToolFactory: () => toolFactory }
}

function registerWithMock(config?: Partial<NeverminedPluginConfig>) {
  const ctx = createMockAPI(config)
  neverminedPlugin.register(ctx.api, { paymentsFactory: () => ctx.mockPayments })
  return ctx
}

function parseResult(result: unknown): unknown {
  const r = result as { content: Array<{ text: string }> }
  return JSON.parse(r.content[0].text)
}

// --- HTTP mock helpers ---

function createMockRequest(headers: Record<string, string>, body: string): { headers: Record<string, string>; on: jest.Mock } {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  const req = {
    headers,
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? []
      listeners[event].push(cb)
      // Simulate data+end immediately
      if (event === 'data') {
        setTimeout(() => cb(Buffer.from(body)), 0)
      }
      if (event === 'end') {
        setTimeout(() => cb(), 1)
      }
    }),
  }
  return req
}

function createMockResponse(): { writeHead: jest.Mock; end: jest.Mock; statusCode?: number; body?: string; headers?: Record<string, string> } {
  const res = {
    writeHead: jest.fn((code: number, headers?: Record<string, string>) => {
      res.statusCode = code
      res.headers = headers
    }),
    end: jest.fn((body?: string) => {
      res.body = body
    }),
  }
  return res
}

// --- Tests ---

describe('OpenClaw Nevermined Plugin', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('register()', () => {
    test('should register all 9 tools', () => {
      const { tools } = registerWithMock()

      expect(tools.size).toBe(9)

      const expectedNames = [
        'nevermined_checkBalance',
        'nevermined_getAccessToken',
        'nevermined_orderPlan',
        'nevermined_orderFiatPlan',
        'nevermined_listPaymentMethods',
        'nevermined_queryAgent',
        'nevermined_registerAgent',
        'nevermined_createPlan',
        'nevermined_listPlans',
      ]
      for (const name of expectedNames) {
        expect(tools.has(name)).toBe(true)
      }
    })

    test('should register 2 slash commands', () => {
      const { commands } = registerWithMock()

      expect(commands.size).toBe(2)
      expect(commands.has('nvm_login')).toBe(true)
      expect(commands.has('nvm_logout')).toBe(true)
    })

    test('should start without nvmApiKey (login-first flow)', () => {
      const { tools } = registerWithMock({ environment: 'sandbox' })
      expect(tools.size).toBe(9)
    })

    test('should throw when calling payment tools without nvmApiKey', async () => {
      const { tools } = registerWithMock({ environment: 'sandbox' })

      const tool = tools.get('nevermined_checkBalance')!
      await expect(tool.execute('call-1', { planId: 'plan-1' })).rejects.toThrow('Not authenticated')
    })

    test('should register paid endpoint when enablePaidEndpoint is true', () => {
      const { httpRoutes } = registerWithMock({ ...validConfig, enablePaidEndpoint: true })
      expect(httpRoutes.has('/nevermined/agent')).toBe(true)
    })

    test('should not register paid endpoint when enablePaidEndpoint is false', () => {
      const { httpRoutes } = registerWithMock({ ...validConfig, enablePaidEndpoint: false })
      expect(httpRoutes.size).toBe(0)
    })

    test('should register before_prompt_build hook', () => {
      const { hooks } = registerWithMock()
      expect(hooks.has('before_prompt_build')).toBe(true)
    })
  })

  describe('config validation', () => {
    test('should validate a complete config', () => {
      const config = validateConfig({
        nvmApiKey: 'sandbox:key',
        environment: 'sandbox',
        planId: 'plan-1',
        agentId: 'agent-1',
        creditsPerRequest: 5,
      })
      expect(config.nvmApiKey).toBe('sandbox:key')
      expect(config.environment).toBe('sandbox')
      expect(config.creditsPerRequest).toBe(5)
    })

    test('should accept missing nvmApiKey', () => {
      const config = validateConfig({ environment: 'sandbox' })
      expect(config.nvmApiKey).toBeUndefined()
    })

    test('should reject invalid environment', () => {
      expect(() => validateConfig({ nvmApiKey: 'key', environment: 'production' })).toThrow()
    })

    test('should default environment to sandbox', () => {
      const config = validateConfig({ nvmApiKey: 'key' })
      expect(config.environment).toBe('sandbox')
    })

    test('should default creditsPerRequest to 1', () => {
      const config = validateConfig({ nvmApiKey: 'key' })
      expect(config.creditsPerRequest).toBe(1)
    })

    test('should default enablePaidEndpoint to false', () => {
      const config = validateConfig({})
      expect(config.enablePaidEndpoint).toBe(false)
    })

    test('should default agentEndpointPath to /nevermined/agent', () => {
      const config = validateConfig({})
      expect(config.agentEndpointPath).toBe('/nevermined/agent')
    })

    test('should accept custom agentEndpointPath', () => {
      const config = validateConfig({ agentEndpointPath: '/custom/path' })
      expect(config.agentEndpointPath).toBe('/custom/path')
    })

    test('should default paymentType to crypto', () => {
      const config = validateConfig({})
      expect(config.paymentType).toBe('crypto')
    })

    test('should accept fiat paymentType', () => {
      const config = validateConfig({ paymentType: 'fiat' })
      expect(config.paymentType).toBe('fiat')
    })

    test('should default defaultSpendingLimitCents to 1000', () => {
      const config = validateConfig({})
      expect(config.defaultSpendingLimitCents).toBe(1000)
    })

    test('should default defaultDelegationDurationSecs to 3600', () => {
      const config = validateConfig({})
      expect(config.defaultDelegationDurationSecs).toBe(3600)
    })
  })

  describe('/nvm_login command', () => {
    const cmdCtx = (args: string) => ({
      senderId: 'user-1',
      channel: 'telegram',
      isAuthorizedSender: true,
      args,
      commandBody: `/nvm_login ${args}`,
      config: {},
    })

    test('accepts API key directly', async () => {
      const { commands, tools } = registerWithMock({ environment: 'sandbox' })

      const handler = commands.get('nvm_login')!.handler
      const result = await handler(cmdCtx('sandbox:eyJhbGciOiJSUzI1NiJ9.test'))

      expect(result.text).toContain('Authenticated')
      expect(result.text).toContain('sandbox')

      // Tools should now work (mock factory ignores the key)
      const tool = tools.get('nevermined_listPlans')!
      await expect(tool.execute('call-1', {})).resolves.toBeDefined()
    })

    test('detects live API key environment', async () => {
      const { commands } = registerWithMock({ environment: 'sandbox' })

      const handler = commands.get('nvm_login')!.handler
      const result = await handler(cmdCtx('live:eyJhbGciOiJSUzI1NiJ9.test'))

      expect(result.text).toContain('live')
    })

    test('looksLikeApiKey correctly identifies API keys', () => {
      expect(looksLikeApiKey('sandbox:eyJhbGciOiJSUzI1NiJ9.test')).toBe(true)
      expect(looksLikeApiKey('live:eyJhbGciOiJSUzI1NiJ9.test')).toBe(true)
      expect(looksLikeApiKey('sandbox')).toBe(false)
      expect(looksLikeApiKey('live')).toBe(false)
      expect(looksLikeApiKey('my-random-string')).toBe(false)
      expect(looksLikeApiKey('')).toBe(false)
    })
  })

  describe('/nvm_logout command', () => {
    test('returns confirmation message', async () => {
      const { commands } = registerWithMock()

      const handler = commands.get('nvm_logout')!.handler
      const result = await handler({
        senderId: 'user-1',
        channel: 'telegram',
        isAuthorizedSender: true,
        args: '',
        commandBody: '',
        config: {},
      })

      expect(result.text).toContain('Logged out')
    })

    test('payment tools fail after logout', async () => {
      const { commands, tools } = registerWithMock()

      // Logout via command
      await commands.get('nvm_logout')!.handler({
        senderId: 'user-1',
        channel: 'telegram',
        isAuthorizedSender: true,
        args: '',
        commandBody: '',
        config: {},
      })

      // Payment tools should fail
      const tool = tools.get('nevermined_checkBalance')!
      await expect(tool.execute('call-1', {})).rejects.toThrow('Not authenticated')
    })
  })

  describe('subscriber tools', () => {
    test('nevermined_checkBalance — uses config planId', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_checkBalance')!
      const result = parseResult(await tool.execute('call-1', {}))

      expect(mockPayments.plans.getPlanBalance).toHaveBeenCalledWith('plan-default')
      expect(result).toEqual({
        planId: 'plan-123',
        planName: 'Test Plan',
        balance: '100',
        isSubscriber: true,
      })
    })

    test('nevermined_checkBalance — param overrides config', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_checkBalance')!
      await tool.execute('call-1', { planId: 'plan-override' })

      expect(mockPayments.plans.getPlanBalance).toHaveBeenCalledWith('plan-override')
    })

    test('nevermined_checkBalance — throws if no planId', async () => {
      const { tools } = registerWithMock({
        ...validConfig,
        planId: undefined,
      })

      const tool = tools.get('nevermined_checkBalance')!
      await expect(tool.execute('call-1', {})).rejects.toThrow('planId is required')
    })

    test('nevermined_getAccessToken — returns token (crypto default)', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_getAccessToken')!
      const result = parseResult(await tool.execute('call-1', {}))

      expect(mockPayments.x402.getX402AccessToken).toHaveBeenCalledWith(
        'plan-default', 'agent-default', undefined, undefined, undefined, undefined,
      )
      expect(result).toEqual({ accessToken: 'tok_test_123' })
    })

    test('nevermined_orderPlan — returns order result', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_orderPlan')!
      const result = parseResult(await tool.execute('call-1', {}))

      expect(mockPayments.plans.orderPlan).toHaveBeenCalledWith('plan-default')
      expect(result).toEqual({ txHash: '0xdeadbeef', success: true })
    })

    test('nevermined_orderFiatPlan — returns Stripe checkout URL', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_orderFiatPlan')!
      const result = parseResult(await tool.execute('call-1', { planId: 'plan-fiat' }))

      expect(mockPayments.plans.orderFiatPlan).toHaveBeenCalledWith('plan-fiat')
      expect(result).toEqual({ result: { checkoutUrl: 'https://checkout.stripe.com/test_session' } })
    })

    test('nevermined_listPaymentMethods — returns enrolled cards', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_listPaymentMethods')!
      const result = parseResult(await tool.execute('call-1', {}))

      expect(mockPayments.delegation.listPaymentMethods).toHaveBeenCalled()
      expect(result).toEqual([
        { id: 'pm_test_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2027 },
      ])
    })

    test('nevermined_getAccessToken — fiat with explicit paymentMethodId', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_getAccessToken')!
      const result = parseResult(await tool.execute('call-1', {
        paymentType: 'fiat',
        paymentMethodId: 'pm_explicit_123',
        spendingLimitCents: 2000,
        delegationDurationSecs: 7200,
      }))

      expect(mockPayments.x402.getX402AccessToken).toHaveBeenCalledWith(
        'plan-default', 'agent-default', undefined, undefined, undefined,
        {
          scheme: 'nvm:card-delegation',
          delegationConfig: {
            providerPaymentMethodId: 'pm_explicit_123',
            spendingLimitCents: 2000,
            durationSecs: 7200,
          },
        },
      )
      expect(result).toEqual({ accessToken: 'tok_test_123' })
    })

    test('nevermined_getAccessToken — fiat auto-selects first enrolled card', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_getAccessToken')!
      await tool.execute('call-1', { paymentType: 'fiat' })

      expect(mockPayments.delegation.listPaymentMethods).toHaveBeenCalled()
      expect(mockPayments.x402.getX402AccessToken).toHaveBeenCalledWith(
        'plan-default', 'agent-default', undefined, undefined, undefined,
        {
          scheme: 'nvm:card-delegation',
          delegationConfig: {
            providerPaymentMethodId: 'pm_test_1',
            spendingLimitCents: 1000,
            durationSecs: 3600,
          },
        },
      )
    })

    test('nevermined_getAccessToken — fiat throws when no enrolled cards', async () => {
      const { tools, mockPayments } = registerWithMock()

      ;(mockPayments.delegation.listPaymentMethods as jest.Mock<() => Promise<unknown>>)
        .mockResolvedValueOnce([])

      const tool = tools.get('nevermined_getAccessToken')!
      await expect(tool.execute('call-1', { paymentType: 'fiat' })).rejects.toThrow('No enrolled payment methods')
    })
  })

  describe('nevermined_queryAgent', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
      globalThis.fetch = jest.fn() as unknown as typeof fetch
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    test('sends prompt with PAYMENT-SIGNATURE header', async () => {
      const mockFetch = globalThis.fetch as jest.Mock<typeof fetch>
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ answer: 'hello' }),
      } as Response)

      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_queryAgent')!
      const result = parseResult(await tool.execute('call-1', {
        agentUrl: 'https://agent.example.com/tasks',
        prompt: 'What is AI?',
      }))

      expect(mockPayments.x402.getX402AccessToken).toHaveBeenCalledWith(
        'plan-default', 'agent-default', undefined, undefined, undefined, undefined,
      )

      const fetchCall = mockFetch.mock.calls[0]
      expect(fetchCall[0]).toBe('https://agent.example.com/tasks')
      const fetchInit = fetchCall[1] as RequestInit
      expect(fetchInit.method).toBe('POST')
      expect((fetchInit.headers as Record<string, string>)['PAYMENT-SIGNATURE']).toBe('tok_test_123')
      expect(JSON.parse(fetchInit.body as string)).toEqual({ prompt: 'What is AI?' })

      expect(result).toEqual({ answer: 'hello' })
    })

    test('handles 402 response', async () => {
      const mockFetch = globalThis.fetch as jest.Mock<typeof fetch>
      mockFetch.mockResolvedValue({
        ok: false,
        status: 402,
        statusText: 'Payment Required',
      } as Response)

      const { tools } = registerWithMock()

      const tool = tools.get('nevermined_queryAgent')!
      const result = parseResult(await tool.execute('call-1', {
        agentUrl: 'https://agent.example.com/tasks',
        prompt: 'test',
      })) as { error: string; status: number }

      expect(result.status).toBe(402)
      expect(result.error).toContain('insufficient credits')
    })

    test('requires agentUrl', async () => {
      const { tools } = registerWithMock()

      const tool = tools.get('nevermined_queryAgent')!
      await expect(tool.execute('call-1', { prompt: 'test' })).rejects.toThrow('agentUrl')
    })

    test('requires prompt', async () => {
      const { tools } = registerWithMock()

      const tool = tools.get('nevermined_queryAgent')!
      await expect(tool.execute('call-1', { agentUrl: 'https://example.com' })).rejects.toThrow('prompt')
    })

    test('sends query with fiat payment type', async () => {
      const mockFetch = globalThis.fetch as jest.Mock<typeof fetch>
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ answer: 'fiat response' }),
      } as Response)

      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_queryAgent')!
      const result = parseResult(await tool.execute('call-1', {
        agentUrl: 'https://agent.example.com/tasks',
        prompt: 'test fiat',
        paymentType: 'fiat',
        paymentMethodId: 'pm_fiat_456',
      }))

      expect(mockPayments.x402.getX402AccessToken).toHaveBeenCalledWith(
        'plan-default', 'agent-default', undefined, undefined, undefined,
        {
          scheme: 'nvm:card-delegation',
          delegationConfig: {
            providerPaymentMethodId: 'pm_fiat_456',
            spendingLimitCents: 1000,
            durationSecs: 3600,
          },
        },
      )
      expect(result).toEqual({ answer: 'fiat response' })
    })
  })

  describe('builder tools', () => {
    test('nevermined_registerAgent — calls registerAgentAndPlan', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_registerAgent')!
      const result = parseResult(await tool.execute('call-1', {
        name: 'My Agent',
        agentUrl: 'https://agent.example.com',
        planName: 'Basic Plan',
        priceAmounts: '1000000000000000000',
        priceReceivers: '0x1234567890abcdef1234567890abcdef12345678',
        creditsAmount: 100,
      }))

      expect(mockPayments.agents.registerAgentAndPlan).toHaveBeenCalled()
      const call = (mockPayments.agents.registerAgentAndPlan as jest.Mock<() => Promise<unknown>>).mock.calls[0] as unknown[]
      expect((call[0] as { name: string }).name).toBe('My Agent')
      expect((call[1] as { endpoints: Array<Record<string, string>> }).endpoints).toEqual([
        { POST: 'https://agent.example.com' },
      ])
      expect((call[3] as { amounts: bigint[] }).amounts).toEqual([1000000000000000000n])
      expect((call[4] as { amount: bigint }).amount).toBe(100n)

      expect(result).toEqual({
        agentId: 'agent-123',
        planId: 'plan-456',
        txHash: '0xabc',
      })
    })

    test('nevermined_registerAgent — passes tokenAddress when provided', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_registerAgent')!
      await tool.execute('call-1', {
        name: 'USDC Agent',
        agentUrl: 'https://agent.example.com',
        planName: 'USDC Plan',
        priceAmounts: '1000000',
        priceReceivers: '0x1234567890abcdef1234567890abcdef12345678',
        creditsAmount: 5,
        tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      })

      const call = (mockPayments.agents.registerAgentAndPlan as jest.Mock<() => Promise<unknown>>).mock.calls[0] as unknown[]
      const priceConfig = call[3] as { tokenAddress?: string; isCrypto: boolean }
      expect(priceConfig.tokenAddress).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
      expect(priceConfig.isCrypto).toBe(true)
    })

    test('nevermined_registerAgent — fiat pricing sets isCrypto to false', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_registerAgent')!
      await tool.execute('call-1', {
        name: 'Fiat Agent',
        agentUrl: 'https://agent.example.com',
        planName: 'Fiat Plan',
        priceAmounts: '100',
        priceReceivers: '0x1234567890abcdef1234567890abcdef12345678',
        creditsAmount: 10,
        pricingType: 'fiat',
      })

      const call = (mockPayments.agents.registerAgentAndPlan as jest.Mock<() => Promise<unknown>>).mock.calls[0] as unknown[]
      const priceConfig = call[3] as { isCrypto: boolean }
      expect(priceConfig.isCrypto).toBe(false)
    })

    test('nevermined_registerAgent — defaults tokenAddress to ZeroAddress when not provided', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_registerAgent')!
      await tool.execute('call-1', {
        name: 'ETH Agent',
        agentUrl: 'https://agent.example.com',
        planName: 'ETH Plan',
        priceAmounts: '1000000000000000000',
        priceReceivers: '0x1234567890abcdef1234567890abcdef12345678',
        creditsAmount: 10,
      })

      const call = (mockPayments.agents.registerAgentAndPlan as jest.Mock<() => Promise<unknown>>).mock.calls[0] as unknown[]
      const priceConfig = call[3] as { tokenAddress?: string }
      expect(priceConfig.tokenAddress).toBe('0x0000000000000000000000000000000000000000')
    })

    test('nevermined_createPlan — calls registerPlan with crypto pricing by default', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_createPlan')!
      const result = parseResult(await tool.execute('call-1', {
        name: 'My Plan',
        priceAmount: '500',
        receiver: '0xabc',
        creditsAmount: 50,
      }))

      expect(mockPayments.plans.registerPlan).toHaveBeenCalled()
      const call = (mockPayments.plans.registerPlan as jest.Mock<() => Promise<unknown>>).mock.calls[0] as unknown[]
      const priceConfig = call[1] as { isCrypto: boolean }
      expect(priceConfig.isCrypto).toBe(true)
      expect(result).toEqual({ planId: 'plan-new' })
    })

    test('nevermined_createPlan — fiat pricing sets isCrypto to false', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_createPlan')!
      await tool.execute('call-1', {
        name: 'Fiat Plan',
        priceAmount: '100',
        receiver: '0xabc',
        creditsAmount: 30,
        pricingType: 'fiat',
      })

      const call = (mockPayments.plans.registerPlan as jest.Mock<() => Promise<unknown>>).mock.calls[0] as unknown[]
      const priceConfig = call[1] as { isCrypto: boolean; tokenAddress: string }
      expect(priceConfig.isCrypto).toBe(false)
      expect(priceConfig.tokenAddress).toBe('0x0000000000000000000000000000000000000000')
    })

    test('nevermined_createPlan — erc20 pricing passes tokenAddress', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_createPlan')!
      await tool.execute('call-1', {
        name: 'USDC Plan',
        priceAmount: '1000000',
        receiver: '0xabc',
        creditsAmount: 5,
        pricingType: 'erc20',
        tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      })

      const call = (mockPayments.plans.registerPlan as jest.Mock<() => Promise<unknown>>).mock.calls[0] as unknown[]
      const priceConfig = call[1] as { isCrypto: boolean; tokenAddress: string }
      expect(priceConfig.isCrypto).toBe(true)
      expect(priceConfig.tokenAddress).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
    })

    test('nevermined_createPlan — erc20 pricing requires tokenAddress', async () => {
      const { tools } = registerWithMock()

      const tool = tools.get('nevermined_createPlan')!
      await expect(tool.execute('call-1', {
        name: 'USDC Plan',
        priceAmount: '1000000',
        receiver: '0xabc',
        creditsAmount: 5,
        pricingType: 'erc20',
      })).rejects.toThrow('tokenAddress is required')
    })

    test('nevermined_listPlans — returns plans', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_listPlans')!
      const result = parseResult(await tool.execute('call-1', {}))

      expect(mockPayments.plans.getPlans).toHaveBeenCalled()
      expect(result).toEqual([{ planId: 'plan-1' }, { planId: 'plan-2' }])
    })
  })

  describe('paid HTTP endpoint', () => {
    test('returns 402 when payment-signature header is missing', async () => {
      const { httpRoutes } = registerWithMock({ ...validConfig, enablePaidEndpoint: true })

      const handler = httpRoutes.get('/nevermined/agent')!
      const req = createMockRequest({}, '{"prompt":"hello"}')
      const res = createMockResponse()

      await handler(req as never, res as never)

      expect(res.statusCode).toBe(402)
      expect(res.body).toContain('missing payment-signature')
    })

    test('calls verifyPermissions and settlePermissions on valid request', async () => {
      const { httpRoutes, mockPayments } = registerWithMock({ ...validConfig, enablePaidEndpoint: true })

      const handler = httpRoutes.get('/nevermined/agent')!
      const req = createMockRequest(
        { 'payment-signature': 'tok_valid_123' },
        '{"prompt":"Weather in Barcelona"}',
      )
      const res = createMockResponse()

      await handler(req as never, res as never)

      expect(mockPayments.facilitator.verifyPermissions).toHaveBeenCalled()
      expect(mockPayments.facilitator.settlePermissions).toHaveBeenCalled()
      expect(res.statusCode).toBe(200)

      const body = JSON.parse(res.body!)
      expect(body.city).toBe('Barcelona')
      expect(body.source).toBe('Weather Oracle (Nevermined demo)')
    })

    test('returns 402 when verifyPermissions says isValid=false', async () => {
      const { httpRoutes, mockPayments } = registerWithMock({ ...validConfig, enablePaidEndpoint: true })

      ;(mockPayments.facilitator.verifyPermissions as jest.Mock<() => Promise<unknown>>)
        .mockResolvedValueOnce({ isValid: false })

      const handler = httpRoutes.get('/nevermined/agent')!
      const req = createMockRequest(
        { 'payment-signature': 'tok_invalid' },
        '{"prompt":"hello"}',
      )
      const res = createMockResponse()

      await handler(req as never, res as never)

      expect(res.statusCode).toBe(402)
      expect(res.body).toContain('Insufficient credits')
    })

    test('includes payment-response header on success', async () => {
      const { httpRoutes } = registerWithMock({ ...validConfig, enablePaidEndpoint: true })

      const handler = httpRoutes.get('/nevermined/agent')!
      const req = createMockRequest(
        { 'payment-signature': 'tok_valid_123' },
        '{"prompt":"Weather in Madrid"}',
      )
      const res = createMockResponse()

      await handler(req as never, res as never)

      expect(res.statusCode).toBe(200)
      expect(res.headers).toBeDefined()
      expect(res.headers!['payment-response']).toBeDefined()

      // Decode the base64 payment-response header
      const decoded = JSON.parse(Buffer.from(res.headers!['payment-response'], 'base64').toString())
      expect(decoded.txHash).toBe('0xsettle')
    })

    test('uses custom agentEndpointPath', () => {
      const { httpRoutes } = registerWithMock({
        ...validConfig,
        enablePaidEndpoint: true,
        agentEndpointPath: '/custom/weather',
      })

      expect(httpRoutes.has('/custom/weather')).toBe(true)
      expect(httpRoutes.has('/nevermined/agent')).toBe(false)
    })
  })

  describe('mockWeatherHandler', () => {
    test('extracts city from prompt', async () => {
      const result = await mockWeatherHandler({ prompt: 'What is the weather in Barcelona?' }) as Record<string, unknown>
      expect(result.city).toBe('Barcelona')
      expect(result.source).toBe('Weather Oracle (Nevermined demo)')
      expect(result.unit).toBe('celsius')
      expect(typeof result.temperature).toBe('number')
      expect(typeof result.humidity).toBe('number')
    })

    test('handles prompt without city', async () => {
      const result = await mockWeatherHandler({ prompt: 'give me weather' }) as Record<string, unknown>
      expect(result.city).toBe('Unknown')
    })

    test('extracts city with "for" pattern', async () => {
      const result = await mockWeatherHandler({ prompt: 'forecast for Madrid' }) as Record<string, unknown>
      expect(result.city).toBe('Madrid')
    })
  })

  describe('before_prompt_build hook', () => {
    test('returns credit balance context when authenticated', async () => {
      const { hooks } = registerWithMock()

      const hookHandlers = hooks.get('before_prompt_build')!
      expect(hookHandlers.length).toBe(1)

      const result = await hookHandlers[0]() as { prependContext: string } | undefined
      expect(result).toBeDefined()
      expect(result!.prependContext).toContain('balance: 100 credits')
      expect(result!.prependContext).toContain('Test Plan')
    })

    test('returns undefined when not authenticated', async () => {
      const { hooks } = registerWithMock({ environment: 'sandbox' })

      // No planId means no plans → hook is not registered
      const hookHandlers = hooks.get('before_prompt_build')
      expect(hookHandlers).toBeUndefined()
    })

    test('returns undefined when no planId configured', async () => {
      const { hooks } = registerWithMock({ ...validConfig, planId: undefined })

      // No planId means no plans → hook is not registered
      const hookHandlers = hooks.get('before_prompt_build')
      expect(hookHandlers).toBeUndefined()
    })
  })
})
