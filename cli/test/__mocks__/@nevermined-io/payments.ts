/**
 * Manual mock for @nevermined-io/payments
 */

export interface MockPlan {
  did: string
  name: string
  planType: string
  createdAt: string
}

export interface MockPlanBalance {
  planId: string
  planName: string
  planType: string
  holderAddress: string
  balance: bigint
  creditsContract: string
  isSubscriber: boolean
  pricePerCredit: number
}

export interface MockAgent {
  did: string
  name: string
  planDid: string
  createdAt: string
}

export interface MockX402Token {
  accessToken: string
}

const mockPlans: MockPlan[] = [
  {
    did: 'did:nvm:test-plan-1',
    name: 'Test Plan 1',
    planType: 'credits',
    createdAt: '2026-01-31T00:00:00Z',
  },
  {
    did: 'did:nvm:test-plan-2',
    name: 'Test Plan 2',
    planType: 'time',
    createdAt: '2026-01-30T00:00:00Z',
  },
]

const mockAgents: MockAgent[] = [
  {
    did: 'did:nvm:test-agent-1',
    name: 'Test Agent 1',
    planDid: 'did:nvm:test-plan-1',
    createdAt: '2026-01-31T00:00:00Z',
  },
]

const mockPaymentMethods = [
  {
    id: 'pm_test_visa_4242',
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2027,
  },
  {
    id: 'pm_test_mc_5555',
    brand: 'mastercard',
    last4: '5555',
    expMonth: 6,
    expYear: 2028,
  },
]

export const Payments = {
  getInstance: jest.fn(() => ({
    plans: {
      getPlans: jest.fn(async () => ({ data: mockPlans })),
      getPlan: jest.fn(async (planId: string) => {
        const plan = mockPlans.find((p) => p.did === planId)
        if (!plan) throw new Error(`Plan ${planId} not found`)
        return plan
      }),
      getPlanBalance: jest.fn(async (planId: string, _accountAddress?: string): Promise<MockPlanBalance> => {
        const plan = mockPlans.find((p) => p.did === planId)
        if (!plan) throw new Error(`Plan ${planId} not found`)

        return {
          planId: plan.did,
          planName: plan.name,
          planType: plan.planType,
          holderAddress: '0x1234567890123456789012345678901234567890',
          balance: BigInt(1000),
          creditsContract: '0x0987654321098765432109876543210987654321',
          isSubscriber: true,
          pricePerCredit: 0.01,
        }
      }),
    },
    agents: {
      getAgent: jest.fn(async (agentId: string) => {
        const agent = mockAgents.find((a) => a.did === agentId)
        if (!agent) throw new Error(`Agent ${agentId} not found`)
        return agent
      }),
    },
    x402: {
      getX402AccessToken: jest.fn(async (planId: string, _agentId?: string, _redemptionLimit?: any, _orderLimit?: string, _expiration?: string, tokenOptions?: any): Promise<MockX402Token> => {
        const suffix = tokenOptions?.scheme === 'nvm:card-delegation' ? '-fiat' : ''
        return {
          accessToken: `mock-token-for-${planId}${suffix}`,
        }
      }),
    },
    delegation: {
      listPaymentMethods: jest.fn(async () => mockPaymentMethods),
    },
  })),
}

export const resolveScheme = jest.fn(async (_payments: any, _planId: string) => {
  return 'nvm:erc4337'
})

// Re-export as default for compatibility
export default { Payments, resolveScheme }
