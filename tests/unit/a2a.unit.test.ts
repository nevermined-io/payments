/**
 * @file Pure unit tests for A2A core modules (no server required)
 */

import { ClientRegistry } from '../../src/a2a/clientRegistry'
import { Payments } from '../../src/payments'
import { buildPaymentAgentCard } from '../../src/a2a/agent-card'
import { PaymentsError } from '../../src/common/payments.error'

// Minimal mock only for network requests in unit tests
jest.mock('@a2a-js/sdk/client', () => ({
  A2AClient: jest.fn().mockImplementation(() => ({
    agentCardPromise: Promise.resolve({
      name: 'Mock Agent',
      description: 'Mock agent for testing',
      capabilities: {
        tools: ['text-generation'],
        extensions: [],
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
      url: 'http://localhost:3001',
      version: '1.0.0',
    }),
  })),
}))

describe('A2A Unit Tests (Pure)', () => {
  let payments: Payments

  const subscriberNvmApiKeyHash =
    process.env.TEST_SUBSCRIBER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweGMxNTA4ZDEzMTczMkNBNDVlN2JDQTE4OGMyNjA4YUU4ODhmMDI2OGQiLCJqdGkiOiIweDQ3NDZmOThiNjdjOGZmMWM5NTNlMTYyYzY3MTUwMWQ1YmJlNjRiNTNmMTQ5NTViNTdlMTVmOTA1ZDkyMjI3MGEiLCJleHAiOjE3ODUzNDk0NzJ9.h_CUR9IFiG0nUZt4q-wqZCY6VRgsmf1_1MSwosmFH3VacNjzqmRcR31So2jf9kiy63HemPa5AKuKHjQkCWmtYBs'

  beforeEach(() => {
    payments = Payments.getInstance({ nvmApiKey: subscriberNvmApiKeyHash, environment: 'sandbox' })
  })

  afterEach(async () => {
    // Clear the client registry after each test
    try {
      payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'test-agent',
        planId: 'test-plan',
      })
    } catch {
      // Ignore errors during cleanup
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  })

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  describe('ClientRegistry', () => {
    it('should register and retrieve a client by agentId and planId', async () => {
      const registry = new ClientRegistry(payments)
      const client1 = registry.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'alice-agent',
        planId: 'plan-1',
      })
      const client2 = registry.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'alice-agent',
        planId: 'plan-1',
      })
      expect(client1).toBe(client2) // Same client instance for same combination

      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    it('should create different clients for different combinations', async () => {
      const registry = new ClientRegistry(payments)
      const client1 = registry.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'alice-agent',
        planId: 'plan-1',
      })
      const client2 = registry.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'bob-agent',
        planId: 'plan-1',
      })
      expect(client1).not.toBe(client2)

      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    it('should throw if required fields are missing', () => {
      const registry = new ClientRegistry(payments)
      expect(() => registry.getClient({} as any)).toThrow('Missing required fields')
    })
  })

  describe('buildPaymentAgentCard', () => {
    it('should build a valid agent card with required fields', () => {
      const baseCard = {
        name: 'Test Agent',
        description: 'A test agent for payments',
        capabilities: {
          tools: ['text-generation'],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3001',
        version: '1.0.0',
      }
      const paymentMetadata = {
        paymentType: 'fixed' as const,
        credits: 10,
        agentId: 'agent1',
        costDescription: '10 credits per request',
      }

      const card = buildPaymentAgentCard(baseCard, paymentMetadata)
      expect(card.name).toBe('Test Agent')
      expect(card.description).toBe('A test agent for payments')
      expect(card.capabilities?.extensions).toHaveLength(1)
      expect(card.capabilities?.extensions?.[0].uri).toBe('urn:nevermined:payment')
    })

    it('should build agent card with optional fields', () => {
      const baseCard = {
        name: 'Test Agent 2',
        description: 'Another test agent',
        capabilities: {
          tools: ['image-analysis'],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3002',
        version: '1.0.0',
      }
      const paymentMetadata = {
        paymentType: 'dynamic' as const,
        credits: 5,
        agentId: 'agent2',
        planId: 'plan-123',
        costDescription: '5 credits per request',
      }

      const card = buildPaymentAgentCard(baseCard, paymentMetadata)
      expect(card.capabilities?.extensions).toHaveLength(1)
      const paymentExtension = card.capabilities?.extensions?.[0]
      expect(paymentExtension?.uri).toBe('urn:nevermined:payment')
      expect((paymentExtension?.params as any)?.planId).toBe('plan-123')
    })

    it('should build agent card with trial plan', () => {
      const baseCard = {
        name: 'Trial Test Agent',
        description: 'A trial test agent',
        capabilities: {
          tools: ['text-generation'],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3004',
        version: '1.0.0',
      }
      const paymentMetadata = {
        paymentType: 'fixed' as const,
        credits: 0,
        agentId: 'trial-agent',
        isTrialPlan: true,
        costDescription: 'Trial service - 0 credits',
      }

      const card = buildPaymentAgentCard(baseCard, paymentMetadata)
      expect(card.capabilities?.extensions).toHaveLength(1)
      const paymentExtension = card.capabilities?.extensions?.[0]
      expect(paymentExtension?.uri).toBe('urn:nevermined:payment')
      expect((paymentExtension?.params as any)?.isTrialPlan).toBe(true)
      expect((paymentExtension?.params as any)?.credits).toBe(0)
    })

    it('should throw if paymentType is missing', () => {
      const baseCard = {
        name: 'Test Agent',
        description: 'A test agent',
        capabilities: {
          tools: [],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3001',
        version: '1.0.0',
      }
      expect(() => buildPaymentAgentCard(baseCard, {} as any)).toThrow('paymentType is required')
    })

    it('should throw if credits is missing or invalid for paid plans', () => {
      const baseCard = {
        name: 'Test Agent',
        description: 'A test agent',
        capabilities: {
          tools: [],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3001',
        version: '1.0.0',
      }

      // Missing credits for paid plan
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'fixed',
          agentId: 'test-agent',
        } as any),
      ).toThrow('credits must be a positive number for paid plans')

      // Zero credits for paid plan
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'fixed',
          credits: 0,
          agentId: 'test-agent',
        } as any),
      ).toThrow('credits must be a positive number for paid plans')

      // Negative credits
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'fixed',
          credits: -1,
          agentId: 'test-agent',
        } as any),
      ).toThrow('credits cannot be negative')
    })

    it('should allow zero credits for trial plans', () => {
      const baseCard = {
        name: 'Test Agent',
        description: 'A test agent',
        capabilities: {
          tools: [],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3001',
        version: '1.0.0',
      }

      // Trial plan with 0 credits
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'fixed',
          credits: 0,
          agentId: 'test-agent',
          isTrialPlan: true,
        }),
      ).not.toThrow()

      // Trial plan with positive credits
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'dynamic',
          credits: 5,
          agentId: 'test-agent',
          isTrialPlan: true,
        }),
      ).not.toThrow()
    })

    it('should throw if agentId is missing', () => {
      const baseCard = {
        name: 'Test Agent',
        description: 'A test agent',
        capabilities: {
          tools: [],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3001',
        version: '1.0.0',
      }
      expect(() =>
        buildPaymentAgentCard(baseCard, {
          paymentType: 'fixed',
          credits: 10,
        } as any),
      ).toThrow('agentId is required')
    })
  })

  describe('Payments A2A Integration', () => {
    it('should expose a2a property with start and getClient methods', () => {
      expect(payments.a2a).toBeDefined()
      expect(typeof payments.a2a.start).toBe('function')
      expect(typeof payments.a2a.getClient).toBe('function')
    })

    it('should initialize client registry only when getClient is called', async () => {
      const client = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'test-agent',
        planId: 'test-plan',
      })
      expect(client).toBeDefined()
      expect(client).toBeInstanceOf(Object) // PaymentsClient instance

      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    it('should reuse existing registry on subsequent getClient calls', async () => {
      const client1 = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'test-agent',
        planId: 'test-plan',
      })

      const client2 = payments.a2a.getClient({
        agentBaseUrl: 'http://localhost:3001',
        agentId: 'test-agent-2',
        planId: 'test-plan',
      })

      expect(client1).toBeDefined()
      expect(client2).toBeDefined()
      expect(client1).not.toBe(client2) // Different clients for different combinations

      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  })

  describe('Static A2A Utilities', () => {
    it('should expose buildPaymentAgentCard as static method', () => {
      expect(Payments.a2a).toBeDefined()
      expect(typeof Payments.a2a.buildPaymentAgentCard).toBe('function')
    })

    it('should build agent card using static method', () => {
      const baseCard = {
        name: 'Static Test Agent',
        description: 'Test agent built via static method',
        capabilities: {
          tools: ['text-generation'],
          extensions: [],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [],
        url: 'http://localhost:3003',
        version: '1.0.0',
      }
      const paymentMetadata = {
        paymentType: 'fixed' as const,
        credits: 15,
        agentId: 'static-agent',
        costDescription: '15 credits per request',
      }

      const card = Payments.a2a.buildPaymentAgentCard(baseCard, paymentMetadata)
      expect(card.name).toBe('Static Test Agent')
      expect((card.capabilities?.extensions?.[0]?.params as any)?.agentId).toBe('static-agent')
    })
  })
})
