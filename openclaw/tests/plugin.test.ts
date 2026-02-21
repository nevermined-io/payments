import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import neverminedPlugin, { validateConfig } from '../src/index.js'
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
  }

  return { api, tools, commands, mockPayments, getToolFactory: () => toolFactory }
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

// --- Tests ---

describe('OpenClaw Nevermined Plugin', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('register()', () => {
    test('should register all 7 tools', () => {
      const { tools } = registerWithMock()

      expect(tools.size).toBe(7)

      const expectedNames = [
        'nevermined_checkBalance',
        'nevermined_getAccessToken',
        'nevermined_orderPlan',
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
      expect(commands.has('nvm-login')).toBe(true)
      expect(commands.has('nvm-logout')).toBe(true)
    })

    test('should start without nvmApiKey (login-first flow)', () => {
      const { tools } = registerWithMock({ environment: 'sandbox' })
      expect(tools.size).toBe(7)
    })

    test('should throw when calling payment tools without nvmApiKey', async () => {
      const { tools } = registerWithMock({ environment: 'sandbox' })

      const tool = tools.get('nevermined_checkBalance')!
      await expect(tool.execute('call-1', { planId: 'plan-1' })).rejects.toThrow('Not authenticated')
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

    test('payment tools fail after logout', async () => {
      const { commands, tools } = registerWithMock()

      // Logout via command
      await commands.get('nvm-logout')!.handler({
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

    test('nevermined_getAccessToken — returns token', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_getAccessToken')!
      const result = parseResult(await tool.execute('call-1', {}))

      expect(mockPayments.x402.getX402AccessToken).toHaveBeenCalledWith('plan-default', 'agent-default')
      expect(result).toEqual({ accessToken: 'tok_test_123' })
    })

    test('nevermined_orderPlan — returns order result', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_orderPlan')!
      const result = parseResult(await tool.execute('call-1', {}))

      expect(mockPayments.plans.orderPlan).toHaveBeenCalledWith('plan-default')
      expect(result).toEqual({ txHash: '0xdeadbeef', success: true })
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

    test('nevermined_createPlan — calls registerPlan', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_createPlan')!
      const result = parseResult(await tool.execute('call-1', {
        name: 'My Plan',
        priceAmounts: '500',
        priceReceivers: '0xabc',
        creditsAmount: 50,
      }))

      expect(mockPayments.plans.registerPlan).toHaveBeenCalled()
      expect(result).toEqual({ planId: 'plan-new' })
    })

    test('nevermined_listPlans — returns plans', async () => {
      const { tools, mockPayments } = registerWithMock()

      const tool = tools.get('nevermined_listPlans')!
      const result = parseResult(await tool.execute('call-1', {}))

      expect(mockPayments.plans.getPlans).toHaveBeenCalled()
      expect(result).toEqual([{ planId: 'plan-1' }, { planId: 'plan-2' }])
    })
  })
})
