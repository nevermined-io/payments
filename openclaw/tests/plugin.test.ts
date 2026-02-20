import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import { register, allTools, validateConfig } from '../src/index.js'
import type { OpenClawPluginAPI, CommandContext } from '../src/index.js'
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
  } as unknown as Payments
}

const validConfig: NeverminedPluginConfig = {
  nvmApiKey: 'sandbox:test-key',
  environment: 'sandbox',
  planId: 'plan-default',
  agentId: 'agent-default',
  creditsPerRequest: 1,
}

function createMockAPI(
  config: Partial<NeverminedPluginConfig> = validConfig,
) {
  const mockPayments = createMockPayments()
  const registered = new Map<
    string,
    { description: string; handler: (params: Record<string, unknown>) => Promise<unknown> }
  >()
  const commands = new Map<
    string,
    { description: string; handler: (ctx: CommandContext) => Promise<{ text: string }> }
  >()
  const configStore = new Map<string, unknown>()

  const api: OpenClawPluginAPI = {
    getConfig: jest.fn(() => config),
    setConfig: jest.fn((namespace: string, key: string, value: unknown) => {
      configStore.set(`${namespace}.${key}`, value)
    }),
    registerGatewayMethod: jest.fn((name: string, options: { description: string; handler: (params: Record<string, unknown>) => Promise<unknown> }) => {
      registered.set(name, { description: options.description, handler: options.handler })
    }),
    registerCommand: jest.fn((options: { name: string; description: string; handler: (ctx: CommandContext) => Promise<{ text: string }> }) => {
      commands.set(options.name, { description: options.description, handler: options.handler })
    }),
  }

  return { api, registered, commands, configStore, mockPayments }
}

function registerWithMock(config?: Partial<NeverminedPluginConfig>) {
  const ctx = createMockAPI(config)
  register(ctx.api, { paymentsFactory: () => ctx.mockPayments })
  return ctx
}

// --- Tests ---

describe('OpenClaw Nevermined Plugin', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('register()', () => {
    test('should register all 9 gateway methods (7 tools + login + logout)', () => {
      const { api, registered } = registerWithMock()

      expect(api.getConfig).toHaveBeenCalledWith('nevermined')
      expect(registered.size).toBe(9)

      const expectedNames = [
        'nevermined.login',
        'nevermined.logout',
        'nevermined.checkBalance',
        'nevermined.getAccessToken',
        'nevermined.orderPlan',
        'nevermined.queryAgent',
        'nevermined.registerAgent',
        'nevermined.createPlan',
        'nevermined.listPlans',
      ]
      for (const name of expectedNames) {
        expect(registered.has(name)).toBe(true)
      }
    })

    test('should register 2 slash commands', () => {
      const { commands } = registerWithMock()

      expect(commands.size).toBe(2)
      expect(commands.has('nvm-login')).toBe(true)
      expect(commands.has('nvm-logout')).toBe(true)
    })

    test('should start without nvmApiKey (login-first flow)', () => {
      const { registered } = registerWithMock({ environment: 'sandbox' })

      // Plugin registers successfully without nvmApiKey
      expect(registered.size).toBe(9)
    })

    test('should throw when calling payment tools without nvmApiKey', async () => {
      const { registered } = registerWithMock({ environment: 'sandbox' })

      const handler = registered.get('nevermined.checkBalance')!.handler
      await expect(handler({})).rejects.toThrow('Not authenticated')
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
  })

  describe('nevermined.logout', () => {
    test('clears nvmApiKey via setConfig', async () => {
      const { registered, api, configStore } = registerWithMock()

      const handler = registered.get('nevermined.logout')!.handler
      const result = (await handler({})) as { authenticated: boolean }

      expect(result.authenticated).toBe(false)
      expect(api.setConfig).toHaveBeenCalledWith('nevermined', 'nvmApiKey', '')
      expect(configStore.get('nevermined.nvmApiKey')).toBe('')
    })

    test('payment tools fail after logout', async () => {
      const { registered } = registerWithMock()

      // Logout
      await registered.get('nevermined.logout')!.handler({})

      // Payment tools should fail
      const handler = registered.get('nevermined.checkBalance')!.handler
      await expect(handler({})).rejects.toThrow('Not authenticated')
    })
  })

  describe('/nvm-logout command', () => {
    test('returns confirmation message', async () => {
      const { commands } = registerWithMock()

      const handler = commands.get('nvm-logout')!.handler
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
  })

  describe('subscriber tools', () => {
    test('nevermined.checkBalance — uses config planId', async () => {
      const { registered, mockPayments } = registerWithMock()

      const handler = registered.get('nevermined.checkBalance')!.handler
      const result = await handler({})

      expect(mockPayments.plans.getPlanBalance).toHaveBeenCalledWith('plan-default')
      expect(result).toEqual({
        planId: 'plan-123',
        planName: 'Test Plan',
        balance: '100',
        isSubscriber: true,
      })
    })

    test('nevermined.checkBalance — param overrides config', async () => {
      const { registered, mockPayments } = registerWithMock()

      const handler = registered.get('nevermined.checkBalance')!.handler
      await handler({ planId: 'plan-override' })

      expect(mockPayments.plans.getPlanBalance).toHaveBeenCalledWith('plan-override')
    })

    test('nevermined.checkBalance — throws if no planId', async () => {
      const { registered } = registerWithMock({
        ...validConfig,
        planId: undefined,
      })

      const handler = registered.get('nevermined.checkBalance')!.handler
      await expect(handler({})).rejects.toThrow('planId is required')
    })

    test('nevermined.getAccessToken — returns token', async () => {
      const { registered, mockPayments } = registerWithMock()

      const handler = registered.get('nevermined.getAccessToken')!.handler
      const result = await handler({})

      expect(mockPayments.x402.getX402AccessToken).toHaveBeenCalledWith('plan-default', 'agent-default')
      expect(result).toEqual({ accessToken: 'tok_test_123' })
    })

    test('nevermined.orderPlan — returns order result', async () => {
      const { registered, mockPayments } = registerWithMock()

      const handler = registered.get('nevermined.orderPlan')!.handler
      const result = await handler({})

      expect(mockPayments.plans.orderPlan).toHaveBeenCalledWith('plan-default')
      expect(result).toEqual({ txHash: '0xdeadbeef', success: true })
    })
  })

  describe('nevermined.queryAgent', () => {
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

      const { registered, mockPayments } = registerWithMock()

      const handler = registered.get('nevermined.queryAgent')!.handler
      const result = await handler({
        agentUrl: 'https://agent.example.com/tasks',
        prompt: 'What is AI?',
      })

      expect(mockPayments.x402.getX402AccessToken).toHaveBeenCalledWith('plan-default', 'agent-default')

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

      const { registered } = registerWithMock()

      const handler = registered.get('nevermined.queryAgent')!.handler
      const result = (await handler({
        agentUrl: 'https://agent.example.com/tasks',
        prompt: 'test',
      })) as { error: string; status: number }

      expect(result.status).toBe(402)
      expect(result.error).toContain('insufficient credits')
    })

    test('requires agentUrl', async () => {
      const { registered } = registerWithMock()

      const handler = registered.get('nevermined.queryAgent')!.handler
      await expect(handler({ prompt: 'test' })).rejects.toThrow('agentUrl')
    })

    test('requires prompt', async () => {
      const { registered } = registerWithMock()

      const handler = registered.get('nevermined.queryAgent')!.handler
      await expect(handler({ agentUrl: 'https://example.com' })).rejects.toThrow('prompt')
    })
  })

  describe('builder tools', () => {
    test('nevermined.registerAgent — calls registerAgentAndPlan', async () => {
      const { registered, mockPayments } = registerWithMock()

      const handler = registered.get('nevermined.registerAgent')!.handler
      const result = await handler({
        name: 'My Agent',
        agentUrl: 'https://agent.example.com',
        planName: 'Basic Plan',
        priceAmounts: '1000000000000000000',
        priceReceivers: '0x1234567890abcdef1234567890abcdef12345678',
        creditsAmount: 100,
      })

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

    test('nevermined.createPlan — calls registerPlan', async () => {
      const { registered, mockPayments } = registerWithMock()

      const handler = registered.get('nevermined.createPlan')!.handler
      const result = await handler({
        name: 'My Plan',
        priceAmounts: '500',
        priceReceivers: '0xabc',
        creditsAmount: 50,
      })

      expect(mockPayments.plans.registerPlan).toHaveBeenCalled()
      expect(result).toEqual({ planId: 'plan-new' })
    })

    test('nevermined.listPlans — returns plans', async () => {
      const { registered, mockPayments } = registerWithMock()

      const handler = registered.get('nevermined.listPlans')!.handler
      const result = await handler({})

      expect(mockPayments.plans.getPlans).toHaveBeenCalled()
      expect(result).toEqual([{ planId: 'plan-1' }, { planId: 'plan-2' }])
    })
  })

  describe('error handling', () => {
    test('wraps SDK errors with plugin context', async () => {
      const { registered, mockPayments } = registerWithMock()

      ;(mockPayments.plans.getPlanBalance as jest.Mock<() => Promise<unknown>>).mockRejectedValueOnce(
        new Error('Network timeout'),
      )

      const handler = registered.get('nevermined.checkBalance')!.handler
      await expect(handler({})).rejects.toThrow(
        '[nevermined] nevermined.checkBalance failed: Network timeout',
      )
    })
  })

  describe('allTools export', () => {
    test('exports exactly 7 tool definitions', () => {
      expect(allTools).toHaveLength(7)
    })

    test('all tools have required fields', () => {
      for (const tool of allTools) {
        expect(tool.name).toBeDefined()
        expect(tool.description).toBeDefined()
        expect(tool.params).toBeDefined()
        expect(typeof tool.handler).toBe('function')
      }
    })
  })
})
