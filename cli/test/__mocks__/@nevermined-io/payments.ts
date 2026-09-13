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
  /** Decimal string — the wire shape. See SDK PlanBalance.balance (#440/#441). */
  balance: string
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
  /** EIP-712 version of the returned token: 3 means single-use. */
  tokenVersion: 2 | 3
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
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2027,
  },
  {
    id: 'pm_test_mc_5555',
    type: 'card',
    brand: 'mastercard',
    last4: '5555',
    expMonth: 6,
    expYear: 2028,
  },
]

export const Payments = {
  getInstance: jest.fn(() => ({
    plans: {
      // Mirrors PlansAPI.getPlans, which returns { total, page, offset, plans }
      // — NOT { data }. The old shape was drift nothing could catch, because
      // the only test reading it is in jest's testPathIgnorePatterns.
      getPlans: jest.fn(async () => ({
        total: mockPlans.length,
        page: 1,
        offset: 100,
        plans: mockPlans,
      })),
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
          balance: '1000',
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
      // Signature matches the SDK: (planId, agentId, tokenOptions). It used to
      // carry three extra positional parameters the SDK dropped long ago, which
      // pushed `tokenOptions` to slot 6 — so the scheme was never read and the
      // two fiat cases in `test/unit/x402.test.ts` were failing unnoticed (that
      // file is not part of the `test:unit` CI target).
      getX402AccessToken: jest.fn(async (planId: string, _agentId?: string, tokenOptions?: any): Promise<MockX402Token> => {
        const suffix = tokenOptions?.scheme === 'nvm:card-delegation' ? '-fiat' : ''
        return {
          accessToken: `mock-token-for-${planId}${suffix}`,
          // NOT what the SDK does — it reads the version off the minted token.
          // This mock has no decodable envelope, so it echoes; CLI tests cover
          // that the field is plumbed through, never the detection itself.
          tokenVersion: tokenOptions?.tokenVersion === 3 ? 3 : 2,
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
